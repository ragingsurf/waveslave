// Tests for the room's socket (spec "Socket protocol" and "Moderation", step 3): hello and history, older, say, report,
// like, delete and nick, the rate limits, the 4 KB and bad-frame rules, the cap on sockets per address, signing out
// everywhere, the keepalive tick and the ping auto-response, and a room that hibernates with sockets open. They run
// inside the Workers runtime (see vitest.config.mjs). Run from chat/:
// npx vitest run --no-isolate --max-workers=1 test/socket.spec.mjs
//
// Each test opens its sockets on a room of its own, straight on the room's /r/ws: the Worker in front only checks the
// Origin and passes the upgrade on (worker.spec.mjs). One test goes through the Worker to the real "taiwan" room, and
// closes its socket again. Accounts are written straight into the room's tables, with session tokens signed by the
// test secret. Tests that move time set the room's clock (room.now) to T and move it with clock.t. The room, account
// and socket helpers are in helpers.mjs, shared with mod-admin.spec.mjs and me.spec.mjs.
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { randomB64u, sha256b64u, signToken } from "../src/auth.js";
import { checkNick } from "../src/mod.js";
import {
  DAY, HOUR, MIN, SEC, addMessages, addUser, all, client, closeClients, connect, join, newRoom, nextError, ofType, say, settle,
  take, until,
} from "./helpers.mjs";

const ORIGIN = "https://waveslave.tw";
const BASE = "https://chat.example";
// 12:00 UTC on a day years ahead, so no alarm a test sets goes off by itself, and the daily run (19:00 UTC) is 7 hours on.
const T = Date.UTC(2030, 5, 3, 12, 0);

const PUBLIC_KEYS = ["body", "id", "kind", "likes", "nick", "reply_to", "role", "spot", "ts"];

// A room of its own. With `at`, its clock stands at that time until the test moves clock.t.
const freshRoom = (at) => newRoom("socket", at);

afterEach(closeClients);

const msgWith = (text) => (f) => f?.type === "msg" && f.msg.body.text === text;
const textCount = (r) => r.rows("SELECT count(*) AS n FROM messages").then(([{ n }]) => n);

// ---- Reading -------------------------------------------------------------------------------------------------------

describe("reading", () => {
  it("hello without a token gets the history, and a reader can't say (error auth): nothing is stored", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const [id] = await r.inRoom((room) => {
      const added = room.sql
        .exec(
          "INSERT INTO messages (ts, uid, kind, spot, body) VALUES (?, ?, 'text', 'jinshan', ?) RETURNING id",
          Date.now() - MIN, a.id, JSON.stringify({ text: "Clean sets at the point" }),
        )
        .one().id;
      room.messagesChanged();
      return [added];
    });
    const reader = await join(r);
    expect(reader.history).toEqual({
      type: "history",
      messages: [
        {
          id, ts: expect.any(Number), nick: a.nick, role: "user", kind: "text", spot: "jinshan",
          body: { text: "Clean sets at the point" }, reply_to: null, likes: 0,
        },
      ],
    });
    expect(all(reader, "me")).toEqual([]);
    say(reader, "Can I post?");
    expect(await nextError(reader)).toEqual({ type: "error", code: "auth", for: "say" });
    expect(await textCount(r)).toBe(1);
  });

  it("a reader may send only hello and older: every write gets error auth", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const [id] = await addMessages(r, a.id, 1);
    const reader = await join(r);
    const writes = [
      { type: "report", spot: "jinshan", size: "chest", cond: "clean", crowd: "few" },
      { type: "like", id },
      { type: "delete", id },
      { type: "nick", nick: "Sneaky" },
    ];
    for (const frame of writes) {
      reader.send(frame);
      expect(await nextError(reader), frame.type).toEqual({ type: "error", code: "auth", for: frame.type });
    }
    expect(await r.rows("SELECT likes FROM messages WHERE id = ?", id)).toEqual([{ likes: 0 }]);
  });

  it("hello with a good token gets me {nick, role} first, then the history", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const c = await join(r, a);
    const me = c.frames.findIndex(ofType("me"));
    expect(c.frames[me]).toEqual({ type: "me", nick: a.nick, role: "user" });
    expect(me).toBeLessThan(c.frames.findIndex(ofType("history")));
    expect(c.history.messages).toEqual([]);
  });

  it("hello with a token that doesn't check out gets error auth (banned: error banned), then the history as a reader", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const banned = await addUser(r);
    await r.inRoom((room) => room.sql.exec("UPDATE subs SET banned = 1 WHERE sub_hash = ?", banned.sub));
    const cases = {
      expired: [await signToken({ uid: a.id, tv: 0, exp: Date.now() - 1 }, env.SESSION_SECRET), "auth"],
      forged: [await signToken({ uid: a.id, tv: 0, exp: Date.now() + DAY }, "another-secret"), "auth"],
      "old tv": [await signToken({ uid: a.id, tv: 1, exp: Date.now() + DAY }, env.SESSION_SECRET), "auth"],
      "no such user": [await signToken({ uid: crypto.randomUUID(), tv: 0, exp: Date.now() + DAY }, env.SESSION_SECRET), "auth"],
      "not a token": [42, "auth"],
      banned: [banned.token, "banned"],
    };
    for (const [name, [token, code]] of Object.entries(cases)) {
      const c = await connect(r);
      c.send({ type: "hello", v: 1, token });
      expect(await nextError(c), name).toEqual({ type: "error", code, for: "hello" });
      expect((await take(c, ofType("history"))).messages, name).toEqual([]);
      expect(all(c, "me"), name).toEqual([]);
      say(c, "hi");
      expect((await nextError(c)).code, name).toBe("auth");
    }
  });

  it("older {before_id} gets the 50 before it, at most one page a second per socket", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const ids = await addMessages(r, a.id, 120);
    const c = await join(r);
    expect(c.history.messages.map((m) => m.id)).toEqual(ids.slice(-100));
    c.send({ type: "older", before_id: ids[100] });
    const page = await take(c, ofType("history"));
    expect(page.before_id).toBe(ids[100]);
    expect(page.messages.map((m) => m.id)).toEqual(ids.slice(50, 100));
    for (const m of page.messages) expect(Object.keys(m).sort()).toEqual(PUBLIC_KEYS);
    r.clock.t += 999;
    c.send({ type: "older", before_id: ids[50] });
    expect(await nextError(c)).toEqual({ type: "error", code: "slow:1", for: "older" });
    // Another socket has its own allowance.
    const other = await join(r);
    other.send({ type: "older", before_id: ids[50] });
    expect((await take(other, ofType("history"))).messages.map((m) => m.id)).toEqual(ids.slice(0, 50));
    r.clock.t += 1;
    c.send({ type: "older", before_id: ids[50] });
    expect((await take(c, ofType("history"))).messages.map((m) => m.id)).toEqual(ids.slice(0, 50));
  });

  it("older with a before_id that isn't a message id -> error invalid", async () => {
    const r = await freshRoom(T);
    const c = await join(r);
    for (const before_id of ["12", -1, 0, 1.5]) {
      r.clock.t += SEC;
      c.send({ type: "older", before_id });
      expect(await nextError(c), String(before_id)).toEqual({ type: "error", code: "invalid", for: "older" });
    }
  });
});

