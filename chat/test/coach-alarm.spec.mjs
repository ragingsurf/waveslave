// Tests for the coach's alarm and its AI call in chat/src/coach.js (docs/superpowers/specs/2026-10-22-ai-coach-design.md,
// "Backend" steps 1-7, "The AI request", "Money" (how Anthropic's errors are sorted) and "Testing", "The alarm" and "The
// request"): alarm(), nextAlarmAt(), callAi() and the outcomes of a call, and Pause off and Start again bringing the alarm
// back. The money rests themselves are Task 9's (coach-money.spec.mjs). They run inside the Workers runtime (see
// vitest.config.mjs). Run from chat/: npx vitest run test/coach-alarm.spec.mjs
//
// Each test has a coach of its own (newCoach) with its clock at T, years ahead, so no alarm a test sets goes off by
// itself: a test runs it with runAlarm(), as the runtime would, or calls coach.alarm() inside the coach when it has to
// change something while the call is out. Reviews are written straight into the tables. The room stub is replaced
// (ruling R1) by one whose isBanned reads a set. The AI is a mocked fetch of env.COACH_API_URL that gives the answers a
// test queued in `ai`, in turn, and records each request; any other fetch, or one more AI call than was queued, throws.
// After each test, every queued answer was used, nothing else was fetched and nothing was logged that the test didn't
// expect.
import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256b64u } from "../src/auth.js";
import { AGREE_VER } from "../src/coach-guide.js";
import { CALLING_STALE } from "../src/coach-rules.js";
import { apiMessage, goodReply, jpegB64 } from "./coach-fixtures.mjs";
import { DAY, HOUR, MIN, SEC, hex, newCoach } from "./helpers.mjs";

// 12:00 UTC (20:00 in Taiwan) on 3 June, years ahead. The next clean-up is at 04:00 Taiwan on 4 June.
const T = Date.UTC(2030, 5, 3, 12, 0);
const MONTH = "2030-06"; // T's Taiwan month
const CLEANUP = Date.UTC(2030, 5, 3, 20);

const FRAME = jpegB64();
const TWELVE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ---- The AI, mocked -------------------------------------------------------------------------------------------------

let ai; // the answers the AI gives, in turn: functions returning a Response (or throwing, for a network error)
let calls; // each AI call made: {method, headers, body}
let unexpected; // any other fetch, or an AI call with no answer queued
let logged; // what console.error was given
beforeEach(() => {
  ai = [];
  calls = [];
  unexpected = [];
  logged = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== env.COACH_API_URL || ai.length === 0) {
      unexpected.push(request.url);
      throw new Error(`unexpected fetch of ${request.url}`);
    }
    calls.push({ method: request.method, headers: Object.fromEntries(request.headers), body: await request.json() });
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

// An answer carrying `reply` (apiMessage), and an error answer the way Anthropic sends one.
const ok = (reply, more) => () => Response.json(apiMessage(reply, more));
const apiError = (status, type, message, headers = {}) => () =>
  new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status, headers: { "content-type": "application/json", ...headers },
  });
const fail500 = apiError(500, "api_error", "Internal server error");

// The text after the key frames in a call's request: the surfer's answers, their earlier reviews, the examples, a Redo.
const userText = (call) => call.body.messages[0].content.at(-1).text;

// ---- Coaches, accounts and reviews ----------------------------------------------------------------------------------

// A coach of its own with its clock at `at`, whose room stub answers isBanned from the set `banned`, records each LINE
// account it was asked about in `asked`, and first runs c.onAsk(coach) when a test set one.
async function freshCoach(at = T) {
  const c = await newCoach("alarm", at);
  c.banned = new Set();
  c.asked = [];
  c.onAsk = null;
  await c.inCoach((coach) => {
    coach.roomStub = () => ({
      async isBanned(sub_hash) {
        c.asked.push(sub_hash);
        await c.onAsk?.(coach);
        return c.banned.has(sub_hash);
      },
    });
  });
  return c;
}

const surfer = () => ({ uid: `u-${hex(6)}`, sub_hash: `sub-${hex(8)}`, role: "user" });

const ANSWERS = Object.freeze({
  move: "top_turn", move_other: "", level: "starting_turns", board: "shortboard", stance: "regular", note: "I fall off at the top",
});
const listed = () => TWELVE.map((n) => ({ n, ms: 11_000 + 250 * (n - 1), box: [200, 120, 360] }));

