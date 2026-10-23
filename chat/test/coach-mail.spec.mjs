// Tests for the coach's emails to Bryan in chat/src/coach.js (docs/superpowers/specs/2026-10-22-ai-coach-design.md, "The
// email" under "What Bryan sees" and under "Backend", and "Testing"): mail(), the hourly email (ruling R9: meta digest_due
// on the alarm's list), the "stopped" and "resting" alerts, the cap of 20 a Taiwan day (ruling R8), no email key, and
// Settings' "Send a test email". They run inside the Workers runtime (see vitest.config.mjs). Run from chat/:
// npx vitest run test/coach-mail.spec.mjs
//
// As in coach-alarm.spec.mjs, each test has a coach of its own (newCoach) with its clock years ahead, so no alarm a test
// sets goes off by itself: a test runs it with runAlarm(), as the runtime would. Reviews are written straight into the
// tables, and the daily clean-up is set far off, so the alarm times a test sees are the email's. The room stub is
// replaced (ruling R1). Both the AI and Resend are mocked fetches: env.COACH_API_URL gives the answers a test queued in
// `ai`, and env.COACH_MAIL_URL those queued in `resend`, each in turn, and every email is recorded in `mails`. Any other
// fetch, or one more call than was queued, throws. After each test, every queued answer was used, nothing else was
// fetched, nothing was logged that the test didn't expect, and no email held an account id.
import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGREE_VER } from "../src/coach-guide.js";
import { twMonth } from "../src/coach-rules.js";
import { apiMessage, goodReply, jpegB64 } from "./coach-fixtures.mjs";
import { DAY, HOUR, MIN, hex, newCoach } from "./helpers.mjs";

// 12:00 UTC (20:00 in Taiwan) on 3 June, years ahead. The next Taiwan day starts 4 hours later, at 16:00 UTC.
const T = Date.UTC(2030, 5, 3, 12, 0);
const NEXT_TW_DAY = Date.UTC(2030, 5, 3, 16, 0);
const FAR = Date.UTC(2031, 0, 1); // the daily clean-up, set out of the way

const LINK = "https://waveslave.tw/?coach=drafts"; // ruling R18
const FROM = "WaveSlave Coach <onboarding@resend.dev>";
const FRAME = jpegB64();
const TWELVE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const NICK = "Surfer_9f3a"; // a chat nickname, as a surfer might type it in their own words

// ---- The AI and Resend, mocked --------------------------------------------------------------------------------------

let ai; // the AI's answers, in turn: functions returning a Response
let resend; // Resend's answers, in turn: functions returning a Response (or throwing, for a network error)
let mails; // each email sent: {method, headers, body}
let unexpected; // any other fetch, or a call with no answer queued
let logged; // what console.error was given
beforeEach(() => {
  ai = [];
  resend = [];
  mails = [];
  unexpected = [];
  logged = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === env.COACH_API_URL && ai.length > 0) return ai.shift()();
    if (request.url === env.COACH_MAIL_URL && resend.length > 0) {
      mails.push({ method: request.method, headers: Object.fromEntries(request.headers), body: await request.json() });
      return resend.shift()();
    }
    unexpected.push(request.url);
    throw new Error(`unexpected fetch of ${request.url}`);
  });
  vi.spyOn(console, "error").mockImplementation((...args) => {
    logged.push(args);
  });
});

afterEach(() => {
  expect(unexpected).toEqual([]);
  expect(ai).toEqual([]);
  expect(resend).toEqual([]);
  expect(logged).toEqual([]);
  // The account ids these tests make (surfer()): no email may hold one.
  for (const mail of mails) expect(JSON.stringify(mail.body)).not.toMatch(/sub-[0-9a-f]{16}|u-[0-9a-f]{12}/);
  vi.restoreAllMocks();
});

const ok = (reply = goodReply()) => () => Response.json(apiMessage(reply));
const apiError = (status, type, message) => () =>
  new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status, headers: { "content-type": "application/json" },
  });