// ---- Saying --------------------------------------------------------------------------------------------------------

describe("say", () => {
  it("-> msg to all three sockets, with the nickname, no user id, and the spot tag taken from the frame", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const b = await addUser(r);
    const sockets = [await join(r, a), await join(r, b), await join(r)];
    say(sockets[0], "Offshore at the point", { spot: "jinshan" });
    const got = await Promise.all(sockets.map((c) => take(c, ofType("msg"))));
    for (const frame of got) {
      expect(Object.keys(frame)).toEqual(["type", "msg"]);
      expect(Object.keys(frame.msg).sort()).toEqual(PUBLIC_KEYS);
      expect(frame.msg).toMatchObject({
        nick: a.nick, role: "user", kind: "text", spot: "jinshan", body: { text: "Offshore at the point" }, reply_to: null, likes: 0,
      });
      const text = JSON.stringify(frame);
      expect(text).not.toContain(a.id);
      expect(text).not.toContain(a.sub);
    }
    expect(await r.rows("SELECT id, uid, kind, spot, body, reply_to FROM messages")).toEqual([
      { id: got[0].msg.id, uid: a.id, kind: "text", spot: "jinshan", body: JSON.stringify({ text: "Offshore at the point" }), reply_to: null },
    ]);
  });

  it("with no spot has no tag (All), and a reply takes its parent's tag whatever the frame says", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const b = await addUser(r);
    const ca = await join(r, a);
    const cb = await join(r, b);
    say(ca, "Anyone out today?");
    expect((await take(cb, msgWith("Anyone out today?"))).msg.spot).toBeNull();
    say(cb, "Fulong is fun", { spot: "fulong" });
    const parent = (await take(ca, msgWith("Fulong is fun"))).msg;
    r.clock.t += 6 * SEC;
    say(ca, "How big?", { spot: "wushi", reply_to: parent.id });
    expect((await take(cb, msgWith("How big?"))).msg).toMatchObject({ spot: "fulong", reply_to: parent.id });
  });

  it("stores the text as normalise() leaves it, trimmed: no hidden characters", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const c = await join(r, a);
    say(c, "​  Offshore‮ wind  ");
    expect((await take(c, ofType("msg"))).msg.body).toEqual({ text: "Offshore wind" });
  });

  it("takes 500 characters, and refuses with error invalid anything else that isn't right, storing nothing", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const [hidden] = await addMessages(r, a.id, 1, { hidden_by: "flags" });
    const c = await join(r, a);
    say(c, "浪".repeat(500));
    expect((await take(c, ofType("msg"))).msg.body.text).toHaveLength(500);
    const bad = [
      { type: "say" },
      { type: "say", text: 42 },
      { type: "say", text: "" },
      { type: "say", text: " ​ \n " },
      { type: "say", text: "x".repeat(501) },
      { type: "say", text: "hi", spot: "pipeline" },
      { type: "say", text: "hi", spot: 5 },
      { type: "say", text: "hi", reply_to: "1" },
      { type: "say", text: "hi", reply_to: 0 },
    ];
    let s;
    for (const [k, frame] of bad.entries()) {
      // Four bad frames at most per socket: the fifth would close it.
      if (k % 4 === 0) s = await join(r, a);
      s.send(frame);
      expect(await nextError(s), JSON.stringify(frame).slice(0, 60)).toEqual({ type: "error", code: "invalid", for: "say" });
    }
    // A reply to a message that isn't there to see is gone, not invalid.
    for (const reply_to of [999_999, hidden]) {
      c.send({ type: "say", text: "hi", reply_to });
      expect(await nextError(c), String(reply_to)).toEqual({ type: "error", code: "gone", for: "say", reply_to });
    }
    expect(await textCount(r)).toBe(2);
  });
});

// ---- Size and bad frames -------------------------------------------------------------------------------------------

describe("frames", () => {
  // A say frame of exactly `bytes` bytes of UTF-8, padded with `ch` (1 or 3 bytes).
  const sized = (bytes, ch = "x") => {
    const head = JSON.stringify({ type: "say", text: "" }).length;
    const width = new TextEncoder().encode(ch).length;
    const text = ch.repeat(Math.floor((bytes - head) / width)) + "x".repeat((bytes - head) % width);
    const frame = JSON.stringify({ type: "say", text });
    expect(new TextEncoder().encode(frame).length).toBe(bytes);
    return frame;
  };

  it("reads a frame of 4 KB, and closes the socket (1009) on a bigger one, after error size", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const c = await join(r, a);
    c.send(sized(4096));
    expect(await nextError(c)).toEqual({ type: "error", code: "invalid", for: "say" }); // over 500 characters
    expect(c.closed).toBeNull();
    c.send(sized(4097));
    expect(await nextError(c)).toEqual({ type: "error", code: "size" });
    await until(() => c.closed !== null, "the close");
    expect(c.closed).toBe(1009);
  });

  it("counts the bytes, not the characters: 1,400 three-byte characters are over 4 KB", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const c = await join(r, a);
    const frame = sized(4200, "浪");
    expect(frame.length).toBeLessThan(4096);
    c.send(frame);
    expect(await nextError(c)).toEqual({ type: "error", code: "size" });
    await until(() => c.closed !== null, "the close");
    expect(c.closed).toBe(1009);
  });

  it("closes the socket (1008) on the fifth bad frame, each one answered with error invalid", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const c = await join(r, a);
    const bad = ["not json", "[1,2]", "null", JSON.stringify({ type: "dance" }), JSON.stringify({ type: 7 })];
    for (const [k, frame] of bad.entries()) {
      c.send(frame);
      expect(await nextError(c), frame).toEqual({ type: "error", code: "invalid" });
      if (k < 4) {
        // Still open: it answers a ping.
        c.send("ping");
        await take(c, (f) => f === "pong");
        expect(c.closed).toBeNull();
      }
    }
    await until(() => c.closed !== null, "the close");
    expect(c.closed).toBe(1008);
  });

  it("counts a binary frame, and a reader's writes, as bad frames too", async () => {
    const r = await freshRoom();
    const reader = await join(r);
    reader.ws.send(new Uint8Array([123, 125]));
    expect(await nextError(reader)).toEqual({ type: "error", code: "invalid" });
    for (let k = 0; k < 4; k++) {
      say(reader, `hi ${k}`);
      expect((await nextError(reader)).code).toBe("auth");
    }
    await until(() => reader.closed !== null, "the close");
    expect(reader.closed).toBe(1008);
  });

  it("doesn't count blocked or slow writes as bad: a user who keeps hitting them stays connected", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const c = await join(r, a);
    say(c, "first");
    await take(c, ofType("msg"));
    for (let k = 0; k < 6; k++) {
      say(c, k % 2 ? "加LINE abc" : "too soon");
      expect((await nextError(c)).code).toMatch(/^(blocked:line|slow:5)$/);
    }
    c.send("ping");
    await take(c, (f) => f === "pong");
    expect(c.closed).toBeNull();
  });

  it("doesn't count a frame about a message that has just gone as bad: error gone, and the socket stays open", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const b = await addUser(r);
    const ca = await join(r, a);
    const cb = await join(r, b);
    say(ca, "Here a moment");
    const { msg } = await take(cb, ofType("msg"));
    ca.send({ type: "delete", id: msg.id });
    await take(cb, (f) => f?.type === "update" && f.deleted);
    // b's taps were on their way as it went: a like, a reply and a flag, twice over, and a's second tap on Delete.
    for (let k = 0; k < 2; k++) {
      cb.send({ type: "like", id: msg.id });
      cb.send({ type: "say", text: "Nice", reply_to: msg.id });
      cb.send({ type: "flag", id: msg.id, reason: "spam" });
    }
    // Each answer names what it was about, so the app knows which message to take off its screen.
    for (const type of ["like", "say", "flag", "like", "say", "flag"]) {
      expect(await nextError(cb)).toEqual({ type: "error", code: "gone", for: type, [type === "say" ? "reply_to" : "id"]: msg.id });
    }
    ca.send({ type: "delete", id: msg.id });
    expect(await nextError(ca)).toEqual({ type: "error", code: "gone", for: "delete", id: msg.id });
    cb.send("ping");
    await take(cb, (f) => f === "pong");
    expect([ca.closed, cb.closed]).toEqual([null, null]);
    expect(await r.inRoom((room, state) => state.getWebSockets().map((ws) => ws.deserializeAttachment().bad))).toEqual([0, 0]);
    // And b can still post.
    say(cb, "Still here");
    await take(ca, msgWith("Still here"));
  });
});

