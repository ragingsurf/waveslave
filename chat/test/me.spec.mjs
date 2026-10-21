// Tests for the signed-in user's own routes (spec "Routes"): the surf diary (GET, POST /me/sessions and DELETE
// /me/sessions/<id>), the share and unshare frames, GET /me/export and DELETE /me (spec "Deleting an account"), and the
// resting guard (spec "Free-plan budget"). They run inside the Workers runtime (see vitest.config.mjs). Run from chat/:
// npx vitest run --no-isolate --max-workers=1 test/me.spec.mjs
//
// The plan names this file me.test.mjs. It is .spec.mjs because it imports "cloudflare:test": see the note in
// vitest.config.mjs.
//
// As in socket.spec.mjs, each test has a room of its own, called straight on its /r/ routes the way the Worker passes
// the app's requests on (worker.spec.mjs covers the Worker's part), with accounts written straight into its tables and
// session tokens signed by the test secret. The room's clock stands at T.
import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { randomB64u, sha256b64u, signToken, subHash } from "../src/auth.js";
import {
  DAY, HOUR, MIN, SEC, addMessages, addUser, all, closeClients, connect, hex, join, newRoom, nextError, ofType, settle, synced,
  take, until,
} from "./helpers.mjs";

// 12:00 UTC (20:00 in Taiwan) on a day years ahead, so no alarm a test sets goes off by itself.
const T = Date.UTC(2030, 5, 3, 12, 0);
// The earliest start a log may have at T: 00:00 Taiwan time two days before.
const EARLIEST = T - 20 * HOUR - 2 * DAY;

// A log as the app sends it, for a session at Jinshan that ended an hour ago.
const SESSION = Object.freeze({
  spot: "jinshan",
  start: T - 3 * HOUR,
  end: T - HOUR,
  stars: 4,
  board: "short",
  note: "Kept nosediving on takeoff",
  cond: { hs: 1.2, hs_t: "2030-06-03T18:00", tp: 9, tp_t: "2030-06-03T18:00", ws: 12, updated: "2030-06-03T11:40:00Z" },
});
// The session card's body for SESSION.
const CARD = { start: SESSION.start, end: SESSION.end, stars: 4, board: "short", note: SESSION.note, cond: SESSION.cond };
// SESSION as GET /me/sessions lists it.
const LISTED = { spot: "jinshan", start: SESSION.start, end: SESSION.end, stars: 4, board: "short", note: SESSION.note, cond: SESSION.cond };

// ---- Rooms, accounts and calls -------------------------------------------------------------------------------------

// A room of its own, with its clock at T until the test moves clock.t.
const freshRoom = (at = T) => newRoom("me", at);

const tokenFor = (r, user, { tv = 0, exp = r.now() + 30 * DAY } = {}) => signToken({ uid: user.id, tv, exp }, env.SESSION_SECRET);

// Calls one of the room's /me routes as `who` (anything with a token, or null for no Authorization header):
// {status, data}. A string body goes as it is.
async function me(r, who, method, path = "", body) {
  const headers = who ? { Authorization: `Bearer ${who.token}` } : {};
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const res = await r.stub.fetch(`https://room/r/me${path}`, init);
  return { status: res.status, data: await res.json() };
}

// A request body that sends its first byte at once and holds the rest back until release(). pulled settles once
// something has started reading it.
function heldBody(text) {
  const bytes = new TextEncoder().encode(text);
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const pulled = new Promise((resolve) => {
    started = resolve;
  });
  let first = true;
  const stream = new ReadableStream({
    async pull(controller) {
      if (first) {
        first = false;
        controller.enqueue(bytes.slice(0, 1));
        started();
        return;
      }
      await gate;
      controller.enqueue(bytes.slice(1));
      controller.close();
    },
  });
  return { stream, pulled, release };
}

// POST /me/sessions with SESSION, changed by `more`.
const logSession = (r, user, more = {}) => me(r, user, "POST", "/sessions", { ...SESSION, ...more });

// Where `text` is in the room: "<table>.<column>" for each column of each table that holds it in some row, inside JSON
// too. The tables are read from the database itself, so a table added later is searched as well.
function holding(r, text) {
  return r.inRoom((room) => {
    const found = [];
    const tables = room.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name")
      .toArray();
    for (const { name: table } of tables) {
      for (const { name: column } of room.sql.exec("SELECT name FROM pragma_table_info(?)", table).toArray()) {
        const { n } = room.sql.exec(`SELECT count(*) AS n FROM "${table}" WHERE instr(CAST("${column}" AS TEXT), ?) > 0`, text).one();
        if (n > 0) found.push(`${table}.${column}`);
      }
    }
    return found;
  });
}

// Every table's rows (each as JSON, sorted), to see that nothing changed.
const everything = (r) =>
  r.inRoom((room) => {
    const tables = room.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'").toArray();
    return Object.fromEntries(tables.map(({ name }) => [name, room.sql.exec(`SELECT * FROM "${name}"`).toArray().map((row) => JSON.stringify(row)).sort()]));
  });

const metaOf = (r, key) => r.inRoom((room) => room.getMeta(key));

// Sets today's usage counts, as if the room had seen that much since 00:00 UTC.
const setUsage = (r, counts) =>
  r.inRoom((room) => {
    const day = new Date(r.now()).toISOString().slice(0, 10);
    room.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('usage', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      JSON.stringify({ day, req: 0, read: 0, write: 0, ...counts, at: r.now() }),
    );
    room.used = null;
  });

async function reports(r, spot = "jinshan") {
  const res = await r.stub.fetch(`https://room/r/reports?spot=${spot}`);
  return { status: res.status, data: await res.json() };
}

afterEach(closeClients);

// ---- POST /me/sessions ---------------------------------------------------------------------------------------------