const accepted = () => Response.json({ id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
// Resend's answer to a key that may only send to its own account's address.
const RESEND_403 = JSON.stringify({
  statusCode: 403,
  message: "You can only send testing emails to your own email address (waveslave050@gmail.com).",
  name: "validation_error",
});

// ---- Coaches, accounts and reviews ----------------------------------------------------------------------------------

// A coach of its own with its clock at `at` and its clean-up far off, whose room stub bans no one. `more` goes into its
// env, for a test with no email key.
async function freshCoach(at = T, more = {}) {
  const c = await newCoach("mail", at);
  await c.inCoach((coach) => {
    coach.roomStub = () => ({ isBanned: async () => false });
    coach.env = { ...coach.env, ...more };
    coach.setMeta("next_cleanup", FAR);
  });
  return c;
}

const surfer = () => ({ uid: `u-${hex(6)}`, sub_hash: `sub-${hex(8)}`, role: "user" });
const BRYAN = Object.freeze({ uid: "u-bryan", sub_hash: "sub-bryan", role: "admin" });

const ANSWERS = Object.freeze({
  move: "top_turn", move_other: "", level: "starting_turns", board: "shortboard", stance: "regular",
  note: `I'm ${NICK} and I fall off at the top`,
});

// A review written straight into the table, sent at the coach's clock and queued then, with its 12 key frames up and its
// count in the Taiwan month's quota, for an account that agreed. Any column can be set in `cols`.
async function insertReview(c, who, opts = {}) {
  const { id = hex(11), status = "queued", ...cols } = opts;
  const t = c.clock.t;
  const row = {
    id, uid: who.uid, sub_hash: who.sub_hash, lang: "en", move: "top_turn", answers: JSON.stringify(ANSWERS), status,
    created: t - 10 * MIN, sent: t, next_try: status === "queued" ? t : null, quota_month: twMonth(t), ...cols,
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
    who.sub_hash, twMonth(t),
  );
  for (const n of TWELVE) {
    await c.rows(
      "INSERT INTO frames (review_id, n, ms, box, b64) VALUES (?, ?, ?, ?, ?)",
      id, n, 11_000 + 250 * (n - 1), JSON.stringify([200, 120, 360]), FRAME,
    );
  }
  return id;
}

// A published review, for the surfer to report.
const insertPublished = (c, who) =>
  insertReview(c, who, {
    status: "published", published: c.clock.t, handled_at: c.clock.t, draft: JSON.stringify(goodReply()),
    final: JSON.stringify(goodReply()), checked: 1,
  });

// One route, as the Worker hands it over: the body as text.
const call = (c, who, method, path, body = "") =>
  c.stub.route({ method, path, who, body: typeof body === "string" ? body : JSON.stringify(body) });
const settings = (c, body) => call(c, BRYAN, "POST", "/admin/coach/settings", body);
const report = (c, who, id, line) => call(c, who, "POST", `/coach/reviews/${id}/report`, { line });
const drafts = (c) => call(c, BRYAN, "GET", "/admin/coach/drafts");

const reviewRow = async (c, id) => (await c.rows("SELECT * FROM reviews WHERE id = ?", id))[0];
const getMeta = (c, key) => c.inCoach((coach) => coach.getMeta(key));
const setMeta = (c, key, value) => c.inCoach((coach) => coach.setMeta(key, value));
const alarmAt = (c) => c.inCoach((coach) => coach.ctx.storage.getAlarm());
const alert = (c, kind) => c.inCoach((coach) => coach.alert(kind));

// One alarm run, as the runtime makes it: the alarm set for the coach's now, then run.
async function runAlarm(c) {
  await c.inCoach((coach) => coach.ctx.storage.setAlarm(c.clock.t));
  expect(await runDurableObjectAlarm(c.stub)).toBe(true);
}

// The subjects of the emails sent so far.
const subjects = () => mails.map((mail) => mail.body.subject);

// ---- The hourly email -----------------------------------------------------------------------------------------------

describe("the hourly email", () => {
  it("two drafts 10 minutes apart: one email at the first, and the second in the next one, an hour later", async () => {
    const c = await freshCoach();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const a = await insertReview(c, surfer());
    ai.push(ok());
    resend.push(accepted);
    await runAlarm(c);
    expect((await reviewRow(c, a)).status).toBe("drafted");
    // Sent in the run that wrote the draft, as Resend asks: the key, a User-Agent (a Worker's fetch sends none) and JSON.
    expect(mails).toHaveLength(1);
    expect(mails[0].method).toBe("POST");
    expect(mails[0].headers).toMatchObject({
      authorization: `Bearer ${env.RESEND_API_KEY}`, "user-agent": "waveslave-coach/1", "content-type": "application/json",
    });
    expect(Object.keys(mails[0].body).sort()).toEqual(["from", "subject", "text", "to"]);
    expect(mails[0].body).toMatchObject({
      from: FROM, to: [env.COACH_ALERT_TO], subject: "WaveSlave Coach: 1 draft waiting (oldest under 1 h)",
    });
    expect(mails[0].body.text).toContain(LINK);
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(await getMeta(c, "last_digest")).toBe(T);
    expect(await getMeta(c, "digest_due")).toBeNull();
    expect(await alarmAt(c)).toBe(FAR);

    // Ten minutes later, a second draft: its email waits for the hour.
    c.clock.t = T + 10 * MIN;
    const b = await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    expect((await reviewRow(c, b)).status).toBe("drafted");
    expect(mails).toHaveLength(1);
    expect(await getMeta(c, "digest_due")).toBe(T + HOUR);
    expect(await alarmAt(c)).toBe(T + HOUR);

    // The hour: one email for both, and the alarm moves on.
    c.clock.t = T + HOUR;
    resend.push(accepted);
    await runAlarm(c);
    expect(subjects()).toEqual([
      "WaveSlave Coach: 1 draft waiting (oldest under 1 h)", "WaveSlave Coach: 2 drafts waiting (oldest 1 h)",
    ]);
    expect(mails[1].body.text).toContain(LINK);
    expect(await getMeta(c, "last_digest")).toBe(T + HOUR);
    expect(await getMeta(c, "digest_due")).toBeNull();
    expect(await alarmAt(c)).toBe(FAR);
  });

  it("a failure and a report bring it too: failed since the last one, the reported and held among those waiting", async () => {
    const c = await freshCoach();
    const a = surfer();
    // A review on its last attempt whose call fails for good: failed and given back, in the email at once.
    const failing = await insertReview(c, a, { attempts: 2 });
    ai.push(apiError(400, "invalid_request_error", "prompt is too long"));
    resend.push(accepted);
    await runAlarm(c);
    expect((await reviewRow(c, failing)).status).toBe("failed");
    expect(subjects()).toEqual(["WaveSlave Coach: 1 review failed"]);
    expect(mails[0].body.text).toMatch(/Failed since the last email: 1\b/);

    // 20 minutes on, the surfer reports a published review: the email waits for the hour after the last.
    c.clock.t = T + 20 * MIN;
    const b = surfer();
    const reported = await insertPublished(c, b);
    expect(await report(c, b, reported, `This isn't me, I'm ${NICK}`)).toEqual({ status: 200, json: { ok: true } });
    expect(await getMeta(c, "digest_due")).toBe(T + HOUR);
    expect(await alarmAt(c)).toBe(T + HOUR);
    // A clip held as not surf meanwhile, sent 3 hours before, which Bryan has to act on too (ruling R16).
    c.clock.t = T - 2 * HOUR;
    await insertReview(c, surfer(), { status: "rejected", hold: 1, handled_at: T, warnings: JSON.stringify(["not_surf"]) });

    c.clock.t = T + HOUR;
    resend.push(accepted);
    await runAlarm(c);
    expect(subjects()[1]).toBe("WaveSlave Coach: 2 drafts waiting (oldest 3 h)");
    const { text } = mails[1].body;
    expect(text).toMatch(/Reported by the surfer: 1\b/);
    expect(text).toMatch(/Held as not surf or flagged: 1\b/);
    // The failure went in the last one.
    expect(text).not.toMatch(/Failed/);
    expect(text).toContain(LINK);

    // A report more than an hour after the last email brings one at once.
    c.clock.t = T + 3 * HOUR;
    const again = await insertPublished(c, b);
    expect((await report(c, b, again, "")).status).toBe(200);
    expect(await getMeta(c, "digest_due")).toBe(T + 3 * HOUR);
    expect(await alarmAt(c)).toBe(T + 3 * HOUR);
    resend.push(accepted);
    await runAlarm(c);
    expect(subjects()[2]).toBe("WaveSlave Coach: 3 drafts waiting (oldest 5 h)");
    expect(mails[2].body.text).toMatch(/Reported by the surfer: 2\b/);
  });

  it("counts a reported review's wait from its report (ruling P46): one sent 20 days ago and reported now waits briefly", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    // a's review was sent and published 20 days ago; b's draft came 3 hours ago.
    const old = await insertReview(c, a, {
      status: "published", sent: T - 20 * DAY, published: T - 20 * DAY + HOUR, handled_at: T - 20 * DAY + HOUR,
      next_try: null, draft: JSON.stringify(goodReply()), final: JSON.stringify(goodReply()), checked: 1,
    });
    const draft = await insertReview(c, b, { status: "drafted", sent: T - 3 * HOUR, waiting_since: T - 3 * HOUR, next_try: null });
    expect((await report(c, a, old, "That isn't me")).status).toBe(200);
    c.clock.t = T + 30 * MIN;
    // In the Drafts list the report waits half an hour, after the draft that has waited three and a half.
    const { waiting } = (await drafts(c)).json;
    expect(waiting.map((r) => [r.id, r.waited_ms])).toEqual([[draft, 3 * HOUR + 30 * MIN], [old, 30 * MIN]]);
    // The email the report brought names the draft's wait as the oldest, not 480 h.
    resend.push(accepted);
    await runAlarm(c);
    expect(subjects()).toEqual(["WaveSlave Coach: 2 drafts waiting (oldest 3 h)"]);
    expect(mails[0].body.text).toMatch(/the oldest waiting 3 h\./);
    expect(mails[0].body.text).toMatch(/Reported by the surfer: 1\b/);
  });

  it("a flagged clip and a failed Redo bring it, as Bryan has them to act on", async () => {
    const c = await freshCoach();
    const flagged = await insertReview(c, surfer());
    ai.push(ok({ ...goodReply(), sexual_content: true }));
    resend.push(accepted);
    await runAlarm(c);
    expect(await reviewRow(c, flagged)).toMatchObject({ status: "rejected", hold: 1 });
    expect(subjects()).toEqual(["WaveSlave Coach: 1 draft waiting (oldest under 1 h)"]);
    expect(mails[0].body.text).toMatch(/Held as not surf or flagged: 1\b/);

    c.clock.t = T + 2 * HOUR;
    const redo = await insertReview(c, surfer(), { redos: 1, attempts: 2, draft: JSON.stringify(goodReply()) });
    ai.push(apiError(400, "invalid_request_error", "prompt is too long"));
    resend.push(accepted);
    await runAlarm(c);
    expect((await reviewRow(c, redo)).status).toBe("drafted");
    expect(subjects()[1]).toBe("WaveSlave Coach: 2 drafts waiting (oldest 2 h)");
  });

  it("with nothing waiting and nothing failed by then, none goes, and the last one stays the last", async () => {
    const c = await freshCoach();
    await setMeta(c, "last_digest", T - 30 * MIN);
    const id = await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    expect(await getMeta(c, "digest_due")).toBe(T + 30 * MIN);
    c.clock.t = T + 10 * MIN;
    expect((await call(c, BRYAN, "POST", `/admin/coach/drafts/${id}`, { action: "approve" })).status).toBe(200);
    c.clock.t = T + 30 * MIN;
    await runAlarm(c);
    expect(mails).toEqual([]);
    expect(await getMeta(c, "digest_due")).toBeNull();
    expect(await getMeta(c, "last_digest")).toBe(T - 30 * MIN);
    expect(await alarmAt(c)).toBe(FAR);
  });

  it("a send that fails isn't tried again in a loop: the time moves on, and a fetch that throws logs only its name", async () => {
    const c = await freshCoach();
    await insertReview(c, surfer());
    ai.push(ok());
    resend.push(() => new Response('{"statusCode":500,"message":"Internal","name":"internal_server_error"}', { status: 500 }));
    await runAlarm(c);
    expect(mails).toHaveLength(1);
    // A refusal is logged by a fixed line: never its status or what Resend said.
    expect(logged.splice(0)).toEqual([["coach: the email was refused"]]);
    expect(await getMeta(c, "digest_due")).toBeNull();
    expect(await getMeta(c, "last_digest")).toBe(T);
    expect(await alarmAt(c)).toBe(FAR);

    c.clock.t = T + 2 * HOUR;
    await insertReview(c, surfer());
    ai.push(ok());
    resend.push(() => {
      throw new TypeError("Network connection lost.");
    });
    await runAlarm(c);
    expect(mails).toHaveLength(2);
    expect(logged.splice(0)).toEqual([["coach: the email failed:", "TypeError"]]);
    expect(await getMeta(c, "digest_due")).toBeNull();
    expect(await getMeta(c, "last_digest")).toBe(T + 2 * HOUR);
    expect(await alarmAt(c)).toBe(FAR);
  });

  // 300 handled reviews written straight into the table, each `status(k)`, handled at `handledAt(k)`.
  const insertHandled = (c, who, status, handledAt) =>
    c.inCoach((coach) => {
      for (let k = 0; k < 300; k++) {
        coach.sql.exec(
          `INSERT INTO reviews (id, uid, sub_hash, lang, move, answers, status, created, sent, handled_at)
           VALUES (?, ?, ?, 'en', 'top_turn', ?, ?, ?, ?, ?)`,
          hex(11), who.uid, who.sub_hash, JSON.stringify(ANSWERS), status(k), T - 40 * DAY, T - 40 * DAY, handledAt(k),
        );
      }
    });

  // The hourly email, due at T and sent then, with each statement's rows read while the coach drew it.
  async function digestReads(c) {
    await setMeta(c, "digest_due", T);
    resend.push(accepted);
    const reads = await c.inCoach(async (coach) => {
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
        await coach.digest(T);
      } finally {
        coach.sql = real;
      }
      return seen.map(({ query, cursor }) => ({ query, read: cursor.rowsRead }));
    });
    // The two waiting queries (the Drafts list's) and the failed count were all made.
    for (const asks of [/status = 'drafted'/, /reviews_held/, /status = 'failed'/]) {
      expect(reads.some(({ query }) => asks.test(query)), String(asks)).toBe(true);
    }
    return reads;
  }

  it("reads through its indexes, never every review kept for 24 months", async () => {
    const c = await freshCoach();
    const a = surfer();
    // 300 reviews handled before the last email: published, rejected and failed.
    await insertHandled(c, a, (k) => ["published", "rejected", "failed"][k % 3], (k) => T - 2 * DAY + k);
    await setMeta(c, "last_digest", T - DAY);
    await insertReview(c, a, { status: "drafted" });
    await insertReview(c, a, { status: "drafted" });
    const reads = await digestReads(c);
    expect(subjects()).toEqual(["WaveSlave Coach: 2 drafts waiting (oldest under 1 h)"]);
    expect(mails[0].body.text).not.toMatch(/Failed/);
    for (const { query, read } of reads) expect(read, query).toBeLessThan(50);
  });

  it("looks back 7 days at most for failures, however old the last email is (ruling P43)", async () => {
    const c = await freshCoach();
    const a = surfer();
    // The last email a month ago; since then, autopilot published 300 reviews 20 to 8 days ago, which bring no email,
    // and one review failed 8 days ago (its email went missing, say). One failed 2 days ago.
    await setMeta(c, "last_digest", T - 30 * DAY);
    await insertHandled(c, a, () => "published", (k) => T - 20 * DAY + k * HOUR);
    await insertReview(c, a, { status: "failed", next_try: null, handled_at: T - 8 * DAY });
    await insertReview(c, a, { status: "failed", next_try: null, handled_at: T - 2 * DAY });
    const reads = await digestReads(c);
    expect(subjects()).toEqual(["WaveSlave Coach: 1 review failed"]);
    expect(mails[0].body.text).toMatch(/Failed since the last email: 1\b/);
    for (const { query, read } of reads) expect(read, query).toBeLessThan(50);
  });
});

