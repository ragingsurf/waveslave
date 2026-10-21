// Tests for the report button and Bryan's tools (spec "Moderation", steps 4, 5 and 7): when a flag counts, the
// one-flag hides, the admin claim, ban and unban, restore, lock and unlock, keep, the hidden list, Bryan's delete and
// GET /admin/where. They run inside the Workers runtime (see vitest.config.mjs). Run from chat/:
// npx vitest run --no-isolate --max-workers=1 test/mod-admin.spec.mjs
//
// The plan names this file mod-admin.test.mjs. It is .spec.mjs because it imports "cloudflare:test": see the note in
// vitest.config.mjs.
//
// As in socket.spec.mjs, each test opens its sockets on a room of its own, straight on the room's /r/ws, and writes
// accounts and messages straight into the room's tables, with session tokens signed by the test secret. The room's
// clock stands at T. Two tests go through the Worker to the real "taiwan" room: signing in with LINE after a ban, and
// /admin/where. Their accounts are new ones each time, and they close their sockets again.
import { evictDurableObject, runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { b64u, hmacB64u, randomB64u, sha256b64u, signToken, subHash } from "../src/auth.js";
import {
  DAY, HOUR, MIN, SEC, addMessages, addUser, all, closeClients, connect, hex, insertUser, join, newRoom, nextError, ofType, say,
  settle, synced, take, until,
} from "./helpers.mjs";

const BASE = "https://chat.example";
// 12:00 UTC on a day years ahead, so no alarm a test sets goes off by itself.
const T = Date.UTC(2030, 5, 3, 12, 0);
const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";

const REFUSED = { type: "error", code: "admin", for: "admin" };

afterEach(() => {
  vi.restoreAllMocks();
});
afterEach(closeClients);

// A room of its own, with its clock at T until the test moves clock.t.
const freshRoom = (at = T) => newRoom("admin", at);

// An account whose flags count: two days old, with a post.
const addFlagger = (r, more = {}) => addUser(r, { age: 2 * DAY, posts: 1, ...more });

// An account whose sexual and child-safety flags hide on their own: a week old, with 5 posts.
const addTrusted = (r) => addUser(r, { age: 7 * DAY, posts: 5 });

const msgOf = (id) => (f) => f?.type === "msg" && f.msg.id === id;

const claim = (c, code) => c.send({ type: "admin", code });

// Flags message id from socket c, and waits until the room has handled it (a flag gets no answer).
async function flag(c, id, reason = "spam") {
  c.send({ type: "flag", id, reason });
  await synced(c);
}

// Joins each of `users` and flags message id from each in turn.
async function flagFrom(r, users, id, reason = "spam") {
  for (const user of users) await flag(await join(r, user), id, reason);
}

const hiddenBy = (r, id) => r.rows("SELECT hidden_by FROM messages WHERE id = ?", id).then(([row]) => row.hidden_by);
const metaOf = (r, key) => r.inRoom((room) => room.getMeta(key));
// Gives the room another ADMIN_CODE, as a deploy with a new secret would.
const setAdminCode = (r, code) =>
  r.inRoom((room) => {
    room.env = { ...room.env, ADMIN_CODE: code };
  });

// ---- Flags ---------------------------------------------------------------------------------------------------------

describe("flags", () => {
  it("three counted flags hide a message: readers get update {id, hidden: true}, Bryan's socket the message marked hidden", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const flaggers = [await addFlagger(r), await addFlagger(r), await addFlagger(r)];
    const [id] = await addMessages(r, author.id, 1, { kind: "report", spot: "jinshan", ts: r.now() - MIN });
    const reader = await join(r);
    const admin = await join(r, bryan);
    const cs = [];
    for (const f of flaggers) cs.push(await join(r, f));
    expect(await r.inRoom((room) => room.reportsFor("jinshan", r.now()).reports)).toHaveLength(1);
    await flag(cs[0], id);
    await flag(cs[1], id, "harass");
    await settle();
    expect(await hiddenBy(r, id)).toBeNull();
    expect(all(reader, "update")).toEqual([]);
    await flag(cs[2], id, "other");
    expect(await take(reader, ofType("update"))).toEqual({ type: "update", id, hidden: true });
    const marked = await take(admin, msgOf(id));
    expect(marked.msg).toEqual({
      id, ts: r.now() - MIN, nick: author.nick, role: "user", kind: "report", spot: "jinshan",
      body: { text: "seeded 0" }, reply_to: null, likes: 0, hidden: "flags",
    });
    expect(await hiddenBy(r, id)).toBe("flags");
    // Readers learn only that it is gone, never why, and never get the message again.
    expect(all(reader, "msg")).toEqual([]);
    expect(JSON.stringify(reader.frames)).not.toContain('"flags"');
    // The flaggers get no answer, and the spot card and the next reader no longer show it.
    for (const c of cs) expect(all(c, "error").filter((e) => e.for === "flag")).toEqual([]);
    expect(await r.inRoom((room) => room.reportsFor("jinshan", r.now()).reports)).toEqual([]);
    expect((await join(r)).history.messages.map((m) => m.id)).not.toContain(id);
    expect(await r.rows("SELECT sub_hash, reason, ts, rejected FROM flags WHERE msg_id = ? ORDER BY rowid", id)).toEqual([
      { sub_hash: flaggers[0].sub, reason: "spam", ts: T, rejected: 0 },
      { sub_hash: flaggers[1].sub, reason: "harass", ts: T, rejected: 0 },
      { sub_hash: flaggers[2].sub, reason: "other", ts: T, rejected: 0 },
    ]);
  });

  it("counts a flag only from an account at least 24 hours old with a post: the others are kept, and don't count", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const [id] = await addMessages(r, author.id, 1);
    const young = await addUser(r, { age: DAY - SEC, posts: 1 });
    const silent = await addUser(r, { age: 2 * DAY, posts: 0 });
    const onlyHidden = await addUser(r, { age: 2 * DAY });
    await addMessages(r, onlyHidden.id, 1, { hidden_by: "flags" });
    const justOldEnough = await addUser(r, { age: DAY, posts: 1 });
    const counted = await addFlagger(r);
    await flagFrom(r, [young, silent, onlyHidden, justOldEnough, counted], id);
    expect(await hiddenBy(r, id)).toBeNull();
    expect((await r.rows("SELECT count(*) AS n FROM flags WHERE msg_id = ?", id))[0].n).toBe(5);
    await flagFrom(r, [await addFlagger(r)], id);
    expect(await hiddenBy(r, id)).toBe("flags");
  });

  it("counts flags per LINE account: two from the same sub_hash (account deleted and signed up again) count once", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const [id] = await addMessages(r, author.id, 1);
    const first = await addFlagger(r);
    await flagFrom(r, [first], id);
    // The account goes, and the same LINE account signs up again as someone new.
    await r.inRoom((room) => room.sql.exec("DELETE FROM users WHERE id = ?", first.id));
    const again = await addFlagger(r, { sub: first.sub });
    await flagFrom(r, [again], id, "harass");
    expect(await r.rows("SELECT sub_hash, reason FROM flags WHERE msg_id = ?", id)).toEqual([{ sub_hash: first.sub, reason: "spam" }]);
    await flagFrom(r, [await addFlagger(r)], id);
    expect(await hiddenBy(r, id)).toBeNull();
    await flagFrom(r, [await addFlagger(r)], id);
    expect(await hiddenBy(r, id)).toBe("flags");
  });

  it("ignores self-flags and flags on Bryan's messages: nothing is kept, and nothing hides", async () => {
    const r = await freshRoom();
    const author = await addTrusted(r);
    const bryan = await addUser(r, { role: "admin" });
    const [mine] = await addMessages(r, author.id, 1);
    const [his] = await addMessages(r, bryan.id, 1);
    await flagFrom(r, [author], mine, "sexual");
    await flagFrom(r, [bryan], his, "child");
    await flagFrom(r, [await addFlagger(r), await addFlagger(r)], mine);
    await flagFrom(r, [await addTrusted(r)], his, "child");
    await flagFrom(r, [await addFlagger(r), await addFlagger(r), await addFlagger(r)], his);
    expect(await r.rows("SELECT msg_id FROM flags WHERE msg_id = ?", his)).toEqual([]);
    expect((await r.rows("SELECT count(*) AS n FROM flags WHERE msg_id = ?", mine))[0].n).toBe(2);
    expect([await hiddenBy(r, mine), await hiddenBy(r, his)]).toEqual([null, null]);
    expect(await r.rows("SELECT * FROM holds")).toEqual([]);
  });

  it("takes 20 flags a day from one account; the 21st -> slow", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const ids = await addMessages(r, author.id, 21);
    const c = await join(r, await addFlagger(r));
    for (const id of ids.slice(0, 20)) await flag(c, id);
    expect(all(c, "error").filter((e) => e.for === "flag")).toEqual([]);
    c.send({ type: "flag", id: ids[20], reason: "spam" });
    expect(await take(c, (f) => f?.type === "error" && f.for === "flag")).toEqual({ type: "error", code: "slow:86400", for: "flag" });
    expect((await r.rows("SELECT count(*) AS n FROM flags"))[0].n).toBe(20);
  });

  it("refuses a flag with a reason that isn't one (error invalid), or on a message that isn't there or is hidden (error gone)", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const [id] = await addMessages(r, author.id, 1);
    const [hidden] = await addMessages(r, author.id, 1, { hidden_by: "ban" });
    const flagger = await addFlagger(r);
    const c = await join(r, flagger);
    for (const frame of [{ id, reason: "boring" }, { id }, { id: String(id), reason: "spam" }]) {
      c.send({ type: "flag", ...frame });
      expect(await nextError(c), JSON.stringify(frame)).toEqual({ type: "error", code: "invalid", for: "flag" });
    }
    for (const frame of [{ id: 999_999, reason: "spam" }, { id: hidden, reason: "spam" }]) {
      c.send({ type: "flag", ...frame });
      expect(await nextError(c), JSON.stringify(frame)).toEqual({ type: "error", code: "gone", for: "flag" });
    }
    expect(c.closed).toBeNull(); // three bad frames and two gone ones
    expect(await r.rows("SELECT * FROM flags")).toEqual([]);
  });

  it("needs a signed-in socket: a reader's flag gets error auth", async () => {
    const r = await freshRoom();
    const [id] = await addMessages(r, (await addUser(r)).id, 1);
    const reader = await join(r);
    reader.send({ type: "flag", id, reason: "spam" });
    expect(await nextError(reader)).toEqual({ type: "error", code: "auth", for: "flag" });
  });
});

