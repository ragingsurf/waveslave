// Tests for accounts reaching the coach (docs/superpowers/specs/2026-10-22-ai-coach-design.md, "Backend", "Accounts", and
// "Testing", "Accounts"; rulings R1, R5, R6, P47 and P48): the coach's forget() and exportFor(), which the room calls
// over RPC, and the block kept for a LINE account blocked after a flagged clip, by forget() or by a flag that comes
// back after it, until the block lapses; the room's DELETE /me, which awaits forget() before deleting the account;
// GET /me/export, which adds the coach's part; and the room's 24-month clean-up of accounts, which deletes only those
// the coach confirmed. They run inside the Workers runtime (see vitest.config.mjs). Run from chat/:
// npx vitest run --no-isolate --max-workers=1 test/coach-accounts.spec.mjs
//
// Each test has a coach of its own (newCoach), and a room of its own (newRoom) when it needs one, each with its clock
// years ahead, so no alarm a test sets goes off by itself. The room reaches the coach through coachStub() (ruling R1),
// which a test points at its own coach, or replaces with a fake that throws or records. Reviews are written straight
// into the coach's tables, as the alarm and Bryan leave them. The coach's room stub is replaced, and it has no email
// key, so it sends no email. The AI is a mocked fetch of env.COACH_API_URL that gives the answers a test queued in
// `ai`, in turn; any other fetch, or one more AI call than was queued, throws. After each test, every queued answer was
// used, nothing else was fetched and nothing was logged that the test didn't expect.
import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256b64u } from "../src/auth.js";
import { AGREE_VER } from "../src/coach-guide.js";
import { apiMessage, goodReply, jpegB64 } from "./coach-fixtures.mjs";
import { DAY, HOUR, MIN, addMessages, addUser, hex, insertUser, newCoach, newRoom } from "./helpers.mjs";

// 12:00 UTC (20:00 in Taiwan) on 3 June, years ahead. The room's daily clean-up runs at 19:00 UTC (T19).
const T = Date.UTC(2030, 5, 3, 12, 0);
const T19 = Date.UTC(2030, 5, 3, 19, 0);
const MONTH = "2030-06"; // T's Taiwan month
const LAST_MONTH = "2030-05";
const STALE = 731 * DAY; // an account not seen for this long goes in the room's daily clean-up (24 months is 730 days)

const GOOD_USD = 0.1216; // apiMessage()'s 15,400 tokens in and 3,000 out at wrangler.toml's prices
const FRAME = jpegB64();
const TWELVE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const listed = () => TWELVE.map((n) => ({ n, ms: 11_000 + 250 * (n - 1), box: [200, 120, 360] }));
const TIMES = Object.fromEntries(listed().map((f) => [f.n, f.ms]));

// ---- The AI, mocked -------------------------------------------------------------------------------------------------

let ai; // the answers the AI gives, in turn: functions returning a Response
let unexpected; // any other fetch, or an AI call with no answer queued
let logged; // what console.error was given
beforeEach(() => {
  ai = [];
  unexpected = [];
  logged = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== env.COACH_API_URL || ai.length === 0) {
      unexpected.push(request.url);
      throw new Error(`unexpected fetch of ${request.url}`);
    }
    return ai.shift()();
  });
  vi.spyOn(console, "error").mockImplementation((...args) => {
    logged.push(args);
  });
});

afterEach(() => {
  expect(unexpected).toEqual([]);
  expect(ai).toEqual([]);
  expect(logged).toEqual([]);
  vi.restoreAllMocks();
});

// ---- Coaches, rooms, accounts and reviews ---------------------------------------------------------------------------

// A coach of its own with its clock at `at`, no email key, and a room stub that bans no one.
async function freshCoach(at = T) {
  const c = await newCoach("accounts", at);
  await c.inCoach((coach) => {
    coach.env = { ...coach.env, RESEND_API_KEY: "" };
    coach.roomStub = () => ({ isBanned: async () => false });
  });
  return c;
}

// A room of its own with its clock at `at`, whose coachStub() reaches the coach `c` (ruling R1): its stub is made
// inside the room, as stubs.js makes the real one, so the room's calls to it are real RPC.
async function roomFor(c, at = T) {
  const r = await newRoom("accounts", at);
  const id = c.stub.id.toString();
  await r.inRoom((room) => {
    room.coachStub = () => room.env.COACH.get(room.env.COACH.idFromString(id));
  });
  return r;
}

// Replaces the room's coachStub() with `fake`, made inside the room by make(room).
const fakeCoach = (r, make) =>
  r.inRoom((room) => {
    room.coachStub = () => make(room);
  });

const surfer = () => ({ uid: `u-${hex(6)}`, sub_hash: `sub-${hex(8)}`, role: "user" });
// The coach's view of a room account (addUser): its uid and its LINE account's sub_hash.
const whoOf = (user) => ({ uid: user.id, sub_hash: user.sub, role: "user" });

const ANSWERS = Object.freeze({
  move: "top_turn", move_other: "", level: "starting_turns", board: "shortboard", stance: "regular", note: "I fall off at the top",
});