// ---- What an email holds --------------------------------------------------------------------------------------------

describe("every email", () => {
  it("holds no sub_hash, uid, nickname, surfer's words, review id or base64: counts, times and the link only", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    const ids = [
      await insertReview(c, a, { status: "drafted", draft: JSON.stringify(goodReply()) }),
      await insertReview(c, b, { status: "rejected", hold: 1, handled_at: T, flags: JSON.stringify(["sexual"]) }),
    ];
    c.clock.t = T + MIN;
    const published = await insertPublished(c, b);
    ids.push(published);
    expect((await report(c, b, published, `Not me. I'm ${NICK}`)).status).toBe(200);
    // A failure, in the run that sends it all.
    c.clock.t = T + 2 * MIN;
    const failing = await insertReview(c, a, { attempts: 2 });
    ids.push(failing);
    ai.push(apiError(400, "invalid_request_error", "prompt is too long"));
    resend.push(accepted, accepted, accepted, accepted);
    await runAlarm(c);
    await alert(c, "stopped");
    await alert(c, "resting");
    expect((await settings(c, { test_email: true })).json.email.status).toBe(200);
    // Waiting: the draft, the flagged clip and the reported review.
    expect(subjects()).toEqual([
      "WaveSlave Coach: 3 drafts waiting (oldest under 1 h)", "WaveSlave Coach: Coach stopped",
      "WaveSlave Coach: Coach resting", "WaveSlave Coach: test email",
    ]);
    expect(mails[0].body.text).toMatch(/Failed since the last email: 1\b/);
    for (const { body } of mails) {
      const all = JSON.stringify(body);
      for (const secret of [a.sub_hash, a.uid, b.sub_hash, b.uid, NICK, "fall off", "Not me", ...ids, env.RESEND_API_KEY]) {
        expect(all, secret).not.toContain(secret);
      }
      expect(all).not.toContain(FRAME.slice(0, 40));
      expect(all).not.toMatch(/[A-Za-z0-9+/_-]{40,}/);
      expect(body.text).toContain(LINK);
    }
  });
});

