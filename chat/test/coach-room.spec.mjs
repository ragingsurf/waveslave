// Tests for the room's calls from the coach (docs/superpowers/specs/2026-10-22-ai-coach-design.md, "Backend", "New Room
// RPC methods"): whoIs, banAccount and isBanned, which the Worker and Coach call on the room's stub over RPC, not through
// fetch(); and the stub helpers in stubs.js (ruling R1). They run inside the Workers runtime (see vitest.config.mjs). Run
// from chat/:
// npx vitest run --no-isolate --max-workers=1 test/coach-room.spec.mjs
//
// As in me.spec.mjs, each test has a room of its own, with accounts written straight into its tables and session tokens
// signed by the test secret, and calls it as Coach will: await r.stub.whoIs(token). The room's clock stands at T.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { randomB64u, sha256b64u, signToken, subHash } from "../src/auth.js";
import * as stubs from "../src/stubs.js";
import {
  DAY, HOUR, MIN, addMessages, addUser, all, closeClients, hex, join, newRoom, ofType, settle, take, until,
} from "./helpers.mjs";

// 12:00 UTC on a day years ahead, so no alarm a test sets goes off by itself.
const T = Date.UTC(2030, 5, 3, 12, 0);

// A room of its own, with its clock at T until the test moves clock.t.
const freshRoom = (at = T) => newRoom("coach-room", at);

const tokenFor = (r, user, { tv = 0, exp = r.now() + 30 * DAY } = {}) => signToken({ uid: user.id, tv, exp }, env.SESSION_SECRET);

// Sets today's usage counts, as if the room had seen that much since 00:00 UTC (as me.spec.mjs does).
const setUsage = (r, counts) =>
  r.inRoom((room) => {
    const day = new Date(r.now()).toISOString().slice(0, 10);
    room.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('usage', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      JSON.stringify({ day, req: 0, read: 0, write: 0, ...counts, at: r.now() }),
    );
    room.used = null;
  });

// Today's count of room requests, as the resting guard reads it.
const requests = (r) => r.inRoom((room) => room.usage("req", 0).req);

// The rows a ban writes to, to see that nothing changed.
const banTables = (r) =>
  r.inRoom((room) =>
    Object.fromEntries(["subs", "users", "messages"].map((t) => [t, room.sql.exec(`SELECT * FROM ${t} ORDER BY rowid`).toArray()])),
  );

const hiddenList = async (admin) => {
  admin.send({ type: "hidden_list" });
  return take(admin, ofType("hidden"));
};

afterEach(closeClients);

// ---- whoIs ---------------------------------------------------------------------------------------------------------

describe("whoIs", () => {
  it("-> {uid, sub_hash, role} for a token that checks out: role user, or admin for Bryan", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    expect(await r.stub.whoIs(u.token)).toEqual({ uid: u.id, sub_hash: u.sub, role: "user" });
    expect(await r.stub.whoIs(bryan.token)).toEqual({ uid: bryan.id, sub_hash: bryan.sub, role: "admin" });
  });

  it("-> {error: auth} for a deleted account, a token from before signing out everywhere, an expired token and garbage", async () => {
    const r = await freshRoom();
    const gone = await addUser(r);
    await r.inRoom((room) => room.sql.exec("DELETE FROM users WHERE id = ?", gone.id));
    expect(await r.stub.whoIs(gone.token)).toEqual({ error: "auth" });

    const out = await addUser(r);
    await r.inRoom((room) => room.sql.exec("UPDATE users SET tv = 1 WHERE id = ?", out.id));
    expect(await r.stub.whoIs(out.token)).toEqual({ error: "auth" });
    // The token of the new version is good.
    expect(await r.stub.whoIs(await tokenFor(r, out, { tv: 1 }))).toEqual({ uid: out.id, sub_hash: out.sub, role: "user" });

    const u = await addUser(r);
    expect(await r.stub.whoIs(await tokenFor(r, u, { exp: T }))).toEqual({ error: "auth" });
    const forged = await signToken({ uid: u.id, tv: 0, exp: T + DAY }, "not-the-session-secret");
    for (const token of [forged, "garbage", "a.b", "", null, undefined, 42, { uid: u.id }]) {
      expect(await r.stub.whoIs(token), String(token)).toEqual({ error: "auth" });
    }
  });

  it("-> {error: banned} for the current token of a banned LINE account", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    await r.inRoom((room) => room.sql.exec("UPDATE subs SET banned = 1 WHERE sub_hash = ?", u.sub));
    expect(await r.stub.whoIs(u.token)).toEqual({ error: "banned" });
  });

  it("while the chat rests -> {error: resting} for everyone but Bryan, who gets his identity; each call counts", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    expect(await requests(r)).toBe(0);
    expect(await r.stub.whoIs(u.token)).toEqual({ uid: u.id, sub_hash: u.sub, role: "user" });
    expect(await requests(r)).toBe(1);
    expect(await r.stub.whoIs("garbage")).toEqual({ error: "auth" });
    expect(await requests(r)).toBe(2);

    await setUsage(r, { req: 95_000 });
    expect(await r.stub.whoIs(u.token)).toEqual({ error: "resting" });
    expect(await requests(r)).toBe(95_001);
    expect(await r.stub.whoIs(bryan.token)).toEqual({ uid: bryan.id, sub_hash: bryan.sub, role: "admin" });
    expect(await requests(r)).toBe(95_002);
    // The sign-in is checked first (only it can tell Bryan apart), so a token that doesn't check out is still auth.
    expect(await r.stub.whoIs("garbage")).toEqual({ error: "auth" });
    expect(await requests(r)).toBe(95_003);

    // The counts start again at 00:00 UTC, and so does the user.
    r.clock.t = Date.UTC(2030, 5, 4, 0, 0);
    expect(await r.stub.whoIs(u.token)).toEqual({ uid: u.id, sub_hash: u.sub, role: "user" });
  });
});