// A review written straight into the table, sent at the coach's clock and queued then unless `status` says otherwise,
// with its 12 key frames up (counted in frame_bytes) unless `frames` is false, for an account that agreed. Any column
// can be set in `cols`. Its count goes in the quota table only through quotaRow().
async function insertReview(c, who, opts = {}) {
  const { id = hex(11), status = "queued", frames = true, ...cols } = opts;
  const t = c.clock.t;
  const row = {
    id, uid: who.uid, sub_hash: who.sub_hash, lang: "en", move: "top_turn", answers: JSON.stringify(ANSWERS), status,
    created: t - 10 * MIN, sent: t, next_try: status === "queued" ? t : null, quota_month: MONTH, ...cols,
  };
  const names = Object.keys(row);
  await c.rows(`INSERT INTO reviews (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, ...Object.values(row));
  await c.rows(
    "INSERT INTO people (sub_hash, level, board, stance, agreed_ver, agreed_at) VALUES (?, 'starting_turns', 'shortboard', 'regular', ?, ?) ON CONFLICT (sub_hash) DO NOTHING",
    who.sub_hash, AGREE_VER, t - DAY,
  );
  if (frames) {
    for (const f of listed()) {
      await c.rows("INSERT INTO frames (review_id, n, ms, box, b64) VALUES (?, ?, ?, ?, ?)", id, f.n, f.ms, JSON.stringify(f.box), FRAME);
    }
    await c.inCoach((coach) => coach.setMeta("frame_bytes", (coach.getMeta("frame_bytes") ?? 0) + 12 * FRAME.length));
  }
  return id;
}

// A LINE account's count for a Taiwan month, written straight into the quota table.
const quotaRow = (c, who, month, used, sent = used) =>
  c.rows("INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, ?, ?)", who.sub_hash, month, used, sent);

// One of Bryan's examples, from the review `review_id`.
const insertExample = (c, review_id, note) =>
  c.rows(
    "INSERT INTO examples (move, level, draft, bryan, note, review_id, at) VALUES ('top_turn', 'starting_turns', ?, NULL, ?, ?, ?)",
    JSON.stringify(goodReply()), note, review_id, c.clock.t - HOUR,
  );

const getMeta = (c, key) => c.inCoach((coach) => coach.getMeta(key));
const coachRequests = (c) => c.inCoach((coach) => coach.usage("req", 0).req);
const route = (c, who, method, path, body = "") =>
  c.stub.route({ method, path, who, body: typeof body === "string" ? body : JSON.stringify(body) });
// The surfer starts a review, and agrees to the coach's terms; and how a blocked account's start is refused.
const start = (c, who) => route(c, who, "POST", "/coach/reviews", { lang: "en", ...ANSWERS, frames: listed() });
const agree = (c, who) => route(c, who, "POST", "/coach/agree", { ver: AGREE_VER, adult: true });
const BLOCKED = Object.freeze({ status: 403, json: { error: "blocked" } });

// The bytes of key frames the table holds: meta frame_bytes must say the same.
async function expectBytesRight(c) {
  const [{ bytes }] = await c.rows("SELECT coalesce(sum(length(b64)), 0) AS bytes FROM frames");
  expect(await getMeta(c, "frame_bytes")).toBe(bytes);
}

// Calls one of the room's /me routes as `user` (as addUser() gives it): {status, data}.
async function me(r, user, method, path = "") {
  const res = await r.stub.fetch(`https://room/r/me${path}`, { method, headers: { Authorization: `Bearer ${user.token}` } });
  return { status: res.status, data: await res.json() };
}

// The room's tables but its usage counts (which every request moves), each row as JSON, to see that nothing changed.
const roomTables = (r) =>
  r.inRoom((room) => {
    const tables = room.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'").toArray();
    return Object.fromEntries(
      tables.map(({ name }) => [
        name,
        room.sql.exec(`SELECT * FROM "${name}"`).toArray().filter((row) => row.key !== "usage").map((row) => JSON.stringify(row)).sort(),
      ]),
    );
  });

// A session log of the user's, written straight into the room.
const addLog = (r, uid) =>
  r.rows(
    "INSERT INTO sessions (uid, spot, start, end, stars, board, note, cond) VALUES (?, 'jinshan', ?, ?, 4, 'short', 'Kept nosediving', NULL)",
    uid, r.now() - 3 * HOUR, r.now() - HOUR,
  );

const userIds = async (r) => (await r.rows("SELECT id FROM users ORDER BY id")).map((u) => u.id);

// ---- forget ---------------------------------------------------------------------------------------------------------

describe("Coach.forget(uid, sub_hash)", () => {
  it("deletes the account's reviews, key frames, examples and saved answers, and keeps this Taiwan month's quota row", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    // a's reviews: one published last month, its key frames cleared by the clean-up (their rows stay, ruling P16); one
    // waiting for Bryan; one still uploading; and one of an earlier account of the same LINE account.
    const old = await insertReview(c, a, {
      status: "published", sent: T - 40 * DAY, published: T - 40 * DAY, final: JSON.stringify(goodReply()), quota_month: LAST_MONTH,
    });
    await c.inCoach((coach) => coach.clearFrames(old));
    const waiting = await insertReview(c, a, { status: "drafted", draft: JSON.stringify(goodReply()) });
    const unsent = await insertReview(c, a, { status: "uploading", sent: null, quota_month: null });
    const before = await insertReview(c, { ...a, uid: `u-${hex(6)}` }, { status: "published", frames: false });
    await insertExample(c, old, "Approved with an edit");
    await insertExample(c, waiting, "Look at the back foot");
    await quotaRow(c, a, LAST_MONTH, 1);
    await quotaRow(c, a, MONTH, 2);
    // b's, which stay.
    const theirs = await insertReview(c, b, { status: "drafted", draft: JSON.stringify(goodReply()) });
    await insertExample(c, theirs, "Someone else's example");
    await quotaRow(c, b, MONTH, 1);
    expect((await route(c, a, "GET", "/coach/me")).json).toMatchObject({ left: 0, agreed: true });
    const asked = await coachRequests(c);

    expect(await c.stub.forget(a.uid, a.sub_hash)).toEqual({ ok: true });

    expect(await coachRequests(c)).toBe(asked + 1);
    expect(await c.rows("SELECT id FROM reviews")).toEqual([{ id: theirs }]);
    for (const id of [old, waiting, unsent, before]) {
      expect(await c.rows("SELECT count(*) AS n FROM frames WHERE review_id = ?", id), id).toEqual([{ n: 0 }]);
    }
    expect(await c.rows("SELECT count(*) AS n FROM frames WHERE review_id = ?", theirs)).toEqual([{ n: 12 }]);
    await expectBytesRight(c);
    expect(await c.rows("SELECT note FROM examples")).toEqual([{ note: "Someone else's example" }]);
    expect(await c.rows("SELECT sub_hash FROM people")).toEqual([{ sub_hash: b.sub_hash }]);
    // This month's count stays, so the LINE account has as many left as before, however it comes back; last month's
    // row goes, as the daily clean-up's would.
    expect(await c.rows("SELECT sub_hash, month, used, sent FROM quota ORDER BY sub_hash = ?", b.sub_hash)).toEqual([
      { sub_hash: a.sub_hash, month: MONTH, used: 2, sent: 2 },
      { sub_hash: b.sub_hash, month: MONTH, used: 1, sent: 1 },
    ]);
    // Nothing of a is left in the coach's own tables but that count.
    const json = JSON.stringify(await c.rows("SELECT * FROM reviews")) + JSON.stringify(await c.rows("SELECT * FROM people"));
    expect(json).not.toContain(a.uid);
    expect(json).not.toContain(a.sub_hash);
  });

  it("a LINE account deleted and made again in the month has 0 reviews left: it agrees afresh and can't start one", async () => {
    const c = await freshCoach();
    const a = surfer();
    await insertReview(c, a, { status: "published", final: JSON.stringify(goodReply()), frames: false });
    await quotaRow(c, a, MONTH, 2);
    expect(await c.stub.forget(a.uid, a.sub_hash)).toEqual({ ok: true });

    const again = { ...a, uid: `u-${hex(6)}` };
    expect((await route(c, again, "GET", "/coach/me")).json).toMatchObject({ left: 0, agreed: false, profile: null, reviews: [] });
    expect(await route(c, again, "POST", "/coach/agree", { ver: AGREE_VER, adult: true })).toEqual({ status: 200, json: { ok: true } });
    const start = await route(c, again, "POST", "/coach/reviews", { lang: "en", ...ANSWERS, frames: listed() });
    expect(start).toEqual({ status: 429, json: { error: "no_reviews_left" } });
  });

  it("during the review's AI call: the review goes at once, the answer is dropped but its flag (ruling P48), and the call still costs the month", async () => {
    const c = await freshCoach();
    const a = surfer();
    await insertReview(c, a);
    await quotaRow(c, a, MONTH, 1);
    await c.inCoach(async (coach) => {
      ai.push(async () => {
        // forget arrives while the call is out. Its answer flags the clip.
        expect(await coach.forget(a.uid, a.sub_hash)).toEqual({ ok: true });
        expect(coach.sql.exec("SELECT count(*) AS n FROM reviews").one().n).toBe(0);
        return Response.json(apiMessage({ ...goodReply(), sexual_content: true }));
      });
      await coach.alarm();
    });
    // Nothing came back but the flag: no review, no key frames, no people row, and nothing for Bryan's email. The flag
    // blocks the LINE account as forget() would have, had it come first: the block is kept, from when it came back.
    expect(await c.rows("SELECT id FROM reviews")).toEqual([]);
    expect(await c.rows("SELECT review_id FROM frames")).toEqual([]);
    expect(await c.rows("SELECT sub_hash FROM people")).toEqual([]);
    expect(await c.rows("SELECT * FROM kept_blocks")).toEqual([{ sub_hash: a.sub_hash, kept_at: T }]);
    expect(await getMeta(c, "digest_due")).toBeNull();
    await expectBytesRight(c);
    // The call was paid as it came back: forget left its mark in calls_out, so nothing goes unpaid.
    const spend = await getMeta(c, "spend");
    expect(spend.usd).toBeCloseTo(GOOD_USD, 8);
    expect(spend.reviews).toBe(1);
    expect(await getMeta(c, "calls_out")).toEqual({});
    expect(await c.rows("SELECT month, used, sent FROM quota")).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
  });
});