// ---- Frames per socket (ruling R22) --------------------------------------------------------------------------------

// Each test sends 1,000 frames or more, so it may take longer than the usual 5 s.
describe("frames per socket", { timeout: 60_000 }, () => {
  // FRAMES_PER_SOCKET in room.js: one socket may send 1,000 frames, 1% of the free plan's 100,000 requests a day, counting
  // every frame the room's code sees (hello, and refused and invalid ones too). The next one closes it with 1008,
  // unanswered. Frames that reach it once it is closed aren't answered, but they are still counted, so rest() still guards
  // the day's limit against a client that ignores the close. Bryan's sockets aren't counted.
  const CAP = 1000;
  const requests = (r) => r.inRoom((room) => room.usage("req", 0).req);
  // The room's answers to older {before_id: 1} on c so far: a page (empty: nothing is older than id 1), or slow:1 while the
  // room's clock stands still.
  const olderAnswers = (c) =>
    c.frames.filter((f) => (f?.type === "history" && f.before_id === 1) || (f?.type === "error" && f.for === "older")).length;
  // n frames from c that the room refuses or answers without closing it, sent at once; resolves once each is answered.
  async function spend(c, n) {
    const before = olderAnswers(c);
    for (let k = 0; k < n; k++) c.send({ type: "older", before_id: 1 });
    await until(() => olderAnswers(c) === before + n, `${n} answers`, 30_000);
  }
  const stillOpen = async (c) => {
    c.send("ping");
    await take(c, (f) => f === "pong");
    expect(c.closed).toBeNull();
  };

  it("closes a reader's socket (1008) on its 1,001st frame, refused and invalid ones counted; then it costs nothing", async () => {
    const r = await freshRoom(T);
    const c = await join(r); // its hello is frame 1
    for (const bad of ["not json", "[1]", "null", JSON.stringify({ type: "dance" })]) c.send(bad);
    await until(() => all(c, "error").filter((f) => f.code === "invalid").length === 4, "the four invalid answers");
    await spend(c, CAP - 5); // slow:1 for all but the first: 1,000 frames in all
    await stillOpen(c);
    const before = await requests(r);
    const answered = c.frames.length;
    c.send({ type: "older", before_id: 1 });
    await until(() => c.closed !== null, "the close", 5000);
    expect(c.closed).toBe(1008);
    expect(c.frames.length).toBe(answered);
    expect(await requests(r)).toBe(before + 1);
    // Whatever it tries to send now never reaches the room, so the day's budget stops growing from it. (Its own end won't
    // send once it has seen the close; frames already on their way when the close came are the next test's.)
    for (let k = 0; k < 20; k++) {
      try {
        c.send({ type: "older", before_id: 1 });
      } catch {
        // Closed.
      }
    }
    await settle();
    expect(await requests(r)).toBe(before + 1);
    expect(await r.inRoom((room) => room.online())).toBe(0);
  });

  // Sends hello and then `frames` on a new socket of r's in one go, before the room's close can reach this end, so frames
  // after the one that closes it are already on their way when it comes, and the runtime still hands them to the room, as
  // it would a client's that ignores the close. With `startAt`, the day's request count is set to it first. Waits for the
  // close and until the room stops being handed frames. Returns the close code, how many frames the room's code was
  // handed, how many answers it sent and how many room requests the socket added.
  async function burst(r, frames, startAt) {
    const c = await connect(r);
    await r.inRoom((room) => {
      const handle = room.webSocketMessage.bind(room);
      const send = room.send.bind(room);
      room.handed = 0;
      room.answered = 0;
      room.webSocketMessage = (ws, message) => {
        room.handed += 1;
        return handle(ws, message);
      };
      room.send = (ws, frame) => {
        room.answered += 1;
        return send(ws, frame);
      };
      if (startAt !== undefined) room.usage("req", startAt - room.usage("req", 0).req);
    });
    const handed = () => r.inRoom((room) => room.handed);
    const before = await requests(r);
    c.send({ type: "hello", v: 1 });
    for (const frame of frames) c.send(frame);
    await until(() => c.closed !== null, "the close", 30_000);
    for (let last = -1; ; ) {
      await settle();
      const now = await handed();
      if (now === last) break;
      last = now;
    }
    const answered = await r.inRoom((room) => room.answered);
    return { closed: c.closed, handed: await handed(), answered, added: (await requests(r)) - before };
  }
  const olders = (n) => Array.from({ length: n }, () => ({ type: "older", before_id: 1 }));

  it("answers none of the frames that reach it closed, but counts each one: a burst of 3,000 sent without waiting", async () => {
    const r = await freshRoom(T);
    const sent = await burst(r, olders(3 * CAP));
    expect(sent.closed).toBe(1008);
    // Some of the burst did reach the closed socket, so this checks something.
    expect(sent.handed).toBeGreaterThan(CAP + 1);
    // Answered: hello, with the history, and the 999 older frames after it. The one that closed it went unanswered, and so
    // did every later one.
    expect(sent.answered).toBe(CAP);
    // Every frame the room was handed is a room request, the ones that reached it closed too.
    expect(sent.added).toBe(sent.handed);
    expect(await r.inRoom((room) => room.online())).toBe(0);
  });

  it("nor after the fifth bad frame (1008) or a frame over 4 KB (1009), and counts those too", async () => {
    const bad = await burst(await freshRoom(T), Array.from({ length: CAP }, () => "not json"));
    expect(bad.closed).toBe(1008);
    expect(bad.handed).toBeGreaterThan(6);
    expect(bad.answered).toBe(6); // hello's history and the five invalid answers
    expect(bad.added).toBe(bad.handed);
    const big = JSON.stringify({ type: "say", text: "x".repeat(4096) });
    const tooBig = await burst(await freshRoom(T), [big, ...olders(CAP)]);
    expect(tooBig.closed).toBe(1009);
    expect(tooBig.handed).toBeGreaterThan(2);
    expect(tooBig.answered).toBe(2); // hello's history and error size
    expect(tooBig.added).toBe(tooBig.handed);
  });

  it("still rests at 90% when a client keeps sending past the close: what reaches it closed counts", async () => {
    const r = await freshRoom(T);
    const reader = await join(r);
    // The day's count stands where the burst's 1,000 frames and the one that closes it take it to 90,000 exactly, the
    // most the chat answers at; only a frame that reaches the closed socket can take it past, and rest() then trips.
    const sent = await burst(r, olders(3 * CAP), 90_000 - (CAP + 1));
    expect(sent.closed).toBe(1008);
    expect(sent.handed).toBeGreaterThan(CAP + 1);
    expect(sent.answered).toBe(CAP);
    await until(() => reader.closed !== null, "the reader's socket to close");
    expect(reader.closed).toBe(4429);
    expect(await requests(r)).toBe(90_000 + sent.handed - (CAP + 1));
    const res = await r.stub.fetch("https://room/r/reports?spot=jinshan");
    expect([res.status, await res.json()]).toEqual([503, { resting: true }]);
  });

  it("counts a signed-in socket's refused writes too", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const c = await join(r, a);
    say(c, "first");
    await take(c, msgWith("first"));
    // Each of these is slow:5, as the room's clock stands still.
    for (let k = 0; k < CAP - 2; k++) say(c, `again ${k}`);
    await until(() => all(c, "error").length === CAP - 2, "the slow answers", 30_000);
    await stillOpen(c);
    say(c, "one too many");
    await until(() => c.closed !== null, "the close", 5000);
    expect(c.closed).toBe(1008);
    expect(all(c, "error").length).toBe(CAP - 2);
  });

  it("keeps the count with the socket through hibernation", async () => {
    const r = await freshRoom(T);
    const c = await join(r);
    await spend(c, 600);
    await evictDurableObject(r.stub);
    await spend(c, CAP - 601);
    await stillOpen(c);
    c.send({ type: "older", before_id: 1 });
    await until(() => c.closed !== null, "the close", 5000);
    expect(c.closed).toBe(1008);
  });

  it("leaves normal use alone: a reconnecting client starts again from nothing, and can post at its last frame", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const first = await join(r, a);
    await spend(first, CAP - 1);
    await stillOpen(first);
    first.ws.close(1000, "back in a moment");
    const again = await join(r, a);
    await spend(again, CAP - 2);
    say(again, "Still here"); // its 1,000th frame
    await take(again, msgWith("Still here"));
    await stillOpen(again);
  });

  it("never counts Bryan's sockets: his tools keep working past 1,000 frames", async () => {
    const r = await freshRoom(T);
    const bryan = await addUser(r, { role: "admin" });
    const c = await join(r, bryan);
    for (let k = 0; k < CAP + 50; k++) c.send({ type: "hidden_list" });
    await until(() => all(c, "hidden").length === CAP + 50, "his hidden lists", 30_000);
    await stillOpen(c);
    c.send({ type: "lock" });
    expect(await take(c, ofType("ok"))).toEqual({ type: "ok", for: "lock" });
  });
});