// ---- One-flag hides ------------------------------------------------------------------------------------------------

describe("one-flag hides", () => {
  it("sexual from an account 7 days old with 5 posts hides on one flag; its 4th such hide that day counts as a normal flag", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const ids = await addMessages(r, author.id, 5);
    const trusted = await addTrusted(r);
    const c = await join(r, trusted);
    const reader = await join(r);
    for (const id of ids.slice(0, 3)) {
      await flag(c, id, "sexual");
      expect(await take(reader, ofType("update"))).toEqual({ type: "update", id, hidden: true });
      expect(await hiddenBy(r, id)).toBe("flags");
    }
    await flag(c, ids[3], "sexual");
    expect(await hiddenBy(r, ids[3])).toBeNull();
    // It is one of the 3 now.
    await flagFrom(r, [await addFlagger(r)], ids[3]);
    expect(await hiddenBy(r, ids[3])).toBeNull();
    await flagFrom(r, [await addFlagger(r)], ids[3]);
    expect(await hiddenBy(r, ids[3])).toBe("flags");
    // A day after the first, it hides on one flag again.
    r.clock.t += DAY;
    await flag(c, ids[4], "sexual");
    expect(await hiddenBy(r, ids[4])).toBe("flags");
  });

  it("child hides on one flag and copies the message to holds", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const [id] = await addMessages(r, author.id, 1, { spot: "fulong", ts: T - 5 * MIN });
    await flagFrom(r, [await addTrusted(r)], id, "child");
    expect(await hiddenBy(r, id)).toBe("flags");
    const holds = await r.rows("SELECT * FROM holds");
    expect(holds).toEqual([{ msg_id: id, body: expect.any(String), uid: author.id, sub_hash: author.sub, reason: "child", ts: T }]);
    expect(JSON.parse(holds[0].body)).toEqual({ ts: T - 5 * MIN, kind: "text", spot: "fulong", reply_to: null, body: { text: "seeded 0" } });
  });

  it("from an account under 7 days old, or with fewer than 5 posts, a sexual or child flag counts as one of the 3", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const [id] = await addMessages(r, author.id, 1);
    const almostAWeek = await addUser(r, { age: 7 * DAY - SEC, posts: 5 });
    const fourPosts = await addUser(r, { age: 30 * DAY, posts: 4 });
    await flagFrom(r, [almostAWeek], id, "sexual");
    expect(await hiddenBy(r, id)).toBeNull();
    await flagFrom(r, [fourPosts], id, "child");
    expect(await hiddenBy(r, id)).toBeNull();
    await flagFrom(r, [await addFlagger(r)], id);
    expect(await hiddenBy(r, id)).toBe("flags");
    // Hidden with a child-safety flag on it, so it is held as well.
    expect(await r.rows("SELECT msg_id, reason FROM holds")).toEqual([{ msg_id: id, reason: "child" }]);
  });
});