// ---- A block kept for a LINE account (rulings P47 and P48) ----------------------------------------------------------

describe("DELETE /coach/reviews/{id} (ruling P67)", () => {
  it("deletes the examples made from the review with it, so forget() afterwards finds nothing of it left", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    const published = { status: "published", published: T - HOUR, final: JSON.stringify(goodReply()) };
    const id = await insertReview(c, a, published);
    const other = await insertReview(c, a, { ...published, frames: false });
    await insertExample(c, id, "Approved with an edit");
    await insertExample(c, id, "Look at the back foot");
    await insertExample(c, other, "Another of theirs");
    const theirs = await insertReview(c, b, { status: "drafted", draft: JSON.stringify(goodReply()) });
    await insertExample(c, theirs, "Someone else's example");

    expect(await route(c, a, "DELETE", `/coach/reviews/${id}`)).toEqual({ status: 200, json: { ok: true } });

    expect(await c.rows("SELECT * FROM examples WHERE review_id = ?", id)).toEqual([]);
    expect(await c.rows("SELECT note FROM examples ORDER BY id")).toEqual([
      { note: "Another of theirs" }, { note: "Someone else's example" },
    ]);
    expect(await c.rows("SELECT count(*) AS n FROM frames WHERE review_id = ?", id)).toEqual([{ n: 0 }]);
    await expectBytesRight(c);
    expect(await c.stub.forget(a.uid, a.sub_hash)).toEqual({ ok: true });
    expect(await c.rows("SELECT note FROM examples")).toEqual([{ note: "Someone else's example" }]);
    expect(await c.rows("SELECT id FROM reviews")).toEqual([{ id: theirs }]);
  });
});

