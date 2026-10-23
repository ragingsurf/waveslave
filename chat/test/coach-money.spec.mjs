// Tests for the coach's money limits in chat/src/coach.js (docs/superpowers/specs/2026-10-22-ai-coach-design.md, "Money",
// "Backend" steps 3 and 7, "When something goes wrong" and "Testing", and the plan's Review Focus 5): the credit month's
// spend, the stop at US$78 and the hard stop at US$80 (each + COACH_EXTRA_USD), what a call costs the month, the money
// rests and the stop that Anthropic's errors start, a credit rest's probe, the calls a cut-off run left on their way, and
// a call that never went out (ruling P31). They run inside the Workers runtime (see vitest.config.mjs). Run from chat/:
// npx vitest run test/coach-money.spec.mjs
//
// As in coach-alarm.spec.mjs, each test has a coach of its own (newCoach) with its clock years ahead, so no alarm a test
// sets goes off by itself: a test runs it with runAlarm(), as the runtime would. Reviews are written straight into the
// tables. The room stub is replaced (ruling R1), and so is the coach's alert(), by one that records each alert in
// `alerts`. The AI is a mocked fetch of env.COACH_API_URL that gives the answers a test queued in `ai`, in turn; any other
// fetch, or one more AI call than was queued, throws. The daily clean-up is set far off, so the alarm times a test sees
// are the money's. After each test, every queued answer was used, nothing else was fetched and nothing was logged that
// the test didn't expect.
import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGREE_VER } from "../src/coach-guide.js";
import { estimateIn, twMonth, worstUsd } from "../src/coach-rules.js";
import { apiMessage, goodReply, jpegB64 } from "./coach-fixtures.mjs";
import { DAY, HOUR, MIN, SEC, hex, newCoach } from "./helpers.mjs";

// 12:00 UTC (20:00 in Taiwan) on 3 June, years ahead. The credit month it is in started at 08:00 Taiwan on 16 May, and
// the next starts at 08:00 Taiwan on 16 June.
const T = Date.UTC(2030, 5, 3, 12, 0);
const CREDIT_START = Date.UTC(2030, 4, 16);
const NEXT_CREDIT = Date.UTC(2030, 5, 16);
const JULY_1 = Date.UTC(2030, 6, 1); // 08:00 in Taiwan on 1 July: the next UTC month
const FAR = Date.UTC(2031, 0, 1); // the daily clean-up, set out of the way

const PRICES = Object.freeze({ in: 4, out: 20 }); // wrangler.toml's COACH_PRICE_IN and COACH_PRICE_OUT
const GOOD_USD = 0.1216; // apiMessage()'s 15,400 tokens in and 3,000 out at those prices
const FRAME = jpegB64();
const TWELVE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ---- The AI, mocked -------------------------------------------------------------------------------------------------

let ai; // the answers the AI gives, in turn: functions returning a Response (or throwing, for a network error)
let calls; // each AI call made: {body}
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
    calls.push({ body: await request.json() });
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

const ok = (reply = goodReply(), more) => () => Response.json(apiMessage(reply, more));
const apiError = (status, type, message) => () =>
  new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status, headers: { "content-type": "application/json" },
  });
const fail500 = apiError(500, "api_error", "Internal server error");
const creditLow = apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.");
const timedOut = () => {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
};

// The tokens a call's request sends, as the coach reckons them (estimateIn), and what the call could have cost at worst:
// the whole request, and every one of the 16,000 tokens max_tokens allows.
function estFor(call) {
  const content = call.body.messages[0].content;
  const text = [call.body.system, ...content.map((block) => block.text ?? "")].join("");
  return estimateIn(content.filter((block) => block.type === "image").length, text.length);
}
const worstFor = (call) => worstUsd(estFor(call), 16_000, PRICES);

// ---- Coaches, accounts and reviews ----------------------------------------------------------------------------------

// A coach of its own with its clock at `at` and its clean-up far off, whose room stub answers isBanned (first running
// c.onAsk(), when a test set one), and whose alert() records each alert in c.alerts.
async function freshCoach(at = T) {
  const c = await newCoach("money", at);
  c.alerts = [];
  c.onAsk = null;
  await c.inCoach((coach) => {
    coach.roomStub = () => ({
      async isBanned() {
        await c.onAsk?.(coach);
        return false;
      },
    });
    coach.alert = async (kind) => {
      c.alerts.push(kind);
    };
    coach.setMeta("next_cleanup", FAR);
  });
  return c;
}

const surfer = () => ({ uid: `u-${hex(6)}`, sub_hash: `sub-${hex(8)}`, role: "user" });

const ANSWERS = Object.freeze({
  move: "top_turn", move_other: "", level: "starting_turns", board: "shortboard", stance: "regular", note: "I fall off at the top",
});
const listed = () => TWELVE.map((n) => ({ n, ms: 11_000 + 250 * (n - 1), box: [200, 120, 360] }));