// ---- Blocks and limits ---------------------------------------------------------------------------------------------

describe("blocks and rate limits", () => {
  it("say 加LINE abc -> error blocked:line, with nothing stored or sent to anyone", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const c = await join(r, a);
    const reader = await join(r);
    say(c, "加LINE abc");
    expect(await nextError(c)).toEqual({ type: "error", code: "blocked:line", for: "say" });
    await settle();
    expect(all(reader, "msg")).toEqual([]);
    expect(await textCount(r)).toBe(0);
  });

  it("a second say within 5 s -> error slow:<seconds left>; one 5 s after the first goes", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const c = await join(r, a);
    say(c, "one");
    await take(c, msgWith("one"));
    r.clock.t += 2 * SEC;
    say(c, "two");
    expect(await nextError(c)).toEqual({ type: "error", code: "slow:3", for: "say" });
    r.clock.t += 3 * SEC;
    say(c, "three");
    await take(c, msgWith("three"));
    expect(await textCount(r)).toBe(2);
  });

  it("a blocked say doesn't use up the 5 s", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const c = await join(r, a);
    say(c, "call me 0912 345 678");
    expect((await nextError(c)).code).toBe("blocked:phone");
    say(c, "Never mind");
    await take(c, msgWith("Never mind"));
  });

  it("the 11th message within an hour from an account under 24 hours old -> slow; an older account's goes", async () => {
    const r = await freshRoom(T);
    const young = await addUser(r, { age: 23 * HOUR });
    const old = await addUser(r, { age: 25 * HOUR });
    const cy = await join(r, young);
    const co = await join(r, old);
    for (let k = 1; k <= 11; k++) {
      say(cy, `young ${k}`);
      say(co, `old ${k}`);
      await take(co, msgWith(`old ${k}`));
      if (k <= 10) await take(cy, msgWith(`young ${k}`));
      else expect(await nextError(cy)).toEqual({ type: "error", code: `slow:${(HOUR - 10 * 6 * SEC) / SEC}`, for: "say" });
      r.clock.t += 6 * SEC;
    }
  });

  it("the 21st message within 10 minutes -> slow, for any account", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r, { age: 30 * DAY });
    const c = await join(r, a);
    for (let k = 1; k <= 21; k++) {
      say(c, `m ${k}`);
      if (k <= 20) await take(c, msgWith(`m ${k}`));
      else expect(await nextError(c)).toEqual({ type: "error", code: `slow:${(10 * MIN - 20 * 6 * SEC) / SEC}`, for: "say" });
      r.clock.t += 6 * SEC;
    }
    expect(await textCount(r)).toBe(20);
  });

  it("keeps the counts in limits by LINE account, not in memory", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const c = await join(r, a);
    say(c, "counted");
    await take(c, ofType("msg"));
    const keys = (await r.rows("SELECT key FROM limits ORDER BY key")).map((row) => row.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.startsWith(`${a.sub}:`), key).toBe(true);
  });
});