describe("a block kept for a LINE account (rulings P47 and P48)", () => {
  // A clip flagged an hour ago and held for Bryan, as the alarm leaves it: rejected, hold 1, its flags, no key frames,
  // its count kept, and the account blocked.
  async function flaggedAccount(c) {
    const a = surfer();
    await insertReview(c, a, {
      status: "rejected", hold: 1, flags: JSON.stringify(["under_18"]), handled_at: c.clock.t - HOUR, frames: false,
    });
    await quotaRow(c, a, MONTH, 1);
    await c.rows("UPDATE people SET blocked = 1 WHERE sub_hash = ?", a.sub_hash);
    return a;
  }

  it("a held flagged review the surfer deletes: the block is kept as forget() keeps it, and lapses after 90 days", async () => {
    const c = await freshCoach();
    const a = await flaggedAccount(c);
    const blocked = async () => (await route(c, a, "GET", "/coach/me")).json.blocked;
    const [{ id }] = await c.rows("SELECT id FROM reviews WHERE sub_hash = ?", a.sub_hash);
    expect(await route(c, a, "DELETE", `/coach/reviews/${id}`)).toEqual({ status: 200, json: { ok: true } });
    expect(await c.rows("SELECT id FROM reviews")).toEqual([]);
    expect(await c.rows("SELECT blocked FROM people WHERE sub_hash = ?", a.sub_hash)).toEqual([{ blocked: 0 }]);
    expect(await c.rows("SELECT * FROM kept_blocks")).toEqual([{ sub_hash: a.sub_hash, kept_at: T }]);
    expect(await start(c, a)).toEqual(BLOCKED);
    expect(await blocked()).toBe(true);
    // Deleting a review of an account that isn't blocked keeps no block.
    const b = surfer();
    const published = await insertReview(c, b, { status: "published", final: JSON.stringify(goodReply()), frames: false });
    expect(await route(c, b, "DELETE", `/coach/reviews/${published}`)).toEqual({ status: 200, json: { ok: true } });
    expect(await c.rows("SELECT sub_hash FROM kept_blocks")).toEqual([{ sub_hash: a.sub_hash }]);
    // 90 days on, the block has lapsed.
    c.clock.t = T + 90 * DAY;
    expect(await blocked()).toBe(false);
    expect(await start(c, a)).toMatchObject({ status: 200 });
  });

  it("GET /coach/me says blocked while the account is blocked, or a block kept for its LINE account holds", async () => {
    const c = await freshCoach();
    const blockedOf = async (who) => (await route(c, who, "GET", "/coach/me")).json.blocked;
    const fresh = surfer();
    await agree(c, fresh);
    expect(await blockedOf(fresh)).toBe(false);
    expect(await blockedOf(surfer())).toBe(false);
    expect(await blockedOf(await flaggedAccount(c))).toBe(true);
    const [d89, d90] = [surfer(), surfer()];
    for (const [who, days] of [[d89, 89], [d90, 90]]) {
      await c.rows("INSERT INTO kept_blocks (sub_hash, kept_at) VALUES (?, ?)", who.sub_hash, T - days * DAY);
    }
    expect(await blockedOf(d89)).toBe(true);
    expect(await blockedOf(d90)).toBe(false);
  });

  it("a flagged account forgotten: only the block and when it was kept stay, and its remade account is still refused", async () => {
    const c = await freshCoach();
    const a = await flaggedAccount(c);
    expect(await start(c, a)).toEqual(BLOCKED);

    expect(await c.stub.forget(a.uid, a.sub_hash)).toEqual({ ok: true });

    // The flagged review and the people row go; the block stays, with nothing else of the account.
    expect(await c.rows("SELECT id FROM reviews")).toEqual([]);
    expect(await c.rows("SELECT * FROM people")).toEqual([]);
    expect(await c.rows("SELECT * FROM kept_blocks")).toEqual([{ sub_hash: a.sub_hash, kept_at: T }]);
    // The remade account agrees afresh and is refused as the blocked one was, with the month's kept count.
    const again = { ...a, uid: `u-${hex(6)}` };
    expect((await route(c, again, "GET", "/coach/me")).json).toMatchObject({ left: 1, agreed: false, reviews: [] });
    expect(await agree(c, again)).toEqual({ status: 200, json: { ok: true } });
    expect(await start(c, again)).toEqual(BLOCKED);
    expect(await c.rows("SELECT month, used, sent FROM quota")).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
    // Deleting the remade account too keeps the block as it was: it lapses when it would have.
    c.clock.t = T + 10 * DAY;
    expect(await c.stub.forget(again.uid, again.sub_hash)).toEqual({ ok: true });
    expect(await c.rows("SELECT * FROM kept_blocks")).toEqual([{ sub_hash: a.sub_hash, kept_at: T }]);
    expect(await c.rows("SELECT * FROM people")).toEqual([]);
  });

  it("a flag that comes back after forget(), the account remade and agreed meanwhile: the block is kept, not set on the remade account's row (ruling P48)", async () => {
    const c = await freshCoach();
    const a = surfer();
    await insertReview(c, a);
    await quotaRow(c, a, MONTH, 1);
    const again = { ...a, uid: `u-${hex(6)}` };
    await c.inCoach(async (coach) => {
      ai.push(async () => {
        // While the call is out, the account is deleted and made again, and the remade account agrees.
        expect(await coach.forget(a.uid, a.sub_hash)).toEqual({ ok: true });
        const body = JSON.stringify({ ver: AGREE_VER, adult: true });
        expect(await coach.route({ method: "POST", path: "/coach/agree", who: again, body })).toEqual({ status: 200, json: { ok: true } });
        return Response.json(apiMessage({ ...goodReply(), surfer_looks_under_18: true }));
      });
      await coach.alarm();
    });
    // The remade account's people row is its own, and isn't blocked: the block is kept for the LINE account, and
    // lapses 90 days after the flag came back. The remade account is refused all the same.
    expect(await c.rows("SELECT sub_hash, agreed_ver, blocked FROM people")).toEqual([{ sub_hash: a.sub_hash, agreed_ver: AGREE_VER, blocked: 0 }]);
    expect(await c.rows("SELECT * FROM kept_blocks")).toEqual([{ sub_hash: a.sub_hash, kept_at: T }]);
    expect(await start(c, again)).toEqual(BLOCKED);
    expect(await c.rows("SELECT id FROM reviews")).toEqual([]);
    expect(await getMeta(c, "digest_due")).toBeNull();
  });

  it("a flag that comes back after forget() while a lapsed block is kept still (the clean-up hasn't run): kept from now", async () => {
    const c = await freshCoach();
    const a = surfer();
    await c.rows("INSERT INTO kept_blocks (sub_hash, kept_at) VALUES (?, ?)", a.sub_hash, T - 91 * DAY);
    await insertReview(c, a);
    await c.inCoach(async (coach) => {
      ai.push(async () => {
        expect(await coach.forget(a.uid, a.sub_hash)).toEqual({ ok: true });
        return Response.json(apiMessage(null, { stop_reason: "refusal" }));
      });
      await coach.alarm();
    });
    expect(await c.rows("SELECT * FROM kept_blocks")).toEqual([{ sub_hash: a.sub_hash, kept_at: T }]);
    const again = { ...a, uid: `u-${hex(6)}` };
    await agree(c, again);
    expect(await start(c, again)).toEqual(BLOCKED);
  });

  it("a flag that comes back after forget() while a block kept still holds: the block stays as it was", async () => {
    const c = await freshCoach();
    const a = surfer();
    await insertReview(c, a);
    // Blocked while this review is out, as a flag on a review redone during its call leaves it (ruling P28).
    await c.rows("UPDATE people SET blocked = 1 WHERE sub_hash = ?", a.sub_hash);
    await c.inCoach(async (coach) => {
      ai.push(async () => {
        expect(await coach.forget(a.uid, a.sub_hash)).toEqual({ ok: true });
        c.clock.t = T + HOUR;
        return Response.json(apiMessage({ ...goodReply(), sexual_content: true }));
      });
      await coach.alarm();
    });
    expect(await c.rows("SELECT * FROM kept_blocks")).toEqual([{ sub_hash: a.sub_hash, kept_at: T }]);
  });

  it("an account that isn't blocked: its people row goes entirely, no block is kept, and a remade account may start", async () => {
    const c = await freshCoach();
    const a = surfer();
    await insertReview(c, a, { status: "published", final: JSON.stringify(goodReply()), frames: false });
    await quotaRow(c, a, MONTH, 1);
    expect(await c.rows("SELECT level, board, stance, agreed_ver, blocked FROM people")).toEqual([
      { level: "starting_turns", board: "shortboard", stance: "regular", agreed_ver: AGREE_VER, blocked: 0 },
    ]);

    expect(await c.stub.forget(a.uid, a.sub_hash)).toEqual({ ok: true });

    expect(await c.rows("SELECT * FROM people")).toEqual([]);
    expect(await c.rows("SELECT * FROM kept_blocks")).toEqual([]);
    const again = { ...a, uid: `u-${hex(6)}` };
    await agree(c, again);
    expect(await start(c, again)).toMatchObject({ status: 200 });
  });

  it("a LINE account blocked again after its kept block lapsed, and forgotten again: the block is kept from now", async () => {
    const c = await freshCoach();
    const a = await flaggedAccount(c);
    // Its block kept 91 days ago has lapsed (the clean-up hasn't run yet), and the account was flagged again since.
    await c.rows("INSERT INTO kept_blocks (sub_hash, kept_at) VALUES (?, ?)", a.sub_hash, T - 91 * DAY);
    expect(await c.stub.forget(a.uid, a.sub_hash)).toEqual({ ok: true });
    expect(await c.rows("SELECT * FROM kept_blocks")).toEqual([{ sub_hash: a.sub_hash, kept_at: T }]);
  });

  it("lapses 90 days after it was kept: the daily clean-up deletes it at 90 and 91 days, not 89, and the start goes", async () => {
    // 04:00 Taiwan on 2 September, a daily clean-up's time, months after T.
    const CLEAN = Date.UTC(2030, 8, 1, 20);
    const c = await freshCoach(CLEAN);
    const [d89, d90, d91] = [surfer(), surfer(), surfer()];
    for (const [who, days] of [[d89, 89], [d90, 90], [d91, 91]]) {
      await c.rows("INSERT INTO kept_blocks (sub_hash, kept_at) VALUES (?, ?)", who.sub_hash, CLEAN - days * DAY);
      await agree(c, who);
    }
    // Lapsed by itself at 90 days, even before the clean-up has deleted it.
    expect(await start(c, d89)).toEqual(BLOCKED);
    expect(await start(c, d90)).toMatchObject({ status: 200 });

    await c.inCoach((coach) => {
      coach.setMeta("next_cleanup", CLEAN);
      return coach.ctx.storage.setAlarm(CLEAN);
    });
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);

    expect(await c.rows("SELECT sub_hash FROM kept_blocks")).toEqual([{ sub_hash: d89.sub_hash }]);
    expect(await start(c, d89)).toEqual(BLOCKED);
    expect(await start(c, d91)).toMatchObject({ status: 200 });
    // A day later it is 90 days old, and goes too.
    c.clock.t = CLEAN + DAY;
    await c.inCoach((coach) => coach.ctx.storage.setAlarm(CLEAN + DAY));
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);
    expect(await c.rows("SELECT sub_hash FROM kept_blocks")).toEqual([]);
  });
});