// A review written straight into the table, sent at the coach's clock and due then, with its 12 key frames up (counted
// in frame_bytes) and its count in the Taiwan month's quota, for an account that agreed. `frames: false` and
// `counted: false` leave those out, for an earlier review of the account.
async function insertReview(c, who, opts = {}) {
  const { id = hex(11), status = "queued", move = "top_turn", lang = "en", frames = true, counted = true, ...cols } = opts;
  const t = c.clock.t;
  const row = {
    id, uid: who.uid, sub_hash: who.sub_hash, lang, move, answers: JSON.stringify({ ...ANSWERS, move }), status,
    created: t - 10 * MIN, sent: t, next_try: status === "queued" ? t : null, quota_month: MONTH, ...cols,
  };
  const names = Object.keys(row);
  await c.rows(`INSERT INTO reviews (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, ...Object.values(row));
  await c.rows(
    "INSERT INTO people (sub_hash, agreed_ver, agreed_at) VALUES (?, ?, ?) ON CONFLICT (sub_hash) DO NOTHING",
    who.sub_hash, AGREE_VER, t,
  );
  if (counted) {
    await c.rows(
      `INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, 1, 1)
       ON CONFLICT (sub_hash, month) DO UPDATE SET used = used + 1, sent = sent + 1`,
      who.sub_hash, MONTH,
    );
  }
  if (frames) {
    for (const f of listed()) {
      await c.rows("INSERT INTO frames (review_id, n, ms, box, b64) VALUES (?, ?, ?, ?, ?)", id, f.n, f.ms, JSON.stringify(f.box), FRAME);
    }
    await c.inCoach((coach) => coach.setMeta("frame_bytes", (coach.getMeta("frame_bytes") ?? 0) + 12 * FRAME.length));
  }
  return id;
}

// An earlier review of the account, published `daysAgo` with `reply` as its text.
const insertPublished = (c, who, reply, { daysAgo, move = "top_turn", status = "published" } = {}) =>
  insertReview(c, who, {
    status, move, frames: false, counted: false, sent: T - daysAgo * DAY - HOUR, published: T - daysAgo * DAY,
    final: JSON.stringify(reply), next_try: null,
  });

// One of Bryan's examples, written `hoursAgo`.
const insertExample = (c, { move = "top_turn", note, hoursAgo, review_id = hex(11) }) =>
  c.rows(
    "INSERT INTO examples (move, level, draft, bryan, note, review_id, at) VALUES (?, 'starting_turns', ?, NULL, ?, ?, ?)",
    move, JSON.stringify(goodReply()), note, review_id, T - hoursAgo * HOUR,
  );

const reviewRow = async (c, id) => (await c.rows("SELECT * FROM reviews WHERE id = ?", id))[0];
const quota = async (c, who) => (await c.rows("SELECT used, sent FROM quota WHERE sub_hash = ? AND month = ?", who.sub_hash, MONTH))[0];
const frameCount = async (c, id) => (await c.rows("SELECT count(*) AS n FROM frames WHERE review_id = ?", id))[0].n;
const blocked = async (c, who) => (await c.rows("SELECT blocked FROM people WHERE sub_hash = ?", who.sub_hash))[0].blocked;
const getMeta = (c, key) => c.inCoach((coach) => coach.getMeta(key));
const setMeta = (c, key, value) => c.inCoach((coach) => coach.setMeta(key, value));
const alarmAt = (c) => c.inCoach((coach) => coach.ctx.storage.getAlarm());
const ownerView = async (c, who, id) => (await c.stub.route({ method: "GET", path: `/coach/reviews/${id}`, who, body: "" })).json;

// One alarm run, as the runtime makes it: the alarm set for the coach's now, then run.
async function runAlarm(c) {
  await c.inCoach((coach) => coach.ctx.storage.setAlarm(c.clock.t));
  expect(await runDurableObjectAlarm(c.stub)).toBe(true);
}

// ---- A good reply ---------------------------------------------------------------------------------------------------

describe("a good reply", () => {
  it("becomes a draft with its tokens, cost and model; the request is the spec's, with an opaque user id", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    ai.push(ok(goodReply()));
    await runAlarm(c);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.method).toBe("POST");
    expect(call.headers).toMatchObject({
      "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2026-10-21", "content-type": "application/json",
    });
    expect(timeout).toHaveBeenCalledWith(600_000);
    const { body } = call;
    expect(body.model).toBe(env.COACH_MODEL);
    expect(body.max_tokens).toBe(16_000);
    for (const key of ["temperature", "top_p", "top_k", "tool_choice", "stream", "fallbacks"]) expect(body, key).not.toHaveProperty(key);
    const content = body.messages[0].content;
    expect(content.filter((b) => b.type === "image")).toHaveLength(12);
    expect(content.filter((b) => b.type === "image").every((b) => b.source.data === FRAME)).toBe(true);
    expect(content[0]).toEqual({ type: "text", text: "Key frame 1 (0:11.00)" });
    expect(body.metadata.user_id).toBe(await sha256b64u("coach:" + a.sub_hash));
    expect(JSON.stringify(body)).not.toContain(a.sub_hash);
    expect(JSON.stringify(body)).not.toContain(a.uid);

    const row = await reviewRow(c, id);
    expect(row).toMatchObject({
      status: "drafted", attempts: 0, waits: 0, next_try: null, model: "coach-test-model", tok_in: 15_400, tok_out: 3_000,
      english: null, hold: 0, published: null, final: null,
    });
    // 15,400 tokens in at US$4 a million and 3,000 out at US$20.
    expect(row.cost).toBeCloseTo(0.1216, 10);
    expect(JSON.parse(row.draft)).toEqual(goodReply());
    expect(JSON.parse(row.warnings)).toEqual([]);
    expect(JSON.parse(row.flags)).toEqual([]);
    // Nothing given back, and the key frames are kept for Bryan.
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
    expect(row.given).toBe(0);
    expect(await frameCount(c, id)).toBe(12);
    // Nothing else is due, so the alarm waits for the clean-up.
    expect(await alarmAt(c)).toBe(CLEANUP);
  });

  it("in 中文, saves the English copy beside the draft", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer(), { lang: "zh" });
    ai.push(ok(goodReply(TWELVE, "zh")));
    await runAlarm(c);
    expect(userText(calls[0])).toContain("Write the review in 中文");
    const row = await reviewRow(c, id);
    expect(row.status).toBe("drafted");
    const { english, ...draft } = goodReply(TWELVE, "zh");
    expect(JSON.parse(row.draft)).toEqual(draft);
    expect(JSON.parse(row.english)).toEqual(english);
  });

  it('with "photo" in a title, is a draft with the warning "words"', async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    const reply = goodReply();
    reply.went_well.title = "Great photo";
    ai.push(ok(reply));
    await runAlarm(c);
    const row = await reviewRow(c, id);
    expect(row.status).toBe("drafted");
    expect(JSON.parse(row.warnings)).toEqual(["words"]);
  });

  it("the alarm counts itself as a request and saves the usage counts at the end of its run", async () => {
    const c = await freshCoach();
    await insertReview(c, surfer());
    const before = await c.inCoach((coach) => coach.usage("req", 0).req);
    ai.push(ok(goodReply()));
    await runAlarm(c);
    const saved = await getMeta(c, "usage");
    expect(saved.req).toBe(before + 1);
    expect(saved.at).toBe(T);
    expect(await c.inCoach((coach) => coach.unsaved)).toBe(0);
  });

  it("one review a run: the oldest sent goes first, and the alarm comes straight back for the next", async () => {
    const c = await freshCoach();
    const older = await insertReview(c, surfer(), { sent: T - 2 * MIN });
    const newer = await insertReview(c, surfer(), { sent: T - MIN });
    ai.push(ok(goodReply()));
    await runAlarm(c);
    expect(calls).toHaveLength(1);
    expect((await reviewRow(c, older)).status).toBe("drafted");
    expect((await reviewRow(c, newer)).status).toBe("queued");
    expect(await alarmAt(c)).toBe(T);
    ai.push(ok(goodReply()));
    await runAlarm(c);
    expect((await reviewRow(c, newer)).status).toBe("drafted");
    expect(await alarmAt(c)).toBe(CLEANUP);
  });
});

// ---- Attempts and waits ---------------------------------------------------------------------------------------------

describe("attempts and waits", () => {
  it("a reply failing a check, one cut off at max_tokens and a timeout each count an attempt; the third fails it, given back once", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);

    // A progress line with no earlier review of this move fails a check. Attempt 2 waits a minute.
    ai.push(ok({ ...goodReply(), progress: "Better than last time." }));
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 1, next_try: T + MIN, draft: null });
    expect(await alarmAt(c)).toBe(T + MIN);

    // Cut off at max_tokens. Attempt 3 waits 5 minutes.
    c.clock.t = T + MIN;
    ai.push(ok(goodReply(), { stop_reason: "max_tokens" }));
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 2, next_try: T + 6 * MIN });
    expect(await alarmAt(c)).toBe(T + 6 * MIN);

    // Timed out: the third attempt. It fails and its count goes back.
    c.clock.t = T + 6 * MIN;
    ai.push(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the AI call failed:", "TimeoutError"]]);
    expect(await reviewRow(c, id)).toMatchObject({ status: "failed", attempts: 3, next_try: null, given: 1 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    // Given back once only.
    expect(await c.inCoach((coach) => coach.giveBack(id))).toBe(false);
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    expect(calls).toHaveLength(3);
    expect(await alarmAt(c)).toBe(CLEANUP);
  });

  it("a 5xx, a lost connection and an answer that isn't JSON count attempts too", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    ai.push(fail500);
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 1, next_try: T + MIN });
    c.clock.t = T + MIN;
    ai.push(() => {
      throw new TypeError("Network connection lost.");
    });
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the AI call failed:", "TypeError"]]);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 2, next_try: T + 6 * MIN });
    c.clock.t = T + 6 * MIN;
    ai.push(() => new Response("<html>bad gateway</html>", { status: 200 }));
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the AI call failed:", "SyntaxError"]]);
    expect(await reviewRow(c, id)).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("callAi marks a timeout or an abort as cut off, and no other attempt", async () => {
    const c = await freshCoach();
    const thrown = (err) => () => {
      throw err;
    };
    ai.push(
      thrown(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
      thrown(new DOMException("The operation was aborted", "AbortError")),
      thrown(new TypeError("Network connection lost.")),
      () => new Response("<html>bad gateway</html>", { status: 200 }),
      fail500,
    );
    const results = await c.inCoach(async (coach) => {
      const out = [];
      for (let i = 0; i < 5; i++) out.push(await coach.callAi({ test: i }));
      return out;
    });
    const attempt = (cutOff) => ({ kind: "attempt", retryAfter: null, cutOff });
    expect(results).toEqual([attempt(true), attempt(true), attempt(false), attempt(false), attempt(false)]);
    expect(logged.splice(0).map((args) => args[1])).toEqual(["TimeoutError", "AbortError", "TypeError", "SyntaxError"]);
  });

  it("a 429 waits for its retry-after and a 529 30 minutes, with no attempt used; after 12 waits the 13th counts as one", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    ai.push(apiError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit", { "retry-after": "120" }));
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 0, waits: 1, next_try: T + 120 * SEC });
    expect(await alarmAt(c)).toBe(T + 120 * SEC);

    c.clock.t = T + 120 * SEC;
    ai.push(apiError(529, "overloaded_error", "Overloaded"));
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 0, waits: 2, next_try: T + 120 * SEC + 30 * MIN });

    // The 12th wait is still a plain wait; the 13th in a row counts as an attempt, and the waits start again.
    await c.rows("UPDATE reviews SET waits = 11 WHERE id = ?", id);
    c.clock.t = T + HOUR;
    ai.push(apiError(429, "rate_limit_error", "Rate limited", { "retry-after": "30" }));
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 0, waits: 12, next_try: T + HOUR + 30 * SEC });
    c.clock.t = T + HOUR + 30 * SEC;
    ai.push(apiError(429, "rate_limit_error", "Rate limited", { "retry-after": "30" }));
    await runAlarm(c);
    // Counted as attempt 1, it waits attempt 2's minute (the longer of that and the retry-after).
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 1, waits: 0, next_try: T + HOUR + 90 * SEC });
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
  });

  it("any other 400 fails the review at once and gives it back", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    ai.push(apiError(400, "invalid_request_error", "prompt is too long: 250000 tokens > 200000 maximum"));
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "failed", given: 1, next_try: null });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
  });

  it.each([
    ["pause", 401, "authentication_error", "invalid x-api-key"],
    ["credit", 400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."],
    ["limit", 400, "invalid_request_error", "You have reached your specified workspace API usage limits."],
  ])("a %s error puts the review back in the queue with no attempt used and nothing given back", async (_kind, status, type, message) => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    ai.push(apiError(status, type, message));
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 0, waits: 0, next_try: T, given: 0 });
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
  });
});

// ---- Calls that went astray -----------------------------------------------------------------------------------------

describe("a call that went astray", () => {
  it("a review left calling past its 16-minute mark counts an attempt and runs again; one inside its mark waits for it", async () => {
    const c = await freshCoach();
    const stale = await insertReview(c, surfer(), { status: "calling", next_try: T - SEC, sent: T - HOUR, waits: 3 });
    const fresh = await insertReview(c, surfer(), { status: "calling", next_try: T + 5 * MIN, sent: T - 2 * HOUR });
    ai.push(ok(goodReply()));
    await runAlarm(c);
    expect(calls).toHaveLength(1);
    expect(await reviewRow(c, stale)).toMatchObject({ status: "drafted", attempts: 1, waits: 0 });
    expect(await reviewRow(c, fresh)).toMatchObject({ status: "calling", attempts: 0, next_try: T + 5 * MIN });
    expect(await alarmAt(c)).toBe(T + 5 * MIN);
  });

  it("a third stale pick fails the review and gives it back once, with no call", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a, { status: "calling", next_try: T - SEC, attempts: 2 });
    await runAlarm(c);
    expect(calls).toEqual([]);
    expect(c.asked).toEqual([]);
    expect(await reviewRow(c, id)).toMatchObject({ status: "failed", attempts: 3, next_try: null, given: 1 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    expect(await c.inCoach((coach) => coach.giveBack(id))).toBe(false);
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    expect(await alarmAt(c)).toBe(CLEANUP);
  });

  it("a review being called is marked calling until its 16-minute mark", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    let during;
    await c.inCoach(async (coach) => {
      ai.push(() => {
        during = coach.sql.exec("SELECT status, next_try FROM reviews WHERE id = ?", id).one();
        return Response.json(apiMessage(goodReply()));
      });
      await coach.alarm();
    });
    expect(during).toEqual({ status: "calling", next_try: T + CALLING_STALE });
    expect((await reviewRow(c, id)).status).toBe("drafted");
  });

  it("a reply for an old redo number is dropped, and so is one for a review deleted meanwhile", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    await c.inCoach(async (coach) => {
      ai.push(() => {
        // Meanwhile the review was drafted, Bryan asked for a Redo and another run took it.
        coach.sql.exec("UPDATE reviews SET redos = 1 WHERE id = ?", id);
        return Response.json(apiMessage(goodReply()));
      });
      await coach.alarm();
    });
    expect(await reviewRow(c, id)).toMatchObject({ status: "calling", redos: 1, draft: null, tok_in: null, attempts: 0 });

    const b = surfer();
    const gone = await insertReview(c, b);
    await c.inCoach(async (coach) => {
      ai.push(() => {
        coach.sql.exec("DELETE FROM reviews WHERE id = ?", gone);
        return Response.json(apiMessage(goodReply()));
      });
      await coach.alarm();
    });
    expect(await reviewRow(c, gone)).toBeUndefined();
    expect(await quota(c, b)).toEqual({ used: 1, sent: 1 });
  });

  it("a flagged reply still blocks the account when its review was deleted or redone during the call", async () => {
    const c = await freshCoach();
    const a = surfer();
    const gone = await insertReview(c, a);
    await c.inCoach(async (coach) => {
      ai.push(() => {
        coach.sql.exec("DELETE FROM reviews WHERE id = ?", gone);
        return Response.json(apiMessage({ ...goodReply(), sexual_content: true }));
      });
      await coach.alarm();
    });
    expect(await reviewRow(c, gone)).toBeUndefined();
    expect(await blocked(c, a)).toBe(1);

    const b = surfer();
    const redone = await insertReview(c, b);
    await c.inCoach(async (coach) => {
      ai.push(() => {
        coach.sql.exec("UPDATE reviews SET redos = 1 WHERE id = ?", redone);
        return Response.json(apiMessage(null, { stop_reason: "refusal" }));
      });
      await coach.alarm();
    });
    expect(await reviewRow(c, redone)).toMatchObject({ status: "calling", redos: 1, hold: 0, flags: "[]" });
    expect(await frameCount(c, redone)).toBe(12);
    expect(await blocked(c, b)).toBe(1);
  });

  it("a review deleted, or a Pause set, while the room is asked about the account makes no call", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    c.onAsk = (coach) => coach.sql.exec("DELETE FROM reviews WHERE id = ?", id);
    await runAlarm(c);
    expect(await reviewRow(c, id)).toBeUndefined();

    const other = await insertReview(c, surfer());
    c.onAsk = (coach) => coach.setMeta("paused", true);
    await runAlarm(c);
    expect(await reviewRow(c, other)).toMatchObject({ status: "queued", attempts: 0, next_try: T });
    expect(calls).toEqual([]);
  });
});

// ---- Not-surf, flagged and banned -----------------------------------------------------------------------------------

describe("not-surf, flagged and banned (ruling R16)", () => {
  it("a not-surf reply: rejected and held for Bryan, its key frames kept, the count kept", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    ai.push(ok({ ...goodReply(), is_surf_clip: false }));
    await runAlarm(c);
    const row = await reviewRow(c, id);
    expect(row).toMatchObject({ status: "rejected", hold: 1, given: 0, next_try: null, tok_in: 15_400 });
    expect(JSON.parse(row.warnings)).toContain("not_surf");
    expect(JSON.parse(row.flags)).toEqual([]);
    expect(await frameCount(c, id)).toBe(12);
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
    expect(await blocked(c, a)).toBe(0);
    expect((await ownerView(c, a, id)).note).toBe("not_surf");
  });

  it.each([
    ["a refusal", ok(null, { stop_reason: "refusal" }), ["refusal"]],
    ["sexual content", ok({ ...goodReply(), sexual_content: true }), ["sexual"]],
    ["a surfer who looks under 18", ok({ ...goodReply(), surfer_looks_under_18: true }), ["under_18"]],
    ["a flag in a reply of the wrong shape", ok({ sexual_content: true }), ["sexual"]],
  ])("%s: rejected and held, its key frames deleted at once, the account blocked, the count kept, never retried", async (_what, answer, flags) => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    ai.push(answer);
    await runAlarm(c);
    const row = await reviewRow(c, id);
    expect(row).toMatchObject({ status: "rejected", hold: 1, given: 0, next_try: null });
    expect(JSON.parse(row.flags)).toEqual(flags);
    expect(await frameCount(c, id)).toBe(0);
    expect(await getMeta(c, "frame_bytes")).toBe(0);
    expect(await blocked(c, a)).toBe(1);
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
    expect((await ownerView(c, a, id)).note).toBe("not_surf");
    // Never sent again.
    c.clock.t = T + DAY;
    await runAlarm(c);
    expect(calls).toHaveLength(1);
  });

  it("a banned account's review is rejected with no call: its key frames go, nothing is given back", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    c.banned.add(a.sub_hash);
    await runAlarm(c);
    expect(c.asked).toEqual([a.sub_hash]);
    expect(calls).toEqual([]);
    expect(await reviewRow(c, id)).toMatchObject({ status: "rejected", hold: 0, given: 0, next_try: null });
    expect(await frameCount(c, id)).toBe(0);
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
  });
});

// ---- Redo -----------------------------------------------------------------------------------------------------------

describe("a Redo", () => {
  // A review Bryan sent back for a Redo: queued again with redos 1 and attempts 0, its old draft kept, and the examples
  // row his Redo made (Task 10).
  async function redone(c, who) {
    const old = goodReply();
    old.main_fix.title = "The old fix";
    const id = await insertReview(c, who, {
      redos: 1, draft: JSON.stringify(old), warnings: JSON.stringify(["unusable"]),
      redo_note: JSON.stringify(["Focus on the back foot"]),
    });
    await insertExample(c, { note: "The note kept as an example", hoursAgo: 0, review_id: id });
    return { id, old };
  }

  it("calls with the old draft and Bryan's note, but not this review's own example; a new draft replaces the old", async () => {
    const c = await freshCoach();
    const { id } = await redone(c, surfer());
    const reply = goodReply();
    reply.main_fix.title = "The new fix";
    ai.push(ok(reply));
    await runAlarm(c);
    const text = userText(calls[0]);
    expect(text).toContain(JSON.stringify(["Focus on the back foot"]));
    expect(text).toContain("The old fix");
    expect(text).not.toContain("The note kept as an example");
    const row = await reviewRow(c, id);
    expect(row).toMatchObject({ status: "drafted", redos: 1 });
    expect(JSON.parse(row.draft)).toEqual(reply);
    expect(JSON.parse(row.warnings)).toEqual([]);
  });

  it("on autopilot, a passing Redo result still waits for Bryan (ruling P24)", async () => {
    const c = await freshCoach();
    const { id } = await redone(c, surfer());
    await setMeta(c, "autopilot", true);
    ai.push(ok(goodReply()));
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "drafted", published: null, final: null });
  });

  it("a third stale pick of a Redo goes back to drafted with its old draft and redo_failed, with no call", async () => {
    const c = await freshCoach();
    const a = surfer();
    const { id, old } = await redone(c, a);
    await c.rows("UPDATE reviews SET status = 'calling', next_try = ?, attempts = 2 WHERE id = ?", T - SEC, id);
    await runAlarm(c);
    expect(calls).toEqual([]);
    const row = await reviewRow(c, id);
    expect(row).toMatchObject({ status: "drafted", attempts: 3, next_try: null, given: 0 });
    expect(JSON.parse(row.draft)).toEqual(old);
    expect(JSON.parse(row.warnings)).toEqual(["unusable", "redo_failed"]);
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
  });

  it("that fails 3 times goes back to drafted with its old draft and redo_failed, the count unchanged", async () => {
    const c = await freshCoach();
    const a = surfer();
    const { id, old } = await redone(c, a);
    for (const at of [T, T + MIN, T + 6 * MIN]) {
      c.clock.t = at;
      ai.push(fail500);
      await runAlarm(c);
    }
    expect(calls).toHaveLength(3);
    const row = await reviewRow(c, id);
    expect(row).toMatchObject({ status: "drafted", redos: 1, next_try: null, given: 0 });
    expect(JSON.parse(row.draft)).toEqual(old);
    expect(JSON.parse(row.warnings)).toEqual(["unusable", "redo_failed"]);
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
    expect(await alarmAt(c)).toBe(CLEANUP);
  });
});

// ---- Autopilot ------------------------------------------------------------------------------------------------------

describe("autopilot", () => {
  it("publishes a first draft that passes every check at once, with checked 0", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    await setMeta(c, "autopilot", true);
    ai.push(ok(goodReply()));
    await runAlarm(c);
    const row = await reviewRow(c, id);
    expect(row).toMatchObject({ status: "published", published: T, checked: 0 });
    expect(JSON.parse(row.final)).toEqual(goodReply());
    const view = await ownerView(c, a, id);
    expect(view.status).toBe("published");
    expect(view.review).toEqual({
      text: goodReply(), times: Object.fromEntries(listed().map((f) => [f.n, f.ms])), checked: false,
    });
  });

  it("keeps a draft with a heads-up for Bryan", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    await setMeta(c, "autopilot", true);
    ai.push(ok({ ...goodReply(), heads_up: { text: "Look where you want to go as you pop up.", move: "popup" } }));
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "drafted", published: null, final: null });
  });
});

// ---- The request's history and examples -----------------------------------------------------------------------------

describe("history and examples", () => {
  it("carries only this account's last 2 published reviews of this move, and the move's 3 newest examples", async () => {
    const c = await freshCoach();
    const a = surfer();
    const titled = (title) => {
      const reply = goodReply();
      reply.went_well.title = title;
      return reply;
    };
    await insertPublished(c, a, titled("Oldest top turn"), { daysAgo: 30 });
    await insertPublished(c, a, titled("Middle top turn"), { daysAgo: 20 });
    await insertPublished(c, a, titled("Newest top turn"), { daysAgo: 10 });
    await insertPublished(c, a, titled("A cutback"), { daysAgo: 5, move: "cutback" });
    await insertPublished(c, a, titled("A withdrawn top turn"), { daysAgo: 3, status: "rejected" });
    await insertPublished(c, surfer(), titled("Someone else's top turn"), { daysAgo: 2 });
    for (const [note, hoursAgo] of [["Example 1", 40], ["Example 2", 30], ["Example 3", 20], ["Example 4", 10]]) {
      await insertExample(c, { note, hoursAgo });
    }
    await insertExample(c, { note: "A cutback example", hoursAgo: 1, move: "cutback" });
    const id = await insertReview(c, a);
    ai.push(ok({ ...goodReply(), progress: "You stay lower than last time." }));
    await runAlarm(c);

    const text = userText(calls[0]);
    for (const seen of ["Newest top turn", "Middle top turn", "Example 2", "Example 3", "Example 4"]) expect(text).toContain(seen);
    const unseen = ["Oldest top turn", "A cutback", "A withdrawn top turn", "Someone else's top turn", "Example 1", "A cutback example"];
    for (const words of unseen) expect(text).not.toContain(words);
    expect(text.indexOf("Newest top turn")).toBeLessThan(text.indexOf("Middle top turn"));
    // With earlier reviews, a progress line passes the checks.
    expect((await reviewRow(c, id)).status).toBe("drafted");
  });
});

describe("history of an \"other\" move", () => {
  it("counts only earlier reviews of an \"other\" move the surfer named the same", async () => {
    const c = await freshCoach();
    const a = surfer();
    const other = (move_other) => JSON.stringify({ ...ANSWERS, move: "other", move_other });
    for (const [move_other, title, daysAgo] of [["duck dive", "The duck dive one", 9], ["snap", "The snap one", 8]]) {
      const reply = goodReply();
      reply.went_well.title = title;
      await insertReview(c, a, {
        move: "other", answers: other(move_other), status: "published", frames: false, counted: false,
        sent: T - daysAgo * DAY - HOUR, published: T - daysAgo * DAY, final: JSON.stringify(reply), next_try: null,
      });
    }
    const id = await insertReview(c, a, { move: "other", answers: other("snap") });
    ai.push(ok(goodReply()));
    await runAlarm(c);
    const text = userText(calls[0]);
    expect(text).toContain("The snap one");
    expect(text).not.toContain("The duck dive one");
    expect((await reviewRow(c, id)).status).toBe("drafted");
  });
});

// ---- When the alarm goes off ----------------------------------------------------------------------------------------

describe("when the alarm next goes off", () => {
  it("with meta paused and a review queued, no call: the alarm waits for the clean-up, and Pause off brings it to now", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    await setMeta(c, "paused", true);
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued" });
    expect(await alarmAt(c)).toBe(CLEANUP);
    await c.inCoach((coach) => coach.setPaused(false));
    expect(await getMeta(c, "paused")).toBe(false);
    expect(await alarmAt(c)).toBe(T);
    ai.push(ok(goodReply()));
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);
    expect((await reviewRow(c, id)).status).toBe("drafted");
  });

  it("stopped (ruling R10): no call, and Start again clears stopped and paused and brings the alarm to now", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    await setMeta(c, "stopped", true);
    await setMeta(c, "paused", true);
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(CLEANUP);
    await c.inCoach((coach) => coach.startAgain());
    expect(await getMeta(c, "stopped")).toBe(false);
    expect(await getMeta(c, "paused")).toBe(false);
    expect(await alarmAt(c)).toBe(T);
    ai.push(ok(goodReply()));
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);
    expect((await reviewRow(c, id)).status).toBe("drafted");
  });

  it("while the free-plan guard holds, no call, and the alarm comes back at 00:00 UTC, when it lifts (not while paused)", async () => {
    const NIGHT = Date.UTC(2030, 5, 3, 21); // 05:00 in Taiwan on 4 June, after that day's clean-up
    const MIDNIGHT = Date.UTC(2030, 5, 4);
    const c = await freshCoach(NIGHT);
    const id = await insertReview(c, surfer());
    await c.inCoach((coach) => {
      coach.usage("req", 0);
      coach.used.req = 8_000; // 8% of the free plan's 100,000 requests a day
    });
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued" });
    expect(await alarmAt(c)).toBe(MIDNIGHT);
    // Paused as well: Pause wakes nothing, so the alarm waits for the clean-up.
    await setMeta(c, "paused", true);
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(Date.UTC(2030, 5, 4, 20));
    await setMeta(c, "paused", false);
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(MIDNIGHT);
    // At 00:00 UTC the counts start again, and the review goes.
    c.clock.t = MIDNIGHT;
    ai.push(ok(goodReply()));
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);
    expect((await reviewRow(c, id)).status).toBe("drafted");
  });

  it("without an API key, the AI is never called", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    await c.inCoach(async (coach) => {
      const real = coach.env;
      coach.env = { ...real, ANTHROPIC_API_KEY: "" };
      await coach.alarm();
      coach.env = real;
    });
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued" });
    expect(c.asked).toEqual([]);
  });

  it("a money rest holds every call: a limit rest wakes at its end, a credit rest at its probe, and the end lets reviews go", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    await setMeta(c, "rest", { kind: "credit", until: Date.UTC(2030, 5, 16), probe_at: T + 6 * HOUR });
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(T + 6 * HOUR);
    await setMeta(c, "rest", { kind: "limit", until: T + HOUR, probe_at: null });
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued" });
    expect(await alarmAt(c)).toBe(T + HOUR);
    // At its end the rest is over and the review goes.
    c.clock.t = T + HOUR;
    ai.push(ok(goodReply()));
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);
    expect(await getMeta(c, "rest")).toBeNull();
    expect((await reviewRow(c, id)).status).toBe("drafted");
  });

  it("the money stop at US$78 refuses new reviews only: one already sent is still called", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    await setMeta(c, "spend", { start: Date.UTC(2030, 4, 16), usd: 78.5, reviews: 520 });
    ai.push(ok(goodReply()));
    await runAlarm(c);
    expect((await reviewRow(c, id)).status).toBe("drafted");
  });

  it("is the earliest of the next try, the clean-up and the hourly email, never before now", async () => {
    const c = await freshCoach();
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(CLEANUP);
    await setMeta(c, "next_cleanup", T + 3 * HOUR);
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(T + 3 * HOUR);
    await setMeta(c, "digest_due", T + 30 * MIN);
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(T + 30 * MIN);
    await insertReview(c, surfer(), { next_try: T + 10 * MIN });
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(T + 10 * MIN);
    await setMeta(c, "digest_due", T - HOUR);
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(T);
  });
});