// ---- Reports -------------------------------------------------------------------------------------------------------

describe("report", () => {
  const report = (spot, more = {}) => ({ type: "report", spot, size: "chest", cond: "clean", crowd: "few", ...more });

  it("-> a msg of kind report to everyone, which then shows in reportsFor", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const c = await join(r, a);
    const reader = await join(r);
    expect((await r.inRoom((room) => room.reportsFor("jinshan", T))).reports).toEqual([]);
    const snap = { hs: 1.2, hs_t: "2030-06-03T19:00", ws: 4.5, ws_t: "2030-06-03T19:00", updated: "2030-06-03T11:40:00Z" };
    c.send(report("jinshan", { snap }));
    const { msg } = await take(reader, ofType("msg"));
    expect(msg).toMatchObject({ nick: a.nick, kind: "report", spot: "jinshan", body: { size: "chest", cond: "clean", crowd: "few", snap } });
    expect((await r.inRoom((room) => room.reportsFor("jinshan", T))).reports).toEqual([{ ts: T, size: "chest", cond: "clean", crowd: "few" }]);
  });

  it("a second report on the same spot within 2 hours -> slow; other spots go, up to 6 a day", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const c = await join(r, a);
    c.send(report("jinshan"));
    await take(c, ofType("msg"));
    r.clock.t += 30 * MIN;
    c.send(report("jinshan"));
    expect(await nextError(c)).toEqual({ type: "error", code: `slow:${90 * 60}`, for: "report" });
    c.send(report("fulong"));
    expect((await take(c, ofType("msg"))).msg.spot).toBe("fulong");
    r.clock.t += 90 * MIN;
    for (const spot of ["jinshan", "nanwan", "wushi", "suao"]) {
      c.send(report(spot));
      expect((await take(c, ofType("msg"))).msg.spot).toBe(spot);
    }
    c.send(report("hualien"));
    expect(await nextError(c)).toEqual({ type: "error", code: `slow:${(DAY - 2 * HOUR) / SEC}`, for: "report" });
    expect((await r.rows("SELECT count(*) AS n FROM messages WHERE kind = 'report'"))[0].n).toBe(6);
  });

  it("refuses a report with a spot or code that isn't one, or a bad snapshot (error invalid)", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const bad = [report("pipeline"), report("jinshan", { size: "huge" }), report("jinshan", { cond: "glassy" }), report("jinshan", { snap: { hs: 99 } })];
    const c = await join(r, a);
    for (const frame of bad) {
      c.send(frame);
      expect(await nextError(c), JSON.stringify(frame)).toEqual({ type: "error", code: "invalid", for: "report" });
    }
    expect(await textCount(r)).toBe(0);
  });
});

// ---- Likes ---------------------------------------------------------------------------------------------------------

describe("like", () => {
  it("twice from one user -> likes stays 1, and everyone gets one update {id, likes}", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const b = await addUser(r);
    const [id] = await addMessages(r, b.id, 1);
    const ca = await join(r, a);
    const reader = await join(r);
    ca.send({ type: "like", id });
    expect(await take(reader, ofType("update"))).toEqual({ type: "update", id, likes: 1 });
    ca.send({ type: "like", id });
    await settle();
    expect(all(reader, "update")).toHaveLength(1);
    expect(all(ca, "error")).toEqual([]);
    expect(await r.rows("SELECT likes FROM messages WHERE id = ?", id)).toEqual([{ likes: 1 }]);
    expect(await r.rows("SELECT uid FROM likes WHERE msg_id = ?", id)).toEqual([{ uid: a.id }]);
  });

  it("the 31st like within 10 minutes -> slow", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const b = await addUser(r);
    const ids = await addMessages(r, b.id, 31);
    const c = await join(r, a);
    for (const id of ids.slice(0, 30)) {
      c.send({ type: "like", id });
      await take(c, (f) => f?.type === "update" && f.id === id);
      r.clock.t += SEC;
    }
    c.send({ type: "like", id: ids[30] });
    expect(await nextError(c)).toEqual({ type: "error", code: `slow:${(10 * MIN - 30 * SEC) / SEC}`, for: "like" });
    expect((await r.rows("SELECT count(*) AS n FROM likes"))[0].n).toBe(30);
  });

  it("refuses a like on a message that isn't there, or is hidden (error gone), or on an id that isn't one (error invalid)", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const [hidden] = await addMessages(r, a.id, 1, { hidden_by: "admin" });
    const c = await join(r, a);
    for (const id of [999_999, hidden]) {
      c.send({ type: "like", id });
      expect(await nextError(c), String(id)).toEqual({ type: "error", code: "gone", for: "like", id });
    }
    c.send({ type: "like", id: "1" });
    expect(await nextError(c)).toEqual({ type: "error", code: "invalid", for: "like" });
    expect(await r.rows("SELECT * FROM likes")).toEqual([]);
  });
});

// ---- Delete --------------------------------------------------------------------------------------------------------

describe("delete", () => {
  it("a user deletes their own message, its likes go with it, and everyone gets update {id, deleted: true}", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const b = await addUser(r);
    const ca = await join(r, a);
    const cb = await join(r, b);
    say(ca, "Oops, wrong spot", { spot: "suao" });
    const { msg } = await take(cb, ofType("msg"));
    cb.send({ type: "like", id: msg.id });
    await take(ca, ofType("update"));
    ca.send({ type: "delete", id: msg.id });
    for (const c of [ca, cb]) expect(await take(c, (f) => f?.type === "update" && f.deleted)).toEqual({ type: "update", id: msg.id, deleted: true });
    expect(await textCount(r)).toBe(0);
    expect(await r.rows("SELECT * FROM likes")).toEqual([]);
    expect((await join(r)).history.messages).toEqual([]);
  });

  it("a user can't delete someone else's message: error invalid, it stays, and nobody is told otherwise", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const b = await addUser(r);
    const ca = await join(r, a);
    const cb = await join(r, b);
    say(ca, "Mine");
    const { msg } = await take(cb, ofType("msg"));
    cb.send({ type: "delete", id: msg.id });
    expect(await nextError(cb)).toEqual({ type: "error", code: "invalid", for: "delete" });
    cb.send({ type: "delete", id: 999_999 });
    expect(await nextError(cb)).toEqual({ type: "error", code: "gone", for: "delete", id: 999_999 });
    await settle();
    expect(all(ca, "update")).toEqual([]);
    expect(await textCount(r)).toBe(1);
  });

  it("keeps a reply's reply_to after its parent is deleted, so the app can show \"Message deleted\"", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const b = await addUser(r);
    const ca = await join(r, a);
    const cb = await join(r, b);
    say(ca, "Is Wushi working?", { spot: "wushi" });
    const parent = (await take(cb, ofType("msg"))).msg;
    say(cb, "Yes, waist high", { reply_to: parent.id });
    const reply = (await take(ca, msgWith("Yes, waist high"))).msg;
    ca.send({ type: "delete", id: parent.id });
    await take(cb, (f) => f?.type === "update" && f.deleted);
    const { messages } = (await join(r)).history;
    expect(messages.map((m) => [m.id, m.reply_to])).toEqual([[reply.id, parent.id]]);
  });
});