// ---- exportFor ------------------------------------------------------------------------------------------------------

describe("Coach.exportFor(uid)", () => {
  it("lists the account's reviews, oldest first, with their published text and key-frame times, and never a frame", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    const DRAFT = { ...goodReply(), progress: "A draft only Bryan sees" };
    const published = await insertReview(c, a, {
      status: "published", created: T - 41 * DAY, sent: T - 40 * DAY, published: T - 39 * DAY, handled_at: T - 39 * DAY,
      draft: JSON.stringify(DRAFT), final: JSON.stringify(goodReply()), checked: 1, model: "coach-test-model", cost: 0.12,
      quota_month: LAST_MONTH,
    });
    // Its key frames were cleared 30 days after (ruling P16): their times are still read from the rows.
    await c.inCoach((coach) => coach.clearFrames(published));
    const rejected = await insertReview(c, a, {
      status: "rejected", created: T - 3 * DAY, sent: T - 3 * DAY, handled_at: T - 2 * DAY, surfer_note: "Too far out to see you",
      draft: JSON.stringify(DRAFT), redo_note: JSON.stringify(["A note for the coach"]), answers: JSON.stringify({ ...ANSWERS, move: "other", move_other: "Floater" }),
      move: "other",
    });
    const waiting = await insertReview(c, a, { status: "drafted", created: T - 2 * HOUR, sent: T - HOUR, draft: JSON.stringify(DRAFT) });
    const unsent = await insertReview(c, a, { status: "uploading", created: T - MIN, sent: null, quota_month: null });
    await c.rows("UPDATE frames SET b64 = NULL WHERE review_id = ? AND n > 4", unsent);
    await insertReview(c, b, { status: "published", final: JSON.stringify({ ...goodReply(), progress: "Someone else's" }) });
    const asked = await coachRequests(c);

    const out = await c.stub.exportFor(a.uid);

    expect(await coachRequests(c)).toBe(asked + 1);
    const base = { lang: "en", move: "top_turn", answers: ANSWERS, note: null, text: null, times: TIMES, report: null, published: null };
    expect(out).toEqual([
      { ...base, id: published, created: T - 41 * DAY, sent: T - 40 * DAY, published: T - 39 * DAY, status: "ready", text: goodReply() },
      {
        ...base, id: rejected, move: "other", answers: { ...ANSWERS, move: "other", move_other: "Floater" }, created: T - 3 * DAY,
        sent: T - 3 * DAY, status: "not_reviewed", note: "Too far out to see you",
      },
      { ...base, id: waiting, created: T - 2 * HOUR, sent: T - HOUR, status: "reviewing" },
      { ...base, id: unsent, created: T - MIN, sent: null, status: "uploading" },
    ]);
    const json = JSON.stringify(out);
    for (const notHere of [FRAME.slice(0, 40), "A draft only Bryan sees", "A note for the coach", "coach-test-model", a.uid, a.sub_hash, "Someone else's"]) {
      expect(json).not.toContain(notHere);
    }
    expect(await c.stub.exportFor(`u-${hex(6)}`)).toEqual([]);
  });
});