describe("POST /me/sessions", () => {
  it("with share: false (or no share) stores the log, private: nothing goes to the room", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const reader = await join(r);
    const res = await logSession(r, u, { note: "  Kept​ nosediving on takeoff ", share: false });
    expect(res).toEqual({ status: 200, data: { id: expect.any(Number) } });
    const plain = await logSession(r, u, { cond: null });
    expect(plain).toEqual({ status: 200, data: { id: expect.any(Number) } });
    expect(await r.rows("SELECT * FROM sessions ORDER BY id")).toEqual([
      {
        id: res.data.id, uid: u.id, spot: "jinshan", start: SESSION.start, end: SESSION.end, stars: 4, board: "short",
        note: "Kept nosediving on takeoff", cond: JSON.stringify(SESSION.cond), shared_msg: null,
      },
      {
        id: plain.data.id, uid: u.id, spot: "jinshan", start: SESSION.start, end: SESSION.end, stars: 4, board: "short",
        note: SESSION.note, cond: null, shared_msg: null,
      },
    ]);
    await settle();
    expect(all(reader, "msg")).toEqual([]);
    expect(await r.rows("SELECT count(*) AS n FROM messages")).toEqual([{ n: 0 }]);
  });

  it("with share: true also posts it as a session card: msg to everyone, and the log keeps the card's id", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const reader = await join(r);
    const mine = await join(r, u);
    const res = await logSession(r, u, { share: true });
    expect(res).toEqual({ status: 200, data: { id: expect.any(Number), shared_msg: expect.any(Number) } });
    const { id, shared_msg } = res.data;
    const card = {
      id: shared_msg, ts: T, nick: u.nick, role: "user", kind: "session", spot: "jinshan", body: CARD, reply_to: null, likes: 0,
    };
    expect((await take(reader, ofType("msg"))).msg).toEqual(card);
    expect((await take(mine, ofType("msg"))).msg).toEqual(card);
    expect(await r.rows("SELECT shared_msg FROM sessions WHERE id = ?", id)).toEqual([{ shared_msg }]);
    // A session with no conditions recorded is shared with cond null.
    const bare = await logSession(r, u, { share: true, cond: null, note: "" });
    expect((await take(reader, ofType("msg"))).msg).toMatchObject({ id: bare.data.shared_msg, body: { ...CARD, note: "", cond: null } });
  });

  it("a blocked note with share: true -> error blocked:<rule>, and the log is still saved, private", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const reader = await join(r);
    // The note goes through the same filters as a message, hidden characters and all.
    for (const [note, stored, rule] of [["加LINE abc", "加LINE abc", "line"], ["call 0912​345678", "call 0912345678", "phone"]]) {
      const res = await logSession(r, u, { note, share: true });
      expect(res, note).toEqual({ status: 200, data: { id: expect.any(Number), error: `blocked:${rule}` } });
      expect(await r.rows("SELECT note, shared_msg FROM sessions WHERE id = ?", res.data.id)).toEqual([{ note: stored, shared_msg: null }]);
    }
    // Kept private, the same note is no one else's business.
    expect(await logSession(r, u, { note: "加LINE abc" })).toEqual({ status: 200, data: { id: expect.any(Number) } });
    await settle();
    expect(all(reader, "msg")).toEqual([]);
    expect(await r.rows("SELECT count(*) AS n FROM messages")).toEqual([{ n: 0 }]);
    // A blocked share uses up none of the 5 a day.
    expect(await r.rows("SELECT key FROM limits")).toEqual([{ key: `${u.sub}:session:1d` }]);
  });

  it("the 21st private log in a day -> 429 slow:<seconds left>; a day after the first, one goes again", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    for (let k = 0; k < 20; k++) expect((await logSession(r, u)).status, `log ${k + 1}`).toBe(200);
    expect(await logSession(r, u)).toEqual({ status: 429, data: { error: "slow:86400" } });
    r.clock.t += DAY - 10 * SEC;
    expect(await logSession(r, u)).toEqual({ status: 429, data: { error: "slow:10" } });
    r.clock.t += 10 * SEC;
    expect((await logSession(r, u)).status).toBe(200);
    expect(await r.rows("SELECT count(*) AS n FROM sessions")).toEqual([{ n: 21 }]);
  });

  it("shares 5 logs a day: the 6th is saved private, with error slow", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    for (let k = 0; k < 5; k++) expect((await logSession(r, u, { share: true })).data.shared_msg, `share ${k + 1}`).toEqual(expect.any(Number));
    const sixth = await logSession(r, u, { share: true });
    expect(sixth).toEqual({ status: 200, data: { id: expect.any(Number), error: "slow:86400" } });
    expect(await r.rows("SELECT shared_msg FROM sessions WHERE id = ?", sixth.data.id)).toEqual([{ shared_msg: null }]);
    expect(await r.rows("SELECT count(*) AS n FROM messages")).toEqual([{ n: 5 }]);
  });

  it("keeps 1,000 logs in all: the next -> 429 full, until one is deleted", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    await r.inRoom((room) => {
      for (let k = 0; k < 1000; k++) {
        room.sql.exec(
          "INSERT INTO sessions (uid, spot, start, end, stars, board, note) VALUES (?, 'suao', ?, ?, 3, 'fish', '')",
          u.id, T - 400 * DAY + k * HOUR, T - 400 * DAY + k * HOUR + HOUR,
        );
      }
    });
    expect(await logSession(r, u)).toEqual({ status: 429, data: { error: "full" } });
    // Refused before the day's count, so it used none of the 20.
    expect(await r.rows("SELECT count(*) AS n FROM limits")).toEqual([{ n: 0 }]);
    const [{ id }] = await r.rows("SELECT id FROM sessions ORDER BY id LIMIT 1");
    expect(await me(r, u, "DELETE", `/sessions/${id}`)).toEqual({ status: 200, data: { ok: true } });
    expect((await logSession(r, u)).status).toBe(200);
  });

  it("refuses a body that isn't a log it takes (400 invalid), storing nothing and using up no limit", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const bad = [
      { ...SESSION, spot: "pipeline" },
      { ...SESSION, board: "sup" },
      { ...SESSION, start: T + MIN, end: T + HOUR },
      { ...SESSION, start: EARLIEST - MIN, end: EARLIEST + HOUR },
      { ...SESSION, end: SESSION.start },
      { ...SESSION, start: T - 14 * HOUR, end: T - HOUR },
      { ...SESSION, stars: 0 },
      { ...SESSION, stars: 6 },
      { ...SESSION, stars: 3.5 },
      { ...SESSION, stars: "4" },
      { ...SESSION, note: "x".repeat(301) },
      { ...SESSION, note: 42 },
      { ...SESSION, cond: { hs: 99 } },
      { ...SESSION, cond: { colour: 1 } },
      { ...SESSION, share: "yes" },
      { ...SESSION, share: 1 },
      { ...SESSION, spot: undefined },
      "{",
      "[]",
      "null",
    ];
    for (const body of bad) {
      expect(await me(r, u, "POST", "/sessions", body), JSON.stringify(body)?.slice(0, 80)).toEqual({ status: 400, data: { error: "invalid" } });
    }
    expect(await me(r, u, "POST", "/sessions")).toEqual({ status: 400, data: { error: "invalid" } });
    expect(await r.rows("SELECT count(*) AS n FROM sessions")).toEqual([{ n: 0 }]);
    expect(await r.rows("SELECT count(*) AS n FROM limits")).toEqual([{ n: 0 }]);
    // The edges themselves are fine: the earliest start, 12 hours long, a 300-character note.
    expect((await logSession(r, u, { start: EARLIEST, end: EARLIEST + 12 * HOUR, note: "x".repeat(300) })).status).toBe(200);
  });

  it("in a locked room saves the log but doesn't share it (error locked), except Bryan's", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    await r.inRoom((room) => room.setMeta("locked", 1));
    const res = await logSession(r, u, { share: true });
    expect(res).toEqual({ status: 200, data: { id: expect.any(Number), error: "locked" } });
    expect(await r.rows("SELECT shared_msg FROM sessions WHERE id = ?", res.data.id)).toEqual([{ shared_msg: null }]);
    expect((await logSession(r, bryan, { share: true })).data).toEqual({ id: expect.any(Number), shared_msg: expect.any(Number) });
  });
});