// ---- Restore -------------------------------------------------------------------------------------------------------

describe("restore", () => {
  it("brings a hidden message back for everyone, rejects its flags, and later flags can't hide it", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const [id] = await addMessages(r, author.id, 1);
    await flagFrom(r, [await addFlagger(r), await addFlagger(r), await addFlagger(r)], id);
    expect(await hiddenBy(r, id)).toBe("flags");
    const reader = await join(r);
    const admin = await join(r, bryan);
    admin.send({ type: "restore", id });
    expect(await take(admin, ofType("ok"))).toEqual({ type: "ok", for: "restore", id });
    const back = { id, ts: r.now() - HOUR, nick: author.nick, role: "user", kind: "text", spot: null, body: { text: "seeded 0" }, reply_to: null, likes: 0 };
    expect((await take(reader, msgOf(id))).msg).toEqual(back);
    expect((await take(admin, msgOf(id))).msg).toEqual(back);
    expect(await r.rows("SELECT hidden_by, flag_immune FROM messages WHERE id = ?", id)).toEqual([{ hidden_by: null, flag_immune: 1 }]);
    expect(await r.rows("SELECT rejected FROM flags WHERE msg_id = ?", id)).toEqual([{ rejected: 1 }, { rejected: 1 }, { rejected: 1 }]);
    expect((await join(r)).history.messages.map((m) => m.id)).toContain(id);
    // Immune: three more counted flags, and a child flag from a trusted account, change nothing.
    await flagFrom(r, [await addFlagger(r), await addFlagger(r), await addFlagger(r)], id);
    await flagFrom(r, [await addTrusted(r)], id, "child");
    expect(await hiddenBy(r, id)).toBeNull();
    expect((await r.rows("SELECT count(*) AS n FROM flags WHERE msg_id = ?", id))[0].n).toBe(3);
  });

  it("an account with 2 rejected flags no longer counts; one with 1 still does", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const admin = await join(r, bryan);
    const [m1, m2, m3] = await addMessages(r, author.id, 3);
    const [x, a, b, c, d] = [await addFlagger(r), await addFlagger(r), await addFlagger(r), await addFlagger(r), await addFlagger(r)];
    await flagFrom(r, [x, a, b], m1);
    await flagFrom(r, [x, c, d], m2);
    for (const id of [m1, m2]) {
      expect(await hiddenBy(r, id)).toBe("flags");
      admin.send({ type: "restore", id });
      await take(admin, ofType("ok"));
    }
    // x has two rejected flags, a and c one each.
    await flagFrom(r, [x, a, c], m3);
    expect(await hiddenBy(r, m3)).toBeNull();
    await flagFrom(r, [await addFlagger(r)], m3);
    expect(await hiddenBy(r, m3)).toBe("flags");
  });

  it("on a message that is there to see, makes it immune and rejects its flags, telling nobody", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const [id] = await addMessages(r, author.id, 1);
    const a = await addFlagger(r);
    await flagFrom(r, [a], id);
    const reader = await join(r);
    const admin = await join(r, bryan);
    admin.send({ type: "restore", id });
    await take(admin, ofType("ok"));
    await settle();
    expect(all(reader, "msg")).toEqual([]);
    expect(await r.rows("SELECT hidden_by, flag_immune FROM messages WHERE id = ?", id)).toEqual([{ hidden_by: null, flag_immune: 1 }]);
    expect(await r.rows("SELECT rejected FROM flags WHERE msg_id = ?", id)).toEqual([{ rejected: 1 }]);
  });

  it("answers a restore of a message that isn't there with error gone, and one of an id that isn't one with invalid", async () => {
    const r = await freshRoom();
    const admin = await join(r, await addUser(r, { role: "admin" }));
    admin.send({ type: "restore", id: 999_999 });
    expect(await nextError(admin)).toEqual({ type: "error", code: "gone", for: "restore" });
    admin.send({ type: "restore", id: "1" });
    expect(await nextError(admin)).toEqual({ type: "error", code: "invalid", for: "restore" });
  });
});

// ---- The admin claim -----------------------------------------------------------------------------------------------