// ---- The alerts -----------------------------------------------------------------------------------------------------

describe("the stopped and resting alerts", () => {
  it("go at once, each once a Taiwan day, and again the next day", async () => {
    const c = await freshCoach();
    resend.push(accepted, accepted);
    await alert(c, "stopped");
    await alert(c, "stopped");
    await alert(c, "resting");
    await alert(c, "resting");
    expect(subjects()).toEqual(["WaveSlave Coach: Coach stopped", "WaveSlave Coach: Coach resting"]);
    expect(mails[0].body.text).toContain("Start again");
    c.clock.t = NEXT_TW_DAY - 1;
    await alert(c, "stopped");
    expect(mails).toHaveLength(2);
    c.clock.t = NEXT_TW_DAY;
    resend.push(accepted);
    await alert(c, "stopped");
    expect(subjects()[2]).toBe("WaveSlave Coach: Coach stopped");
  });

  it("are sent by the alarm's own paths: a key error stops the coach, and a second one that day sends nothing", async () => {
    const c = await freshCoach();
    await insertReview(c, surfer());
    ai.push(apiError(401, "authentication_error", "invalid x-api-key"));
    resend.push(accepted);
    await runAlarm(c);
    expect(await getMeta(c, "stopped")).toBe(true);
    expect(subjects()).toEqual(["WaveSlave Coach: Coach stopped"]);
    expect((await settings(c, { start_again: true })).status).toBe(200);
    c.clock.t = T + HOUR;
    ai.push(apiError(401, "authentication_error", "invalid x-api-key"));
    await runAlarm(c);
    expect(await getMeta(c, "stopped")).toBe(true);
    expect(mails).toHaveLength(1);
  });

  it("a money rest says when it ends, in Taiwan time", async () => {
    const c = await freshCoach();
    await insertReview(c, surfer());
    ai.push(apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."));
    resend.push(accepted);
    await runAlarm(c);
    expect(subjects()).toEqual(["WaveSlave Coach: Coach resting"]);
    // The next credit day: 08:00 Taiwan on 16 June.
    expect(mails[0].body.text).toContain("2030-06-16 08:00");
  });

  it("never throw: a fetch that throws, or anything else that fails, is logged by its name only", async () => {
    const c = await freshCoach();
    resend.push(() => {
      throw new TypeError("Network connection lost.");
    });
    expect(await alert(c, "stopped")).toBeUndefined();
    expect(logged.splice(0)).toEqual([["coach: the email failed:", "TypeError"]]);
    await c.inCoach((coach) => {
      coach.mailDay = () => {
        throw new RangeError("no storage");
      };
    });
    expect(await alert(c, "resting")).toBeUndefined();
    expect(logged.splice(0)).toEqual([["coach: the alert failed:", "RangeError"]]);
    expect(mails).toHaveLength(1);
  });
});

// ---- At most 20 a day -----------------------------------------------------------------------------------------------

describe("at most 20 emails a Taiwan day", () => {
  it("the 21st isn't sent, the test email counting; a digest due then goes when the day turns", async () => {
    const c = await freshCoach();
    // A report just before: its email is due now.
    const b = surfer();
    const reported = await insertPublished(c, b);
    expect((await report(c, b, reported, "")).status).toBe(200);
    expect(await getMeta(c, "digest_due")).toBe(T);
    for (let k = 0; k < 20; k++) resend.push(accepted);
    for (let k = 0; k < 20; k++) {
      expect((await settings(c, { test_email: true })).json.email.status).toBe(200);
    }
    expect(mails).toHaveLength(20);
    expect(await settings(c, { test_email: true })).toEqual({
      status: 200, json: { ok: true, email: { status: 0, text: "daily limit" } },
    });
    await alert(c, "stopped");
    // The alarm runs with a draft: the email due now waits for the next Taiwan day, carrying what happened since the
    // last one.
    await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    expect(mails).toHaveLength(20);
    expect(await getMeta(c, "digest_due")).toBe(NEXT_TW_DAY);
    expect(await alarmAt(c)).toBe(NEXT_TW_DAY);
    // More that day doesn't bring it back to now, which would only wake the alarm to put it off again.
    c.clock.t = T + 10 * MIN;
    await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    const again = await insertPublished(c, b);
    expect((await report(c, b, again, "")).status).toBe(200);
    expect(await getMeta(c, "digest_due")).toBe(NEXT_TW_DAY);
    expect(await alarmAt(c)).toBe(NEXT_TW_DAY);

    c.clock.t = NEXT_TW_DAY;
    resend.push(accepted);
    await runAlarm(c);
    expect(subjects()[20]).toBe("WaveSlave Coach: 4 drafts waiting (oldest 4 h)");
    expect(await getMeta(c, "digest_due")).toBeNull();
    expect(await alarmAt(c)).toBe(FAR);
  });

  it("a report on a capped day sets the email for the next day, so the alarm isn't woken for nothing", async () => {
    const c = await freshCoach();
    await setMeta(c, "mail_day", { day: "2030-06-03", n: 20, alerts: [] });
    const b = surfer();
    const reported = await insertPublished(c, b);
    expect((await report(c, b, reported, "")).status).toBe(200);
    expect(await getMeta(c, "digest_due")).toBe(NEXT_TW_DAY);
    expect(await alarmAt(c)).toBe(NEXT_TW_DAY);
  });
});

// ---- No email key ---------------------------------------------------------------------------------------------------

describe("with no email key", () => {
  it.each([["unset", undefined], ["empty", ""], ["blank", " \n"]])("(%s) nothing is fetched, and drafts still work", async (_, key) => {
    const c = await freshCoach(T, { RESEND_API_KEY: key });
    const id = await insertReview(c, surfer());
    ai.push(ok());
    await runAlarm(c);
    expect((await reviewRow(c, id)).status).toBe("drafted");
    expect((await drafts(c)).json.waiting.map((r) => r.id)).toEqual([id]);
    // The email's time moved on, so the alarm doesn't come back for it.
    expect(await getMeta(c, "digest_due")).toBeNull();
    expect(await alarmAt(c)).toBe(FAR);
    await alert(c, "stopped");
    await alert(c, "resting");
    expect(await settings(c, { test_email: true })).toEqual({
      status: 200, json: { ok: true, email: { status: 0, text: "no key" } },
    });
    expect(await c.inCoach((coach) => coach.mail("A subject", "A text"))).toEqual({ status: 0, text: "no key" });
    expect(mails).toEqual([]);
  });
});

// ---- Send a test email ----------------------------------------------------------------------------------------------

describe("Send a test email", () => {
  it("answers with Resend's answer as it came: a 403's text, or the id of one sent", async () => {
    const c = await freshCoach();
    resend.push(() => new Response(RESEND_403, { status: 403, headers: { "content-type": "application/json" } }));
    expect(await settings(c, { test_email: true })).toEqual({
      status: 200, json: { ok: true, email: { status: 403, text: RESEND_403 } },
    });
    expect(logged.splice(0)).toEqual([["coach: the email was refused"]]);
    expect(mails[0].body).toMatchObject({ from: FROM, to: [env.COACH_ALERT_TO], subject: "WaveSlave Coach: test email" });
    // A long answer, a gateway's error page say, is cut at 2,000 characters for Settings.
    const page = "<html>" + "x".repeat(3_000) + "</html>";
    resend.push(() => new Response(page, { status: 502, headers: { "content-type": "text/html" } }));
    expect((await settings(c, { test_email: true })).json.email).toEqual({ status: 502, text: page.slice(0, 2_000) });
    expect(logged.splice(0)).toEqual([["coach: the email was refused"]]);
    resend.push(accepted);
    const { json } = await settings(c, { autopilot: true, test_email: true });
    expect(json).toEqual({ ok: true, email: { status: 200, text: '{"id":"4ef9a417-02e9-4d39-ad75-9611e0fcc33c"}' } });
    expect(await getMeta(c, "autopilot")).toBe(true);
    // Without test_email, nothing is sent and there is no email in the answer.
    expect(await settings(c, { autopilot: false, test_email: false })).toEqual({ status: 200, json: { ok: true } });
    expect(mails).toHaveLength(3);
  });
});