// A review written straight into the table, sent at the coach's clock and due then, with its 12 key frames up and its
// count in the Taiwan month's quota, for an account that agreed.
async function insertReview(c, who, opts = {}) {
  const { id = hex(11), status = "queued", ...cols } = opts;
  const t = c.clock.t;
  const month = twMonth(t);
  const row = {
    id, uid: who.uid, sub_hash: who.sub_hash, lang: "en", move: "top_turn", answers: JSON.stringify(ANSWERS), status,
    created: t - 10 * MIN, sent: t, next_try: status === "queued" ? t : null, quota_month: month, ...cols,
  };
  const names = Object.keys(row);
  await c.rows(`INSERT INTO reviews (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, ...Object.values(row));
  await c.rows(
    "INSERT INTO people (sub_hash, agreed_ver, agreed_at) VALUES (?, ?, ?) ON CONFLICT (sub_hash) DO NOTHING",
    who.sub_hash, AGREE_VER, t,
  );
  await c.rows(
    `INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, 1, 1)
     ON CONFLICT (sub_hash, month) DO UPDATE SET used = used + 1, sent = sent + 1`,
    who.sub_hash, month,
  );
  for (const f of listed()) {
    await c.rows("INSERT INTO frames (review_id, n, ms, box, b64) VALUES (?, ?, ?, ?, ?)", id, f.n, f.ms, JSON.stringify(f.box), FRAME);
  }
  return id;
}

const reviewRow = async (c, id) => (await c.rows("SELECT * FROM reviews WHERE id = ?", id))[0];
const quota = async (c, who, month = twMonth(c.clock.t)) =>
  (await c.rows("SELECT used, sent FROM quota WHERE sub_hash = ? AND month = ?", who.sub_hash, month))[0];
const getMeta = (c, key) => c.inCoach((coach) => coach.getMeta(key));
const setMeta = (c, key, value) => c.inCoach((coach) => coach.setMeta(key, value));
const setEnv = (c, more) => c.inCoach((coach) => {
  coach.env = { ...coach.env, ...more };
});
const alarmAt = (c) => c.inCoach((coach) => coach.ctx.storage.getAlarm());
const giveBackAgain = (c, id) => c.inCoach((coach) => coach.giveBack(id));

// The month's spend, with its US$ checked to within a millionth of a cent and left out of the rest.
async function expectSpend(c, { usd, ...rest }) {
  const spend = await getMeta(c, "spend");
  expect(spend).toMatchObject(rest);
  expect(spend.usd).toBeCloseTo(usd, 8);
}

// One alarm run, as the runtime makes it: the alarm set for the coach's now, then run.
async function runAlarm(c) {
  await c.inCoach((coach) => coach.ctx.storage.setAlarm(c.clock.t));
  expect(await runDurableObjectAlarm(c.stub)).toBe(true);
}

// The surfer's routes, as the Worker hands them over.
const route = (c, who, method, path, body = "") =>
  c.stub.route({ method, path, who, body: typeof body === "string" ? body : JSON.stringify(body) });
const agree = (c, who) => route(c, who, "POST", "/coach/agree", { ver: AGREE_VER, adult: true });
const start = (c, who) =>
  route(c, who, "POST", "/coach/reviews", { lang: "en", ...ANSWERS, frames: listed() });
const me = (c, who) => route(c, who, "GET", "/coach/me");
const money = (until) => ({ status: 503, json: { error: "money", until } });

// A new account that agreed, ready to start a review.
async function agreed(c) {
  const who = surfer();
  await agree(c, who);
  return who;
}

// ---- The money stop at US$78 ----------------------------------------------------------------------------------------

describe("the money stop at US$78 + extra", () => {
  it("refuses new reviews and Redo at US$78.00, until the next 16th; just under, a start goes through", async () => {
    const c = await freshCoach();
    const a = await agreed(c);
    await setMeta(c, "spend", { start: CREDIT_START, usd: 78, reviews: 520 });
    expect(await start(c, a)).toEqual(money(NEXT_CREDIT));
    expect((await me(c, a)).json.stop).toEqual({ kind: "money", until: NEXT_CREDIT });
    // A Redo asks stopFor() as a start does.
    expect(await c.inCoach((coach) => coach.stopFor(T))).toEqual({ kind: "money", until: NEXT_CREDIT });
    await setMeta(c, "spend", { start: CREDIT_START, usd: 77.99, reviews: 520 });
    expect((await start(c, a)).status).toBe(200);
  });

  it("the call whose cost reaches US$78 alerts once: the reviews already sent are still called, new ones are refused", async () => {
    const c = await freshCoach();
    await setMeta(c, "spend", { start: CREDIT_START, usd: 77.95, reviews: 519 });
    const first = await insertReview(c, surfer(), { sent: T - 2 * MIN });
    const second = await insertReview(c, surfer(), { sent: T - MIN });
    ai.push(ok());
    await runAlarm(c);
    await expectSpend(c, { start: CREDIT_START, usd: 77.95 + GOOD_USD, reviews: 520 });
    expect(c.alerts).toEqual(["resting"]);
    ai.push(ok());
    await runAlarm(c);
    expect(c.alerts).toEqual(["resting"]);
    expect((await reviewRow(c, first)).status).toBe("drafted");
    expect((await reviewRow(c, second)).status).toBe("drafted");
    expect(await start(c, await agreed(c))).toEqual(money(NEXT_CREDIT));
  });

  it("when a limit rest holds as well, a start is told the later of the two ends", async () => {
    const JUNE_20 = Date.UTC(2030, 5, 20, 12); // in the credit month that ends at 08:00 Taiwan on 16 July
    const c = await freshCoach(JUNE_20);
    const a = await agreed(c);
    await setMeta(c, "rest", { kind: "limit", until: JULY_1, probe_at: null });
    await setMeta(c, "spend", { start: NEXT_CREDIT, usd: 78, reviews: 520 });
    expect(await start(c, a)).toEqual(money(Date.UTC(2030, 6, 16)));
    await setMeta(c, "spend", { start: NEXT_CREDIT, usd: 70, reviews: 500 });
    expect(await start(c, a)).toEqual(money(JULY_1));
  });
});

// ---- The hard stop at US$80 -----------------------------------------------------------------------------------------

describe("the hard stop at US$80 + extra", () => {
  it("makes no AI call: the review waiting stays queued with no attempt used, and the alarm comes back when the credit month ends", async () => {
    const c = await freshCoach();
    await setMeta(c, "spend", { start: CREDIT_START, usd: 80, reviews: 530 });
    const id = await insertReview(c, surfer());
    await runAlarm(c);
    expect(calls).toEqual([]);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 0, waits: 0 });
    expect(await alarmAt(c)).toBe(NEXT_CREDIT);
    // At 08:00 Taiwan on the 16th the spend starts again, and the review goes.
    c.clock.t = NEXT_CREDIT;
    ai.push(ok());
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);
    expect((await reviewRow(c, id)).status).toBe("drafted");
    await expectSpend(c, { start: NEXT_CREDIT, usd: GOOD_USD, reviews: 1 });
  });

  it("the call that reaches it is saved; every other review waiting goes back to queued and waits, given back once", async () => {
    const c = await freshCoach();
    const [a, b, d] = [surfer(), surfer(), surfer()];
    await setMeta(c, "spend", { start: CREDIT_START, usd: 79.95, reviews: 529 });
    const first = await insertReview(c, a, { sent: T - 3 * MIN });
    const second = await insertReview(c, b, { sent: T - 2 * MIN, attempts: 1, next_try: T - MIN });
    // Left calling by a run that was cut off before its call went out.
    const third = await insertReview(c, d, { status: "calling", sent: T - MIN, next_try: T + 10 * MIN });
    ai.push(ok());
    await runAlarm(c);
    expect(calls).toHaveLength(1);
    await expectSpend(c, { start: CREDIT_START, usd: 79.95 + GOOD_USD, reviews: 530 });
    expect(await reviewRow(c, first)).toMatchObject({ status: "drafted", given: 0 });
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
    expect(await reviewRow(c, second)).toMatchObject({ status: "queued", attempts: 1, next_try: T - MIN, given: 1 });
    expect(await quota(c, b)).toEqual({ used: 0, sent: 1 });
    expect(await reviewRow(c, third)).toMatchObject({ status: "queued", attempts: 0, next_try: T + 10 * MIN, given: 1 });
    expect(await quota(c, d)).toEqual({ used: 0, sent: 1 });
    expect(c.alerts).toEqual(["resting"]);
    expect(await alarmAt(c)).toBe(NEXT_CREDIT);
    expect(await start(c, await agreed(c))).toEqual(money(NEXT_CREDIT));

    // Nothing more is called this credit month, and nothing is given back twice.
    c.clock.t = T + HOUR;
    await runAlarm(c);
    expect(calls).toHaveLength(1);
    expect(await giveBackAgain(c, second)).toBe(false);
    expect(await quota(c, b)).toEqual({ used: 0, sent: 1 });
    expect(c.alerts).toEqual(["resting"]);

    // On the 16th they go, their cost counted in the new credit month.
    c.clock.t = NEXT_CREDIT;
    ai.push(ok(), ok());
    await runAlarm(c);
    await runAlarm(c);
    expect((await reviewRow(c, second)).status).toBe("drafted");
    expect((await reviewRow(c, third)).status).toBe("drafted");
    await expectSpend(c, { start: NEXT_CREDIT, usd: 2 * GOOD_USD, reviews: 2 });
    expect(await quota(c, b, "2030-06")).toEqual({ used: 0, sent: 1 });
  });

  it("a timeout that reaches it counts its attempt first, then waits like the rest", async () => {
    const c = await freshCoach();
    const a = surfer();
    await setMeta(c, "spend", { start: CREDIT_START, usd: 79.7, reviews: 529 });
    const id = await insertReview(c, a);
    ai.push(timedOut);
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the AI call failed:", "TimeoutError"]]);
    await expectSpend(c, { start: CREDIT_START, usd: 79.7 + worstFor(calls[0]), reviews: 529 });
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 1, next_try: T + MIN, given: 1 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    expect(c.alerts).toEqual(["resting"]);
  });

  it("a lost call that reaches it holds the review it was for: no call, no attempt used, given back, one alert", async () => {
    const c = await freshCoach();
    const a = surfer();
    await setMeta(c, "spend", { start: CREDIT_START, usd: 79.7, reviews: 529 });
    const id = await insertReview(c, a, { status: "calling", next_try: T - SEC, attempts: 1 });
    await setMeta(c, "calls_out", { [id]: { redos: 0, est_in: 15_000, at: T - 17 * MIN } });
    await runAlarm(c);
    expect(calls).toEqual([]);
    await expectSpend(c, { start: CREDIT_START, usd: 79.7 + worstUsd(15_000, 16_000, PRICES), reviews: 529 });
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 1, next_try: T - SEC, given: 1 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    expect(c.alerts).toEqual(["resting"]);
    expect(await alarmAt(c)).toBe(NEXT_CREDIT);
  });

  it("raising COACH_EXTRA_USD after it lets the reviews it held go at the next alarm run, not at the next credit month", async () => {
    const c = await freshCoach();
    await setMeta(c, "spend", { start: CREDIT_START, usd: 79.95, reviews: 529 });
    await insertReview(c, surfer(), { sent: T - 2 * MIN });
    const held = await insertReview(c, surfer(), { sent: T - MIN });
    ai.push(ok());
    await runAlarm(c);
    expect(await reviewRow(c, held)).toMatchObject({ status: "queued", attempts: 0, next_try: T, given: 1 });
    c.clock.t = T + HOUR;
    await runAlarm(c);
    expect(calls).toHaveLength(1);
    // Bryan adds credit and raises the extra budget, which the coach reads afresh on its next run.
    await setEnv(c, { COACH_EXTRA_USD: "20" });
    c.clock.t = T + 2 * HOUR;
    ai.push(ok());
    await runAlarm(c);
    expect((await reviewRow(c, held)).status).toBe("drafted");
    await expectSpend(c, { start: CREDIT_START, usd: 79.95 + 2 * GOOD_USD, reviews: 531 });
  });

  it("holds a waiting Redo without giving it back: the surfer still gets the review (ruling P38)", async () => {
    const c = await freshCoach();
    const [a, b] = [surfer(), surfer()];
    await setMeta(c, "spend", { start: CREDIT_START, usd: 79.95, reviews: 529 });
    await insertReview(c, a, { sent: T - 3 * MIN });
    const first = await insertReview(c, a, { sent: T - 2 * MIN });
    const redo = await insertReview(c, b, { sent: T - MIN, redos: 1 });
    ai.push(ok());
    await runAlarm(c);
    expect(await reviewRow(c, first)).toMatchObject({ status: "queued", given: 1 });
    expect(await reviewRow(c, redo)).toMatchObject({ status: "queued", redos: 1, given: 0 });
    expect(await quota(c, a)).toEqual({ used: 1, sent: 2 });
    expect(await quota(c, b)).toEqual({ used: 1, sent: 1 });
  });

  it("COACH_EXTRA_USD = \"10\" raises both lines by 10", async () => {
    const c = await freshCoach();
    await setEnv(c, { COACH_EXTRA_USD: "10" });
    const a = await agreed(c);
    // At US$80 a start still goes through, and a review sent is called.
    await setMeta(c, "spend", { start: CREDIT_START, usd: 80, reviews: 530 });
    expect((await start(c, a)).status).toBe(200);
    const sent = await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    expect((await reviewRow(c, sent)).status).toBe("drafted");
    expect(c.alerts).toEqual([]);
    // At US$88 new reviews are refused, and a review sent is still called.
    await setMeta(c, "spend", { start: CREDIT_START, usd: 88, reviews: 531 });
    expect(await start(c, a)).toEqual(money(NEXT_CREDIT));
    const late = await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    expect((await reviewRow(c, late)).status).toBe("drafted");
    // At US$90 nothing is called.
    await setMeta(c, "spend", { start: CREDIT_START, usd: 90, reviews: 532 });
    const held = await insertReview(c, surfer());
    await runAlarm(c);
    expect(calls).toHaveLength(2);
    expect((await reviewRow(c, held)).status).toBe("queued");
  });
});

// ---- The credit month -----------------------------------------------------------------------------------------------

describe("the credit month", () => {
  it("starts at 08:00 Taiwan on the 16th: a call a moment before counts in the old month, one at Date.UTC(2030, 10, 16) starts the spend again", async () => {
    const NOV_16 = Date.UTC(2030, 10, 16);
    const c = await freshCoach(NOV_16 - SEC);
    await setMeta(c, "spend", { start: Date.UTC(2030, 9, 16), usd: 50, reviews: 300 });
    await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    await expectSpend(c, { start: Date.UTC(2030, 9, 16), usd: 50 + GOOD_USD, reviews: 301 });
    c.clock.t = NOV_16;
    await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    await expectSpend(c, { start: NOV_16, usd: GOOD_USD, reviews: 1 });
  });

  it("in a month without the credit day, starts on the month's last day", async () => {
    const NOV_30 = Date.UTC(2030, 10, 30);
    const c = await freshCoach(NOV_30 - SEC);
    await setEnv(c, { COACH_CREDIT_DAY: "31" });
    await setMeta(c, "spend", { start: Date.UTC(2030, 9, 31), usd: 5, reviews: 30 });
    await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    await expectSpend(c, { start: Date.UTC(2030, 9, 31), usd: 5 + GOOD_USD, reviews: 31 });
    c.clock.t = NOV_30;
    await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    await expectSpend(c, { start: NOV_30, usd: GOOD_USD, reviews: 1 });
  });
});

// ---- What a call costs the month ------------------------------------------------------------------------------------

describe("what a call costs the month", () => {
  it("a call that timed out counts at its worst case, about US$0.38: the whole request and all of max_tokens", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    ai.push(timedOut);
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the AI call failed:", "TimeoutError"]]);
    const worst = worstFor(calls[0]);
    expect(worst).toBeCloseTo(0.38, 1);
    expect(await getMeta(c, "spend")).toEqual({ start: CREDIT_START, usd: worst, reviews: 0 });
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 1, cost: null });
  });

  it("a reply cut off at max_tokens counts at its worst case, a good reply at its token counts, an error answer nothing", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    ai.push(ok(goodReply(), { stop_reason: "max_tokens", usage: { input_tokens: 15_400, output_tokens: 16_000 } }));
    await runAlarm(c);
    const worst = worstFor(calls[0]);
    await expectSpend(c, { start: CREDIT_START, usd: worst, reviews: 1 });
    // A 500, then a 429: no cost.
    c.clock.t = T + MIN;
    ai.push(fail500);
    await runAlarm(c);
    c.clock.t = T + 6 * MIN;
    ai.push(apiError(429, "rate_limit_error", "Rate limited"));
    await runAlarm(c);
    await expectSpend(c, { start: CREDIT_START, usd: worst, reviews: 1 });
    c.clock.t = T + 36 * MIN;
    ai.push(ok());
    await runAlarm(c);
    await expectSpend(c, { start: CREDIT_START, usd: worst + GOOD_USD, reviews: 2 });
    expect(await reviewRow(c, id)).toMatchObject({ status: "drafted", attempts: 2, cost: GOOD_USD });
  });

  it("a reply for a review deleted, or redone, during the call saves nothing but still costs the month", async () => {
    const c = await freshCoach();
    const gone = await insertReview(c, surfer());
    await c.inCoach(async (coach) => {
      ai.push(() => {
        coach.sql.exec("DELETE FROM reviews WHERE id = ?", gone);
        return Response.json(apiMessage(goodReply()));
      });
      await coach.alarm();
    });
    expect(await reviewRow(c, gone)).toBeUndefined();
    await expectSpend(c, { start: CREDIT_START, usd: GOOD_USD, reviews: 1 });

    const redone = await insertReview(c, surfer());
    await c.inCoach(async (coach) => {
      ai.push(() => {
        coach.sql.exec("UPDATE reviews SET redos = 1 WHERE id = ?", redone);
        return Response.json(apiMessage(goodReply()));
      });
      await coach.alarm();
    });
    expect(await reviewRow(c, redone)).toMatchObject({ status: "calling", redos: 1, tok_in: null, cost: null });
    await expectSpend(c, { start: CREDIT_START, usd: 2 * GOOD_USD, reviews: 2 });
  });

  it("spend.reviews counts each answer the AI wrote, a Redo's included, and no call that gave none (ruling P36)", async () => {
    const c = await freshCoach();
    const redo = await insertReview(c, surfer(), {
      redos: 1, draft: JSON.stringify(goodReply()), redo_note: JSON.stringify(["Focus on the back foot"]),
    });
    ai.push(ok());
    await runAlarm(c);
    expect((await reviewRow(c, redo)).status).toBe("drafted");
    await expectSpend(c, { start: CREDIT_START, usd: GOOD_USD, reviews: 1 });
    // A 500 and a timeout write no answer: the timeout costs its worst case, and neither counts.
    await insertReview(c, surfer());
    ai.push(fail500);
    await runAlarm(c);
    c.clock.t = T + MIN;
    ai.push(timedOut);
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the AI call failed:", "TimeoutError"]]);
    await expectSpend(c, { start: CREDIT_START, usd: GOOD_USD + worstFor(calls[2]), reviews: 1 });
    // The third try is answered: one more.
    c.clock.t = T + 6 * MIN;
    ai.push(ok());
    await runAlarm(c);
    await expectSpend(c, { start: CREDIT_START, usd: 2 * GOOD_USD + worstFor(calls[2]), reviews: 2 });
  });

  it("errors start no spending at all, and the money rests' errors none either", async () => {
    const c = await freshCoach();
    await insertReview(c, surfer());
    ai.push(apiError(400, "invalid_request_error", "prompt is too long"));
    await runAlarm(c);
    await insertReview(c, surfer());
    ai.push(creditLow);
    await runAlarm(c);
    expect(await getMeta(c, "spend")).toBeNull();
  });
});

// ---- Calls a cut-off run left, and calls that never went out (rulings P31, P35 and P37) -----------------------------

describe("a call cut off midway, and one that never went out (rulings P31, P35 and P37)", () => {
  it("a call is marked as on its way from just before its fetch until it comes back", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    let during;
    await c.inCoach(async (coach) => {
      ai.push(() => {
        during = coach.getMeta("calls_out");
        return Response.json(apiMessage(goodReply()));
      });
      await coach.alarm();
    });
    expect(during).toEqual({ [id]: { redos: 0, est_in: estFor(calls[0]), at: T } });
    expect(await getMeta(c, "calls_out")).toEqual({});
  });

  it("a review left calling with its call marked is paid at its worst case once when it is picked up again; one never called costs nothing", async () => {
    const c = await freshCoach();
    // Cut off during its call (a deploy): left calling past its 16-minute mark, its call still marked.
    const cut = await insertReview(c, surfer(), { status: "calling", next_try: T - SEC, sent: T - HOUR });
    await setMeta(c, "calls_out", { [cut]: { redos: 0, est_in: 15_000, at: T - 15 * MIN } });
    // Cut off before its call went out: left calling with nothing marked.
    const early = await insertReview(c, surfer(), { status: "calling", next_try: T - SEC, sent: T - 30 * MIN });
    const lost = worstUsd(15_000, 16_000, PRICES);
    ai.push(ok());
    await runAlarm(c);
    expect(await reviewRow(c, cut)).toMatchObject({ status: "drafted", attempts: 1 });
    await expectSpend(c, { start: CREDIT_START, usd: lost + GOOD_USD, reviews: 1 });
    expect(await getMeta(c, "calls_out")).toEqual({});
    // The next run takes the other again (an attempt, like any review left calling) and pays only its own call.
    ai.push(ok());
    await runAlarm(c);
    expect(await reviewRow(c, early)).toMatchObject({ status: "drafted", attempts: 1 });
    await expectSpend(c, { start: CREDIT_START, usd: lost + 2 * GOOD_USD, reviews: 2 });
  });

  it("at its last attempt it is given up on with no call, and its lost call is still paid", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a, { status: "calling", next_try: T - SEC, attempts: 2 });
    await setMeta(c, "calls_out", { [id]: { redos: 0, est_in: 15_000, at: T - 17 * MIN } });
    await runAlarm(c);
    expect(calls).toEqual([]);
    expect(await reviewRow(c, id)).toMatchObject({ status: "failed", attempts: 3, given: 1 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    await expectSpend(c, { start: CREDIT_START, usd: worstUsd(15_000, 16_000, PRICES), reviews: 0 });
  });

  it("a mark whose review is gone is paid once it is 16 minutes old (before that it may still be on its way), and never twice", async () => {
    const c = await freshCoach();
    await setMeta(c, "calls_out", { [hex(11)]: { redos: 0, est_in: 15_000, at: T - 15 * MIN } });
    await runAlarm(c);
    expect(await getMeta(c, "spend")).toBeNull();
    c.clock.t = T + MIN;
    await runAlarm(c);
    const lost = worstUsd(15_000, 16_000, PRICES);
    await expectSpend(c, { start: CREDIT_START, usd: lost, reviews: 0 });
    expect(await getMeta(c, "calls_out")).toEqual({});
    c.clock.t = T + 20 * MIN;
    await runAlarm(c);
    await expectSpend(c, { start: CREDIT_START, usd: lost, reviews: 0 });
  });

  it("a lost connection or an answer that isn't JSON may have run, so each counts at its worst case (ruling P37)", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    ai.push(() => {
      throw new TypeError("Network connection lost.");
    });
    await runAlarm(c);
    const worst = worstFor(calls[0]);
    await expectSpend(c, { start: CREDIT_START, usd: worst, reviews: 0 });
    c.clock.t = T + MIN;
    ai.push(() => new Response("<html>bad gateway</html>", { status: 200 }));
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the AI call failed:", "TypeError"], ["coach: the AI call failed:", "SyntaxError"]]);
    await expectSpend(c, { start: CREDIT_START, usd: 2 * worst, reviews: 0 });
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 2 });
  });

  it("a mark its review's earlier call left is paid at its worst case before the next call replaces it (ruling P37)", async () => {
    const c = await freshCoach();
    // The hard stop put this review back in the queue while its cut-off call, 5 minutes ago, was still marked.
    const id = await insertReview(c, surfer());
    await setMeta(c, "calls_out", { [id]: { redos: 0, est_in: 15_000, at: T - 5 * MIN } });
    let during;
    await c.inCoach(async (coach) => {
      ai.push(() => {
        during = coach.getMeta("calls_out");
        return Response.json(apiMessage(goodReply()));
      });
      await coach.alarm();
    });
    expect(during).toEqual({ [id]: { redos: 0, est_in: estFor(calls[0]), at: T } });
    await expectSpend(c, { start: CREDIT_START, usd: worstUsd(15_000, 16_000, PRICES) + GOOD_USD, reviews: 1 });
    expect(await getMeta(c, "calls_out")).toEqual({});
    expect((await reviewRow(c, id)).status).toBe("drafted");
  });

  it("when paying that mark reaches the hard stop, the call doesn't go out: the review is held and given back", async () => {
    const c = await freshCoach();
    const a = surfer();
    await setMeta(c, "spend", { start: CREDIT_START, usd: 79.7, reviews: 529 });
    const id = await insertReview(c, a);
    await setMeta(c, "calls_out", { [id]: { redos: 0, est_in: 15_000, at: T - 5 * MIN } });
    await runAlarm(c);
    expect(calls).toEqual([]);
    await expectSpend(c, { start: CREDIT_START, usd: 79.7 + worstUsd(15_000, 16_000, PRICES), reviews: 529 });
    expect(await getMeta(c, "calls_out")).toEqual({});
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 0, given: 1 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    expect(c.alerts).toEqual(["resting"]);
    expect(await alarmAt(c)).toBe(NEXT_CREDIT);
  });

  it("a call whose mark lostCalls() took, and paid at its worst case, isn't paid again when it comes back (ruling P37)", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    await c.inCoach(async (coach) => {
      ai.push(async () => {
        // It takes so long that a run meanwhile counts it lost.
        c.clock.t = T + 17 * MIN;
        await coach.lostCalls(c.clock.t);
        return Response.json(apiMessage(goodReply()));
      });
      await coach.alarm();
    });
    await expectSpend(c, { start: CREDIT_START, usd: worstFor(calls[0]), reviews: 1 });
    expect((await reviewRow(c, id)).status).toBe("drafted");
    expect(await getMeta(c, "calls_out")).toEqual({});
  });

  it("a failed ban check puts the review back with no attempt used and nothing paid, waiting twice as long after each failure in a row (ruling P35)", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    c.onAsk = () => {
      throw new Error("the room is down");
    };
    // A minute, then 2, then 4...
    let at = T;
    for (const wait of [MIN, 2 * MIN, 4 * MIN]) {
      c.clock.t = at;
      await runAlarm(c);
      at += wait;
      expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 0, next_try: at });
      expect(await alarmAt(c)).toBe(at);
    }
    expect(logged.splice(0)).toEqual(Array(3).fill(["coach: the room's ban check failed:", "Error"]));
    expect(await getMeta(c, "ban_fails")).toBe(3);
    // ...and 30 minutes at most.
    await setMeta(c, "ban_fails", 9);
    c.clock.t = at;
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the room's ban check failed:", "Error"]]);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 0, next_try: at + 30 * MIN });
    expect(calls).toEqual([]);
    expect(await getMeta(c, "spend")).toBeNull();
    expect(await getMeta(c, "calls_out")).toBeNull();
    // A run that gets past the ban check starts the count again, and the review goes, still on its first attempt.
    c.onAsk = null;
    c.clock.t = at + 30 * MIN;
    ai.push(ok());
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "drafted", attempts: 0 });
    expect(await getMeta(c, "ban_fails")).toBe(0);
  });

  it("a request that can't be built counts an attempt, so the third fails it and gives it back once (ruling P35)", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a, { answers: "{" });
    await runAlarm(c);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 1, next_try: T + MIN });
    for (const at of [T + MIN, T + 6 * MIN]) {
      c.clock.t = at;
      await runAlarm(c);
    }
    expect(logged.splice(0)).toEqual(Array(3).fill(["coach: the request couldn't be built:", "SyntaxError"]));
    expect(calls).toEqual([]);
    expect(await reviewRow(c, id)).toMatchObject({ status: "failed", attempts: 3, next_try: null, given: 1 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    expect(await giveBackAgain(c, id)).toBe(false);
    expect(await getMeta(c, "spend")).toBeNull();
  });

  it("a Redo whose request can't be built goes back to drafted with redo_failed at its last attempt, its count kept", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a, { answers: "{", redos: 1, attempts: 2, draft: JSON.stringify(goodReply()) });
    await runAlarm(c);
    expect(logged.splice(0)).toEqual([["coach: the request couldn't be built:", "SyntaxError"]]);
    const row = await reviewRow(c, id);
    expect(row).toMatchObject({ status: "drafted", redos: 1, attempts: 3, next_try: null, given: 0 });
    expect(JSON.parse(row.warnings)).toEqual(["redo_failed"]);
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
  });
});

// ---- Anthropic's errors ---------------------------------------------------------------------------------------------

describe("each of Anthropic's money and key errors goes its own way", () => {
  it.each([
    [401, "authentication_error", "invalid x-api-key"],
    [403, "permission_error", "Your API key does not have permission to use the specified resource."],
    [404, "not_found_error", "The model was not found."],
  ])("a %i %s stops the coach: meta stopped, the review queued with no attempt used and nothing given back, one alert", async (status, type, message) => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    ai.push(apiError(status, type, message));
    await runAlarm(c);
    expect(await getMeta(c, "stopped")).toBe(true);
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", attempts: 0, waits: 0, next_try: T, given: 0 });
    expect(await quota(c, a)).toEqual({ used: 1, sent: 1 });
    expect(c.alerts).toEqual(["stopped"]);
    expect(await getMeta(c, "rest")).toBeNull();
    // Nothing more is called, and nothing wakes for the review, until Bryan's Start again.
    expect(await alarmAt(c)).toBe(FAR);
    c.clock.t = T + HOUR;
    await runAlarm(c);
    expect(calls).toHaveLength(1);
    expect(c.alerts).toEqual(["stopped"]);
    expect(await start(c, await agreed(c))).toEqual({ status: 503, json: { error: "break" } });
    await c.inCoach((coach) => coach.startAgain());
    ai.push(ok());
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);
    expect((await reviewRow(c, id)).status).toBe("drafted");
  });

  it.each([
    ["a billing_error", apiError(400, "billing_error", "There is a problem with your billing.")],
    ["a credit balance too low", creditLow],
  ])("%s starts a credit rest until the next credit day: the reviews waiting are given back, one is tried every 6 hours, and an answer ends it", async (_what, answer) => {
    const c = await freshCoach();
    const [a, b] = [surfer(), surfer()];
    const first = await insertReview(c, a, { sent: T - 2 * MIN });
    const second = await insertReview(c, b, { sent: T - MIN });
    ai.push(answer);
    await runAlarm(c);
    expect(await getMeta(c, "rest")).toEqual({ kind: "credit", until: NEXT_CREDIT, probe_at: T + 6 * HOUR });
    expect(await reviewRow(c, first)).toMatchObject({ status: "queued", attempts: 0, next_try: T, given: 1 });
    expect(await reviewRow(c, second)).toMatchObject({ status: "queued", attempts: 0, given: 1 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    expect(await quota(c, b)).toEqual({ used: 0, sent: 1 });
    expect(c.alerts).toEqual(["resting"]);
    expect(await alarmAt(c)).toBe(T + 6 * HOUR);
    // Meanwhile a start is told when the rest ends.
    expect(await start(c, await agreed(c))).toEqual(money(NEXT_CREDIT));
    // Nothing is called before the probe.
    c.clock.t = T + HOUR;
    await runAlarm(c);
    expect(calls).toHaveLength(1);

    // The first probe: one review, and the credit is still low. The rest goes on, with no new alert or give back.
    c.clock.t = T + 6 * HOUR;
    ai.push(creditLow);
    await runAlarm(c);
    expect(calls).toHaveLength(2);
    expect(await getMeta(c, "rest")).toEqual({ kind: "credit", until: NEXT_CREDIT, probe_at: T + 12 * HOUR });
    expect(await reviewRow(c, first)).toMatchObject({ status: "queued", attempts: 0, given: 1 });
    expect(c.alerts).toEqual(["resting"]);
    expect(await alarmAt(c)).toBe(T + 12 * HOUR);

    // The next probe is answered: the rest is over, and the other review goes at once.
    c.clock.t = T + 12 * HOUR;
    ai.push(ok());
    await runAlarm(c);
    expect(await getMeta(c, "rest")).toBeNull();
    expect((await reviewRow(c, first)).status).toBe("drafted");
    expect(await alarmAt(c)).toBe(T + 12 * HOUR);
    ai.push(ok());
    await runAlarm(c);
    expect((await reviewRow(c, second)).status).toBe("drafted");
    expect(await quota(c, a, "2030-06")).toEqual({ used: 0, sent: 1 });
    expect(c.alerts).toEqual(["resting"]);
  });

  it.each([
    ["a workspace usage limit", apiError(400, "invalid_request_error", "You have reached your specified workspace API usage limits.")],
    ["an enforced spend limit", apiError(429, "rate_limit_error", "enforced_spend_limit_reached")],
  ])("%s starts a rest until 08:00 Taiwan on the 1st, with no probe: the reviews waiting are given back", async (_what, answer) => {
    const c = await freshCoach();
    const [a, b] = [surfer(), surfer()];
    const first = await insertReview(c, a, { sent: T - 2 * MIN });
    const second = await insertReview(c, b, { sent: T - MIN });
    ai.push(answer);
    await runAlarm(c);
    expect(await getMeta(c, "rest")).toEqual({ kind: "limit", until: JULY_1, probe_at: null });
    expect(await reviewRow(c, first)).toMatchObject({ status: "queued", attempts: 0, waits: 0, given: 1 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    expect(await quota(c, b)).toEqual({ used: 0, sent: 1 });
    expect(c.alerts).toEqual(["resting"]);
    expect(await alarmAt(c)).toBe(JULY_1);
    expect(await start(c, await agreed(c))).toEqual(money(JULY_1));
    // No probe: nothing is called until it ends.
    c.clock.t = T + 7 * HOUR;
    await runAlarm(c);
    expect(calls).toHaveLength(1);
    // At 08:00 Taiwan on 1 July it is over, and the reviews go.
    c.clock.t = JULY_1;
    ai.push(ok());
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);
    expect(await getMeta(c, "rest")).toBeNull();
    expect((await reviewRow(c, first)).status).toBe("drafted");
    expect((await reviewRow(c, second)).status).toBe("queued");
  });

  it.each([
    ["credit", creditLow],
    ["limit", apiError(400, "invalid_request_error", "You have reached your specified workspace API usage limits.")],
  ])("a %s rest gives back only the first reviews waiting: a Redo keeps its count (ruling P38)", async (kind, answer) => {
    const c = await freshCoach();
    const [a, b] = [surfer(), surfer()];
    const first = await insertReview(c, a, { sent: T - 2 * MIN });
    const redo = await insertReview(c, b, { sent: T - MIN, redos: 1 });
    ai.push(answer);
    await runAlarm(c);
    expect((await getMeta(c, "rest")).kind).toBe(kind);
    expect(await reviewRow(c, first)).toMatchObject({ status: "queued", given: 1 });
    expect(await reviewRow(c, redo)).toMatchObject({ status: "queued", redos: 1, given: 0 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });
    expect(await quota(c, b)).toEqual({ used: 1, sent: 1 });
  });

  it("during a credit rest a start gets money with the rest's end, and a start just after the end goes through", async () => {
    const c = await freshCoach();
    const a = await agreed(c);
    await setMeta(c, "rest", { kind: "credit", until: NEXT_CREDIT, probe_at: T + 6 * HOUR });
    expect(await start(c, a)).toEqual(money(NEXT_CREDIT));
    expect((await me(c, a)).json.stop).toEqual({ kind: "money", until: NEXT_CREDIT });
    // The rest is over at its end, before any alarm run clears it.
    c.clock.t = NEXT_CREDIT;
    expect(await getMeta(c, "rest")).not.toBeNull();
    expect((await me(c, a)).json.stop).toBeNull();
    expect((await start(c, a)).status).toBe(200);
  });

  it("a credit rest's probe moves on in the run it wakes, even when Pause holds the call", async () => {
    const c = await freshCoach();
    await insertReview(c, surfer());
    await setMeta(c, "rest", { kind: "credit", until: NEXT_CREDIT, probe_at: T });
    await setMeta(c, "paused", true);
    await runAlarm(c);
    expect(calls).toEqual([]);
    expect(await getMeta(c, "rest")).toEqual({ kind: "credit", until: NEXT_CREDIT, probe_at: T + 6 * HOUR });
    expect(await alarmAt(c)).toBe(T + 6 * HOUR);
  });
});

// ---- Review Focus 5 -------------------------------------------------------------------------------------------------

describe("the credit month turns over while reviews wait on a credit rest (Review Focus 5)", () => {
  it("at 08:00 Taiwan on the 16th the waiting reviews run, their cost counts in the new month, and no count goes back twice", async () => {
    const NOV_10 = Date.UTC(2030, 10, 10, 12); // 20:00 in Taiwan on 10 November
    const NOV_16 = Date.UTC(2030, 10, 16); // 08:00 in Taiwan on 16 November: the next credit day
    const NOVEMBER = "2030-11";
    const c = await freshCoach(NOV_10);
    await setMeta(c, "spend", { start: Date.UTC(2030, 9, 16), usd: 61.5, reviews: 410 });
    const [a, b] = [surfer(), surfer()];
    // b had a review counted earlier in November too, so a second give back would show.
    await c.rows("INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, 1, 1)", b.sub_hash, NOVEMBER);
    const failing = await insertReview(c, b, { sent: NOV_10 - 2 * MIN });
    const passing = await insertReview(c, a, { sent: NOV_10 - MIN });
    expect(await quota(c, b)).toEqual({ used: 2, sent: 2 });

    // The credit runs out: a credit rest until the 16th, and both reviews are given back.
    ai.push(creditLow);
    await runAlarm(c);
    expect(await getMeta(c, "rest")).toEqual({ kind: "credit", until: NOV_16, probe_at: NOV_10 + 6 * HOUR });
    expect(await quota(c, b)).toEqual({ used: 1, sent: 2 });
    expect(await quota(c, a)).toEqual({ used: 0, sent: 1 });

    // The probes find no credit; the last before the 16th sets the next for the rest's end.
    for (const at of [NOV_10 + 6 * HOUR, Date.UTC(2030, 10, 15, 18)]) {
      c.clock.t = at;
      ai.push(creditLow);
      await runAlarm(c);
    }
    expect(await alarmAt(c)).toBe(NOV_16);
    expect(c.alerts).toEqual(["resting"]);
    expect(await quota(c, b, NOVEMBER)).toEqual({ used: 1, sent: 2 });

    // At 08:00 Taiwan on the 16th the rest is over and the reviews run: b's fails three times, a's is drafted.
    c.clock.t = NOV_16;
    ai.push(fail500);
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);
    expect(await getMeta(c, "rest")).toBeNull();
    expect(await reviewRow(c, failing)).toMatchObject({ status: "queued", attempts: 1 });
    ai.push(ok());
    await runAlarm(c);
    expect((await reviewRow(c, passing)).status).toBe("drafted");
    for (const at of [NOV_16 + MIN, NOV_16 + 6 * MIN]) {
      c.clock.t = at;
      ai.push(fail500);
      await runAlarm(c);
    }
    expect(await reviewRow(c, failing)).toMatchObject({ status: "failed", attempts: 3, given: 1 });

    // Their cost is the new credit month's; the old month's spend is left behind.
    await expectSpend(c, { start: NOV_16, usd: GOOD_USD, reviews: 1 });
    // Given back at the rest and not again when it failed: one lower, not two.
    expect(await quota(c, b, NOVEMBER)).toEqual({ used: 1, sent: 2 });
    expect(await quota(c, a, NOVEMBER)).toEqual({ used: 0, sent: 1 });
    expect(c.alerts).toEqual(["resting"]);
  });
});

// ---- When the alarm next goes off -----------------------------------------------------------------------------------

describe("when the alarm next goes off (ruling P31)", () => {
  it("while the free-plan guard holds, it comes back at the later of 00:00 UTC and the waiting review's next try", async () => {
    const NIGHT = Date.UTC(2030, 5, 3, 21); // 05:00 in Taiwan on 4 June
    const MIDNIGHT = Date.UTC(2030, 5, 4);
    const c = await freshCoach(NIGHT);
    const id = await insertReview(c, surfer(), { next_try: MIDNIGHT + 2 * HOUR });
    await c.inCoach((coach) => {
      coach.usage("req", 0);
      coach.used.req = 8_000; // 8% of the free plan's 100,000 requests a day
    });
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(MIDNIGHT + 2 * HOUR);
    await c.rows("UPDATE reviews SET next_try = ? WHERE id = ?", NIGHT - HOUR, id);
    await runAlarm(c);
    expect(await alarmAt(c)).toBe(MIDNIGHT);
    expect(calls).toEqual([]);
  });
});