describe("the admin claim", () => {
  it("with a 32-character ADMIN_CODE, the right code makes the account Bryan's; a second account's right code is refused", async () => {
    expect(env.ADMIN_CODE).toHaveLength(32);
    const r = await freshRoom();
    const bryan = await addUser(r);
    const other = await addUser(r);
    const phone = await join(r, bryan);
    const laptop = await join(r, bryan);
    const them = await join(r, other);
    claim(phone, env.ADMIN_CODE);
    expect(await take(phone, (f) => f?.type === "me" && f.role === "admin")).toEqual({ type: "me", nick: bryan.nick, role: "admin" });
    expect(await take(laptop, (f) => f?.type === "me" && f.role === "admin")).toEqual({ type: "me", nick: bryan.nick, role: "admin" });
    expect(await metaOf(r, "admin_uid")).toBe(bryan.id);
    expect(await r.rows("SELECT role FROM users WHERE id = ?", bryan.id)).toEqual([{ role: "admin" }]);
    // His sockets are admin sockets now, through hibernation too.
    const roles = await r.inRoom((room, state) => state.getWebSockets().map((ws) => ws.deserializeAttachment()));
    expect(roles.filter((at) => at.uid === bryan.id).map((at) => at.role)).toEqual(["admin", "admin"]);
    // His messages carry role admin, set by the room.
    say(laptop, "Welcome to the Taiwan chat");
    expect((await take(them, ofType("msg"))).msg).toMatchObject({ nick: bryan.nick, role: "admin" });
    // Claims are closed: the right code from another account is refused, and nothing changes.
    claim(them, env.ADMIN_CODE);
    expect(await nextError(them)).toEqual(REFUSED);
    expect(await metaOf(r, "admin_uid")).toBe(bryan.id);
    expect(await r.rows("SELECT role FROM users WHERE id = ?", other.id)).toEqual([{ role: "user" }]);
    expect(all(them, "me").map((f) => f.role)).toEqual(["user"]);
  });

  it("takes the line as typed too: /admin <code>, with either slash", async () => {
    for (const line of [`/admin ${env.ADMIN_CODE}`, `／admin  ${env.ADMIN_CODE} `]) {
      const r = await freshRoom();
      const bryan = await addUser(r);
      const c = await join(r, bryan);
      claim(c, line);
      expect(await take(c, (f) => f?.type === "me" && f.role === "admin"), line).toEqual({ type: "me", nick: bryan.nick, role: "admin" });
    }
  });

  it("doesn't count other slash commands as claims, so people typing /shrug can't switch claiming off", async () => {
    const r = await freshRoom();
    const people = [];
    for (let k = 0; k < 4; k++) people.push(await join(r, await addUser(r)));
    for (const c of people) {
      for (const line of ["/shrug", "／me waves", "/ad min x", "/adminx"]) {
        claim(c, line);
        expect(await nextError(c), line).toEqual(REFUSED);
      }
    }
    expect(await metaOf(r, "admin_claims")).toBeNull();
    expect(people.map((c) => c.closed)).toEqual([null, null, null, null]);
    const bryan = await addUser(r);
    const c = await join(r, bryan);
    claim(c, `/admin ${env.ADMIN_CODE}`);
    expect(await take(c, (f) => f?.type === "me" && f.role === "admin")).toEqual({ type: "me", nick: bryan.nick, role: "admin" });
  });

  it("sets a message's role from the account only: a role in a frame changes nothing", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const c = await join(r, a);
    const reader = await join(r);
    say(c, "I'm the admin now", { role: "admin" });
    expect((await take(reader, ofType("msg"))).msg).toMatchObject({ nick: a.nick, role: "user" });
  });

  it("stops an account after 3 wrong codes, and everyone after 10 in all, until ADMIN_CODE is changed", async () => {
    const r = await freshRoom();
    const people = [];
    for (let k = 0; k < 5; k++) people.push(await addUser(r));
    const cs = [];
    for (const p of people) cs.push(await join(r, p));
    const wrong = (k) => `wrong-code-${k}-${"x".repeat(32)}`;
    const tryWith = async (c, code) => {
      claim(c, code);
      expect(await nextError(c)).toEqual(REFUSED);
    };
    for (let k = 0; k < 3; k++) await tryWith(cs[0], wrong(k));
    // Blocked now: the right code is refused too, and that try doesn't count.
    await tryWith(cs[0], env.ADMIN_CODE);
    expect(await metaOf(r, "admin_uid")).toBeNull();
    // The same LINE account, signed up again, is still blocked.
    await r.inRoom((room) => room.sql.exec("DELETE FROM users WHERE id = ?", people[0].id));
    const again = await addUser(r, { sub: people[0].sub, nick: `Again_${hex(3)}` });
    await tryWith(await join(r, again), env.ADMIN_CODE);
    // Seven more wrong codes from three other accounts make 10 in all...
    for (let k = 0; k < 3; k++) await tryWith(cs[1], wrong(k));
    for (let k = 0; k < 3; k++) await tryWith(cs[2], wrong(k));
    await tryWith(cs[3], wrong(0));
    // ...and then claiming is off for everyone, even with the right code.
    await tryWith(cs[3], env.ADMIN_CODE);
    await tryWith(cs[4], env.ADMIN_CODE);
    expect(await metaOf(r, "admin_uid")).toBeNull();
    expect(await r.rows("SELECT count(*) AS n FROM users WHERE role = 'admin'")).toEqual([{ n: 0 }]);
    // A new ADMIN_CODE opens claiming again, with every count back at zero.
    const next = "test-only-admin-code-changed-32x";
    expect(next).toHaveLength(32);
    await setAdminCode(r, next);
    await tryWith(cs[4], env.ADMIN_CODE);
    const fresh = await join(r, again);
    claim(fresh, next);
    expect(await take(fresh, (f) => f?.type === "me" && f.role === "admin")).toEqual({ type: "me", nick: again.nick, role: "admin" });
    expect(await metaOf(r, "admin_uid")).toBe(again.id);
  });

  it("refuses every claim while ADMIN_CODE is under 32 characters, or missing, and counts none of them", async () => {
    const r = await freshRoom();
    const bryan = await addUser(r);
    const c = await join(r, bryan);
    const short = env.ADMIN_CODE.slice(0, 31);
    await setAdminCode(r, short);
    for (let k = 0; k < 12; k++) {
      claim(c, short);
      expect(await nextError(c)).toEqual(REFUSED);
    }
    await setAdminCode(r, undefined);
    claim(c, "undefined");
    expect(await nextError(c)).toEqual(REFUSED);
    expect(await metaOf(r, "admin_uid")).toBeNull();
    expect(await metaOf(r, "admin_claims")).toBeNull();
    // None of those counted against him: with a long enough code, his claim goes.
    await setAdminCode(r, env.ADMIN_CODE);
    claim(c, env.ADMIN_CODE);
    expect(await take(c, (f) => f?.type === "me" && f.role === "admin")).toEqual({ type: "me", nick: bryan.nick, role: "admin" });
  });

  it("needs a signed-in socket that isn't banned: a reader gets error auth, a banned account error banned", async () => {
    const r = await freshRoom();
    const banned = await addUser(r);
    const c = await join(r, banned);
    await r.inRoom((room) => room.sql.exec("UPDATE subs SET banned = 1 WHERE sub_hash = ?", banned.sub));
    claim(c, env.ADMIN_CODE);
    expect(await nextError(c)).toEqual({ type: "error", code: "banned", for: "admin" });
    const reader = await join(r);
    claim(reader, env.ADMIN_CODE);
    expect(await nextError(reader)).toEqual({ type: "error", code: "auth", for: "admin" });
    expect(await metaOf(r, "admin_uid")).toBeNull();
  });
});

// ---- Bryan's tools -------------------------------------------------------------------------------------------------