// ---- Signing in, for every /me route -------------------------------------------------------------------------------

describe("every /me route", () => {
  it("needs a good token: 401 auth without one, with a bad or expired one, or after signing out everywhere", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const logged = await logSession(r, u);
    const gone = await addUser(r);
    await r.inRoom((room) => room.sql.exec("UPDATE users SET tv = 1 WHERE id = ?", gone.id));
    const nobody = [null, { token: "junk" }, { token: await tokenFor(r, u, { exp: T - 1 }) }, gone, { token: u.token.slice(0, -2) }];
    const routes = [["GET", "/sessions"], ["POST", "/sessions", SESSION], ["DELETE", `/sessions/${logged.data.id}`], ["GET", "/export"], ["DELETE", ""]];
    for (const [method, path, body] of routes) {
      for (const who of nobody) {
        expect(await me(r, who, method, path, body), `${method} /me${path}`).toEqual({ status: 401, data: { error: "auth" } });
      }
    }
    expect(await r.rows("SELECT count(*) AS n FROM sessions")).toEqual([{ n: 1 }]);
    expect(await r.rows("SELECT count(*) AS n FROM users")).toEqual([{ n: 2 }]);
  });
});

// ---- GET /me/sessions ----------------------------------------------------------------------------------------------

describe("GET /me/sessions", () => {
  it("lists the user's own logs, newest first, each with its conditions and whether it is shared", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const v = await addUser(r);
    const yesterday = await logSession(r, u, { start: T - 30 * HOUR, end: T - 28 * HOUR, stars: 2, board: "long", note: "Too small" });
    const today = await logSession(r, u, { share: true });
    const earlier = await logSession(r, u, { start: T - 6 * HOUR, end: T - 5 * HOUR, cond: null });
    const theirs = await logSession(r, v);
    expect(await me(r, u, "GET", "/sessions")).toEqual({
      status: 200,
      data: [
        { id: today.data.id, ...LISTED, shared: true },
        { id: earlier.data.id, ...LISTED, start: T - 6 * HOUR, end: T - 5 * HOUR, cond: null, shared: false },
        { id: yesterday.data.id, ...LISTED, start: T - 30 * HOUR, end: T - 28 * HOUR, stars: 2, board: "long", note: "Too small", shared: false },
      ],
    });
    expect(await me(r, v, "GET", "/sessions")).toEqual({ status: 200, data: [{ id: theirs.data.id, ...LISTED, shared: false }] });
    expect(await me(r, await addUser(r), "GET", "/sessions")).toEqual({ status: 200, data: [] });
  });
});

// ---- DELETE /me/sessions/<id> --------------------------------------------------------------------------------------

describe("DELETE /me/sessions/<id>", () => {
  it("deletes the user's own log: 200 {ok: true}; anyone else's, or one that isn't there -> 404, and it stays", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const v = await addUser(r);
    const mine = (await logSession(r, u)).data.id;
    const theirs = (await logSession(r, v)).data.id;
    for (const path of [`/sessions/${theirs}`, "/sessions/999999", "/sessions/0", "/sessions/-1", "/sessions/1.5", "/sessions/abc", `/sessions/0${mine}`]) {
      expect(await me(r, u, "DELETE", path), path).toEqual({ status: 404, data: { error: "not found" } });
    }
    expect(await r.rows("SELECT id FROM sessions ORDER BY id")).toEqual([{ id: mine }, { id: theirs }]);
    expect(await me(r, u, "DELETE", `/sessions/${mine}`)).toEqual({ status: 200, data: { ok: true } });
    expect(await r.rows("SELECT id FROM sessions")).toEqual([{ id: theirs }]);
    expect(await me(r, u, "DELETE", `/sessions/${mine}`)).toEqual({ status: 404, data: { error: "not found" } });
  });

  it("takes a shared log's card out of the room too: everyone gets update {id, deleted: true}, and its likes go", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const v = await addUser(r);
    const reader = await join(r);
    const cv = await join(r, v);
    const { id, shared_msg } = (await logSession(r, u, { share: true })).data;
    cv.send({ type: "like", id: shared_msg });
    expect(await take(reader, ofType("update"))).toEqual({ type: "update", id: shared_msg, likes: 1 });
    expect(await me(r, u, "DELETE", `/sessions/${id}`)).toEqual({ status: 200, data: { ok: true } });
    expect(await take(reader, ofType("update"))).toEqual({ type: "update", id: shared_msg, deleted: true });
    expect(await r.rows("SELECT count(*) AS n FROM messages")).toEqual([{ n: 0 }]);
    expect(await r.rows("SELECT count(*) AS n FROM likes")).toEqual([{ n: 0 }]);
  });
});