// ---- banAccount ----------------------------------------------------------------------------------------------------

describe("banAccount", () => {
  it("bans an account with no messages: subs.banned 1, tv 1, its sockets close with 4403, and it is on Bryan's Unban list", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const other = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const one = await join(r, u);
    const two = await join(r, u);
    const reader = await join(r);
    const otherSocket = await join(r, other);
    const admin = await join(r, bryan);
    expect(await r.stub.banAccount(u.sub)).toEqual({ ok: true });
    await until(() => one.closed !== null && two.closed !== null, "their sockets to close");
    expect([one.closed, two.closed]).toEqual([4403, 4403]);
    expect(await r.rows("SELECT banned FROM subs WHERE sub_hash = ?", u.sub)).toEqual([{ banned: 1 }]);
    expect(await r.rows("SELECT tv FROM users WHERE id = ?", u.id)).toEqual([{ tv: 1 }]);
    await settle();
    expect([reader.closed, otherSocket.closed, admin.closed]).toEqual([null, null, null]);
    expect(all(reader, "update")).toEqual([]);
    // The old token is dead, and the new version's says banned.
    expect(await r.stub.whoIs(u.token)).toEqual({ error: "auth" });
    expect(await r.stub.whoIs(await tokenFor(r, u, { tv: 1 }))).toEqual({ error: "banned" });
    // A coach ban shows in the chat's Unban list, like any other.
    const list = await hiddenList(admin);
    expect(list.banned).toEqual([{ sub_hash: u.sub, nick: u.nick }]);
    expect(list.banned_count).toBe(1);
    expect(list.count).toBe(0);
  });

  it("hides the account's messages from the last 24 hours, as the chat's ban does", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const other = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    const [old] = await addMessages(r, u.id, 1, { ts: T - DAY - MIN });
    const [flagged] = await addMessages(r, u.id, 1, { ts: T - 3 * HOUR, hidden_by: "flags" });
    const recent = await addMessages(r, u.id, 2, { ts: T - HOUR, kind: "report", spot: "suao" });
    const [theirs] = await addMessages(r, other.id, 1);
    const reader = await join(r);
    const admin = await join(r, bryan);
    expect(await r.inRoom((room) => room.reportsFor("suao", T).reports)).toHaveLength(2);
    expect(await r.stub.banAccount(u.sub)).toEqual({ ok: true });
    for (const id of recent) {
      expect(await take(reader, ofType("update"))).toEqual({ type: "update", id, hidden: true });
      expect((await take(admin, (f) => f?.type === "msg" && f.msg.id === id)).msg).toMatchObject({ id, nick: u.nick, hidden: "ban" });
    }
    await settle();
    expect(all(reader, "update")).toHaveLength(2);
    expect(await r.rows("SELECT id, hidden_by FROM messages ORDER BY id")).toEqual([
      { id: old, hidden_by: null },
      { id: flagged, hidden_by: "flags" },
      { id: recent[0], hidden_by: "ban" },
      { id: recent[1], hidden_by: "ban" },
      { id: theirs, hidden_by: null },
    ]);
    expect(await r.inRoom((room) => room.reportsFor("suao", T).reports)).toEqual([]);
    expect((await join(r)).history.messages.map((m) => m.id)).toEqual([old, theirs]);
  });

  it("bans a LINE account the room has no account for: a banned subs row, which stops it signing in", async () => {
    const r = await freshRoom();
    const sub = `U${hex(16)}`;
    const account = await subHash(sub, env.SUB_PEPPER);
    expect(await r.stub.banAccount(account)).toEqual({ ok: true });
    expect(await r.rows("SELECT * FROM subs")).toEqual([{ sub_hash: account, banned: 1, deleted_at: null }]);
    expect(await r.rows("SELECT count(*) AS n FROM users")).toEqual([{ n: 0 }]);
    // LINE says it is them: the room refuses the handoff, as for any banned LINE account.
    const res = await r.stub.fetch("https://room/r/handoffs", {
      method: "POST",
      body: JSON.stringify({ h: await sha256b64u(randomB64u(32)), sub, line_name: "Kai" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "banned" });
    expect(await r.rows("SELECT count(*) AS n FROM handoffs")).toEqual([{ n: 0 }]);
  });

  it("refuses Bryan's account with {error: admin}, and changes nothing", async () => {
    const r = await freshRoom();
    const bryan = await addUser(r, { role: "admin" });
    await addMessages(r, bryan.id, 2);
    const admin = await join(r, bryan);
    const before = await banTables(r);
    expect(await r.stub.banAccount(bryan.sub)).toEqual({ error: "admin" });
    await settle();
    expect(await banTables(r)).toEqual(before);
    expect(admin.closed).toBeNull();
    expect(all(admin, "msg")).toEqual([]);
    expect(await r.stub.whoIs(bryan.token)).toEqual({ uid: bryan.id, sub_hash: bryan.sub, role: "admin" });
  });
});