// ---- Slash text ----------------------------------------------------------------------------------------------------

describe("say starting with a slash", () => {
  it("is dropped with error invalid and never broadcast, however the slash is written", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const c = await join(r, a);
    const reader = await join(r);
    for (const text of ["/admin x", "／admin x", "​/admin x", " \n/admin x"]) {
      say(c, text);
      expect(await nextError(c), text).toEqual({ type: "error", code: "invalid", for: "say" });
    }
    await settle();
    expect(all(reader, "msg")).toEqual([]);
    expect(await textCount(r)).toBe(0);
  });
});

// ---- Versions ------------------------------------------------------------------------------------------------------

describe("versions", () => {
  it("hello with v: 0 -> error update, and the socket is closed (4426)", async () => {
    const r = await freshRoom();
    const c = await connect(r);
    c.send({ type: "hello", v: 0 });
    expect(await nextError(c)).toEqual({ type: "error", code: "update", for: "hello" });
    await until(() => c.closed !== null, "the close");
    expect(c.closed).toBe(4426);
    expect(all(c, "history")).toEqual([]);
  });

  it("speaks only version 1 for now: no v, a string, or a newer one -> error update", async () => {
    const r = await freshRoom();
    for (const v of [undefined, "1", 2, 1.5]) {
      const c = await connect(r);
      c.send({ type: "hello", v });
      expect((await nextError(c)).code, String(v)).toBe("update");
    }
  });

  it("takes one hello per socket: a second -> error invalid", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const c = await join(r);
    c.send({ type: "hello", v: 1, token: a.token });
    expect(await nextError(c)).toEqual({ type: "error", code: "invalid", for: "hello" });
    say(c, "still a reader");
    expect((await nextError(c)).code).toBe("auth");
  });
});

// ---- One account on two sockets (Review Focus 3) -------------------------------------------------------------------