describe("Bryan's tools are his alone", () => {
  it("from anyone else, each gets error invalid and changes nothing; from a reader, error auth", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const b = await addUser(r);
    const [id] = await addMessages(r, b.id, 1, { hidden_by: "flags" });
    await r.inRoom((room) => room.sql.exec("UPDATE subs SET banned = 1 WHERE sub_hash = ?", b.sub));
    const frames = [
      { type: "ban", msg_id: id }, { type: "unban", sub_hash: b.sub }, { type: "restore", id }, { type: "keep", id },
      { type: "lock" }, { type: "unlock" }, { type: "hidden_list" },
    ];
    const seen = [];
    for (const frame of frames) {
      // Sockets of their own: each of these is a bad frame, and five close a socket.
      const c = await join(r, a);
      const reader = await join(r);
      c.send(frame);
      expect(await nextError(c), frame.type).toEqual({ type: "error", code: "invalid", for: frame.type });
      reader.send(frame);
      expect(await nextError(reader), frame.type).toEqual({ type: "error", code: "auth", for: frame.type });
      seen.push(...c.frames, ...reader.frames);
    }
    await settle();
    expect(await r.rows("SELECT banned FROM subs WHERE sub_hash = ?", b.sub)).toEqual([{ banned: 1 }]);
    expect(await hiddenBy(r, id)).toBe("flags");
    expect(await r.rows("SELECT * FROM holds")).toEqual([]);
    expect(await metaOf(r, "locked")).toBeNull();
    expect(seen.filter((f) => f.type === "hidden" || f.type === "ok" || f.type === "msg")).toEqual([]);
  });
});

describe("ban", () => {
  it("hides the user's messages from the last 24 hours, bans their LINE account and closes their sockets (4403)", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const other = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const [old] = await addMessages(r, u.id, 1, { ts: T - DAY - MIN });
    const [flagged] = await addMessages(r, u.id, 1, { ts: T - 3 * HOUR, hidden_by: "flags" });
    const recent = await addMessages(r, u.id, 2, { ts: T - HOUR, kind: "report", spot: "suao" });
    const [theirs] = await addMessages(r, other.id, 1);
    const one = await join(r, u);
    const two = await join(r, u);
    const reader = await join(r);
    const otherSocket = await join(r, other);
    const admin = await join(r, bryan);
    expect(await r.inRoom((room) => room.reportsFor("suao", T).reports)).toHaveLength(2);
    admin.send({ type: "ban", msg_id: recent[1] });
    expect(await take(admin, ofType("ok"))).toEqual({ type: "ok", for: "ban", msg_id: recent[1], sub_hash: u.sub });
    await until(() => one.closed !== null && two.closed !== null, "their sockets to close");
    expect([one.closed, two.closed]).toEqual([4403, 4403]);
    for (const id of recent) {
      expect(await take(reader, ofType("update"))).toEqual({ type: "update", id, hidden: true });
      expect((await take(admin, msgOf(id))).msg).toMatchObject({ id, nick: u.nick, kind: "report", hidden: "ban" });
    }
    await settle();
    expect(all(reader, "update")).toHaveLength(2);
    expect([otherSocket.closed, reader.closed, admin.closed]).toEqual([null, null, null]);
    const hidden = await r.rows("SELECT id, hidden_by FROM messages ORDER BY id");
    expect(hidden).toEqual([
      { id: old, hidden_by: null },
      { id: flagged, hidden_by: "flags" },
      { id: recent[0], hidden_by: "ban" },
      { id: recent[1], hidden_by: "ban" },
      { id: theirs, hidden_by: null },
    ]);
    expect(await r.rows("SELECT banned FROM subs WHERE sub_hash = ?", u.sub)).toEqual([{ banned: 1 }]);
    expect(await r.rows("SELECT tv FROM users WHERE id = ?", u.id)).toEqual([{ tv: 1 }]);
    expect(await r.inRoom((room) => room.reportsFor("suao", T).reports)).toEqual([]);
    // Their token no longer signs a socket in.
    const back = await connect(r);
    back.send({ type: "hello", v: 1, token: u.token });
    expect(await nextError(back)).toEqual({ type: "error", code: "auth", for: "hello" });
  });

  it("hides the message the ban was for, even when it is over 24 hours old", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const [old] = await addMessages(r, u.id, 1, { ts: T - 3 * DAY });
    const admin = await join(r, await addUser(r, { role: "admin" }));
    admin.send({ type: "ban", msg_id: old });
    await take(admin, ofType("ok"));
    expect(await hiddenBy(r, old)).toBe("ban");
  });

  it("stops the banned account's flags counting", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const [id] = await addMessages(r, author.id, 1);
    const a = await addFlagger(r);
    const b = await addFlagger(r);
    await flagFrom(r, [a, b], id);
    // a also has a post the ban leaves visible (over 24 hours old), so only the ban stops a's flag counting.
    await addMessages(r, a.id, 1, { ts: T - 2 * DAY });
    const [post] = await r.rows("SELECT id FROM messages WHERE uid = ? ORDER BY id LIMIT 1", a.id);
    const admin = await join(r, await addUser(r, { role: "admin" }));
    admin.send({ type: "ban", msg_id: post.id });
    await take(admin, ofType("ok"));
    expect(await r.rows("SELECT hidden_by FROM messages WHERE uid = ? ORDER BY id", a.id)).toEqual([{ hidden_by: "ban" }, { hidden_by: null }]);
    await flagFrom(r, [await addFlagger(r)], id);
    expect(await hiddenBy(r, id)).toBeNull();
    await flagFrom(r, [await addFlagger(r)], id);
    expect(await hiddenBy(r, id)).toBe("flags");
  });

  it("can't ban Bryan (error invalid), or the author of a message that isn't there or has no author left (error gone)", async () => {
    const r = await freshRoom();
    const bryan = await addUser(r, { role: "admin" });
    const [his] = await addMessages(r, bryan.id, 1);
    const [orphan] = await addMessages(r, null, 1, { kind: "report", spot: "nanwan" });
    const admin = await join(r, bryan);
    for (const [msg_id, code] of [[his, "invalid"], [orphan, "gone"], [999_999, "gone"], [String(his), "invalid"]]) {
      admin.send({ type: "ban", msg_id });
      expect(await nextError(admin), String(msg_id)).toEqual({ type: "error", code, for: "ban" });
    }
    expect(admin.closed).toBeNull();
    expect(await r.rows("SELECT banned FROM subs WHERE sub_hash = ?", bryan.sub)).toEqual([{ banned: 0 }]);
    expect(await hiddenBy(r, his)).toBeNull();
  });
});