// ---- DELETE /me -----------------------------------------------------------------------------------------------------

describe("DELETE /me reaches the coach", () => {
  it("has the coach forget the account first, then deletes it; the coach keeps only this month's quota row", async () => {
    const c = await freshCoach();
    const r = await roomFor(c);
    const u = await addUser(r);
    const v = await addUser(r);
    const id = await insertReview(c, whoOf(u), { status: "published", final: JSON.stringify(goodReply()) });
    await quotaRow(c, whoOf(u), MONTH, 1);
    const theirs = await insertReview(c, whoOf(v), { status: "drafted" });

    expect(await me(r, u, "DELETE")).toEqual({ status: 200, data: { ok: true } });

    expect(await userIds(r)).toEqual([v.id]);
    expect(await c.rows("SELECT id FROM reviews")).toEqual([{ id: theirs }]);
    expect(await c.rows("SELECT count(*) AS n FROM frames WHERE review_id = ?", id)).toEqual([{ n: 0 }]);
    expect(await c.rows("SELECT sub_hash FROM people")).toEqual([{ sub_hash: v.sub }]);
    expect(await c.rows("SELECT sub_hash, month, used FROM quota")).toEqual([{ sub_hash: u.sub, month: MONTH, used: 1 }]);
  });

  it("a blocked account deleted: the coach keeps its block (ruling P47), and the LINE account signed up again is refused", async () => {
    const c = await freshCoach();
    const r = await roomFor(c);
    const u = await addUser(r);
    await insertReview(c, whoOf(u), {
      status: "rejected", hold: 1, flags: JSON.stringify(["sexual"]), handled_at: T - HOUR, frames: false,
    });
    await quotaRow(c, whoOf(u), MONTH, 1);
    await c.rows("UPDATE people SET blocked = 1 WHERE sub_hash = ?", u.sub);

    expect(await me(r, u, "DELETE")).toEqual({ status: 200, data: { ok: true } });

    expect(await userIds(r)).toEqual([]);
    expect(await c.rows("SELECT id FROM reviews")).toEqual([]);
    expect(await c.rows("SELECT * FROM people")).toEqual([]);
    expect(await c.rows("SELECT * FROM kept_blocks")).toEqual([{ sub_hash: u.sub, kept_at: T }]);
    const again = { uid: crypto.randomUUID(), sub_hash: u.sub, role: "user" };
    expect(await agree(c, again)).toEqual({ status: 200, json: { ok: true } });
    expect(await start(c, again)).toEqual(BLOCKED);
  });

  it("when the coach's forget throws or doesn't confirm: 503 {error: coach}, and nothing is deleted", async () => {
    const c = await freshCoach();
    const r = await roomFor(c);
    const u = await addUser(r, { posts: 1 });
    await addLog(r, u.id);
    // A first request, which sets the room's alarm and its next retention time, so the ones below change nothing.
    expect(await me(r, u, "GET", "/sessions")).toMatchObject({ status: 200 });
    for (const [forget, name] of [
      [async () => {
        throw new Error("the coach is down, token abc");
      }, "Error"],
      [async () => ({ ok: false }), null],
    ]) {
      await fakeCoach(r, () => ({ forget }));
      const before = await roomTables(r);
      expect(await me(r, u, "DELETE")).toEqual({ status: 503, data: { error: "coach" } });
      expect(await roomTables(r)).toEqual(before);
      expect(logged.splice(0)).toEqual(name ? [["chat: the coach's forget failed:", name]] : []);
    }
    // The account still works.
    expect(await me(r, u, "GET", "/sessions")).toMatchObject({ status: 200 });
    expect(await userIds(r)).toEqual([u.id]);
  });

  it("reads the account again after the coach: one signed out everywhere meanwhile gets 401, and is not deleted", async () => {
    const c = await freshCoach();
    const r = await roomFor(c);
    const u = await addUser(r);
    let forgot = 0;
    await fakeCoach(r, (room) => ({
      async forget(uid, sub_hash) {
        expect([uid, sub_hash]).toEqual([u.id, u.sub]);
        forgot++;
        // Another tab signs out everywhere while the coach is asked.
        room.sql.exec("UPDATE users SET tv = tv + 1 WHERE id = ?", u.id);
        return { ok: true };
      },
    }));
    expect(await me(r, u, "DELETE")).toEqual({ status: 401, data: { error: "auth" } });
    expect(forgot).toBe(1);
    expect(await userIds(r)).toEqual([u.id]);
  });
});