describe("the same account on two sockets", () => {
  it("checks every write against the account as it is now, not as it was at hello", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const b = await addUser(r);
    const ca = await join(r, a);
    const cb = await join(r, b);
    // Changed straight in the tables, so the sockets stay open: as for a frame already on its way when that happens.
    await r.inRoom((room) => {
      room.sql.exec("UPDATE users SET tv = tv + 1 WHERE id = ?", a.id);
      room.sql.exec("UPDATE subs SET banned = 1 WHERE sub_hash = ?", b.sub);
    });
    say(ca, "after signing out");
    expect(await nextError(ca)).toEqual({ type: "error", code: "auth", for: "say" });
    say(cb, "after a ban");
    expect(await nextError(cb)).toEqual({ type: "error", code: "banned", for: "say" });
    expect(await textCount(r)).toBe(0);
  });

  it("a message from one of them reaches the other", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const one = await join(r, a);
    const two = await join(r, a);
    say(one, "From my phone");
    expect((await take(two, ofType("msg"))).msg).toMatchObject({ nick: a.nick, body: { text: "From my phone" } });
  });

  it("signing out everywhere closes both (4401), and a reconnect with the old token gets error auth", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const b = await addUser(r);
    const one = await join(r, a);
    const two = await join(r, a);
    const other = await join(r, b);
    const reader = await join(r);
    const signOut = () => r.stub.fetch("https://room/r/me/signout", { method: "POST", headers: { Authorization: `Bearer ${a.token}` } });
    const res = await signOut();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await until(() => one.closed !== null && two.closed !== null, "both closes");
    expect([one.closed, two.closed]).toEqual([4401, 4401]);
    await settle();
    expect([other.closed, reader.closed]).toEqual([null, null]);
    expect(await r.rows("SELECT tv FROM users WHERE id = ?", a.id)).toEqual([{ tv: 1 }]);
    const again = await connect(r);
    again.send({ type: "hello", v: 1, token: a.token });
    expect(await nextError(again)).toEqual({ type: "error", code: "auth", for: "hello" });
    await take(again, ofType("history"));
    const twice = await signOut();
    expect(twice.status).toBe(401);
    expect(await twice.json()).toEqual({ error: "auth" });
  });

  it("refuses /me/signout without a good token (401 auth), changing nothing", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    for (const headers of [{}, { Authorization: "Bearer junk" }, { Authorization: `Basic ${a.token}` }, { Authorization: a.token }]) {
      const res = await r.stub.fetch("https://room/r/me/signout", { method: "POST", headers });
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(await res.json()).toEqual({ error: "auth" });
    }
    expect(await r.rows("SELECT tv FROM users WHERE id = ?", a.id)).toEqual([{ tv: 0 }]);
  });

  it("POST /me/signout through the Worker reaches the room's sign-out", async () => {
    const res = await SELF.fetch(`${BASE}/me/signout`, { method: "POST", headers: { Origin: ORIGIN, Authorization: "Bearer junk" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "auth" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ---- Sockets per address -------------------------------------------------------------------------------------------

describe("sockets per address", () => {
  it("refuses the 6th socket from one CF-Connecting-IP with 429, and counts each address on its own", async () => {
    const r = await freshRoom();
    const five = [];
    for (let k = 0; k < 5; k++) five.push(await connect(r, "203.0.113.5"));
    expect(five.map((c) => c.status)).toEqual([101, 101, 101, 101, 101]);
    expect(await connect(r, "203.0.113.5")).toEqual({ status: 429, body: { error: "sockets" } });
    expect((await connect(r, "203.0.113.6")).status).toBe(101);
    five[0].ws.close(1000, "bye");
    await until(() => r.inRoom((room) => room.online() === 5), "the close to reach the room");
    expect((await connect(r, "203.0.113.5")).status).toBe(101);
  });

  it("keeps the count across hibernation, and never keeps the address itself", async () => {
    const r = await freshRoom();
    for (let k = 0; k < 5; k++) await join(r, null, "203.0.113.8");
    await evictDurableObject(r.stub);
    expect((await connect(r, "203.0.113.8")).status).toBe(429);
    const tags = await r.inRoom((room, state) => state.getWebSockets().flatMap((ws) => state.getTags(ws)));
    expect(tags).toHaveLength(5);
    for (const tag of tags) expect(tag).not.toContain("203.0.113.8");
  });

  it("answers 426 to a request that isn't a WebSocket upgrade", async () => {
    const r = await freshRoom();
    const res = await r.stub.fetch("https://room/r/ws");
    expect(res.status).toBe(426);
  });
});

// ---- Nicknames -----------------------------------------------------------------------------------------------------

describe("nick", () => {
  it("a first change goes: me {nick} to each of the user's sockets, and the room shows the new name", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r, { nick: "Kai" });
    const one = await join(r, a);
    const two = await join(r, a);
    const reader = await join(r);
    one.send({ type: "nick", nick: "Kai_Surfs" });
    for (const c of [one, two]) expect(await take(c, (f) => f?.type === "me" && f.nick === "Kai_Surfs")).toEqual({ type: "me", nick: "Kai_Surfs", role: "user" });
    await settle();
    expect(all(reader, "me")).toEqual([]);
    expect(await r.rows("SELECT nick, nick_key, nick_changed FROM users WHERE id = ?", a.id)).toEqual([
      { nick: "Kai_Surfs", nick_key: checkNick("Kai_Surfs").key, nick_changed: T },
    ]);
    say(one, "New name");
    expect((await take(reader, ofType("msg"))).msg.nick).toBe("Kai_Surfs");
  });

  it("a second change within 7 days -> slow; one after 7 days goes", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const c = await join(r, a);
    c.send({ type: "nick", nick: "First_Change" });
    await take(c, (f) => f?.type === "me" && f.nick === "First_Change");
    r.clock.t += 6 * DAY;
    c.send({ type: "nick", nick: "Second_Change" });
    expect(await nextError(c)).toEqual({ type: "error", code: `slow:${DAY / SEC}`, for: "nick" });
    r.clock.t += DAY;
    c.send({ type: "nick", nick: "Second_Change" });
    await take(c, (f) => f?.type === "me" && f.nick === "Second_Change");
  });

  it("saving the nickname you already have changes nothing and doesn't use up the week; a change of case does", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r, { nick: "Kai_Same" });
    const one = await join(r, a);
    const two = await join(r, a);
    for (const c of [one, two]) await take(c, ofType("me")); // hello's
    for (const nick of ["Kai_Same", "  Kai_Same  ", "Ｋａｉ＿Ｓａｍｅ"]) {
      one.send({ type: "nick", nick });
      expect(await take(one, ofType("me")), nick).toEqual({ type: "me", nick: "Kai_Same", role: "user" });
    }
    await settle();
    expect(all(two, "me")).toHaveLength(1);
    expect(await r.rows("SELECT nick, nick_changed FROM users WHERE id = ?", a.id)).toEqual([{ nick: "Kai_Same", nick_changed: null }]);
    expect(await r.rows("SELECT key FROM limits")).toEqual([]);
    one.send({ type: "nick", nick: "kai_same" });
    expect(await take(two, (f) => f?.type === "me" && f.nick === "kai_same")).toEqual({ type: "me", nick: "kai_same", role: "user" });
    expect(await r.rows("SELECT nick, nick_changed FROM users WHERE id = ?", a.id)).toEqual([{ nick: "kai_same", nick_changed: T }]);
  });

  it("a freed nickname can't be taken by another account for 30 days, though its owner can take it back", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r, { nick: "Mika" });
    const b = await addUser(r);
    const ca = await join(r, a);
    const cb = await join(r, b);
    ca.send({ type: "nick", nick: "Mika_2" });
    await take(ca, ofType("me"));
    for (const nick of ["Mika", "MIKA", "ｍｉｋａ"]) {
      cb.send({ type: "nick", nick });
      expect(await nextError(cb), nick).toEqual({ type: "error", code: "nick:taken", for: "nick" });
    }
    r.clock.t += 7 * DAY;
    ca.send({ type: "nick", nick: "Mika" });
    await take(ca, (f) => f?.type === "me" && f.nick === "Mika");
    // Now "Mika_2" is the freed one, held from day 7 to day 37.
    r.clock.t += 30 * DAY - SEC;
    cb.send({ type: "nick", nick: "Mika_2" });
    expect((await nextError(cb)).code).toBe("nick:taken");
    r.clock.t += SEC;
    cb.send({ type: "nick", nick: "Mika_2" });
    await take(cb, (f) => f?.type === "me" && f.nick === "Mika_2");
  });

  it("refuses a nickname checkNick refuses, one in use, or one the filters block", async () => {
    const r = await freshRoom(T);
    await addUser(r, { nick: "Leo" });
    const a = await addUser(r);
    const c = await join(r, a);
    const cases = [
      ["L", "nick:length"],
      [undefined, "nick:length"],
      ["Admin_Kai", "nick:reserved"],
      ["a<b>", "nick:chars"],
      ["leo", "nick:taken"],
      ["0912 345 678", "blocked:phone"],
      ["bit.ly", "blocked:short"],
    ];
    for (const [nick, code] of cases) {
      c.send({ type: "nick", nick });
      expect(await nextError(c), String(nick)).toEqual({ type: "error", code, for: "nick" });
    }
    expect(await r.rows("SELECT nick, nick_changed FROM users WHERE id = ?", a.id)).toEqual([{ nick: a.nick, nick_changed: null }]);
    expect(c.closed).toBeNull();
  });

  it("signup can't take a held or blocked nickname either (400 nick)", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r, { nick: "Nami" });
    const ca = await join(r, a);
    ca.send({ type: "nick", nick: "Nami_Again" });
    await take(ca, ofType("me"));
    // A finished LINE sign-in for someone new, waiting for their signup.
    const v = randomB64u(32);
    const code = randomB64u(16);
    const [h, codeHash] = await Promise.all([sha256b64u(v), sha256b64u(code)]);
    await r.inRoom((room) =>
      room.sql.exec(
        "INSERT INTO handoffs (code_hash, h, sub_hash, line_name, pin, created, tries) VALUES (?, ?, 'sub-new', 'Nami', '123456', ?, 0)",
        codeHash, h, T,
      ),
    );
    const signup = async (nick) => {
      const res = await r.stub.fetch("https://room/r/signup", { method: "POST", body: JSON.stringify({ v, code, nick, consent: "v1" }) });
      return { status: res.status, body: await res.json() };
    };
    expect(await signup("Nami")).toEqual({ status: 400, body: { error: "nick", code: "taken" } });
    expect(await signup("0912345678")).toEqual({ status: 400, body: { error: "nick", code: "blocked:phone" } });
    expect((await signup("Nami_Two")).status).toBe(200);
  });
});

// ---- canWrite ------------------------------------------------------------------------------------------------------