describe("unban", () => {
  it("clears the ban; a second unban is ok too, a LINE account the room has no row for is gone", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const [id] = await addMessages(r, u.id, 1);
    const admin = await join(r, await addUser(r, { role: "admin" }));
    admin.send({ type: "ban", msg_id: id });
    await take(admin, ofType("ok"));
    admin.send({ type: "unban", sub_hash: u.sub });
    expect(await take(admin, ofType("ok"))).toEqual({ type: "ok", for: "unban", sub_hash: u.sub });
    expect(await r.rows("SELECT banned FROM subs WHERE sub_hash = ?", u.sub)).toEqual([{ banned: 0 }]);
    // Their hidden messages stay hidden until Bryan restores them.
    expect(await hiddenBy(r, id)).toBe("ban");
    // Bryan's double tap: the account isn't banned, and stays so.
    admin.send({ type: "unban", sub_hash: u.sub });
    expect(await take(admin, ofType("ok"))).toEqual({ type: "ok", for: "unban", sub_hash: u.sub });
    expect(await r.rows("SELECT banned FROM subs WHERE sub_hash = ?", u.sub)).toEqual([{ banned: 0 }]);
    admin.send({ type: "unban", sub_hash: "sub-nobody" });
    expect(await nextError(admin)).toEqual({ type: "error", code: "gone", for: "unban" });
    admin.send({ type: "unban", sub_hash: 42 });
    expect(await nextError(admin)).toEqual({ type: "error", code: "invalid", for: "unban" });
    expect(await r.rows("SELECT sub_hash FROM subs WHERE sub_hash = 'sub-nobody'")).toEqual([]);
  });
});

describe("lock and unlock", () => {
  it("lock: others get error locked on say and report, while Bryan posts and everyone can still like, flag and delete", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const b = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const [mine] = await addMessages(r, a.id, 1);
    const [hers] = await addMessages(r, b.id, 1);
    const ca = await join(r, a);
    const admin = await join(r, bryan);
    admin.send({ type: "lock" });
    expect(await take(admin, ofType("ok"))).toEqual({ type: "ok", for: "lock" });
    expect(await metaOf(r, "locked")).toBe(1);
    say(ca, "Anyone out?");
    expect(await nextError(ca)).toEqual({ type: "error", code: "locked", for: "say" });
    ca.send({ type: "report", spot: "jinshan", size: "chest", cond: "clean", crowd: "few" });
    expect(await nextError(ca)).toEqual({ type: "error", code: "locked", for: "report" });
    say(admin, "Locked for tonight");
    expect((await take(ca, ofType("msg"))).msg).toMatchObject({ role: "admin", body: { text: "Locked for tonight" } });
    ca.send({ type: "like", id: hers });
    expect(await take(ca, ofType("update"))).toEqual({ type: "update", id: hers, likes: 1 });
    await flag(ca, hers);
    expect(await r.rows("SELECT sub_hash FROM flags WHERE msg_id = ?", hers)).toEqual([{ sub_hash: a.sub }]);
    ca.send({ type: "delete", id: mine });
    expect(await take(ca, ofType("update"))).toEqual({ type: "update", id: mine, deleted: true });
    expect(all(ca, "error")).toHaveLength(2);
  });

  it("unlock reverses it", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const ca = await join(r, a);
    const admin = await join(r, await addUser(r, { role: "admin" }));
    admin.send({ type: "lock" });
    await take(admin, ofType("ok"));
    admin.send({ type: "unlock" });
    expect(await take(admin, ofType("ok"))).toEqual({ type: "ok", for: "unlock" });
    expect(await metaOf(r, "locked")).toBe(0);
    say(ca, "Back again");
    expect((await take(admin, ofType("msg"))).msg).toMatchObject({ nick: a.nick, body: { text: "Back again" } });
  });
});

describe("keep", () => {
  it("copies the message to holds as evidence, once, and leaves the message as it is", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const [id] = await addMessages(r, u.id, 1, { spot: "wushi", ts: T - 2 * MIN });
    const [hidden] = await addMessages(r, u.id, 1, { hidden_by: "flags" });
    const admin = await join(r, await addUser(r, { role: "admin" }));
    admin.send({ type: "keep", id });
    expect(await take(admin, ofType("ok"))).toEqual({ type: "ok", for: "keep", id });
    admin.send({ type: "keep", id });
    await take(admin, ofType("ok"));
    const holds = await r.rows("SELECT * FROM holds");
    expect(holds).toEqual([{ msg_id: id, body: expect.any(String), uid: u.id, sub_hash: u.sub, reason: "keep", ts: T }]);
    expect(JSON.parse(holds[0].body)).toEqual({ ts: T - 2 * MIN, kind: "text", spot: "wushi", reply_to: null, body: { text: "seeded 0" } });
    expect(await hiddenBy(r, id)).toBeNull();
    // A hidden message can be kept too; one that isn't there can't.
    admin.send({ type: "keep", id: hidden });
    expect(await take(admin, ofType("ok"))).toEqual({ type: "ok", for: "keep", id: hidden });
    admin.send({ type: "keep", id: 999_999 });
    expect(await nextError(admin)).toEqual({ type: "error", code: "gone", for: "keep" });
    expect((await r.rows("SELECT count(*) AS n FROM holds"))[0].n).toBe(2);
  });
});