// ---- isBanned ------------------------------------------------------------------------------------------------------

describe("isBanned", () => {
  it("is true after banAccount and false for a stranger, and again after Bryan's unban", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const admin = await join(r, await addUser(r, { role: "admin" }));
    expect(await r.stub.isBanned(u.sub)).toBe(false);
    await r.stub.banAccount(u.sub);
    expect(await r.stub.isBanned(u.sub)).toBe(true);
    expect(await r.stub.isBanned("sub-nobody")).toBe(false);
    expect(await r.rows("SELECT count(*) AS n FROM subs WHERE sub_hash = 'sub-nobody'")).toEqual([{ n: 0 }]);
    admin.send({ type: "unban", sub_hash: u.sub });
    await take(admin, ofType("ok"));
    expect(await r.stub.isBanned(u.sub)).toBe(false);
  });

  it("counts each banAccount and isBanned as a room request, refused or not", async () => {
    const r = await freshRoom();
    const u = await addUser(r);
    const bryan = await addUser(r, { role: "admin" });
    expect(await requests(r)).toBe(0);
    await r.stub.isBanned(u.sub);
    expect(await requests(r)).toBe(1);
    await r.stub.banAccount(u.sub);
    expect(await requests(r)).toBe(2);
    await r.stub.banAccount(bryan.sub);
    expect(await requests(r)).toBe(3);
    await r.stub.isBanned("sub-nobody");
    expect(await requests(r)).toBe(4);
  });
});

// ---- Stubs (ruling R1) ---------------------------------------------------------------------------------------------

describe("stubs", () => {
  // A namespace that records how its stubs are asked for, and gives {stub: name} for each.
  const namespace = () => {
    const asked = [];
    const getByName = (name, options) => {
      asked.push({ name, options });
      return { stub: name };
    };
    return { asked, getByName };
  };

  it("room(env) and coach(env) make their stubs by name, with the apac-ne hint", () => {
    const fake = { ROOM: namespace(), COACH: namespace() };
    expect(stubs.HINT).toEqual({ locationHint: "apac-ne" });
    expect(stubs.COACH_NAME).toBe("taiwan");
    expect(stubs.room(fake)).toEqual({ stub: "taiwan" });
    expect(stubs.coach(fake)).toEqual({ stub: "taiwan" });
    expect(fake.ROOM.asked).toEqual([{ name: "taiwan", options: { locationHint: "apac-ne" } }]);
    expect(fake.COACH.asked).toEqual([{ name: "taiwan", options: { locationHint: "apac-ne" } }]);
  });

  it("the room reaches Coach through coachStub()", async () => {
    const r = await freshRoom();
    const asked = await r.inRoom((room) => {
      const COACH = namespace();
      room.env = { ...room.env, COACH };
      expect(room.coachStub()).toEqual({ stub: "taiwan" });
      return COACH.asked;
    });
    expect(asked).toEqual([{ name: "taiwan", options: { locationHint: "apac-ne" } }]);
  });
});