// ---- The share and unshare frames ----------------------------------------------------------------------------------

describe("share and unshare", () => {
  it("share {session_id} posts a private log as a session card: msg to everyone, and ok {for, session_id, shared_msg}", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const reader = await join(r);
    const c = await join(r, u);
    const { id } = (await logSession(r, u)).data;
    c.send({ type: "share", session_id: id });
    const ok = await take(c, ofType("ok"));
    expect(ok).toEqual({ type: "ok", for: "share", session_id: id, shared_msg: expect.any(Number) });
    expect((await take(reader, ofType("msg"))).msg).toEqual({
      id: ok.shared_msg, ts: T, nick: u.nick, role: "user", kind: "session", spot: "jinshan", body: CARD, reply_to: null, likes: 0,
    });
    // Sharing it again posts nothing new.
    c.send({ type: "share", session_id: id });
    expect(await take(c, ofType("ok"))).toEqual(ok);
    await settle();
    expect(all(reader, "msg")).toHaveLength(1);
    expect(await r.rows("SELECT shared_msg FROM sessions")).toEqual([{ shared_msg: ok.shared_msg }]);
    expect((await me(r, u, "GET", "/sessions")).data[0].shared).toBe(true);
  });

  it("unshare takes the card out of the room (update deleted to everyone); the log stays, private, to share again", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const reader = await join(r);
    const c = await join(r, u);
    const { id, shared_msg } = (await logSession(r, u, { share: true })).data;
    c.send({ type: "unshare", session_id: id });
    expect(await take(c, ofType("ok"))).toEqual({ type: "ok", for: "unshare", session_id: id });
    expect(await take(reader, ofType("update"))).toEqual({ type: "update", id: shared_msg, deleted: true });
    expect(await r.rows("SELECT count(*) AS n FROM messages")).toEqual([{ n: 0 }]);
    expect(await me(r, u, "GET", "/sessions")).toEqual({ status: 200, data: [{ id, ...LISTED, shared: false }] });
    // Unsharing a private log is fine, and tells nobody.
    c.send({ type: "unshare", session_id: id });
    expect(await take(c, ofType("ok"))).toEqual({ type: "ok", for: "unshare", session_id: id });
    await settle();
    expect(all(reader, "update")).toHaveLength(1);
    c.send({ type: "share", session_id: id });
    const again = await take(c, ofType("ok"));
    expect(again.shared_msg).toBeGreaterThan(shared_msg);
  });

  it("deleting the card with delete {id} unshares its log, which can then be shared again", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const c = await join(r, u);
    const { id, shared_msg } = (await logSession(r, u, { share: true })).data;
    c.send({ type: "delete", id: shared_msg });
    expect(await take(c, ofType("update"))).toEqual({ type: "update", id: shared_msg, deleted: true });
    expect(await r.rows("SELECT shared_msg FROM sessions WHERE id = ?", id)).toEqual([{ shared_msg: null }]);
    c.send({ type: "share", session_id: id });
    expect((await take(c, ofType("ok"))).shared_msg).toBeGreaterThan(shared_msg);
  });

  it("refuses a log that isn't the user's (error gone) or an id that isn't one (error invalid); a reader gets error auth", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const v = await addUser(r);
    const theirs = (await logSession(r, v, { share: true })).data;
    for (const type of ["share", "unshare"]) {
      // A socket of its own for each, as four bad frames are as many as one socket may send.
      const c = await join(r, u);
      for (const [session_id, code] of [[theirs.id, "gone"], [999_999, "gone"], [String(theirs.id), "invalid"], [undefined, "invalid"]]) {
        c.send({ type, session_id });
        expect(await nextError(c), `${type} ${session_id}`).toEqual({ type: "error", code, for: type });
      }
    }
    const reader = await join(r);
    reader.send({ type: "share", session_id: theirs.id });
    expect(await nextError(reader)).toEqual({ type: "error", code: "auth", for: "share" });
    expect(await r.rows("SELECT shared_msg FROM sessions")).toEqual([{ shared_msg: theirs.shared_msg }]);
    expect(await r.rows("SELECT count(*) AS n FROM messages")).toEqual([{ n: 1 }]);
  });

  it("share goes through the same filters and limits as POST: a blocked note, a locked room, 5 a day", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const c = await join(r, u);
    const cb = await join(r, bryan);
    const share = async (sock, user, more = {}) => {
      sock.send({ type: "share", session_id: (await logSession(r, user, more)).data.id });
      return take(sock, (f) => f?.type === "ok" || f?.type === "error");
    };
    expect(await share(c, u, { note: "加LINE abc" })).toEqual({ type: "error", code: "blocked:line", for: "share" });
    await r.inRoom((room) => room.setMeta("locked", 1));
    expect(await share(c, u)).toEqual({ type: "error", code: "locked", for: "share" });
    expect(await share(cb, bryan)).toMatchObject({ type: "ok", for: "share" });
    await r.inRoom((room) => room.setMeta("locked", 0));
    for (let k = 0; k < 5; k++) expect(await share(c, u), `share ${k + 1}`).toMatchObject({ type: "ok", for: "share" });
    expect(await share(c, u)).toEqual({ type: "error", code: "slow:86400", for: "share" });
    // None of these is a bad frame.
    expect(c.closed).toBeNull();
  });
});

// ---- GET /me/export ------------------------------------------------------------------------------------------------