describe("hidden_list", () => {
  it("-> hidden {count, messages, banned, banned_count}: each hidden message, newest first, with why it was hidden", async () => {
    const r = await freshRoom();
    const a = await addUser(r);
    const b = await addUser(r);
    const gone = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    await addMessages(r, a.id, 1);
    const [byFlags] = await addMessages(r, a.id, 1, { hidden_by: "flags", ts: T - 3 * MIN });
    const [byBan] = await addMessages(r, b.id, 1, { hidden_by: "ban", ts: T - 2 * MIN });
    const [byAdmin] = await addMessages(r, a.id, 1, { hidden_by: "admin", ts: T - MIN, kind: "report", spot: "donghe" });
    await r.inRoom((room) => {
      for (const [sub, reason, rejected] of [["s1", "spam", 0], ["s2", "spam", 0], ["s3", "child", 0], ["s4", "other", 1]]) {
        room.sql.exec("INSERT INTO flags (msg_id, sub_hash, reason, ts, rejected) VALUES (?, ?, ?, ?, ?)", byFlags, sub, reason, T, rejected);
      }
      room.sql.exec("UPDATE subs SET banned = 1 WHERE sub_hash IN (?, ?)", b.sub, gone.sub);
      room.sql.exec("DELETE FROM users WHERE id = ?", gone.id);
    });
    const admin = await join(r, bryan);
    admin.send({ type: "hidden_list" });
    const list = await take(admin, ofType("hidden"));
    const shown = (id, who, ts, more) => ({
      id, ts, nick: who.nick, role: "user", kind: "text", spot: null, body: { text: "seeded 0" }, reply_to: null, likes: 0, ...more,
    });
    expect(list).toEqual({
      type: "hidden",
      count: 3,
      messages: [
        shown(byAdmin, a, T - MIN, { kind: "report", spot: "donghe", hidden: "admin", flags: {} }),
        shown(byBan, b, T - 2 * MIN, { hidden: "ban", flags: {} }),
        shown(byFlags, a, T - 3 * MIN, { hidden: "flags", flags: { spam: 2, child: 1 } }),
      ],
      // The newest LINE accounts first: gone's account was made after b's.
      banned: [{ sub_hash: gone.sub, nick: null }, { sub_hash: b.sub, nick: b.nick }],
      banned_count: 2,
    });
  });

  it("lists the newest 100 banned LINE accounts, always the same ones, and says how many are banned in all", async () => {
    const r = await freshRoom();
    const bryan = await addUser(r, { role: "admin" });
    // 130 banned accounts, made in this order, with sub_hash values that sort the other way round; and some that aren't.
    const subs = Array.from({ length: 130 }, (_, k) => `sub-${String(999 - k).padStart(4, "0")}`);
    await r.inRoom((room) => {
      for (const sub of subs) room.sql.exec("INSERT INTO subs (sub_hash, banned) VALUES (?, 1)", sub);
      for (let k = 0; k < 5; k++) room.sql.exec("INSERT INTO subs (sub_hash, banned) VALUES (?, 0)", `sub-free-${k}`);
    });
    const admin = await join(r, bryan);
    const lists = [];
    for (let k = 0; k < 2; k++) {
      admin.send({ type: "hidden_list" });
      lists.push(await take(admin, ofType("hidden")));
    }
    for (const list of lists) {
      expect(list.banned_count).toBe(130);
      expect(list.banned.map((row) => row.sub_hash)).toEqual(subs.slice(30).reverse());
    }
  });
});

describe("delete by Bryan", () => {
  it("hides anyone's message (hidden_by admin): readers get update hidden, his socket the message marked; his own goes outright", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const [theirs] = await addMessages(r, u.id, 1);
    const [orphan] = await addMessages(r, null, 1, { kind: "report", spot: "hualien" });
    const [his] = await addMessages(r, bryan.id, 1);
    const reader = await join(r);
    const admin = await join(r, bryan);
    for (const id of [theirs, orphan]) {
      admin.send({ type: "delete", id });
      expect(await take(reader, ofType("update"))).toEqual({ type: "update", id, hidden: true });
      expect((await take(admin, msgOf(id))).msg).toMatchObject({ id, hidden: "admin" });
      expect(await hiddenBy(r, id)).toBe("admin");
    }
    admin.send({ type: "delete", id: his });
    expect(await take(reader, ofType("update"))).toEqual({ type: "update", id: his, deleted: true });
    expect(await r.rows("SELECT id FROM messages WHERE id = ?", his)).toEqual([]);
    // Anyone else still deletes only their own.
    const c = await join(r, u);
    c.send({ type: "delete", id: orphan });
    expect(await nextError(c)).toEqual({ type: "error", code: "invalid", for: "delete" });
    expect(await hiddenBy(r, orphan)).toBe("admin");
  });

  it("leaves a message that is already hidden as it is: it keeps why (flags, ban), and nobody is told again", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const flagger = await addFlagger(r);
    const bryan = await addUser(r, { role: "admin" });
    const [byFlags] = await addMessages(r, u.id, 1, { hidden_by: "flags" });
    const [byBan] = await addMessages(r, u.id, 1, { hidden_by: "ban" });
    const [byAdmin] = await addMessages(r, u.id, 1, { hidden_by: "admin" });
    await r.inRoom((room) => room.sql.exec("INSERT INTO flags (msg_id, sub_hash, reason, ts) VALUES (?, ?, 'spam', ?)", byFlags, flagger.sub, T));
    const reader = await join(r);
    const admin = await join(r, bryan);
    // A double tap too: the second Delete on each finds it hidden already.
    for (const id of [byFlags, byBan, byAdmin, byFlags, byBan]) admin.send({ type: "delete", id });
    await synced(admin);
    await settle();
    expect(await r.rows("SELECT id, hidden_by FROM messages WHERE uid = ? ORDER BY id", u.id)).toEqual([
      { id: byFlags, hidden_by: "flags" },
      { id: byBan, hidden_by: "ban" },
      { id: byAdmin, hidden_by: "admin" },
    ]);
    expect([all(reader, "update"), all(admin, "update"), all(admin, "msg"), all(admin, "error")]).toEqual([[], [], [], []]);
    expect(admin.closed).toBeNull();
    // So his hidden list still says why each one went.
    admin.send({ type: "hidden_list" });
    const list = await take(admin, ofType("hidden"));
    expect(list.messages.map((m) => [m.id, m.hidden, m.flags])).toEqual([[byAdmin, "admin", {}], [byBan, "ban", {}], [byFlags, "flags", { spam: 1 }]]);
  });
});

describe("hibernation", () => {
  it("after eviction, Bryan's socket still gets a hidden message marked, and a reader only update hidden", async () => {
    const r = await freshRoom();
    const author = await addUser(r);
    const [id] = await addMessages(r, author.id, 1);
    const flaggers = [await addFlagger(r), await addFlagger(r), await addFlagger(r)];
    const cs = [];
    for (const f of flaggers) cs.push(await join(r, f));
    const reader = await join(r);
    const admin = await join(r, await addUser(r, { role: "admin" }));
    await evictDurableObject(r.stub);
    await runInDurableObject(r.stub, (room) => {
      room.now = () => r.clock.t;
    });
    for (const c of cs) await flag(c, id);
    expect(await take(reader, ofType("update"))).toEqual({ type: "update", id, hidden: true });
    expect((await take(admin, msgOf(id))).msg).toMatchObject({ id, hidden: "flags" });
    expect(all(reader, "msg")).toEqual([]);
  });
});

// ---- GET /admin/where ----------------------------------------------------------------------------------------------