// ---- GET /me/export -------------------------------------------------------------------------------------------------

describe("GET /me/export reaches the coach", () => {
  it("adds coach: the coach's export of the account (exportFor)", async () => {
    const c = await freshCoach();
    const r = await roomFor(c);
    const u = await addUser(r);
    const v = await addUser(r);
    const id = await insertReview(c, whoOf(u), {
      status: "published", created: T - 2 * DAY, sent: T - 2 * DAY, published: T - DAY, final: JSON.stringify(goodReply()),
    });
    await insertReview(c, whoOf(v), { status: "drafted" });
    const res = await me(r, u, "GET", "/export");
    expect(res.status).toBe(200);
    expect(res.data.coach).toEqual([
      {
        id, lang: "en", move: "top_turn", answers: ANSWERS, created: T - 2 * DAY, sent: T - 2 * DAY, published: T - DAY,
        status: "ready", note: null, text: goodReply(), times: TIMES, report: null,
      },
    ]);
    expect(Object.keys(res.data)).toEqual(["nick", "created", "messages", "reports", "sessions", "coach"]);
  });

  it("answers 503 {error: coach} when the coach's exportFor throws (ruling R5), logging only the error's name", async () => {
    const c = await freshCoach();
    const r = await roomFor(c);
    const u = await addUser(r);
    await fakeCoach(r, () => ({
      exportFor: async () => {
        throw new TypeError("the coach is down, token abc");
      },
    }));
    expect(await me(r, u, "GET", "/export")).toEqual({ status: 503, data: { error: "coach" } });
    expect(logged.splice(0)).toEqual([["chat: the coach's export failed:", "TypeError"]]);
  });
});

// ---- The 24-month clean-up ------------------------------------------------------------------------------------------