describe("GET /me/export", () => {
  it("holds the user's own nickname, account date, messages, reports and logs, and nothing of anyone else's", async () => {
    const r = await freshRoom();
    const u = await addUser(r, { age: 3 * DAY });
    const v = await addUser(r);
    const REPORT = { size: "waist", cond: "ok", crowd: "busy", snap: {} };
    const [text] = await addMessages(r, u.id, 1, { ts: T - 2 * HOUR, spot: "wushi" });
    const [hidden] = await addMessages(r, u.id, 1, { ts: T - 90 * MIN, hidden_by: "flags" });
    const [report] = await addMessages(r, u.id, 1, { ts: T - HOUR, kind: "report", spot: "nanwan", body: REPORT });
    const shared = (await logSession(r, u, { share: true })).data;
    const quiet = (await logSession(r, u, { start: T - 30 * HOUR, end: T - 28 * HOUR, cond: null, note: "" })).data;
    await addMessages(r, v.id, 2, { body: { text: "Someone else's message" } });
    await addMessages(r, v.id, 1, { kind: "report", spot: "nanwan", body: REPORT });
    await logSession(r, v, { note: "Someone else's session" });
    const res = await me(r, u, "GET", "/export");
    expect(res).toEqual({
      status: 200,
      data: {
        nick: u.nick,
        created: T - 3 * DAY,
        messages: [
          { id: text, ts: T - 2 * HOUR, kind: "text", spot: "wushi", body: { text: "seeded 0" }, reply_to: null, likes: 0, hidden: false },
          { id: hidden, ts: T - 90 * MIN, kind: "text", spot: null, body: { text: "seeded 0" }, reply_to: null, likes: 0, hidden: true },
          { id: shared.shared_msg, ts: T, kind: "session", spot: "jinshan", body: CARD, reply_to: null, likes: 0, hidden: false },
        ],
        reports: [{ id: report, ts: T - HOUR, kind: "report", spot: "nanwan", body: REPORT, reply_to: null, likes: 0, hidden: false }],
        sessions: [
          { id: shared.id, ...LISTED, shared: true },
          { id: quiet.id, ...LISTED, start: T - 30 * HOUR, end: T - 28 * HOUR, cond: null, note: "", shared: false },
        ],
      },
    });
    const json = JSON.stringify(res.data);
    for (const notHere of [v.id, v.nick, v.sub, "Someone else's", u.id, u.sub]) expect(json).not.toContain(notHere);
  });
});

// ---- DELETE /me ----------------------------------------------------------------------------------------------------

