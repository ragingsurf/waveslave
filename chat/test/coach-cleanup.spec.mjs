// Tests for the coach's daily clean-up in chat/src/coach.js (docs/superpowers/specs/2026-10-22-ai-coach-design.md,
// "Backend", "Daily clean-up (04:00 Taiwan)", and "Testing", "Clean-up and guards"; rulings R16 and P16): cleanup(),
// which the alarm runs at meta next_cleanup. Each rule at its edges: reviews never sent (2 hours after they were
// started), drafts waiting 14 days (from when each began waiting for Bryan), the key frames of failed reviews and of
// clips held as not surf (7 days after) and of published and rejected reviews (30 days after), a rejected review's
// drafts and notes (30 days after), and the quota rows of past Taiwan months; with frame_bytes kept right, the next
// clean-up set in the same run, a run that fails, and the rows a run reads. They run inside the Workers runtime (see
// vitest.config.mjs). Run from chat/: npx vitest run test/coach-cleanup.spec.mjs
//
// Each test has a coach of its own (newCoach) with its clock years ahead, so no alarm a test sets goes off by itself: a
// test runs it with runAlarm(), as the runtime would. Reviews are written straight into the tables, as the alarm and
// Bryan leave them. The room stub is replaced (ruling R1), and the coach has no email key, so it sends no email. The AI
// is a mocked fetch of env.COACH_API_URL that gives the answers a test queued in `ai`, in turn; any other fetch, or one
// more AI call than was queued, throws. After each test, every queued answer was used, nothing else was fetched and
// nothing was logged that the test didn't expect.
import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGREE_VER } from "../src/coach-guide.js";
import { apiMessage, goodReply, jpegB64 } from "./coach-fixtures.mjs";
import { DAY, HOUR, MIN, hex, newCoach } from "./helpers.mjs";

// 04:00 Taiwan (20:00 UTC the day before) on 4 June, years ahead: a clean-up's time. The next one is a day later.
const CLEAN = Date.UTC(2030, 5, 3, 20);
const MONTH = "2030-06"; // CLEAN's Taiwan month
// A draft closed after 14 days: the surfer is told with a code, "late", that the page puts in their language, never
// with words stored for them, so surfer_note stays empty.
const LATE = Object.freeze({ surfer_note: null, warnings: JSON.stringify(["late"]) });

const NOT_FOUND = Object.freeze({ status: 404, json: { error: "not_found" } });

// A review's 12 key frames, each of its own size, so that frame_bytes going down by the wrong frame's bytes shows.
const TWELVE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const FRAMES = TWELVE.map((n) => jpegB64({ app: [n * 7] }));
const SET_BYTES = FRAMES.reduce((sum, frame) => sum + frame.length, 0);
// Their rows as the table holds them: number, time and box, and whether the JPEG is kept.
const LISTED = TWELVE.map((n) => ({ n, ms: 11_000 + 250 * (n - 1), box: "[200,120,360]" }));
const ALL_KEPT = LISTED.map((f) => ({ ...f, kept: 1 }));
const ALL_CLEARED = LISTED.map((f) => ({ ...f, kept: 0 }));
const TIMES = Object.fromEntries(LISTED.map((f) => [f.n, f.ms]));

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

const ok = (reply = goodReply()) => () => Response.json(apiMessage(reply));
const apiError = (status, type, message) => () =>
  new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status, headers: { "content-type": "application/json" },
  });

// ---- Coaches, accounts and reviews ----------------------------------------------------------------------------------

// A coach of its own with its clock at `at`, its daily clean-up due at `cleanup` (at `at` unless given), no email key,
// and a room stub that bans no one.
async function freshCoach(at = CLEAN, { cleanup = at } = {}) {
  const c = await newCoach("cleanup", at);
  await c.inCoach((coach) => {
    coach.env = { ...coach.env, RESEND_API_KEY: "" };
    coach.roomStub = () => ({ isBanned: async () => false });
    coach.setMeta("next_cleanup", cleanup);
  });
  return c;
}

const surfer = () => ({ uid: `u-${hex(6)}`, sub_hash: `sub-${hex(8)}`, role: "user" });
const BRYAN = Object.freeze({ uid: "u-bryan", sub_hash: "sub-bryan", role: "admin" });

const ANSWERS = Object.freeze({
  move: "top_turn", move_other: "", level: "starting_turns", board: "shortboard", stance: "regular", note: "I fall off at the top",
});