describe("the room's 24-month clean-up reaches the coach (ruling R6)", () => {
  // The room's retention at 19:00 UTC, as its alarm runs it.
  const retention = (r) => r.inRoom((room) => room.retention(T19));

  it("has the coach forget each stale account first, and deletes only those it confirmed; the rest wait a day", async () => {
    const c = await freshCoach(T19);
    const r = await roomFor(c, T19);
    const gone = await addUser(r, { age: STALE });
    const kept = await addUser(r, { age: STALE });
    const fresh = await addUser(r, { age: 700 * DAY });
    for (const user of [gone, kept]) {
      await addLog(r, user.id);
      await insertReview(c, whoOf(user), { status: "published", final: JSON.stringify(goodReply()) });
    }
    const asked = [];
    let down = new Set([kept.id]);
    const coachId = c.stub.id.toString();
    await fakeCoach(r, (room) => {
      const real = room.env.COACH.get(room.env.COACH.idFromString(coachId));
      return {
        async forget(uid, sub_hash) {
          asked.push([uid, sub_hash]);
          if (down.has(uid)) throw new Error("the coach is down");
          return real.forget(uid, sub_hash);
        },
      };
    });

    await retention(r);

    expect(asked).toEqual([[gone.id, gone.sub], [kept.id, kept.sub]].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
    expect(logged.splice(0)).toEqual([["chat: the coach's forget failed:", "Error"]]);
    expect(await userIds(r)).toEqual([kept.id, fresh.id].sort());
    expect(await r.rows("SELECT uid FROM sessions")).toEqual([{ uid: kept.id }]);
    expect(await r.rows("SELECT sub_hash, deleted_at FROM subs WHERE deleted_at IS NOT NULL")).toEqual([{ sub_hash: gone.sub, deleted_at: T19 }]);
    expect(await c.rows("SELECT uid FROM reviews")).toEqual([{ uid: kept.id }]);

    // The next day the coach answers, and the account goes.
    down = new Set();
    asked.length = 0;
    await retention(r);
    expect(asked).toEqual([[kept.id, kept.sub]]);
    expect(await userIds(r)).toEqual([fresh.id]);
    expect(await c.rows("SELECT uid FROM reviews")).toEqual([]);
  });

  it("reads each account again after the coach: one that signed in meanwhile is kept", async () => {
    const r = await newRoom("accounts", T19);
    const user = await addUser(r, { age: STALE });
    await fakeCoach(r, (room) => ({
      async forget(uid) {
        room.sql.exec("UPDATE users SET last_seen = ? WHERE id = ?", T19, uid);
        return { ok: true };
      },
    }));
    await retention(r);
    expect(await userIds(r)).toEqual([user.id]);
    expect(await r.rows("SELECT deleted_at FROM subs WHERE sub_hash = ?", user.sub)).toEqual([{ deleted_at: null }]);
  });

  it("keeps an account whose forget the coach doesn't confirm ({ok: false}), and logs nothing", async () => {
    const r = await newRoom("accounts", T19);
    const user = await addUser(r, { age: STALE });
    await addLog(r, user.id);
    const asked = [];
    await fakeCoach(r, () => ({
      async forget(uid, sub_hash) {
        asked.push([uid, sub_hash]);
        return { ok: false };
      },
    }));
    await retention(r);
    expect(asked).toEqual([[user.id, user.sub]]);
    expect(await userIds(r)).toEqual([user.id]);
    expect(await r.rows("SELECT uid FROM sessions")).toEqual([{ uid: user.id }]);
    expect(await r.rows("SELECT deleted_at FROM subs WHERE sub_hash = ?", user.sub)).toEqual([{ deleted_at: null }]);
  });

  it("follows the messages it deleted before it waits on the coach: a text message gone no longer lights the CHAT dot", async () => {
    const r = await newRoom("accounts", T19);
    await addUser(r, { age: STALE });
    const writer = await addUser(r);
    const [old] = await addMessages(r, writer.id, 1, { ts: T19 - 31 * DAY });
    let dot;
    await fakeCoach(r, (room) => ({
      async forget() {
        dot = room.reportsFor("jinshan", T19).last_id;
        return { ok: true };
      },
    }));
    expect(await r.inRoom((room) => room.reportsFor("jinshan", T19).last_id)).toBe(old);
    await retention(r);
    expect(dot).toBe(0);
  });

  it("with 1,001 stale accounts whose forget throws, still ends: each is asked once and every one is kept", async () => {
    const r = await newRoom("accounts", T19);
    const ids = await r.inRoom((room) => {
      const made = [];
      for (let k = 0; k < 1001; k++) {
        const user = { id: crypto.randomUUID(), sub: `sub-${hex(8)}`, nick: `Stale_${k}` };
        insertUser(room, user, { age: STALE, role: "user", now: T19 });
        made.push(user.id);
      }
      return made.sort();
    });
    const asked = [];
    await fakeCoach(r, () => ({
      async forget(uid) {
        asked.push(uid);
        throw new Error("the coach is down");
      },
    }));
    await retention(r);
    expect(asked).toEqual(ids);
    expect(await userIds(r)).toEqual(ids);
    // One line for the run, not one for each account.
    expect(logged.splice(0)).toEqual([["chat: the coach's forget failed:", "Error"]]);
  }, 60_000);

  it("in the alarm: a sign-in that starts while the coach is asked still has the alarm come back for its handoff", async () => {
    const r = await newRoom("accounts", T19);
    await addUser(r, { age: STALE });
    await fakeCoach(r, (room) => ({
      async forget() {
        // A LINE sign-in finishes meanwhile: its handoff, with the LINE name, must go in 10 minutes.
        const body = JSON.stringify({ h: await sha256b64u(hex(8)), sub: `U${hex(16)}`, line_name: "Kai" });
        expect((await room.fetch(new Request("https://room/r/handoffs", { method: "POST", body }))).status).toBe(200);
        return { ok: true };
      },
    }));
    const alarm = await r.inRoom(async (room, state) => {
      room.setMeta("next_retention", T19);
      room.retentionAt = null;
      await room.alarm();
      return state.storage.getAlarm();
    });
    expect(await r.rows("SELECT count(*) AS n FROM handoffs")).toEqual([{ n: 1 }]);
    expect(alarm).toBeGreaterThanOrEqual(T19 + 10 * MIN);
    expect(alarm).toBeLessThanOrEqual(T19 + 10 * MIN + 2000);
  });
});