describe("DELETE /me", () => {
  it("deletes the account and everything of it but its subs row and holds, telling every open screen", async () => {
    const r = await freshRoom();
    const u = await addUser(r, { nick: "Kai_Leaving" });
    const v = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const REPORT = { size: "chest", cond: "clean", crowd: "few", snap: {} };
    // Theirs: a text message, one hidden by flags, a report, a private log and a shared one.
    const [text] = await addMessages(r, u.id, 1, { ts: T - 2 * HOUR });
    const [hiddenText] = await addMessages(r, u.id, 1, { ts: T - 2 * HOUR, hidden_by: "flags" });
    const [report] = await addMessages(r, u.id, 1, { kind: "report", spot: "suao", body: REPORT });
    await logSession(r, u);
    const card = (await logSession(r, u, { share: true })).data.shared_msg;
    // Someone else's: a text message, a report, one hidden by flags, and a log.
    const [vText] = await addMessages(r, v.id, 1);
    const [vReport] = await addMessages(r, v.id, 1, { kind: "report", spot: "suao", body: REPORT });
    const [vHidden] = await addMessages(r, v.id, 1, { hidden_by: "flags" });
    await logSession(r, v);
    const cu = await join(r, u);
    const cv = await join(r, v);
    const cb = await join(r, bryan);
    const reader = await join(r);
    // They like both of v's messages and flag one; v likes their text and card; Bryan likes v's text too.
    cu.send({ type: "like", id: vText });
    cu.send({ type: "like", id: vReport });
    cu.send({ type: "flag", id: vText, reason: "spam" });
    cv.send({ type: "like", id: text });
    cv.send({ type: "like", id: card });
    cb.send({ type: "like", id: vText });
    // Each of them once tried a wrong /admin code.
    for (const c of [cu, cv]) {
      c.send({ type: "admin", code: "/admin not-the-code" });
      expect(await nextError(c)).toEqual({ type: "error", for: "admin", code: "admin" });
    }
    for (const c of [cu, cv, cb]) await synced(c);
    const heldV = `held:vold:${v.sub}`;
    await r.inRoom((room) => {
      // A flag of theirs that helped hide v's message, a nickname of theirs still held, a sign-in of theirs waiting to
      // be redeemed, and a copy Bryan keeps of their hidden message.
      room.sql.exec("INSERT INTO flags (msg_id, sub_hash, reason, ts) VALUES (?, ?, 'harass', ?)", vHidden, u.sub, T - HOUR);
      room.sql.exec("INSERT INTO limits (key, n, window_end) VALUES (?, 1, ?), (?, 1, ?)", `held:kaiold:${u.sub}`, T + 9 * DAY, heldV, T + 9 * DAY);
      room.sql.exec(
        "INSERT INTO handoffs (code_hash, h, sub_hash, sub, line_name, pin, created) VALUES ('code', 'h', ?, 'U-their-line', 'Kai', '123456', ?)",
        u.sub, T - MIN,
      );
      room.sql.exec("INSERT INTO holds (msg_id, body, uid, sub_hash, reason, ts) VALUES (?, '{}', ?, ?, 'keep', ?)", hiddenText, u.id, u.sub, T - MIN);
    });
    expect(await holding(r, u.id)).toEqual(["holds.uid", "likes.uid", "messages.uid", "sessions.uid", "users.id"]);
    expect(await holding(r, u.sub)).toEqual([
      "flags.sub_hash", "handoffs.sub_hash", "holds.sub_hash", "limits.key", "meta.value", "subs.sub_hash", "users.sub_hash",
    ]);
    await settle();
    const seen = reader.frames.length;

    expect(await me(r, u, "DELETE")).toEqual({ status: 200, data: { ok: true } });

    // Their socket closes as on signing out everywhere; nobody else's does.
    await until(() => cu.closed !== null, "their socket to close");
    expect(cu.closed).toBe(4401);
    // Every screen loses their text messages and card, and v's messages lose their likes.
    await until(() => reader.frames.slice(seen).filter(ofType("update")).length >= 5, "the updates");
    expect(reader.frames.slice(seen).filter(ofType("update"))).toEqual([
      { type: "update", id: text, deleted: true },
      { type: "update", id: hiddenText, deleted: true },
      { type: "update", id: card, deleted: true },
      { type: "update", id: vText, likes: 1 },
      { type: "update", id: vReport, likes: 0 },
    ]);
    expect([cv.closed, cb.closed, reader.closed]).toEqual([null, null, null]);
    // Their report stays, as "a surfer"; v's message stays hidden.
    expect(await r.rows("SELECT id, uid, kind, likes, hidden_by FROM messages ORDER BY id")).toEqual([
      { id: report, uid: null, kind: "report", likes: 0, hidden_by: null },
      { id: vText, uid: v.id, kind: "text", likes: 1, hidden_by: null },
      { id: vReport, uid: v.id, kind: "report", likes: 0, hidden_by: null },
      { id: vHidden, uid: v.id, kind: "text", likes: 0, hidden_by: "flags" },
    ]);
    expect(await r.rows("SELECT msg_id, uid FROM likes")).toEqual([{ msg_id: vText, uid: bryan.id }]);
    expect(await r.rows("SELECT count(*) AS n FROM flags")).toEqual([{ n: 0 }]);
    expect(await r.rows("SELECT uid FROM sessions")).toEqual([{ uid: v.id }]);
    expect(await r.rows("SELECT count(*) AS n FROM handoffs")).toEqual([{ n: 0 }]);
    expect(await r.rows("SELECT key FROM limits WHERE key = ?", heldV)).toEqual([{ key: heldV }]);
    // Their wrong /admin code no longer names them, but it still counts towards the 10 in all.
    const claims = JSON.parse(await metaOf(r, "admin_claims"));
    expect([claims.total, claims.by]).toEqual([2, { [v.sub]: 1 }]);
    // Only the LINE account's row, marked deleted, and Bryan's copy are left.
    expect(await r.rows("SELECT * FROM subs WHERE sub_hash = ?", u.sub)).toEqual([{ sub_hash: u.sub, banned: 0, deleted_at: T }]);
    expect(await r.rows("SELECT msg_id, uid, sub_hash, reason FROM holds")).toEqual([{ msg_id: hiddenText, uid: u.id, sub_hash: u.sub, reason: "keep" }]);
    expect(await holding(r, u.id)).toEqual(["holds.uid"]);
    expect(await holding(r, u.sub)).toEqual(["holds.sub_hash", "subs.sub_hash"]);
    expect(await holding(r, "Kai_Leaving")).toEqual([]);
    expect(await holding(r, "kai_leaving")).toEqual([]);
    // The room as a new reader sees it, and the spot card.
    expect((await join(r)).history.messages.map((m) => [m.id, m.nick])).toEqual([[report, null], [vText, v.nick], [vReport, v.nick]]);
    expect((await reports(r, "suao")).data.reports).toHaveLength(2);
    // Their token is no good now.
    expect(await me(r, u, "GET", "/sessions")).toEqual({ status: 401, data: { error: "auth" } });
  });

  it("tells only Bryan the new like count of a message hidden since they liked it", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const v = await addUser(r);
    const [shown, hidden] = await addMessages(r, v.id, 2);
    const cu = await join(r, u);
    for (const id of [shown, hidden]) cu.send({ type: "like", id });
    await synced(cu);
    await r.rows("UPDATE messages SET hidden_by = 'flags' WHERE id = ?", hidden);
    const reader = await join(r);
    const cb = await join(r, await addUser(r, { role: "admin" }));

    expect(await me(r, u, "DELETE")).toEqual({ status: 200, data: { ok: true } });

    expect(await take(cb, ofType("update"))).toEqual({ type: "update", id: shown, likes: 0 });
    expect(await take(cb, ofType("update"))).toEqual({ type: "update", id: hidden, likes: 0 });
    expect(await take(reader, ofType("update"))).toEqual({ type: "update", id: shown, likes: 0 });
    await settle();
    expect(all(reader, "update")).toEqual([{ type: "update", id: shown, likes: 0 }]);
    expect(await r.rows("SELECT id, likes FROM messages ORDER BY id")).toEqual([{ id: shown, likes: 0 }, { id: hidden, likes: 0 }]);
  });

  it("is one transaction: when a step fails, nothing at all is deleted", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const v = await addUser(r);
    const [vText] = await addMessages(r, v.id, 1);
    await addMessages(r, u.id, 2);
    await logSession(r, u, { share: true });
    const cu = await join(r, u);
    cu.send({ type: "like", id: vText });
    await synced(cu);
    const before = await everything(r);
    await r.inRoom((room) => {
      const real = room.all;
      room.all = function (query, ...binds) {
        if (query.startsWith("DELETE FROM users")) throw new Error("the disk is full");
        return real.call(this, query, ...binds);
      };
      try {
        expect(() => room.forgetAccount(room.account(u.id, 0), T)).toThrow("the disk is full");
      } finally {
        room.all = real;
      }
    });
    expect(await everything(r)).toEqual(before);
  });

  it("works in a locked room: locking stops posting, not leaving", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const [id] = await addMessages(r, u.id, 1);
    const admin = await join(r, await addUser(r, { role: "admin" }));
    admin.send({ type: "lock" });
    expect(await take(admin, ofType("ok"))).toEqual({ type: "ok", for: "lock" });
    expect(await me(r, u, "DELETE")).toEqual({ status: 200, data: { ok: true } });
    expect(await take(admin, ofType("update"))).toEqual({ type: "update", id, deleted: true });
    expect(await r.rows("SELECT count(*) AS n FROM users WHERE id = ?", u.id)).toEqual([{ n: 0 }]);
    expect(await metaOf(r, "locked")).toBe(1);
  });

  it("by a banned user is refused (their tokens stopped with the ban) and changes nothing: the ban stays", async () => {
    const r = await freshRoom();
    const line = `U${hex(16)}`;
    const u = await addUser(r, { sub: await subHash(line, env.SUB_PEPPER) });
    const [id] = await addMessages(r, u.id, 1);
    await logSession(r, u);
    const admin = await join(r, await addUser(r, { role: "admin" }));
    admin.send({ type: "ban", msg_id: id });
    expect(await take(admin, ofType("ok"))).toMatchObject({ for: "ban", sub_hash: u.sub });
    // The ban moved tv on, so their token is dead; one made for the new tv is refused too, being banned.
    for (const token of [u.token, await tokenFor(r, u, { tv: 1 })]) {
      expect(await me(r, { token }, "DELETE")).toEqual({ status: 401, data: { error: "auth" } });
    }
    expect(await r.rows("SELECT banned, deleted_at FROM subs WHERE sub_hash = ?", u.sub)).toEqual([{ banned: 1, deleted_at: null }]);
    expect(await r.rows("SELECT tv FROM users WHERE id = ?", u.id)).toEqual([{ tv: 1 }]);
    expect(await r.rows("SELECT hidden_by FROM messages WHERE id = ?", id)).toEqual([{ hidden_by: "ban" }]);
    expect(await r.rows("SELECT count(*) AS n FROM sessions WHERE uid = ?", u.id)).toEqual([{ n: 1 }]);
    // And their LINE account still can't sign in.
    const handoff = await r.stub.fetch("https://room/r/handoffs", {
      method: "POST",
      body: JSON.stringify({ h: await sha256b64u(randomB64u(32)), sub: line, line_name: "Kai" }),
    });
    expect(handoff.status).toBe(403);
    expect(await handoff.json()).toEqual({ error: "banned" });
  });

  it("on a banned LINE account, keeps the ban: the transaction only marks its subs row deleted", async () => {
    // DELETE /me never gets this far for a banned account (above), so this calls the transaction itself, the way a
    // later route to it would.
    const r = await freshRoom();
    const u = await addUser(r);
    await r.rows("UPDATE subs SET banned = 1 WHERE sub_hash = ?", u.sub);
    await r.inRoom((room) => {
      room.forgetAccount(room.account(u.id, 0), T);
    });
    expect(await r.rows("SELECT banned, deleted_at FROM subs WHERE sub_hash = ?", u.sub)).toEqual([{ banned: 1, deleted_at: T }]);
    expect(await r.rows("SELECT count(*) AS n FROM users WHERE id = ?", u.id)).toEqual([{ n: 0 }]);
  });

  it("while a POST /me/sessions body is still arriving, leaves nothing of the account: the log gets 401, and no row is written", async () => {
    // The room reads a request's body without its input gate shut, so other requests run in the meantime. Here the
    // account goes while the log's body is held back, the way a slow phone connection would hold it.
    const r = await freshRoom();
    const u = await addUser(r);
    const reader = await join(r);
    const held = heldBody(JSON.stringify({ ...SESSION, share: true }));
    const posting = r.stub.fetch("https://room/r/me/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${u.token}`, "Content-Type": "application/json" },
      body: held.stream,
    });
    await held.pulled;
    // Time for the room to get as far as it can before the rest of the body comes.
    await settle();
    await r.inRoom(() => {});

    expect(await me(r, u, "DELETE")).toEqual({ status: 200, data: { ok: true } });
    held.release();

    const res = await posting;
    expect({ status: res.status, data: await res.json() }).toEqual({ status: 401, data: { error: "auth" } });
    expect(await holding(r, u.id)).toEqual([]);
    expect(await holding(r, u.sub)).toEqual(["subs.sub_hash"]);
    await settle();
    expect(all(reader, "msg")).toEqual([]);
  });

  it("refuses a POST /me/sessions whose account is signed out everywhere or banned while its body arrives: 401, no log", async () => {
    for (const what of ["signout", "ban"]) {
      const r = await freshRoom();
      const u = await addUser(r);
      const [id] = await addMessages(r, u.id, 1);
      const admin = await join(r, await addUser(r, { role: "admin" }));
      const held = heldBody(JSON.stringify({ ...SESSION, share: true }));
      const posting = r.stub.fetch("https://room/r/me/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${u.token}`, "Content-Type": "application/json" },
        body: held.stream,
      });
      await held.pulled;
      await settle();
      await r.inRoom(() => {});

      if (what === "signout") {
        expect(await me(r, u, "POST", "/signout")).toEqual({ status: 200, data: { ok: true } });
      } else {
        admin.send({ type: "ban", msg_id: id });
        expect(await take(admin, ofType("ok"))).toMatchObject({ for: "ban", sub_hash: u.sub });
      }
      held.release();

      const res = await posting;
      expect({ what, status: res.status, data: await res.json() }).toEqual({ what, status: 401, data: { error: "auth" } });
      expect(await r.rows("SELECT count(*) AS n FROM sessions")).toEqual([{ n: 0 }]);
      expect(await r.rows("SELECT key FROM limits WHERE key > ? AND key < ?", `${u.sub}:`, `${u.sub};`)).toEqual([]);
      // No card came. (The ban sends Bryan the banned message again, marked hidden.)
      await settle();
      expect(all(admin, "msg").filter((f) => f.msg.kind === "session")).toEqual([]);
    }
  });

  it("leaves the LINE account free to sign up again as a new person, with the same nickname and nothing of before", async () => {
    const r = await freshRoom();
    const line = `U${hex(16)}`;
    const post = async (path, body) => (await r.stub.fetch(`https://room${path}`, { method: "POST", body: JSON.stringify(body) })).json();
    const signUp = async () => {
      const v = randomB64u(32);
      const { code } = await post("/r/handoffs", { h: await sha256b64u(v), sub: line, line_name: "Kai" });
      return { token: (await post("/r/signup", { v, code, nick: "Kai_Again", consent: "v1" })).token };
    };
    const sub = await subHash(line, env.SUB_PEPPER);
    const first = await signUp();
    const [{ id: firstId }] = await r.rows("SELECT id FROM users WHERE sub_hash = ?", sub);
    await logSession(r, first);
    expect(await me(r, first, "DELETE")).toEqual({ status: 200, data: { ok: true } });
    expect(await r.rows("SELECT banned, deleted_at FROM subs WHERE sub_hash = ?", sub)).toEqual([{ banned: 0, deleted_at: T }]);
    const second = await signUp();
    expect(second.token).toEqual(expect.any(String));
    const [{ id: secondId }] = await r.rows("SELECT id FROM users WHERE sub_hash = ?", sub);
    expect(secondId).not.toBe(firstId);
    expect(await r.rows("SELECT banned, deleted_at FROM subs WHERE sub_hash = ?", sub)).toEqual([{ banned: 0, deleted_at: null }]);
    expect(await me(r, second, "GET", "/sessions")).toEqual({ status: 200, data: [] });
  });

  it("of Bryan's own account frees the role: he can claim it again from a new account", async () => {
    const r = await freshRoom();
    const bryan = await addUser(r);
    const c = await join(r, bryan);
    const isAdminMe = (f) => f?.type === "me" && f.role === "admin";
    c.send({ type: "admin", code: env.ADMIN_CODE });
    await take(c, isAdminMe);
    expect(await metaOf(r, "admin_uid")).toBe(bryan.id);
    expect(await me(r, bryan, "DELETE")).toEqual({ status: 200, data: { ok: true } });
    expect(await metaOf(r, "admin_uid")).toBeNull();
    expect(await holding(r, bryan.id)).toEqual([]);
    const again = await addUser(r);
    const c2 = await join(r, again);
    c2.send({ type: "admin", code: env.ADMIN_CODE });
    expect(await take(c2, isAdminMe)).toEqual({ type: "me", nick: again.nick, role: "admin" });
  });
});