describe("Room.canWrite(user, kind)", () => {
  it("is auth with no user, banned for a banned LINE account, and locked in a locked room for all but Bryan", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    await r.inRoom((room) => {
      const user = room.account(a.id, 0);
      const admin = room.account(bryan.id, 0);
      expect(room.canWrite(null, "say")).toBe("auth");
      expect(room.canWrite({ ...user, banned: true }, "say")).toBe("banned");
      room.setMeta("locked", 1);
      expect(room.canWrite(user, "say")).toBe("locked");
      expect(room.canWrite(user, "report", "jinshan")).toBe("locked");
      expect(room.canWrite(admin, "say")).toBeNull();
      // A locked room stops posting, not tidying up.
      expect(room.canWrite(user, "delete")).toBeNull();
      room.setMeta("locked", 0);
      expect(room.canWrite(user, "say")).toBeNull();
    });
  });

  it("gives error locked on the socket while the room is locked", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    await r.inRoom((room) => room.setMeta("locked", 1));
    const c = await join(r, a);
    const cb = await join(r, bryan);
    say(c, "Hello?");
    expect(await nextError(c)).toEqual({ type: "error", code: "locked", for: "say" });
    say(cb, "Room is locked for now");
    expect((await take(c, ofType("msg"))).msg).toMatchObject({ role: "admin", body: { text: "Room is locked for now" } });
  });

  it("knows the account behind a token, for /me: userFromToken gives the row canWrite needs", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const user = await r.inRoom((room) => room.userFromToken(a.token));
    expect(user).toMatchObject({ id: a.id, nick: a.nick, role: "user", tv: 0, sub_hash: a.sub, banned: false });
    expect(await r.inRoom((room) => room.canWrite(room.account(a.id, 0), "say"))).toBeNull();
  });
});

// ---- Keepalive -----------------------------------------------------------------------------------------------------

describe("keepalive", () => {
  it("with sockets open, the alarm sends tick {online: 3} to each, and comes back in 45 s", async () => {
    const r = await freshRoom(T);
    const a = await addUser(r);
    const b = await addUser(r);
    const sockets = [await join(r, a), await join(r, b), await join(r)];
    const alarmAt = () => r.inRoom((room, state) => state.storage.getAlarm());
    expect(await alarmAt()).toBe(T + 45 * SEC);
    expect(await runDurableObjectAlarm(r.stub)).toBe(true);
    for (const c of sockets) expect(await take(c, ofType("tick"))).toEqual({ type: "tick", online: 3 });
    expect(await alarmAt()).toBe(T + 45 * SEC);
  });

  it("with none open, the alarm sends no tick and sets no 45 s alarm, only the daily run", async () => {
    const r = await freshRoom(T);
    const sockets = [await join(r), await join(r)];
    for (const c of sockets) c.ws.close(1000, "bye");
    await until(() => r.inRoom((room) => room.online() === 0), "the closes to reach the room");
    const sent = [];
    await r.inRoom((room) => {
      room.broadcast = (frame) => sent.push(frame);
    });
    expect(await runDurableObjectAlarm(r.stub)).toBe(true);
    await r.inRoom(async (room, state) => {
      delete room.broadcast;
      expect(await state.storage.getAlarm()).toBe(T + 7 * HOUR);
    });
    expect(sent.filter((f) => f.type === "tick")).toEqual([]);
  });

  it("starts the 45 s alarm as soon as a socket opens, before it says anything", async () => {
    const r = await freshRoom(T);
    await connect(r);
    expect(await r.inRoom((room, state) => state.storage.getAlarm())).toBe(T + 45 * SEC);
  });

  it("tells every socket how many are online as sockets say hello and go", async () => {
    const r = await freshRoom();
    const one = await join(r);
    expect(await take(one, ofType("online"))).toEqual({ type: "online", online: 1 });
    const two = await join(r);
    expect(await take(one, ofType("online"))).toEqual({ type: "online", online: 2 });
    expect(await take(two, ofType("online"))).toEqual({ type: "online", online: 2 });
    two.ws.close(1000, "bye");
    expect(await take(one, ofType("online"))).toEqual({ type: "online", online: 1 });
  });

  it("answers a ping with pong through the auto-response, without the room's code running", async () => {
    const r = await freshRoom();
    const c = await join(r);
    const requests = () => r.inRoom((room) => room.usage("req", 0).req);
    const before = await requests();
    c.send("ping");
    expect(await take(c, (f) => f === "pong")).toBe("pong");
    expect(await requests()).toBe(before);
    const pair = await r.inRoom((room, state) => {
      const set = state.getWebSocketAutoResponse();
      return [set.request, set.response];
    });
    expect(pair).toEqual(["ping", "pong"]);
  });

  it("counts every other frame as a room request", async () => {
    const r = await freshRoom();
    const c = await join(r);
    const requests = () => r.inRoom((room) => room.usage("req", 0).req);
    const before = await requests();
    c.send({ type: "older", before_id: 5 });
    await take(c, ofType("history"));
    expect(await requests()).toBe(before + 1);
  });
});

// ---- Hibernation ---------------------------------------------------------------------------------------------------

describe("hibernation", () => {
  it("after eviction, the open sockets still post as the right user: the attachment is restored", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const ca = await join(r, a);
    const reader = await join(r);
    await r.inRoom((room) => {
      room.beforeTheNap = true;
    });
    await evictDurableObject(r.stub);
    // A new copy of the room, with nothing of the old one's memory.
    expect(await r.inRoom((room) => room.beforeTheNap)).toBeUndefined();
    say(ca, "Still here after a nap");
    expect((await take(reader, ofType("msg"))).msg).toMatchObject({ nick: a.nick, body: { text: "Still here after a nap" } });
    expect(await r.rows("SELECT uid FROM messages")).toEqual([{ uid: a.id }]);
    say(reader, "And me?");
    expect((await nextError(reader)).code).toBe("auth");
    const uids = await r.inRoom((room, state) => state.getWebSockets().map((ws) => ws.deserializeAttachment().uid));
    expect(uids.sort()).toEqual([a.id, null].sort());
  });
});

// ---- Through the Worker --------------------------------------------------------------------------------------------

describe("GET /ws through the Worker", () => {
  it("opens a socket on the taiwan room that answers hello with the history", async () => {
    const res = await SELF.fetch(`${BASE}/ws`, { headers: { Origin: ORIGIN, Upgrade: "websocket", "CF-Connecting-IP": "192.0.2.44" } });
    expect(res.status).toBe(101);
    const c = client(res.webSocket);
    c.send({ type: "hello", v: 1 });
    expect(Array.isArray((await take(c, ofType("history"))).messages)).toBe(true);
    c.ws.close(1000, "done");
    // Leave the shared room as it was: no socket open.
    const taiwan = env.ROOM.getByName("taiwan", { locationHint: "apac-ne" });
    await until(() => runInDurableObject(taiwan, (room) => room.online() === 0), "the taiwan room to see the close");
  });
});