const TRACE = [
  "fl=12f345", "h=www.cloudflare.com", "ip=203.0.113.9", "ts=1906545600.123", "visit_scheme=https", "uag=workerd",
  "colo=NRT", "sliver=none", "http=http/1.1", "loc=JP", "tls=TLSv1.3", "sni=plaintext", "warp=off", "gateway=off",
].join("\n") + "\n";

// Answers the trace page with `answer`, and records what was asked for. Any other fetch goes out as usual.
function mockTrace(answer = () => new Response(TRACE)) {
  const asked = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== TRACE_URL) return real(input, init);
    asked.push(request.url);
    return answer();
  });
  return asked;
}

const where = (stub, token) => stub.fetch("https://room/r/where", { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe("GET /admin/where", () => {
  it("with Bryan's token answers the colo= line of Cloudflare's trace and nothing else; anyone else's gets 403", async () => {
    const r = await freshRoom(Date.now());
    const bryan = await addUser(r, { role: "admin" });
    const a = await addUser(r);
    const asked = mockTrace();
    const res = await where(r.stub, bryan.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(await res.text()).toBe("colo=NRT\n");
    expect(asked).toEqual([TRACE_URL]);
    const theirs = await where(r.stub, a.token);
    expect(theirs.status).toBe(403);
    expect(await theirs.json()).toEqual({ error: "admin" });
    for (const token of [null, "junk"]) {
      const res2 = await where(r.stub, token);
      expect(res2.status).toBe(401);
      expect(await res2.json()).toEqual({ error: "auth" });
    }
    expect(asked).toHaveLength(1);
  });

  it("answers 502 when the trace can't be read", async () => {
    const r = await freshRoom(Date.now());
    const bryan = await addUser(r, { role: "admin" });
    for (const answer of [() => new Response("oops", { status: 500 }), () => new Response("fl=1\nh=x\n"), () => Promise.reject(new TypeError("network"))]) {
      mockTrace(answer);
      const res = await where(r.stub, bryan.token);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "trace" });
      vi.restoreAllMocks();
    }
  });
});

// ---- Through the Worker, on the taiwan room ------------------------------------------------------------------------

// LINE, mocked, for the trip through /auth/line/start and /auth/line/callback (as in login.spec.mjs).
const enc = new TextEncoder();

async function idToken(claims) {
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "HS256" })));
  const body = b64u(enc.encode(JSON.stringify(claims)));
  return `${head}.${body}.${await hmacB64u(env.LINE_CHANNEL_SECRET, `${head}.${body}`)}`;
}

// Signs in with LINE as `sub`, through the Worker, and returns the fragment the browser is sent back with.
async function signInWithLine(sub) {
  const start = await SELF.fetch(`${BASE}/auth/line/start?h=${await sha256b64u(randomB64u(32))}`, { redirect: "manual" });
  const nonce = new URL(start.headers.get("Location")).searchParams.get("nonce");
  const state = new URL(start.headers.get("Location")).searchParams.get("state");
  const now = Math.floor(Date.now() / 1000);
  const token = await idToken({ iss: "https://access.line.me", sub, aud: env.LINE_CHANNEL_ID, exp: now + 3600, iat: now, nonce, name: "Kai" });
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (new Request(input, init).url !== env.LINE_TOKEN_URL) return real(input, init);
    return Response.json({ access_token: "line-access-token", token_type: "Bearer", id_token: token });
  });
  const back = await SELF.fetch(`${BASE}/auth/line/callback?code=line-code&state=${state}`, { redirect: "manual" });
  vi.restoreAllMocks();
  return Object.fromEntries(new URLSearchParams(new URL(back.headers.get("Location")).hash.slice(1)));
}

describe("through the Worker, on the taiwan room", () => {
  const taiwan = env.ROOM.getByName("taiwan", { locationHint: "apac-ne" });

  // An account in the taiwan room for LINE account `sub` (its sub_hash made as the room makes it), with a token.
  async function taiwanUser(sub, role = "user") {
    const user = { id: crypto.randomUUID(), sub: await subHash(sub, env.SUB_PEPPER), nick: `Taiwan_${hex(4)}` };
    await runInDurableObject(taiwan, (room) => insertUser(room, user, { age: 2 * DAY, role, now: Date.now() }));
    user.token = await signToken({ uid: user.id, tv: 0, exp: Date.now() + DAY }, env.SESSION_SECRET);
    return user;
  }

  it("a banned LINE account signing in again goes back to the app with #e=banned; after unban it signs in", async () => {
    const line = `U${hex(16)}`;
    const u = await taiwanUser(line);
    const bryan = await taiwanUser(`U${hex(16)}`, "admin");
    const id = await runInDurableObject(taiwan, (room) => {
      const added = room.sql
        .exec("INSERT INTO messages (ts, uid, kind, body) VALUES (?, ?, 'text', ?) RETURNING id", Date.now() - MIN, u.id, JSON.stringify({ text: "Selling boards, DM me" }))
        .one().id;
      room.messagesChanged();
      return added;
    });
    const admin = await connect({ stub: taiwan });
    admin.send({ type: "hello", v: 1, token: bryan.token });
    await take(admin, ofType("history"));
    expect(Object.keys(await signInWithLine(line)).sort()).toEqual(["c", "p"]);
    admin.send({ type: "ban", msg_id: id });
    expect(await take(admin, ofType("ok"))).toEqual({ type: "ok", for: "ban", msg_id: id, sub_hash: u.sub });
    expect(await signInWithLine(line)).toEqual({ e: "banned" });
    admin.send({ type: "unban", sub_hash: u.sub });
    await take(admin, ofType("ok"));
    expect(Object.keys(await signInWithLine(line)).sort()).toEqual(["c", "p"]);
    admin.ws.close(1000, "done");
    await until(() => runInDurableObject(taiwan, (room) => room.online() === 0), "the taiwan room to see the close");
  });

  it("GET /admin/where with Bryan's token returns the colo= line; with anyone else's, 403", async () => {
    const bryan = await taiwanUser(`U${hex(16)}`, "admin");
    const other = await taiwanUser(`U${hex(16)}`);
    mockTrace();
    const res = await SELF.fetch(`${BASE}/admin/where`, { headers: { Authorization: `Bearer ${bryan.token}` } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("colo=NRT\n");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const theirs = await SELF.fetch(`${BASE}/admin/where`, { headers: { Authorization: `Bearer ${other.token}` } });
    expect(theirs.status).toBe(403);
    expect(await theirs.json()).toEqual({ error: "admin" });
  });
});