// ---- Resting -------------------------------------------------------------------------------------------------------

describe("the resting guard", () => {
  it("past 90% of the 100k requests a day, a new socket is closed with 4429 and every request gets 503 {resting: true}", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    await setUsage(r, { req: 90_000 });
    const c = await connect(r);
    await until(() => c.closed !== null, "the socket to close");
    expect(c.closed).toBe(4429);
    expect(c.frames).toEqual([]);
    expect(await reports(r)).toEqual({ status: 503, data: { resting: true } });
    const calls = [
      ["GET", "/r/me/sessions"], ["POST", "/r/me/sessions", SESSION], ["DELETE", "/r/me/sessions/1"], ["GET", "/r/me/export"],
      ["DELETE", "/r/me"], ["POST", "/r/me/signout", {}], ["POST", "/r/logins", { h: await sha256b64u("x") }],
      ["POST", "/r/redeem", {}], ["GET", "/r/where"],
    ];
    for (const [method, path, body] of calls) {
      const res = await r.stub.fetch(`https://room${path}`, {
        method,
        headers: { Authorization: `Bearer ${u.token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(503);
      expect(await res.json(), `${method} ${path}`).toEqual({ resting: true });
    }
    // None of them did anything.
    expect(await r.rows("SELECT tv FROM users WHERE id = ?", u.id)).toEqual([{ tv: 0 }]);
    expect(await r.rows("SELECT (SELECT count(*) FROM sessions) AS sessions, (SELECT count(*) FROM logins) AS logins")).toEqual([
      { sessions: 0, logins: 0 },
    ]);
  });

  it("rests only once past 90%: the 90,000th request of the day is answered, the next one isn't", async () => {
    const r = await freshRoom();
    await setUsage(r, { req: 89_999 });
    expect((await reports(r)).status).toBe(200);
    expect(await reports(r)).toEqual({ status: 503, data: { resting: true } });
  });

  it("closes every open socket with 4429 when it trips, and a socket that sends a frame while it rests", async () => {
    const r = await freshRoom();
    const mine = await join(r, await addUser(r));
    const reader = await join(r);
    await setUsage(r, { req: 90_000 });
    expect((await reports(r)).status).toBe(503);
    await until(() => mine.closed !== null && reader.closed !== null, "both sockets to close");
    expect([mine.closed, reader.closed]).toEqual([4429, 4429]);

    const r2 = await freshRoom();
    const c = await join(r2);
    await setUsage(r2, { req: 90_000 });
    c.send({ type: "older", before_id: 5 });
    await until(() => c.closed !== null, "the socket to close");
    expect(c.closed).toBe(4429);
    expect(all(c, "history")).toHaveLength(1);
    expect(all(c, "error")).toEqual([]);
  });

  it("rests past 90% of the 5M rows read or the 100k rows written a day, too", async () => {
    for (const [counts, status] of [[{ req: 80_000, read: 4_400_000, write: 89_000 }, 200], [{ read: 4_500_001 }, 503], [{ write: 90_001 }, 503]]) {
      const r = await freshRoom();
      await setUsage(r, counts);
      expect((await reports(r)).status, JSON.stringify(counts)).toBe(status);
    }
  });

  it("comes back at 00:00 UTC, when the free plan's daily counts start again", async () => {
    const r = await freshRoom();
    await setUsage(r, { req: 95_000 });
    expect((await reports(r)).status).toBe(503);
    r.clock.t = Date.UTC(2030, 5, 4, 0, 0);
    expect(await reports(r)).toEqual({ status: 200, data: { reports: [], online: 0, last_id: 0 } });
    expect((await join(r)).history.messages).toEqual([]);
  });

  it("while it rests, the alarm closes the open sockets with 4429 instead of sending the tick", async () => {
    const r = await freshRoom();
    const c = await join(r);
    // The alarm counts itself as a request only at its end, so it rests from what the counts were before it.
    await setUsage(r, { req: 95_000 });
    expect(await runDurableObjectAlarm(r.stub)).toBe(true);
    await until(() => c.closed !== null, "the socket to close");
    expect(c.closed).toBe(4429);
    expect(all(c, "tick")).toEqual([]);
  });
});