// A review written straight into the table, as the alarm and Bryan leave one: drafted by default, sent 5 hours before
// the clean-up and waiting for Bryan since (a draft's waiting_since), with goodReply() as its draft, its 12 key frames
// up (counted in frame_bytes) unless `frames` is false, and its count in the Taiwan month's quota unless `counted` is
// false, for an account that agreed. Any column can be set in `cols`.
async function insertReview(c, who, opts = {}) {
  const { id = hex(11), frames = true, counted = true, status = "drafted", sent = CLEAN - 5 * HOUR, ...cols } = opts;
  const row = {
    id, uid: who.uid, sub_hash: who.sub_hash, lang: "en", move: "top_turn", answers: JSON.stringify(ANSWERS), status,
    created: (sent ?? CLEAN) - 10 * MIN, sent, waiting_since: status === "drafted" ? sent : null, quota_month: MONTH,
    draft: JSON.stringify(goodReply()), ...cols,
  };
  const names = Object.keys(row);
  await c.rows(`INSERT INTO reviews (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, ...Object.values(row));
  await c.rows(
    "INSERT INTO people (sub_hash, agreed_ver, agreed_at) VALUES (?, ?, ?) ON CONFLICT (sub_hash) DO NOTHING",
    who.sub_hash, AGREE_VER, CLEAN - 60 * DAY,
  );
  if (counted) {
    await c.rows(
      `INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, 1, 1)
       ON CONFLICT (sub_hash, month) DO UPDATE SET used = used + 1, sent = sent + 1`,
      who.sub_hash, MONTH,
    );
  }
  if (frames) await insertFrames(c, id, TWELVE);
  return id;
}

// A review's 12 listed key frames, with those numbered in `uploaded` up (counted in frame_bytes) and the rest still to
// come, as the start lists them and the uploads fill them in.
async function insertFrames(c, id, uploaded) {
  for (const f of LISTED) {
    const b64 = uploaded.includes(f.n) ? FRAMES[f.n - 1] : null;
    await c.rows("INSERT INTO frames (review_id, n, ms, box, b64) VALUES (?, ?, ?, ?, ?)", id, f.n, f.ms, f.box, b64);
  }
  const bytes = uploaded.reduce((sum, n) => sum + FRAMES[n - 1].length, 0);
  await c.inCoach((coach) => coach.setMeta("frame_bytes", (coach.getMeta("frame_bytes") ?? 0) + bytes));
}

// A review still uploading, started at `created`, as the start leaves it: nothing counted (quota_month is null), and
// the key frames in `uploaded` up.
async function insertUnsent(c, who, created, uploaded = TWELVE) {
  const id = await insertReview(c, who, {
    status: "uploading", sent: null, created, quota_month: null, draft: null, frames: false, counted: false,
  });
  await insertFrames(c, id, uploaded);
  return id;
}

// A review handled `age` before the clean-up (handled_at), in `status`, as the alarm or Bryan left it, sent an hour
// before that: a published one with its text published then and checked.
function insertHandled(c, who, status, age, more = {}) {
  const at = CLEAN - age;
  const published = status === "published" ? { published: at, final: JSON.stringify(goodReply()), checked: 1 } : {};
  return insertReview(c, who, { status, sent: at - HOUR, handled_at: at, ...published, ...more });
}

// A clip the coach found isn't surfing, held for Bryan `age` before the clean-up (ruling R16), as the alarm leaves it:
// rejected, hold 1, handled then, its "not_surf" warning, no flags, its key frames kept and its count kept.
const insertNotSurf = (c, who, age, more = {}) =>
  insertHandled(c, who, "rejected", age, {
    hold: 1, draft: JSON.stringify({ ...goodReply(), is_surf_clip: false }), warnings: JSON.stringify(["not_surf"]), ...more,
  });

// A flagged clip held for Bryan `age` before the clean-up (ruling R16): rejected, hold 1, its flags, no key frames and no
// draft, and the account blocked.
async function insertFlagged(c, who, age) {
  const id = await insertHandled(c, who, "rejected", age, {
    hold: 1, flags: JSON.stringify(["under_18"]), draft: null, frames: false,
  });
  await c.rows("UPDATE people SET blocked = 1 WHERE sub_hash = ?", who.sub_hash);
  return id;
}

// One route, as the Worker hands it over: the body as text.
const call = (c, who, method, path, body = "") =>
  c.stub.route({ method, path, who, body: typeof body === "string" ? body : JSON.stringify(body) });
const me = async (c, who) => (await call(c, who, "GET", "/coach/me")).json;
const drafts = async (c) => (await call(c, BRYAN, "GET", "/admin/coach/drafts")).json;
const frame = (c, who, id, n) => call(c, who, "GET", `/coach/reviews/${id}/frames/${n}`);
const report = (c, who, id, line) => call(c, who, "POST", `/coach/reviews/${id}/report`, { line });

const reviewRow = async (c, id) => (await c.rows("SELECT * FROM reviews WHERE id = ?", id))[0];
const quota = (c, who) => c.rows("SELECT month, used, sent FROM quota WHERE sub_hash = ? ORDER BY month", who.sub_hash);
const framesOf = (c, id) => c.rows("SELECT n, ms, box, b64 IS NOT NULL AS kept FROM frames WHERE review_id = ? ORDER BY n", id);
const getMeta = (c, key) => c.inCoach((coach) => coach.getMeta(key));
const setMeta = (c, key, value) => c.inCoach((coach) => coach.setMeta(key, value));
const alarmAt = (c) => c.inCoach((coach) => coach.ctx.storage.getAlarm());

// The bytes of key frames the table holds: meta frame_bytes must say the same.
async function expectBytesRight(c) {
  const [{ bytes }] = await c.rows("SELECT coalesce(sum(length(b64)), 0) AS bytes FROM frames");
  expect(await getMeta(c, "frame_bytes")).toBe(bytes);
}

// One alarm run, as the runtime makes it: the alarm set for the coach's now, then run.
async function runAlarm(c) {
  await c.inCoach((coach) => coach.ctx.storage.setAlarm(c.clock.t));
  expect(await runDurableObjectAlarm(c.stub)).toBe(true);
}

// ---- When it runs ---------------------------------------------------------------------------------------------------

describe("when it runs", () => {
  it("at next_cleanup, which the same run moves on to the next 04:00 Taiwan, so the alarm goes off a day later", async () => {
    const c = await freshCoach();
    const unsent = await insertUnsent(c, surfer(), CLEAN - 3 * HOUR);
    await runAlarm(c);
    expect(await reviewRow(c, unsent)).toBeUndefined();
    expect(await getMeta(c, "next_cleanup")).toBe(CLEAN + DAY);
    expect(await getMeta(c, "last_cleanup")).toBe(CLEAN);
    expect(await alarmAt(c)).toBe(CLEAN + DAY);
  });

  it("not before it is due: an alarm a minute before cleans nothing and leaves the next clean-up where it is", async () => {
    const c = await freshCoach(CLEAN - MIN, { cleanup: CLEAN });
    const unsent = await insertUnsent(c, surfer(), CLEAN - 3 * HOUR);
    await runAlarm(c);
    expect((await reviewRow(c, unsent)).status).toBe("uploading");
    expect(await getMeta(c, "next_cleanup")).toBe(CLEAN);
    expect(await getMeta(c, "last_cleanup")).toBeNull();
    expect(await alarmAt(c)).toBe(CLEAN);
  });

  it("keeps running every day with nothing queued, and after days missed runs once and sets the next 04:00", async () => {
    const c = await freshCoach();
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(CLEAN + DAY);
    c.clock.t = CLEAN + DAY;
    await runAlarm(c);
    expect(await getMeta(c, "last_cleanup")).toBe(CLEAN + DAY);
    expect(await alarmAt(c)).toBe(CLEAN + 2 * DAY);
    // The coach was down for three days: the run that comes cleans, and the next is the next 04:00, not one missed.
    c.clock.t = CLEAN + 4 * DAY + 5 * HOUR;
    const unsent = await insertUnsent(c, surfer(), c.clock.t - 3 * HOUR);
    await runAlarm(c);
    expect(await reviewRow(c, unsent)).toBeUndefined();
    expect(await getMeta(c, "next_cleanup")).toBe(CLEAN + 5 * DAY);
    expect(await getMeta(c, "last_cleanup")).toBe(CLEAN + 4 * DAY + 5 * HOUR);
    expect(await alarmAt(c)).toBe(CLEAN + 5 * DAY);
  });

  it("a coach with none set yet (its first alarm) sets it for the next 04:00 Taiwan and cleans nothing then", async () => {
    const c = await freshCoach(CLEAN + 2 * HOUR);
    await c.rows("DELETE FROM meta WHERE key = 'next_cleanup'");
    const unsent = await insertUnsent(c, surfer(), CLEAN - 3 * HOUR);
    await runAlarm(c);
    expect((await reviewRow(c, unsent)).status).toBe("uploading");
    expect(await getMeta(c, "next_cleanup")).toBe(CLEAN + DAY);
    expect(await alarmAt(c)).toBe(CLEAN + DAY);
  });

  it("before the run's AI call, so a run whose call throws has cleaned, and sets the alarm for the next one", async () => {
    const c = await freshCoach();
    const unsent = await insertUnsent(c, surfer(), CLEAN - 3 * HOUR);
    const thrown = await c.inCoach(async (coach) => {
      coach.runOne = async () => {
        throw new TypeError("cut off");
      };
      try {
        await coach.alarm();
        return null;
      } catch (err) {
        return err.message;
      }
    });
    expect(thrown).toBe("cut off");
    expect(await reviewRow(c, unsent)).toBeUndefined();
    expect(await getMeta(c, "next_cleanup")).toBe(CLEAN + DAY);
    expect(await alarmAt(c)).toBe(CLEAN + DAY);
  });

  it("a run that fails still makes the run's AI call, and the review is drafted", async () => {
    const c = await freshCoach();
    const queued = await insertReview(c, surfer(), { status: "queued", next_try: CLEAN });
    await c.inCoach((coach) => {
      coach.cleanRules = () => {
        throw new RangeError("a bug");
      };
    });
    ai.push(ok());
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the daily clean-up failed:", "RangeError"]]);
    expect(await reviewRow(c, queued)).toMatchObject({ status: "drafted", waiting_since: CLEAN });
    expect(await getMeta(c, "next_cleanup")).toBe(CLEAN + DAY);
    expect(await getMeta(c, "last_cleanup")).toBeNull();
  });

  it("a run that fails changes nothing and is logged by the error's name only; the next day's run covers both days", async () => {
    const c = await freshCoach();
    const a = surfer();
    // Yesterday's run finished. Today a review never sent is due to go, and a published one's key frames; tomorrow,
    // another published one's.
    await setMeta(c, "last_cleanup", CLEAN - DAY);
    const unsent = await insertUnsent(c, a, CLEAN - 3 * HOUR);
    const today = await insertHandled(c, a, "published", 30 * DAY + HOUR);
    const tomorrow = await insertHandled(c, a, "published", 29 * DAY + HOUR);
    await c.inCoach((coach) => {
      coach.clearFrames = () => {
        throw new TypeError("the disk is full of secrets");
      };
    });
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the daily clean-up failed:", "TypeError"]]);
    // Nothing of it stayed, the review never sent included, which went before the error.
    expect((await reviewRow(c, unsent)).status).toBe("uploading");
    expect(await framesOf(c, today)).toEqual(ALL_KEPT);
    expect(await getMeta(c, "last_cleanup")).toBe(CLEAN - DAY);
    await expectBytesRight(c);
    // The next one is still tomorrow, so the alarm doesn't go off again at once.
    expect(await getMeta(c, "next_cleanup")).toBe(CLEAN + DAY);
    expect(await alarmAt(c)).toBe(CLEAN + DAY);

    await c.inCoach((coach) => {
      delete coach.clearFrames;
    });
    c.clock.t = CLEAN + DAY;
    await runAlarm(c);
    expect(await reviewRow(c, unsent)).toBeUndefined();
    expect(await framesOf(c, today)).toEqual(ALL_CLEARED);
    expect(await framesOf(c, tomorrow)).toEqual(ALL_CLEARED);
    expect(await getMeta(c, "last_cleanup")).toBe(CLEAN + DAY);
    await expectBytesRight(c);
  });
});

// ---- Reviews never sent ---------------------------------------------------------------------------------------------

describe("reviews never sent", () => {
  it("go with their key frames 2 hours after they were started (1 h 59 and 2 h 01), and no count goes back: none was taken", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    // Each account had a review counted this month already.
    await insertHandled(c, a, "published", 2 * DAY);
    await insertHandled(c, b, "published", 2 * DAY);
    const young = await insertUnsent(c, a, CLEAN - (2 * HOUR - MIN), [1, 2, 3]);
    const old = await insertUnsent(c, b, CLEAN - (2 * HOUR + MIN), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // A review started long ago but sent is not one of them (it waits for the alarm a while yet).
    const sent = await insertReview(c, a, { status: "queued", created: CLEAN - 5 * HOUR, sent: CLEAN - MIN, next_try: CLEAN + HOUR });
    await runAlarm(c);
    expect(await reviewRow(c, old)).toBeUndefined();
    expect(await c.rows("SELECT n FROM frames WHERE review_id = ?", old)).toEqual([]);
    expect((await reviewRow(c, young)).status).toBe("uploading");
    expect(await framesOf(c, young)).toEqual(LISTED.map((f) => ({ ...f, kept: f.n <= 3 ? 1 : 0 })));
    expect((await reviewRow(c, sent)).status).toBe("queued");
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 2, sent: 2 }]);
    expect(await quota(c, b)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
    await expectBytesRight(c);
  });
});

// ---- Drafts waiting 14 days -----------------------------------------------------------------------------------------

describe("drafts waiting 14 days", () => {
  it("are closed (13 and 15 days): rejected, the surfer told, given back once, handled now, with no email", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    const fresh = await insertReview(c, a, { sent: CLEAN - 13 * DAY - HOUR });
    const late = await insertReview(c, b, { sent: CLEAN - 15 * DAY });
    // b's other review this month, published.
    await insertHandled(c, b, "published", 16 * DAY);
    await runAlarm(c);
    expect(await reviewRow(c, fresh)).toMatchObject({ status: "drafted", given: 0, handled_at: null, surfer_note: null });
    expect(await reviewRow(c, late)).toMatchObject({
      status: "rejected", ...LATE, given: 1, handled_at: CLEAN, next_try: null, hold: 0,
      draft: JSON.stringify(goodReply()),
    });
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
    expect(await quota(c, b)).toEqual([{ month: MONTH, used: 1, sent: 2 }]);
    // The surfer sees it wasn't reviewed, and why, and has a review back to send.
    const mine = await me(c, b);
    expect(mine.left).toBe(1);
    expect(mine.reviews.find((r) => r.id === late)).toMatchObject({ status: "not_reviewed", note: "late" });
    // Bryan sees it among the handled, the last handled first, and no longer waiting.
    const list = await drafts(c);
    expect(list.waiting.map((r) => r.id)).toEqual([fresh]);
    expect(list.handled[0]).toMatchObject({ id: late, status: "rejected", handled_at: CLEAN });
    // Its key frames stay for 30 days after, as any rejected review's.
    expect(await framesOf(c, late)).toEqual(ALL_KEPT);
    // Bryan heard of the draft when it came: closing it brings no email.
    expect(await getMeta(c, "digest_due")).toBeNull();

    // The next day: the one 13 days waiting has waited 14 and is closed too, and nothing goes back twice.
    c.clock.t = CLEAN + DAY;
    await runAlarm(c);
    expect(await reviewRow(c, fresh)).toMatchObject({ status: "rejected", ...LATE, given: 1, handled_at: CLEAN + DAY });
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 0, sent: 1 }]);
    expect(await quota(c, b)).toEqual([{ month: MONTH, used: 1, sent: 2 }]);
    await expectBytesRight(c);
  });

  it("close a draft whose count a money rest or the hard stop already gave back, and give nothing back twice", async () => {
    const c = await freshCoach();
    const a = surfer();
    // Two reviews counted this month, the late one given back already (as startRest() and holdForCredit() leave it):
    // used 1 of 2 sent.
    await insertHandled(c, a, "published", 3 * DAY);
    const late = await insertReview(c, a, { sent: CLEAN - 15 * DAY, given: 1 });
    await c.rows("UPDATE quota SET used = used - 1 WHERE sub_hash = ? AND month = ?", a.sub_hash, MONTH);
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 2 }]);
    await runAlarm(c);
    expect(await reviewRow(c, late)).toMatchObject({ status: "rejected", ...LATE, given: 1, handled_at: CLEAN });
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 2 }]);
  });

  it("count from when each began waiting for Bryan: a draft that came days after it was sent, a Redo's, a failed Redo's", async () => {
    // Three reviews sent 20 days ago and held in the queue since by Bryan's Pause, which gives no count back: a first
    // one, and two Redos Bryan asked for before he paused. He has let them go: an hour apart before the clean-up, the AI
    // drafts the first and the second, and the third's Redo fails, so it goes back to Bryan with its old draft.
    const T1 = CLEAN - 3 * HOUR;
    const c = await freshCoach(T1, { cleanup: CLEAN });
    const queued = (who, sent, more = {}) =>
      insertReview(c, who, { status: "queued", sent: CLEAN - 20 * DAY + sent, next_try: T1, ...more });
    const redo = { redos: 1, redo_note: JSON.stringify(["Look at key frame 4"]) };
    const first = await queued(surfer(), 0, { draft: null });
    const redone = await queued(surfer(), MIN, redo);
    const failed = await queued(surfer(), 2 * MIN, redo);
    ai.push(ok());
    await runAlarm(c);
    c.clock.t = T1 + HOUR;
    ai.push(ok());
    await runAlarm(c);
    c.clock.t = T1 + 2 * HOUR;
    ai.push(apiError(400, "invalid_request_error", "Bad request"));
    await runAlarm(c);
    expect(await reviewRow(c, first)).toMatchObject({ status: "drafted", waiting_since: T1 });
    expect(await reviewRow(c, redone)).toMatchObject({ status: "drafted", waiting_since: T1 + HOUR });
    const back = await reviewRow(c, failed);
    expect(back).toMatchObject({ status: "drafted", waiting_since: T1 + 2 * HOUR });
    expect(JSON.parse(back.warnings)).toEqual(["redo_failed"]);

    // Sent 20 days ago, but none has waited for Bryan 14 days.
    c.clock.t = CLEAN;
    await runAlarm(c);
    for (const id of [first, redone, failed]) expect((await reviewRow(c, id)).status).toBe("drafted");

    // 14 days and a half hour after the second came, and so half an hour short of 14 days after the third came back,
    // only the first two are closed.
    c.clock.t = T1 + 14 * DAY + HOUR + 30 * MIN;
    await runAlarm(c);
    expect(await reviewRow(c, first)).toMatchObject({ status: "rejected", ...LATE, given: 1 });
    expect(await reviewRow(c, redone)).toMatchObject({ status: "rejected", ...LATE, given: 1 });
    expect(await reviewRow(c, failed)).toMatchObject({ status: "drafted", given: 0 });
  });

  it("count from the report for a published review the surfer reported, which goes back to published, report kept", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    // Both published 19 days ago. b reported theirs 15 days ago, a theirs yesterday.
    const yesterday = await insertHandled(c, a, "published", 19 * DAY);
    const longAgo = await insertHandled(c, b, "published", 19 * DAY);
    c.clock.t = CLEAN - 15 * DAY;
    expect((await report(c, b, longAgo, "That isn't me")).status).toBe(200);
    c.clock.t = CLEAN - DAY;
    expect((await report(c, a, yesterday, "")).status).toBe(200);
    expect(await reviewRow(c, yesterday)).toMatchObject({ status: "drafted", waiting_since: CLEAN - DAY, handled_at: null });
    c.clock.t = CLEAN;
    await runAlarm(c);
    expect(await reviewRow(c, yesterday)).toMatchObject({
      status: "drafted", report: "", published: CLEAN - 19 * DAY, handled_at: null, given: 0,
    });
    // Not closed as late: it was published, so it is published again as it was, handled now with its report kept, so
    // Bryan still finds it among the handled. Nothing goes back, and the surfer sees it as before.
    expect(await reviewRow(c, longAgo)).toMatchObject({
      status: "published", surfer_note: null, warnings: "[]", report: "That isn't me", published: CLEAN - 19 * DAY,
      final: JSON.stringify(goodReply()), handled_at: CLEAN, next_try: null, given: 0,
    });
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
    expect(await quota(c, b)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
    expect((await me(c, b)).reviews.find((r) => r.id === longAgo)).toMatchObject({ status: "ready", note: null });
    expect((await drafts(c)).handled.find((r) => r.id === longAgo)).toMatchObject({ status: "published", handled_at: CLEAN });
  });

  it("close a reported review as late when a Redo took its published text, as there is nothing to publish again", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertHandled(c, a, "published", 19 * DAY, {
      status: "drafted", final: null, report: "", handled_at: null, waiting_since: CLEAN - 15 * DAY,
    });
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "rejected", ...LATE, report: "", handled_at: CLEAN, given: 1 });
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 0, sent: 1 }]);
  });

  it("15 days old, a clip held as not surf or flagged isn't given back: the not-surf hold ends, the flagged one waits", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    const notSurf = await insertNotSurf(c, a, 15 * DAY);
    const flagged = await insertFlagged(c, b, 15 * DAY);
    const flaggedBefore = await reviewRow(c, flagged);
    await runAlarm(c);
    expect(await reviewRow(c, notSurf)).toMatchObject({
      status: "rejected", hold: 0, given: 0, surfer_note: null, handled_at: CLEAN - 15 * DAY,
    });
    expect(await reviewRow(c, flagged)).toEqual(flaggedBefore);
    expect(await c.rows("SELECT blocked FROM people WHERE sub_hash = ?", b.sub_hash)).toEqual([{ blocked: 1 }]);
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
    expect(await quota(c, b)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
  });
});

// ---- Clips held as not surf -----------------------------------------------------------------------------------------

describe("clips held as not surf", () => {
  it("are let go 7 days after (6 and 8 days): the hold ends and the key frames go, their rows kept, and the count stays", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    const six = await insertNotSurf(c, a, 6 * DAY);
    const eight = await insertNotSurf(c, b, 8 * DAY);
    await runAlarm(c);
    expect(await reviewRow(c, six)).toMatchObject({ status: "rejected", hold: 1 });
    expect(await framesOf(c, six)).toEqual(ALL_KEPT);
    expect(await reviewRow(c, eight)).toMatchObject({ status: "rejected", hold: 0, given: 0, handled_at: CLEAN - 8 * DAY });
    expect(await framesOf(c, eight)).toEqual(ALL_CLEARED);
    expect(await quota(c, b)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
    // It leaves Bryan's waiting list for the handled, where it was handled; the surfer is still told it couldn't be
    // reviewed.
    const list = await drafts(c);
    expect(list.waiting.map((r) => r.id)).toEqual([six]);
    expect(list.handled.map((r) => r.id)).toEqual([eight]);
    expect((await me(c, b)).reviews).toMatchObject([{ id: eight, status: "not_reviewed", note: "not_surf" }]);
    await expectBytesRight(c);
    expect(await getMeta(c, "frame_bytes")).toBe(SET_BYTES);
  });
});

// ---- Key frames -----------------------------------------------------------------------------------------------------

describe("key frames", () => {
  it("of a failed review go 7 days after (6 and 8 days), their rows kept", async () => {
    const c = await freshCoach();
    const a = surfer();
    const six = await insertHandled(c, a, "failed", 6 * DAY, { draft: null, attempts: 3 });
    const eight = await insertHandled(c, a, "failed", 8 * DAY, { draft: null, attempts: 3 });
    await runAlarm(c);
    expect(await framesOf(c, six)).toEqual(ALL_KEPT);
    expect(await framesOf(c, eight)).toEqual(ALL_CLEARED);
    expect(await reviewRow(c, eight)).toMatchObject({ status: "failed", handled_at: CLEAN - 8 * DAY });
    await expectBytesRight(c);
    expect(await getMeta(c, "frame_bytes")).toBe(SET_BYTES);
  });

  it("of published and rejected reviews go 30 days after (29 and 31 days); the rows stay, so a published review keeps its key frames' times, and a frame asked for is not_found to its owner and to Bryan", async () => {
    const c = await freshCoach();
    const a = surfer();
    const published29 = await insertHandled(c, a, "published", 29 * DAY);
    const published31 = await insertHandled(c, a, "published", 31 * DAY);
    const rejected29 = await insertHandled(c, a, "rejected", 29 * DAY, { surfer_note: "Not a top turn" });
    const rejected31 = await insertHandled(c, a, "rejected", 31 * DAY, { surfer_note: "Not a top turn" });
    await runAlarm(c);
    for (const id of [published29, rejected29]) expect(await framesOf(c, id)).toEqual(ALL_KEPT);
    for (const id of [published31, rejected31]) expect(await framesOf(c, id)).toEqual(ALL_CLEARED);
    await expectBytesRight(c);
    expect(await getMeta(c, "frame_bytes")).toBe(2 * SET_BYTES);

    // The owner's published review still has its text and its key frames' times; none of its frames is here now.
    expect((await call(c, a, "GET", `/coach/reviews/${published31}`)).json).toEqual({
      id: published31, status: "published", move: "top_turn", move_other: "", created: CLEAN - 31 * DAY - HOUR - 10 * MIN,
      have: [], note: null,
      review: { text: goodReply(), times: TIMES, checked: true },
    });
    const admin = (await call(c, BRYAN, "GET", `/coach/reviews/${rejected31}`)).json;
    expect(admin.frames).toEqual(LISTED.map((f) => ({ n: f.n, ms: f.ms, box: JSON.parse(f.box) })));
    expect(admin.have).toEqual([]);
    for (const n of [1, 7, 12]) {
      for (const id of [published31, rejected31]) {
        expect(await frame(c, a, id, n)).toEqual(NOT_FOUND);
        expect(await frame(c, BRYAN, id, n)).toEqual(NOT_FOUND);
      }
      const kept = await frame(c, a, published29, n);
      expect(kept.status).toBe(200);
      expect(kept.jpeg.length).toBeGreaterThan(0);
    }

    // The next day, the ones 29 days old have reached 30: their key frames go then.
    c.clock.t = CLEAN + DAY;
    await runAlarm(c);
    for (const id of [published29, rejected29]) expect(await framesOf(c, id)).toEqual(ALL_CLEARED);
    await expectBytesRight(c);
    expect(await getMeta(c, "frame_bytes")).toBe(0);
  });

  it("of a review still waiting, queued or drafted, are never the clean-up's, however old it is", async () => {
    const c = await freshCoach();
    const a = surfer();
    // A review held in the queue 40 days by Bryan's Pause, which goes on, so nothing calls it in this run; and a draft
    // sent 40 days ago that Bryan redid, back with him 3 days ago.
    await setMeta(c, "paused", true);
    const queued = await insertReview(c, a, { status: "queued", sent: CLEAN - 40 * DAY, next_try: CLEAN - 40 * DAY });
    const draft = await insertReview(c, a, { sent: CLEAN - 40 * DAY, waiting_since: CLEAN - 3 * DAY, redos: 1 });
    await runAlarm(c);
    for (const id of [queued, draft]) expect(await framesOf(c, id)).toEqual(ALL_KEPT);
    expect((await reviewRow(c, draft)).status).toBe("drafted");
    await expectBytesRight(c);
  });
});

// ---- A rejected review's drafts and notes ---------------------------------------------------------------------------

describe("a rejected review's drafts and notes", () => {
  it("go 30 days after (29 and 31 days); what the surfer is shown stays, and a published review keeps its text", async () => {
    const c = await freshCoach();
    const a = surfer();
    const texts = {
      draft: JSON.stringify(goodReply()), english: JSON.stringify(goodReply(TWELVE, "zh").english),
      final: JSON.stringify(goodReply()), redo_note: JSON.stringify(["Look at key frame 4"]),
    };
    // Withdrawn after a report 31 days ago, its published text with it; rejected by Bryan 29 days ago; published 31
    // days ago; a not-surf clip found 31 days ago; and a flagged clip Bryan still holds after 31 days.
    const withdrawn = await insertHandled(c, a, "rejected", 31 * DAY, {
      ...texts, published: CLEAN - 40 * DAY, surfer_note: "Wrong surfer, sorry", report: "That isn't me", checked: 1,
    });
    const rejected29 = await insertHandled(c, a, "rejected", 29 * DAY, { ...texts, surfer_note: "Not a top turn" });
    const published = await insertHandled(c, a, "published", 31 * DAY, texts);
    const notSurf = await insertNotSurf(c, a, 31 * DAY);
    const flagged = await insertFlagged(c, surfer(), 31 * DAY);
    const before = {};
    for (const id of [withdrawn, rejected29, published, notSurf, flagged]) before[id] = await reviewRow(c, id);
    await runAlarm(c);

    const blank = { draft: null, english: null, final: null, redo_note: "[]" };
    expect(await reviewRow(c, withdrawn)).toEqual({ ...before[withdrawn], ...blank });
    expect(await reviewRow(c, notSurf)).toEqual({ ...before[notSurf], ...blank, hold: 0 });
    expect(await reviewRow(c, rejected29)).toEqual(before[rejected29]);
    expect(await reviewRow(c, published)).toEqual(before[published]);
    expect(await reviewRow(c, flagged)).toEqual(before[flagged]);
    // The surfer is still told what they were told.
    const notes = Object.fromEntries((await me(c, a)).reviews.map((r) => [r.id, r.note]));
    expect(notes[withdrawn]).toBe("Wrong surfer, sorry");
    expect(notes[notSurf]).toBe("not_surf");
    expect((await call(c, a, "GET", `/coach/reviews/${published}`)).json.review.text).toEqual(goodReply());

    // The next day, the one rejected 29 days ago has reached 30.
    c.clock.t = CLEAN + DAY;
    await runAlarm(c);
    expect(await reviewRow(c, rejected29)).toEqual({ ...before[rejected29], ...blank });
    expect(await reviewRow(c, published)).toEqual(before[published]);
  });
});

// ---- Quota rows -----------------------------------------------------------------------------------------------------

describe("quota rows", () => {
  it("of past Taiwan months go, this month's stay: at 04:00 Taiwan on 1 July, June's go, though it is June still in UTC", async () => {
    // 23:00 Taiwan on 30 June, then 04:00 on 1 July (20:00 UTC on 30 June).
    const june = Date.UTC(2030, 5, 30, 15);
    const july = Date.UTC(2030, 5, 30, 20);
    const c = await freshCoach(june);
    const a = surfer();
    const b = surfer();
    const months = [[a, "2029-12", 2, 3], [a, "2030-05", 1, 1], [a, "2030-06", 2, 4], [a, "2030-07", 1, 1], [b, "2030-06", 1, 2]];
    for (const [who, month, used, sent] of months) {
      await c.rows("INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, ?, ?)", who.sub_hash, month, used, sent);
    }
    await runAlarm(c);
    expect(await quota(c, a)).toEqual([
      { month: "2030-06", used: 2, sent: 4 }, { month: "2030-07", used: 1, sent: 1 },
    ]);
    expect(await quota(c, b)).toEqual([{ month: "2030-06", used: 1, sent: 2 }]);
    expect(await getMeta(c, "next_cleanup")).toBe(july);

    c.clock.t = july;
    await runAlarm(c);
    expect(await quota(c, a)).toEqual([{ month: "2030-07", used: 1, sent: 1 }]);
    expect(await quota(c, b)).toEqual([]);
  });
});

// ---- What a run reads -----------------------------------------------------------------------------------------------

describe("what a run reads", () => {
  it("about as many rows as it cleans, however many reviews are kept, and frame_bytes matches the key frames left", async () => {
    const c = await freshCoach();
    const a = surfer();
    // 900 reviews handled over the last year and more, a third each published, rejected and failed, cleaned by the
    // earlier runs: their key frames' rows are left, blank. The last run was yesterday.
    await c.inCoach((coach) => {
      for (let k = 0; k < 900; k++) {
        const status = ["published", "rejected", "failed"][k % 3];
        const at = CLEAN - 31 * DAY - k * 12 * HOUR;
        const id = hex(11);
        coach.sql.exec(
          `INSERT INTO reviews (id, uid, sub_hash, lang, move, answers, status, created, sent, published, handled_at,
             quota_month, surfer_note)
           VALUES (?, ?, ?, 'en', 'top_turn', ?, ?, ?, ?, ?, ?, '2029-01', ?)`,
          id, a.uid, a.sub_hash, JSON.stringify(ANSWERS), status, at - 2 * HOUR, at - HOUR,
          status === "published" ? at : null, at, status === "rejected" ? "Not a top turn" : null,
        );
        for (const f of LISTED) {
          coach.sql.exec("INSERT INTO frames (review_id, n, ms, box, b64) VALUES (?, ?, ?, ?, NULL)", id, f.n, f.ms, f.box);
        }
      }
      coach.setMeta("last_cleanup", CLEAN - DAY);
    });
    // Today's: a review never sent, a draft 14 days waiting, a not-surf clip 7 days held, a failed review 7 days old,
    // a published and a rejected review 30 days old; and some kept: a draft, a published review a day old.
    const unsent = await insertUnsent(c, a, CLEAN - 3 * HOUR);
    const late = await insertReview(c, a, { sent: CLEAN - 14 * DAY - HOUR });
    const notSurf = await insertNotSurf(c, a, 7 * DAY + HOUR);
    const failed = await insertHandled(c, a, "failed", 7 * DAY + HOUR, { draft: null });
    const published = await insertHandled(c, a, "published", 30 * DAY + HOUR);
    const rejected = await insertHandled(c, a, "rejected", 30 * DAY + HOUR, { surfer_note: "Not a top turn" });
    const draft = await insertReview(c, a);
    const fresh = await insertHandled(c, a, "published", DAY);

    // Each statement's rows read while the coach ran it.
    const reads = await c.inCoach((coach) => {
      const real = coach.sql;
      const seen = [];
      coach.sql = {
        exec(query, ...binds) {
          const cursor = real.exec(query, ...binds);
          seen.push({ query, cursor });
          return cursor;
        },
      };
      try {
        coach.cleanup(CLEAN);
      } finally {
        coach.sql = real;
      }
      return seen.map(({ query, cursor }) => ({ query, read: cursor.rowsRead }));
    });
    // Every rule asked.
    for (const asks of [/'uploading'/, /'drafted'/, /reviews_held/, /'failed'/, /'published', 'rejected'/, /redo_note = '\[\]'/, /quota/]) {
      expect(reads.some(({ query }) => asks.test(query)), String(asks)).toBe(true);
    }
    // One that read every review handled, or every key frame's row, would read 900 or 10,800 or more.
    for (const { query, read } of reads) expect(read, query).toBeLessThan(100);

    expect(await reviewRow(c, unsent)).toBeUndefined();
    expect(await reviewRow(c, late)).toMatchObject({ status: "rejected", ...LATE });
    expect(await reviewRow(c, notSurf)).toMatchObject({ hold: 0 });
    expect(await reviewRow(c, rejected)).toMatchObject({ draft: null, surfer_note: "Not a top turn" });
    for (const id of [notSurf, failed, published, rejected]) expect(await framesOf(c, id)).toEqual(ALL_CLEARED);
    for (const id of [late, draft, fresh]) expect(await framesOf(c, id)).toEqual(ALL_KEPT);
    await expectBytesRight(c);
    expect(await getMeta(c, "frame_bytes")).toBe(3 * SET_BYTES);
    expect(await getMeta(c, "next_cleanup")).toBe(CLEAN + DAY);
  });
});
