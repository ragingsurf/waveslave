// The coach: the chat Worker's second Durable Object, one of a kind, found by name (COACH_NAME in stubs.js). It holds
// the AI surf coach's clip reviews and makes its AI calls. The design is in
// docs/superpowers/specs/2026-10-22-ai-coach-design.md, "Backend". It is a class of its own, not part of the room,
// because the room counts every request against the budget that rests the chat, its one alarm is taken by the chat's
// own jobs, and its request bodies are capped at 4 KB. All the coach's data lives in its SQLite storage.
//
//   migrate()                  creates the tables, or brings an older coach's up to date, before anything else
//   all, one                   every query, with its rows read and written counted in usage()
//   getMeta, setMeta           the meta table, whose values are JSON (the keys are listed above SCHEMA_V1)
//   config()                   the coach's [vars] from wrangler.toml as numbers, with the spec's for a bad one
//   usage(kind, n)             approximate daily counts of coach requests and SQL rows, for the free-plan guard
//   stopFor(now)               why no new review may start or send now: a break, money, or nothing
//   switchedOff, usageGuard    the breaks only a person ends (Pause, a stop, no key), and the free-plan guard
//   dailyLimit(), sentToday(now)   how many reviews a Taiwan day takes, and how many were sent today
//   counts(sub_hash, month)    a LINE account's reviews used and sent in a Taiwan month
//   giveBack(id)               a review's count given back, once: the only way any count goes back
//   dropFrames, dropReview     a review's key frames, or the review and its key frames, deleted, with frame_bytes kept right
//   route({method, path, who, body})   every /coach/... and /admin/coach/... route, from the Worker over RPC (ruling R2):
//     getMe                    GET /coach/me
//     postAgree                POST /coach/agree
//     postReview               POST /coach/reviews: starts a review
//     postFrame, getFrame      POST and GET /coach/reviews/{id}/frames/{n}
//     postSend                 POST /coach/reviews/{id}/send
//     getReview, deleteReview  GET and DELETE /coach/reviews/{id}
//   where()                    the second line of GET /admin/where: which Cloudflare data centre the coach lives in
//   roomStub()                 the room's stub (stubs.js), which tests replace
//   alarmBy(at)                makes sure the coach's one alarm goes off by `at`
//   alarm()                    the one alarm: one review's AI call a run (spec "Backend", steps 1-7)
//   nextAlarmAt(now)           when the alarm should next go off
//   callsHeld(now)             whether Pause, a stop or a money rest holds every AI call
//   requestFor, callAi         a review's Messages API request, and the call itself
//   setPaused, startAgain      Bryan's Pause, and Start again after the coach stopped itself (ruling R10)
//
// Times are epoch milliseconds. Nothing reaches the coach but RPC calls from the Worker and the room, and its alarm.
// Every route answers {status, json}, or {status, jpeg: Uint8Array} for a key frame.
import { DurableObject } from "cloudflare:workers";
import { randomB64u, sha256b64u } from "./auth.js";
import {
  AGREE_VER, BOARDS, LANGS, LEVELS, MOVES, STANCES, autopilotOk, buildRequest, checkReply, readReply,
} from "./coach-guide.js";
import {
  ATTEMPT_WAITS, CALLING_STALE, DAY, MAX_TRIES, MAX_WAITS, checkFrame, cleanupAfter, costUsd, creditMonth, estimateIn,
  nextTwMonth, sortError, twDay, twMonth, waitFor, worstUsd,
} from "./coach-rules.js";
import { colo, room } from "./stubs.js";

// The schema this code expects. A change to the tables bumps it and adds a step to migrate(), which brings the coach up
// from whatever version it has, as the room's does. The steps only go forward, so never roll the coach back past a
// version that bumped this: the older code would take the higher schema_ver as done. To undo a change, deploy a fix on
// top instead.
const SCHEMA_VER = 1;

const USAGE_SAVE_EVERY = 100; // requests between saves of the usage counts...
const USAGE_SAVE_MS = 30_000; // ...or time, whichever comes first

// The meta keys, each value JSON (setMeta):
//   schema_ver     the schema migrate() has made
//   usage          {day, req, read, write, at}: today's counts (usage()), with when they were saved
//   autopilot      true while a draft that passes every check is published without Bryan
//   paused         true while Bryan's Pause holds: no new reviews and no AI calls
//   stopped        true after a key or model error, until Bryan taps Start again (ruling R10)
//   spend          {start, usd, reviews}: the credit month's spending
//   rest           {kind, until, probe_at}: a money rest
//   today          {day, n}: the reviews sent on this Taiwan day
//   frame_bytes    the bytes of key frames stored, for the size guard
//   next_cleanup   when the daily clean-up next runs
//   digest_due     when the hourly email is due (ruling R9), and last_digest, when the last one went
//   mail_day       this Taiwan day's emails, for the cap of 20 a day
//
// Every table in the spec ("Storage (Coach's SQLite)") but meta, which migrate() makes first. The JSON columns hold text
// written with JSON.stringify.
const SCHEMA_V1 = [
  // One clip review, from its start to its last state. status goes uploading -> queued -> calling -> drafted ->
  // published, rejected or failed: drafted -> queued on a Redo, published -> drafted on a report, published -> rejected
  // on a Withdraw. answers is what the surfer said (JSON); draft, english and final are the coach's text, its English
  // copy and what was published (JSON); flags, warnings and redo_note (Bryan's Redo notes) are JSON arrays. attempts
  // and waits count failed and waiting calls, redos Bryan's Redos, and next_try is when the alarm may call next.
  // quota_month is the Taiwan month the review counted in ("2030-06"); given is 1 once its count was given back, so it
  // never goes back twice. checked is 1 once Bryan approved or edited it (ruling R20); hold is 1 while Bryan has a
  // not-surf or flagged clip to act on (ruling R16). model, tok_in, tok_out and cost (US$) are the call's.
  // surfer_note is what the surfer is told when it isn't published; report is the surfer's line when they report it.
  `CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    sub_hash TEXT NOT NULL,
    lang TEXT NOT NULL,
    move TEXT NOT NULL,
    answers TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('uploading', 'queued', 'calling', 'drafted', 'published', 'rejected', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    waits INTEGER NOT NULL DEFAULT 0,
    redos INTEGER NOT NULL DEFAULT 0,
    next_try INTEGER,
    created INTEGER NOT NULL,
    sent INTEGER,
    published INTEGER,
    quota_month TEXT,
    given INTEGER NOT NULL DEFAULT 0,
    checked INTEGER NOT NULL DEFAULT 0,
    hold INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    tok_in INTEGER,
    tok_out INTEGER,
    cost REAL,
    draft TEXT,
    english TEXT,
    final TEXT,
    flags TEXT NOT NULL DEFAULT '[]',
    warnings TEXT NOT NULL DEFAULT '[]',
    redo_note TEXT NOT NULL DEFAULT '[]',
    surfer_note TEXT,
    report TEXT
  )`,
  // The alarm's next review; a person's own list, newest first; and a LINE account's open reviews.
  "CREATE INDEX reviews_status_next ON reviews (status, next_try)",
  "CREATE INDEX reviews_uid_created ON reviews (uid, created)",
  "CREATE INDEX reviews_sub_status ON reviews (sub_hash, status)",
  // A review's key frames, numbered 1-12, one row each (a row is capped at 2 MB): its time in the clip in ms, the box
  // around the surfer as JSON [x, y, side], and the JPEG as base64 text, null while a listed frame hasn't arrived.
  `CREATE TABLE frames (
    review_id TEXT NOT NULL,
    n INTEGER NOT NULL CHECK (n BETWEEN 1 AND 12),
    ms INTEGER NOT NULL,
    box TEXT NOT NULL,
    b64 TEXT,
    PRIMARY KEY (review_id, n)
  )`,
  // One row per LINE account that used the coach: its saved level, board and stance, the coach agreement it agreed to
  // and when, and blocked, 1 after a flagged clip until Bryan clears it.
  `CREATE TABLE people (
    sub_hash TEXT PRIMARY KEY,
    level TEXT,
    board TEXT,
    stance TEXT,
    agreed_ver TEXT,
    agreed_at INTEGER,
    blocked INTEGER NOT NULL DEFAULT 0
  )`,
  // The reviews a LINE account used and sent in a Taiwan month ("2030-06"). Keyed by sub_hash, so deleting and remaking
  // an account inside a month doesn't reset it. A give back lowers used, never sent.
  `CREATE TABLE quota (
    sub_hash TEXT NOT NULL,
    month TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sub_hash, month)
  )`,
  // Bryan's examples for the coaching guide, text only: the move and level, the coach's draft, Bryan's version and his
  // note, the review it came from and when.
  `CREATE TABLE examples (
    id INTEGER PRIMARY KEY,
    move TEXT NOT NULL,
    level TEXT,
    draft TEXT NOT NULL,
    bryan TEXT,
    note TEXT,
    review_id TEXT,
    at INTEGER NOT NULL
  )`,
];

// The coach's [vars] (wrangler.toml), read as numbers: [name]: [the var, the spec's value, what it may be]. They arrive
// as text, and a typo read with Number() is NaN, which compares false with everything and would quietly lift a limit,
// so a value that is missing or isn't one takes the spec's.
const AMOUNT = (n) => n >= 0; // US$, or US$ per million tokens
const COUNT = (n) => Number.isInteger(n) && n >= 0;
const DAY_OF_MONTH = (n) => Number.isInteger(n) && n >= 1 && n <= 31;
const SETTINGS = Object.freeze({
  priceIn: ["COACH_PRICE_IN", 4, AMOUNT],
  priceOut: ["COACH_PRICE_OUT", 20, AMOUNT],
  stopUsd: ["COACH_STOP_USD", 78, AMOUNT],
  hardUsd: ["COACH_HARD_USD", 80, AMOUNT],
  extraUsd: ["COACH_EXTRA_USD", 0, AMOUNT],
  creditDay: ["COACH_CREDIT_DAY", 16, DAY_OF_MONTH], // Bryan's Max plan renews on the 16th (Bryan, Oct 23)
  monthly: ["COACH_MONTHLY", 2, COUNT],
  monthlyMax: ["COACH_MONTHLY_MAX", 4, COUNT],
  daily: ["COACH_DAILY", 10, COUNT],
  dailyAuto: ["COACH_DAILY_AUTO", 40, COUNT],
});
const DECIMAL = /^\d+(\.\d+)?$/; // "16", "12.50": no sign, exponent or hex

// One setting: `value` as a number when it is a plain decimal (a test may also set a number) that `ok` takes.
function setting(value, fallback, ok) {
  const text = String(value ?? "").trim();
  const n = typeof value === "number" ? value : DECIMAL.test(text) ? Number(text) : NaN;
  return Number.isFinite(n) && ok(n) ? n : fallback;
}

// The coach's settings from env: {priceIn, priceOut, stopUsd, hardUsd, extraUsd, creditDay, monthly, monthlyMax, daily,
// dailyAuto}.
export const readConfig = (env) =>
  Object.fromEntries(
    Object.entries(SETTINGS).map(([name, [key, fallback, ok]]) => [name, setting(env[key], fallback, ok)]),
  );

const refuse = (status, error, more = {}) => ({ status, json: { error, ...more } });
const OK = Object.freeze({ status: 200, json: { ok: true } });
const NOT_FOUND = refuse(404, "not_found");

// ---- Limits -------------------------------------------------------------------------------------------------------

// The free-plan guard (spec "Free-plan room"): the account's daily limits on the free plan, which the room and the coach
// share, and the share of any one of them at which the coach refuses new reviews by its own count (usage()). The room
// rests the chat at 90% of its own, so the coach stops well before.
const COACH_GUARD = 0.08;
const FREE_DAILY = Object.freeze({ req: 100_000, read: 5_000_000, write: 100_000 });

// The size guard (spec "Size guard"): new reviews stop while the key frames stored pass 700 MB, or the whole database
// passes 950 MB (freed pages aren't always handed back). Counted in millions of bytes, the lower reading of a MB, so the
// guard errs early.
const FRAME_BYTES_MAX = 700_000_000;
const DATABASE_MAX = 950_000_000;

const BREAK = Object.freeze({ kind: "break" });
// The answer to a start or send that stopFor() stops: 503 break, or 503 money with when the rest ends.
const stopped = (stop) => (stop.kind === "money" ? refuse(503, "money", { until: stop.until }) : refuse(503, "break"));

// ---- Starting a review --------------------------------------------------------------------------------------------

const FRAMES_MIN = 8; // the surfer must be in at least 8 of the 12 key frames
const FRAME_N_MAX = 12;
const NOTE_MAX = 200; // characters in the surfer's "Anything else?" line
const MOVE_OTHER_MAX = 60; // characters in the line that names an "other" move
// A box is [x, y, side] in the video's displayed pixels: no phone films wider than 8K.
const BOX_MAX = 8192;
// A key frame's time in the clip. Clips are 2 minutes at most, so this is only there to keep nonsense out.
const FRAME_MS_MAX = 10 * 60_000;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// The body's JSON object, or null when it isn't one.
function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

// The surfer's own line, trimmed: "" when left out, or null when it isn't text or runs over `max` characters (counted
// as characters, so 中文 has the same room as English).
function ownLine(value, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const line = value.trim();
  return [...line].length <= max ? line : null;
}

const isBox = (box) =>
  Array.isArray(box) && box.length === 3 && box.every((v) => Number.isInteger(v) && v >= 0 && v <= BOX_MAX) && box[2] >= 1;
const isFrameMs = (ms) => Number.isInteger(ms) && ms >= 0 && ms <= FRAME_MS_MAX;

// A start's body, checked: {error: "too_few_frames" | "invalid"}, or {lang, answers, frames}. Too few frames is checked
// before the rest, in the spec's order of refusals: fewer than 8 listed, or a number outside 1-12 or listed twice. Then
// "invalid": a body that isn't a JSON object, an answer not on its list, a line too long, or a frame's time or box
// that isn't whole numbers in range.
function readStart(body) {
  if (body === null) return { error: "invalid" };
  const frames = Array.isArray(body.frames) ? body.frames : [];
  const ns = frames.map((f) => (isObject(f) ? f.n : undefined));
  const numbered = ns.every((n) => Number.isInteger(n) && n >= 1 && n <= FRAME_N_MAX);
  if (frames.length < FRAMES_MIN || !numbered || new Set(ns).size !== ns.length) return { error: "too_few_frames" };
  const note = ownLine(body.note, NOTE_MAX);
  const moveOther = ownLine(body.move_other, MOVE_OTHER_MAX);
  const listed = MOVES.includes(body.move) && LEVELS.includes(body.level) && BOARDS.includes(body.board) &&
    STANCES.includes(body.stance) && LANGS.includes(body.lang);
  if (!listed || note === null || moveOther === null || !frames.every((f) => isFrameMs(f.ms) && isBox(f.box))) {
    return { error: "invalid" };
  }
  return {
    lang: body.lang,
    answers: { move: body.move, move_other: moveOther, level: body.level, board: body.board, stance: body.stance, note },
    frames: frames.map((f) => ({ n: f.n, ms: f.ms, box: f.box })),
  };
}

// ---- What a surfer and the admin see -----------------------------------------------------------------------------

// The surfer's words for a stored status (spec "The Coach tab": Coach is reviewing / Ready / Not reviewed).
const SURFER_STATUS = Object.freeze({
  queued: "reviewing", calling: "reviewing", drafted: "reviewing", published: "ready", rejected: "not_reviewed",
  failed: "not_reviewed",
});

// What the surfer is told about a review that wasn't published: "not_surf" while Bryan holds a not-surf or flagged clip
// (ruling R16: "We couldn't review this clip."), else his note, or null.
const noteFor = (review) => (review.hold ? "not_surf" : review.surfer_note ?? null);

// The reviews columns that hold JSON (SCHEMA_V1), read back as values for the admin.
const JSON_COLUMNS = Object.freeze(["answers", "draft", "english", "final", "flags", "warnings", "redo_note"]);
const fromJson = (text) => (text === null ? null : JSON.parse(text));

// ---- The AI call --------------------------------------------------------------------------------------------------

// The Messages API call (spec "The AI request"): the API version it is written for, room for the model's thinking as
// well as the reply, and a 10-minute timeout, inside the 15 minutes an alarm run may take.
const API_VERSION = "2026-10-21";
const MAX_TOKENS = 16_000;
const CALL_TIMEOUT = 600_000;
// The reviews columns that record a call that answered, in the order answered() lists them: the model named in the
// answer, its tokens in and out, and its cost in US$.
const CALL_SET = "model = ?, tok_in = ?, tok_out = ?, cost = ?";

// A key frame's base64 text as its JPEG's bytes. checkFrame() let only plain base64 in.
function fromBase64(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---- Routes -------------------------------------------------------------------------------------------------------

// Every route the coach serves so far: [method, path, the method that answers it]. The path's groups (a review's id, a
// key frame's number) come after who and the body. The Worker has already matched the same shapes (index.js).
const ID = "([A-Za-z0-9_-]{22})";
const N = "([1-9]|1[0-2])";
const ROUTES = [
  ["GET", "/coach/me", "getMe"],
  ["POST", "/coach/agree", "postAgree"],
  ["POST", "/coach/reviews", "postReview"],
  ["GET", `/coach/reviews/${ID}`, "getReview"],
  ["DELETE", `/coach/reviews/${ID}`, "deleteReview"],
  ["GET", `/coach/reviews/${ID}/frames/${N}`, "getFrame"],
  ["POST", `/coach/reviews/${ID}/frames/${N}`, "postFrame"],
  ["POST", `/coach/reviews/${ID}/send`, "postSend"],
].map(([method, path, run]) => ({ method, path: new RegExp(`^${path}$`), run }));

export class Coach extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.used = null; // today's usage counts, read from meta on first use
    this.unsaved = 0; // requests counted since the usage counts were last saved
    this.savedAt = null; // when the usage counts were last saved, by this copy of the coach or an earlier one
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  // The coach's clock. Tests replace it to run the coach at a chosen time.
  now() {
    return Date.now();
  }

  // ---- SQL ---------------------------------------------------------------------------------------------------------

  // Every query goes through all() or one(), so its rows read and written are counted in usage().
  all(query, ...binds) {
    const cursor = this.sql.exec(query, ...binds);
    const rows = cursor.toArray();
    this.usage("read", cursor.rowsRead);
    this.usage("write", cursor.rowsWritten);
    return rows;
  }

  one(query, ...binds) {
    return this.all(query, ...binds)[0] ?? null;
  }

  // A meta value, or null when the key was never set.
  getMeta(key) {
    const row = this.one("SELECT value FROM meta WHERE key = ?", key);
    return row === null ? null : JSON.parse(row.value);
  }

  setMeta(key, value) {
    this.all(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key, JSON.stringify(value),
    );
  }

  // Creates the tables, or brings them up to SCHEMA_VER: each version's step runs in turn, and meta.schema_ver records
  // what is done, so each step runs once and nothing changes after that. The steps and the new schema_ver are written
  // in one transaction, so a step that fails undoes them all. The constructor calls it before the coach takes any call.
  migrate() {
    this.all("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value)");
    const ver = this.getMeta("schema_ver") ?? 0;
    if (ver >= SCHEMA_VER) return;
    this.ctx.storage.transactionSync(() => {
      if (ver < 1) for (const statement of SCHEMA_V1) this.all(statement);
      this.setMeta("schema_ver", SCHEMA_VER);
    });
  }

  // ---- Settings ----------------------------------------------------------------------------------------------------

  // The [vars] as numbers (readConfig), read from env on every call, so a test's change counts at once.
  config() {
    return readConfig(this.env);
  }

  // ---- Usage -------------------------------------------------------------------------------------------------------

  // Approximate counts for today of coach requests ("req") and SQL rows read and written ("read", "write"), as the
  // room keeps its own: the free plan's daily limits are the account's, shared by the room and the coach, so the coach
  // refuses new reviews well before the room would rest the chat (spec "Free-plan room"). Every RPC call and alarm run
  // counts itself as a request; all() adds the rows. The day is UTC's, as the free limits reset at 00:00 UTC (ruling
  // R8). Returns today's totals so far; usage("req", 0) only reads them.
  //
  // The counts are kept in memory and saved to meta "usage" as the room saves its own: on a request when 30 s have
  // passed since the last save (by any copy of the coach), and on the 100th request since then. A copy that goes loses
  // only what came in since its last save.
  usage(kind, n = 1) {
    if (kind !== "req" && kind !== "read" && kind !== "write") throw new Error(`usage: unknown kind ${kind}`);
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.used?.day !== day) this.used = this.savedUsage(day);
    this.used[kind] += n;
    if (kind === "req" && n > 0) {
      this.unsaved += n;
      if (this.unsaved >= USAGE_SAVE_EVERY || now - this.savedAt >= USAGE_SAVE_MS) this.saveUsage();
    }
    return { ...this.used };
  }

  // These two use sql.exec directly, not all(): all() counts its rows through usage(), which they are part of.
  // The row is JSON {day, req, read, write, at}, where at is when it was saved.
  savedUsage(day) {
    const row = this.sql.exec("SELECT value FROM meta WHERE key = 'usage'").toArray()[0];
    const saved = row ? JSON.parse(row.value) : null;
    this.savedAt = saved?.at ?? -Infinity; // never saved: the next request saves
    if (saved?.day === day) return { day, req: saved.req, read: saved.read, write: saved.write };
    return { day, req: 0, read: 0, write: 0 };
  }

  saveUsage() {
    this.unsaved = 0;
    this.savedAt = this.now();
    const cursor = this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('usage', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      JSON.stringify({ ...this.used, at: this.savedAt }),
    );
    cursor.toArray();
    this.used.write += cursor.rowsWritten;
  }

  // ---- Limits ------------------------------------------------------------------------------------------------------

  // Why no new review may start or be sent at `now`, or null when nothing stops it (spec "Backend" and "Money"):
  //   {kind: "break"}   "Coach is taking a break": Bryan's Pause, the coach stopped itself (ruling R10), no API key, the
  //                     free-plan guard (8% of a daily limit, by the coach's own UTC-day count, ruling R8), or the size
  //                     guard
  //   {kind: "money", until}   "Coach is resting until <until>": a money rest, until it ends; or the credit month's spend
  //                     at COACH_STOP_USD + COACH_EXTRA_USD, until the next credit day, when the spend starts again
  // A break says more than money, so it comes first.
  stopFor(now) {
    if (this.switchedOff() || this.usageGuard()) return BREAK;
    if ((this.getMeta("frame_bytes") ?? 0) > FRAME_BYTES_MAX || this.sql.databaseSize > DATABASE_MAX) return BREAK;
    const rest = this.getMeta("rest");
    if (rest) return { kind: "money", until: rest.until };
    const spend = this.getMeta("spend");
    if (spend) {
      const { stopUsd, extraUsd, creditDay } = this.config();
      // The spend counts until the credit month it started in ends; after that it is last month's.
      const { next } = creditMonth(spend.start, creditDay);
      if (now < next && spend.usd >= stopUsd + extraUsd) return { kind: "money", until: next };
    }
    return null;
  }

  // Bryan's Pause, the coach's own stop (ruling R10), or no API key: a break that only a person ends.
  switchedOff() {
    return Boolean(this.getMeta("paused") || this.getMeta("stopped")) || String(this.env.ANTHROPIC_API_KEY ?? "").trim() === "";
  }

  // The free-plan guard: true while today's count (usage(), a UTC day, ruling R8) has reached 8% of any of the account's
  // daily limits. It lifts by itself at 00:00 UTC, when the counts start again.
  usageGuard() {
    const used = this.usage("req", 0);
    return Object.entries(FREE_DAILY).some(([kind, limit]) => used[kind] >= COACH_GUARD * limit);
  }

  // How many reviews a Taiwan day takes: COACH_DAILY, or COACH_DAILY_AUTO while autopilot is on.
  dailyLimit() {
    const { daily, dailyAuto } = this.config();
    return this.getMeta("autopilot") ? dailyAuto : daily;
  }

  // The reviews sent on `now`'s Taiwan day (ruling R8), from meta today = {day, n}: 0 once the day has changed.
  sentToday(now) {
    const today = this.getMeta("today");
    return today?.day === twDay(now) ? today.n : 0;
  }

  fullToday(now) {
    return this.sentToday(now) >= this.dailyLimit();
  }

  // A LINE account's {used, sent} in a Taiwan month ("2030-06"), 0 and 0 when it has no row.
  counts(sub_hash, month) {
    return this.one("SELECT used, sent FROM quota WHERE sub_hash = ? AND month = ?", sub_hash, month) ?? { used: 0, sent: 0 };
  }

  // What a month's {used, sent} leaves: `left` of the COACH_MONTHLY, and `sent_left` of the COACH_MONTHLY_MAX an account
  // may send whatever is given back. `none` when no more may start or send.
  leftOf({ used, sent }) {
    const { monthly, monthlyMax } = this.config();
    return {
      left: Math.max(0, Math.min(monthly - used, monthlyMax - sent)),
      sent_left: Math.max(0, monthlyMax - sent),
      none: used >= monthly || sent >= monthlyMax,
    };
  }

  // Gives a review's count back to the Taiwan month it was sent in: used - 1, never below 0, and never sent, so the
  // 4-a-month cap still holds. given marks it, so a review is given back once at most, whoever asks again; a review
  // never sent has nothing to give. True when this call gave it back. This is the only way any count goes back: a
  // reject, Bryan's Give back, a withdraw, a failure, the 14-day close, the hard stop and a money rest all call it; a
  // not-surf or flagged reply, a delete, a ban and a banned account's skipped review never do.
  giveBack(id) {
    return this.ctx.storage.transactionSync(() => {
      const review = this.one(
        "UPDATE reviews SET given = 1 WHERE id = ? AND given = 0 AND quota_month IS NOT NULL RETURNING sub_hash, quota_month",
        id,
      );
      if (!review) return false;
      this.all("UPDATE quota SET used = max(used - 1, 0) WHERE sub_hash = ? AND month = ?", review.sub_hash, review.quota_month);
      return true;
    });
  }

  // ---- Key frames --------------------------------------------------------------------------------------------------

  // meta frame_bytes, the base64 text of every key frame stored, for the size guard: every write and delete of a frame
  // moves it by the bytes it adds or frees.
  addFrameBytes(delta) {
    if (delta !== 0) this.setMeta("frame_bytes", Math.max(0, (this.getMeta("frame_bytes") ?? 0) + delta));
  }

  // Deletes a review's key frames, their rows included. Returns the bytes freed. Inside the caller's transaction.
  dropFrames(id) {
    const { bytes } = this.one("SELECT coalesce(sum(length(b64)), 0) AS bytes FROM frames WHERE review_id = ?", id);
    this.all("DELETE FROM frames WHERE review_id = ?", id);
    this.addFrameBytes(-bytes);
    return bytes;
  }

  // Deletes a review and its key frames. Inside the caller's transaction.
  dropReview(id) {
    this.dropFrames(id);
    this.all("DELETE FROM reviews WHERE id = ?", id);
  }

  // ---- Routes (ruling R2) ------------------------------------------------------------------------------------------

  // Every coach route, from the Worker, as route({method, path, who, body}): who = {uid, sub_hash, role} is the
  // signed-in caller as the room's whoIs() gave it (never anything the surfer sent), and body is the request's text.
  // A path it doesn't serve is 404 not_found (ROUTES).
  async route({ method, path, who, body } = {}) {
    this.usage("req");
    if (typeof who?.uid !== "string" || typeof who?.sub_hash !== "string") return refuse(401, "auth");
    for (const route of ROUTES) {
      const match = route.method === method ? route.path.exec(path) : null;
      if (match) return this[route.run](who, body, ...match.slice(1));
    }
    return NOT_FOUND;
  }

  // The people row of a LINE account, or null.
  person(sub_hash) {
    return this.one("SELECT * FROM people WHERE sub_hash = ?", sub_hash);
  }

  // A review of the caller's own account (by uid), or null. With `admin`, Bryan may see anyone's. Another account
  // asking gets null, the same as for a review that isn't there, so it learns nothing.
  reviewFor(who, id, { admin = false } = {}) {
    const review = this.one("SELECT * FROM reviews WHERE id = ?", id);
    if (!review) return null;
    return review.uid === who.uid || (admin && who.role === "admin") ? review : null;
  }

  // GET /coach/me: what the Coach panel shows. left and sent_left as leftOf() says for this Taiwan month; month and
  // next_month (when the next one starts) are the server's, whatever the phone's clock says (Review Focus 3); stop is
  // stopFor(); profile is the saved level, board and stance; and the account's reviews, newest first, but the one
  // still uploading, each with its status in the surfer's words.
  getMe(who) {
    const now = this.now();
    const month = twMonth(now);
    const { left, sent_left } = this.leftOf(this.counts(who.sub_hash, month));
    const person = this.person(who.sub_hash);
    const reviews = this.all(
      `SELECT id, move, created, status, published, surfer_note, hold FROM reviews
       WHERE uid = ? AND status != 'uploading' ORDER BY created DESC, id DESC`,
      who.uid,
    );
    return {
      status: 200,
      json: {
        left,
        sent_left,
        monthly: this.config().monthly,
        month,
        next_month: nextTwMonth(now),
        full_today: this.fullToday(now),
        stop: this.stopFor(now),
        profile: person?.level ? { level: person.level, board: person.board, stance: person.stance } : null,
        agreed: person?.agreed_ver === AGREE_VER,
        admin: who.role === "admin",
        reviews: reviews.map((r) => ({
          id: r.id, move: r.move, created: r.created, status: SURFER_STATUS[r.status], published: r.published, note: noteFor(r),
        })),
      },
    };
  }

  // POST /coach/agree {ver, adult}: saves the coach agreement's version and when, for this LINE account. Only this
  // version, with the 18+ tick, else 403 agree.
  postAgree(who, body) {
    const agreement = parseObject(body);
    if (agreement?.ver !== AGREE_VER || agreement?.adult !== true) return refuse(403, "agree");
    this.all(
      `INSERT INTO people (sub_hash, agreed_ver, agreed_at) VALUES (?, ?, ?)
       ON CONFLICT (sub_hash) DO UPDATE SET agreed_ver = excluded.agreed_ver, agreed_at = excluded.agreed_at`,
      who.sub_hash, AGREE_VER, this.now(),
    );
    return OK;
  }

  // POST /coach/reviews {lang, move, move_other, level, board, stance, note, frames: [{n, ms, box}]}: starts a review,
  // {id}. Refused, in this order: agree, banned (the room's isBanned), blocked, stopFor(), in_progress (one queued,
  // calling or drafted), full_today, no_reviews_left, then too_few_frames and invalid (readStart). Nothing counts yet:
  // that is send's. Only once every check passes does it write, all in one transaction: the account's own review still
  // uploading goes (another tab's, ruling R12), the new one goes in with its listed key frames waiting, and the level,
  // board and stance are saved for next time.
  async postReview(who, body) {
    if (this.person(who.sub_hash)?.agreed_ver !== AGREE_VER) return refuse(403, "agree");
    if (await this.roomStub().isBanned(who.sub_hash)) return refuse(403, "banned");
    // No await from here on, so nothing else runs between these checks and the write. The row is read again, as the
    // account may have gone meanwhile.
    const now = this.now();
    const person = this.person(who.sub_hash);
    if (person?.agreed_ver !== AGREE_VER) return refuse(403, "agree");
    if (person.blocked) return refuse(403, "blocked");
    const stop = this.stopFor(now);
    if (stop) return stopped(stop);
    const open = "SELECT 1 FROM reviews WHERE sub_hash = ? AND status IN ('queued', 'calling', 'drafted') LIMIT 1";
    if (this.one(open, who.sub_hash)) return refuse(409, "in_progress");
    if (this.fullToday(now)) return refuse(429, "full_today");
    if (this.leftOf(this.counts(who.sub_hash, twMonth(now))).none) return refuse(429, "no_reviews_left");
    const start = readStart(parseObject(body));
    if (start.error) return refuse(400, start.error);
    const { lang, answers, frames } = start;
    const id = randomB64u(16);
    this.ctx.storage.transactionSync(() => {
      for (const old of this.all("SELECT id FROM reviews WHERE sub_hash = ? AND status = 'uploading'", who.sub_hash)) {
        this.dropReview(old.id);
      }
      this.all(
        `INSERT INTO reviews (id, uid, sub_hash, lang, move, answers, status, created)
         VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?)`,
        id, who.uid, who.sub_hash, lang, answers.move, JSON.stringify(answers), now,
      );
      for (const f of frames) {
        this.all("INSERT INTO frames (review_id, n, ms, box) VALUES (?, ?, ?, ?)", id, f.n, f.ms, JSON.stringify(f.box));
      }
      this.all(
        "UPDATE people SET level = ?, board = ?, stance = ? WHERE sub_hash = ?",
        answers.level, answers.board, answers.stance, who.sub_hash,
      );
    });
    return { status: 200, json: { id } };
  }

  // POST /coach/reviews/{id}/frames/{n}, the body a key frame's JPEG as base64 text: {ok: true}. Refused: not_found
  // (not the caller's own), not_uploading (sent already), bad_frame (a number not listed at the start, or checkFrame()
  // says so), too_big (over 140 KB). A frame sent again replaces the one there.
  postFrame(who, body, id, n) {
    const review = this.reviewFor(who, id);
    if (!review) return NOT_FOUND;
    if (review.status !== "uploading") return refuse(409, "not_uploading");
    const frame = this.one("SELECT length(b64) AS bytes FROM frames WHERE review_id = ? AND n = ?", id, Number(n));
    if (!frame) return refuse(400, "bad_frame");
    const bad = checkFrame(body);
    if (bad === "too_big") return refuse(413, "too_big");
    if (bad) return refuse(400, "bad_frame");
    this.ctx.storage.transactionSync(() => {
      this.all("UPDATE frames SET b64 = ? WHERE review_id = ? AND n = ?", body, id, Number(n));
      this.addFrameBytes(body.length - (frame.bytes ?? 0));
    });
    return OK;
  }

  // POST /coach/reviews/{id}/send: {ok: true, left}. Refused: not_found, not_uploading, missing_frames (a listed key
  // frame hasn't come), then stopFor(), full_today and no_reviews_left again, as they may have changed since the start.
  // Then it counts, in the Taiwan month of now, not of the start (Review Focus 3), queues the review for the alarm and
  // sets the alarm for now. The checks and the writes run with no await between them, so two sends can't both take
  // today's last place or the month's last review.
  async postSend(who, body, id) {
    const review = this.reviewFor(who, id);
    if (!review) return NOT_FOUND;
    if (review.status !== "uploading") return refuse(409, "not_uploading");
    if (this.one("SELECT 1 FROM frames WHERE review_id = ? AND b64 IS NULL LIMIT 1", id)) return refuse(409, "missing_frames");
    const now = this.now();
    const stop = this.stopFor(now);
    if (stop) return stopped(stop);
    if (this.fullToday(now)) return refuse(429, "full_today");
    const month = twMonth(now);
    if (this.leftOf(this.counts(review.sub_hash, month)).none) return refuse(429, "no_reviews_left");
    this.ctx.storage.transactionSync(() => {
      this.all(
        "UPDATE reviews SET status = 'queued', sent = ?, next_try = ?, quota_month = ? WHERE id = ?",
        now, now, month, id,
      );
      this.all(
        `INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, 1, 1)
         ON CONFLICT (sub_hash, month) DO UPDATE SET used = used + 1, sent = sent + 1`,
        review.sub_hash, month,
      );
      this.setMeta("today", { day: twDay(now), n: this.sentToday(now) + 1 });
    });
    const { left } = this.leftOf(this.counts(review.sub_hash, month));
    await this.alarmBy(now);
    return { status: 200, json: { ok: true, left } };
  }

  // GET /coach/reviews/{id}, for its owner or the admin; anyone else gets not_found. The owner gets
  // {id, status, move, created, have, note}: have is the key frames already here (for a resumed upload), note as in
  // GET /coach/me; and once it is published, review = {text, times, checked}: the published text, each key frame's time
  // in ms by its number (the server's record, so the AI can't make a time up), and whether Bryan checked it (ruling
  // R20). Never the draft, its English copy, flags, warnings, Redo notes, tokens or cost. The admin gets every column
  // (adminView).
  getReview(who, body, id) {
    const review = this.reviewFor(who, id, { admin: true });
    if (!review) return NOT_FOUND;
    if (who.role === "admin") return { status: 200, json: this.adminView(review) };
    const frames = this.all("SELECT n, ms, b64 IS NOT NULL AS have FROM frames WHERE review_id = ? ORDER BY n", id);
    const view = {
      id, status: review.status, move: review.move, created: review.created, have: frames.filter((f) => f.have).map((f) => f.n),
      note: noteFor(review),
    };
    if (review.status === "published") {
      view.review = {
        text: fromJson(review.final),
        times: Object.fromEntries(frames.map((f) => [f.n, f.ms])),
        checked: review.checked === 1,
      };
    }
    return { status: 200, json: view };
  }

  // A review as the admin sees it: every column, the JSON ones read back, with its key frames' {n, ms, box} and the
  // numbers of those here (have). Never a frame's text: that comes one at a time from getFrame().
  adminView(review) {
    const view = { ...review };
    for (const column of JSON_COLUMNS) view[column] = fromJson(review[column]);
    const frames = this.all("SELECT n, ms, box, b64 IS NOT NULL AS have FROM frames WHERE review_id = ? ORDER BY n", review.id);
    view.frames = frames.map((f) => ({ n: f.n, ms: f.ms, box: JSON.parse(f.box) }));
    view.have = frames.filter((f) => f.have).map((f) => f.n);
    return view;
  }

  // GET /coach/reviews/{id}/frames/{n}, for its owner or the admin: {status: 200, jpeg}, which the Worker answers as
  // image/jpeg. not_found for anyone else, and for a frame that hasn't come or is gone.
  getFrame(who, body, id, n) {
    if (!this.reviewFor(who, id, { admin: true })) return NOT_FOUND;
    const frame = this.one("SELECT b64 FROM frames WHERE review_id = ? AND n = ? AND b64 IS NOT NULL", id, Number(n));
    if (!frame) return NOT_FOUND;
    return { status: 200, jpeg: fromBase64(frame.b64) };
  }

  // DELETE /coach/reviews/{id}, for its owner: the review and its key frames go, in any status. Its count is never given
  // back (spec "Counting the 2 reviews").
  deleteReview(who, body, id) {
    if (!this.reviewFor(who, id)) return NOT_FOUND;
    this.ctx.storage.transactionSync(() => this.dropReview(id));
    return OK;
  }

  // ---- Placement ---------------------------------------------------------------------------------------------------

  // Where the coach lives, for the room's GET /admin/where: the colo= line of Cloudflare's trace, fetched from here
  // ("colo=KIX"), or "colo=?" when the trace can't be read. It never throws: a throw over RPC is logged as an uncaught
  // exception here as well as caught by the room.
  async where() {
    this.usage("req");
    try {
      const line = await colo();
      if (line) return line;
    } catch (err) {
      console.error("coach: the trace failed:", err?.name ?? "error");
    }
    return "colo=?";
  }

  // ---- The room ----------------------------------------------------------------------------------------------------

  // The room's stub (stubs.js), for isBanned and banAccount. Tests replace it, as they replace now().
  roomStub() {
    return room(this.env);
  }

  // ---- Alarm -------------------------------------------------------------------------------------------------------

  // Makes sure the alarm goes off by `at`: sets it when none is set or the one set is later. Every caller only brings
  // the alarm forward, never pushes it back; the alarm works out its next time itself.
  async alarmBy(at) {
    const set = await this.ctx.storage.getAlarm();
    if (set === null || set > at) await this.ctx.storage.setAlarm(at);
  }

  // The one alarm (spec "Backend", steps 1-7): one review's AI call a run, never in a surfer's request, as a run may
  // take 15 minutes. Whatever happened, the run counts itself as a request, the usage counts are saved, and the alarm
  // is set for the next thing due (nextAlarmAt), as the room's alarm does.
  async alarm() {
    try {
      await this.runOne(this.now());
    } finally {
      try {
        // Counted last, so the save covers the rows the run itself read and wrote. usage() may have saved already.
        this.usage("req");
        if (this.unsaved > 0) this.saveUsage();
      } finally {
        await this.ctx.storage.setAlarm(this.nextAlarmAt(this.now()));
      }
    }
  }

  // One run: the oldest review due is taken, the room is asked whether its account is banned, then the AI is called
  // and what came back is saved (settle). A money rest past its end is over first, so the reviews waiting on it go.
  async runOne(now) {
    const rest = this.getMeta("rest");
    if (rest && now >= rest.until) this.setMeta("rest", null);
    if (this.callsHeld(now)) return;
    const review = this.takeNext(now);
    if (!review) return;
    // A stale pick's call was cut off midway (a deploy, say), so takeNext() counted it an attempt, and after the last
    // one the coach gives up on it with no call. (The money limits add a stale pick's worst-case cost here.)
    if (review.stale && review.attempts >= MAX_TRIES) return this.gaveUp(review, review.attempts);
    let banned, userId;
    try {
      [banned, userId] = await Promise.all([
        this.roomStub().isBanned(review.sub_hash),
        sha256b64u("coach:" + review.sub_hash),
      ]);
    } catch (err) {
      // It stays calling, so the alarm comes back for it at its 16-minute mark.
      console.error("coach: the room's ban check failed:", err?.name ?? "error");
      return;
    }
    // Everything is looked at again after that await, and there is none from here to the call: the review may have
    // gone, or Bryan paused, meanwhile.
    if (!this.stillCalling(review)) return;
    if (banned) return this.skipBanned(review);
    if (this.callsHeld(this.now())) return this.putBack(review);
    const ask = this.requestFor(review, userId);
    this.settle(review, ask, await this.callAi(ask.body));
  }

  // Whether every AI call waits now: while stopFor() says "break" (Pause, the coach stopped itself, no API key, the
  // free-plan or the size guard), or a money rest holds. The money stop at COACH_STOP_USD + COACH_EXTRA_USD refuses only
  // new reviews and Redo: the reviews already sent are still called. (The money limits add the hard stop, and a credit
  // rest's probe every 6 hours.)
  callsHeld(now) {
    const stop = this.stopFor(now);
    return stop !== null && (stop.kind === "break" || this.getMeta("rest") !== null);
  }

  // When the alarm should next go off (spec step 7), never before now: the earliest of the next review's next_try (a
  // queued one's, or a calling one's 16-minute mark), the next daily clean-up (04:00 Taiwan), the hourly email (ruling
  // R9), and a money rest's next probe and its end. While callsHeld() no review counts, so Pause, a stop and no key
  // wake nothing, and lifting them brings the alarm back (setPaused, startAgain). The free-plan guard lifts by itself,
  // so while it alone holds reviews that wait, the alarm comes back at the next 00:00 UTC. Each time here must be moved
  // on by the run it wakes, or the alarm would go off again at once.
  nextAlarmAt(now) {
    const rest = this.getMeta("rest");
    const times = [this.getMeta("next_cleanup") ?? cleanupAfter(now), this.getMeta("digest_due"), rest?.until, rest?.probe_at];
    const waiting = this.one("SELECT min(next_try) AS at FROM reviews WHERE status IN ('queued', 'calling')").at;
    if (!this.callsHeld(now)) times.push(waiting);
    else if (waiting !== null && this.usageGuard() && !this.switchedOff()) times.push((Math.floor(now / DAY) + 1) * DAY);
    return Math.max(now, Math.min(...times.filter(Number.isFinite)));
  }

  // The next review to call, marked calling with next_try at its 16-minute mark (spec step 2): of those queued and due,
  // or left calling past their mark, the one sent first. null when none is due. A review left calling is `stale`: its
  // call was cut off midway (a deploy can stop one), which counts as an attempt (step 5, like a timeout), so a call that
  // fails that way every time can't go on paying every 16 minutes. The read and the write have no await between them.
  takeNext(now) {
    const next = this.one(
      "SELECT id, status FROM reviews WHERE status IN ('queued', 'calling') AND next_try <= ? ORDER BY sent, id LIMIT 1",
      now,
    );
    if (!next) return null;
    const stale = next.status === "calling";
    const counted = stale ? ", attempts = attempts + 1, waits = 0" : "";
    const review = this.one(
      `UPDATE reviews SET status = 'calling', next_try = ?${counted} WHERE id = ? RETURNING *`,
      now + CALLING_STALE, next.id,
    );
    return { ...review, stale };
  }

  // Whether a review taken by takeNext() is still calling for the redo number it was taken with (spec step 3).
  stillCalling(review) {
    return this.one("SELECT 1 FROM reviews WHERE id = ? AND status = 'calling' AND redos = ?", review.id, review.redos) !== null;
  }

  // Saves what became of a call, only while its review is still calling for the same redo number (spec step 3), so an
  // alarm that ran twice saves once, and a review deleted, banned or sent back for a Redo meanwhile gets nothing. `set`
  // is the SET clause, with its values in `binds`. True when it saved.
  saveCall(review, set, ...binds) {
    const saved = this.one(
      `UPDATE reviews SET ${set} WHERE id = ? AND status = 'calling' AND redos = ? RETURNING id`,
      ...binds, review.id, review.redos,
    );
    return saved !== null;
  }

  // The Messages API request for a review (spec "The AI request"; buildRequest): its key frames; the surfer's answers;
  // the published text of the account's last 2 reviews of this move, for progress; the 3 newest of Bryan's examples for
  // the move, leaving out this review's own, as a Redo's note reaches the coach through `redo` only; and on a Redo, the
  // draft it redoes with Bryan's notes. `userId` is the account's opaque hash for metadata.user_id. Returns {body, nums:
  // the key frames' numbers, hadHistory, estIn: the tokens it sends, as estimateIn() reckons them}.
  requestFor(review, userId) {
    const frames = this.all("SELECT n, ms, b64 FROM frames WHERE review_id = ? AND b64 IS NOT NULL ORDER BY n", review.id);
    const answers = JSON.parse(review.answers);
    // Two "other" moves are the same move only when the surfer named them the same.
    const history = this.all(
      `SELECT published AS at, final FROM reviews WHERE sub_hash = ? AND move = ? AND status = 'published'
         AND (move != 'other' OR json_extract(answers, '$.move_other') = ?)
       ORDER BY published DESC LIMIT 2`,
      review.sub_hash, review.move, answers.move_other ?? "",
    ).map((h) => ({ at: h.at, final: fromJson(h.final) }));
    const examples = this.all(
      "SELECT draft, bryan, note FROM examples WHERE move = ? AND review_id IS NOT ? ORDER BY at DESC, id DESC LIMIT 3",
      review.move, review.id,
    ).map((e) => ({ draft: fromJson(e.draft), bryan: fromJson(e.bryan), note: e.note }));
    const redo = review.redos > 0 ? { draft: fromJson(review.draft), notes: fromJson(review.redo_note) } : null;
    const body = buildRequest({
      model: this.env.COACH_MODEL, maxTokens: MAX_TOKENS, lang: review.lang, answers, frames, history, examples, userId,
      redo,
    });
    const text = [body.system, ...body.messages[0].content.map((block) => block.text ?? "")].join("");
    return { body, nums: frames.map((f) => f.n), hadHistory: history.length > 0, estIn: estimateIn(frames.length, text.length) };
  }

  // One call to the Messages API with a request body, not streaming, with a 10-minute timeout (spec "The AI request"):
  // {kind: "ok", message}, the answer, or {kind, retryAfter, cutOff}, what sortError() makes of the error and the
  // answer's retry-after header. A network error, the timeout or an answer that isn't JSON is "attempt" (sortError()
  // would take a missing answer for "fail"); cutOff is true only for the timeout or an abort, a call that may have run
  // to its worst case (spec "Money"). The alarm never calls it without an API key (stopFor).
  async callAi(body) {
    try {
      const res = await fetch(this.env.COACH_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": String(this.env.ANTHROPIC_API_KEY).trim(),
          "anthropic-version": API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT),
      });
      if (res.ok) return { kind: "ok", message: await res.json() };
      return { kind: sortError(res.status, await res.text()), retryAfter: res.headers.get("retry-after"), cutOff: false };
    } catch (err) {
      console.error("coach: the AI call failed:", err?.name ?? "error");
      return { kind: "attempt", retryAfter: null, cutOff: err?.name === "TimeoutError" || err?.name === "AbortError" };
    }
  }

  // What became of a call (spec steps 4-6 and "Money"), each saved with saveCall(). An answer is checked (answered());
  // an error goes by its kind:
  //   "wait"      a 429 or 529: it waits for retry-after, or 30 minutes, with no attempt used, 12 times in a row at most
  //   "attempt"   a 5xx, a timeout or a network error
  //   "fail"      any other 400, or a 413: the coach gives up on it at once
  //   "pause", "credit", "limit"   the key, the model or the money, not this review's fault
  settle(review, ask, result) {
    const now = this.now();
    if (result.kind === "ok") return this.answered(review, ask, readReply(result.message), now);
    if (result.kind === "wait") return this.waited(review, waitFor(result.retryAfter), now);
    if (result.kind === "attempt") return this.attempted(review, now);
    if (result.kind === "fail") return this.gaveUp(review, review.attempts + 1);
    // The review goes back in the queue with no attempt used. The money limits add what each kind starts: "pause"
    // stops the coach (ruling R10), "credit" and "limit" a money rest.
    return this.putBack(review, now);
  }

  // An answer, checked in the spec's order. A refusal or a flag first, as a reply of any shape may carry one (ruling
  // R16); then a reply cut off or failing a check counts an attempt; then a clip that isn't surfing is held for Bryan
  // (ruling R16); and the rest is a draft, published at once on autopilot when autopilotOk(), but for a Redo's, which
  // Bryan asked for and sees first (ruling P24). The call's model, tokens and cost are saved with what it gave.
  answered(review, ask, { reply, stop, usage, model }, now) {
    const call = [model, usage?.input_tokens ?? null, usage?.output_tokens ?? null, this.callCost(usage, ask.estIn)];
    if (stop === "refusal") return this.flagged(review, ["refusal"], [], call);
    const checked = checkReply(reply, { sentNums: ask.nums, hadHistory: ask.hadHistory, lang: review.lang });
    if (checked.flags.length > 0) return this.flagged(review, checked.flags, checked.warnings, call);
    if (checked.errors.length > 0) return this.attempted(review, now);
    // A 中文 review's English copy, for Bryan, has a column of its own.
    const { english = null, ...draft } = reply;
    const saved = [
      JSON.stringify(draft), english === null ? null : JSON.stringify(english), JSON.stringify(checked.warnings), ...call,
    ];
    const set = `next_try = NULL, draft = ?, english = ?, warnings = ?, flags = '[]', ${CALL_SET}`;
    if (!reply.is_surf_clip) {
      // Not published, and held for Bryan, who may give it back or ban the account. Its key frames stay for him.
      this.saveCall(review, `status = 'rejected', hold = 1, ${set}`, ...saved);
    } else if (review.redos === 0 && this.getMeta("autopilot") && autopilotOk(reply, checked)) {
      this.saveCall(review, `status = 'published', published = ?, final = ?, checked = 0, ${set}`, now, saved[0], ...saved);
    } else {
      this.saveCall(review, `status = 'drafted', ${set}`, ...saved);
    }
  }

  // A refusal, or a reply flagged sexual or under 18 (ruling R16), is never retried or published: the review is
  // rejected and held for Bryan with its flags, its key frames go at once, the account starts no new review until he
  // clears or bans it, and the count is kept. Its reply isn't kept as a draft: Bryan sees only the warning. The block is
  // the account's, so it holds even when the review was deleted or redone during the call and nothing else is saved.
  flagged(review, flags, warnings, call) {
    this.ctx.storage.transactionSync(() => {
      this.all("UPDATE people SET blocked = 1 WHERE sub_hash = ?", review.sub_hash);
      const set = `status = 'rejected', hold = 1, next_try = NULL, flags = ?, warnings = ?, ${CALL_SET}`;
      if (this.saveCall(review, set, JSON.stringify(flags), JSON.stringify(warnings), ...call)) this.dropFrames(review.id);
    });
  }

  // A call that counts as an attempt (spec step 5): a reply cut off or failing a check, a 5xx, a timeout. Attempt 2
  // waits a minute and attempt 3 five (ATTEMPT_WAITS), or longer when the AI asked for a longer wait (`wait`, in ms),
  // and the waits start again. After the third the coach gives up on it.
  attempted(review, now, wait = 0) {
    const attempts = review.attempts + 1;
    if (attempts >= MAX_TRIES) return this.gaveUp(review, attempts);
    const next = now + Math.max(ATTEMPT_WAITS[attempts - 1], wait);
    this.saveCall(review, "status = 'queued', attempts = ?, waits = 0, next_try = ?", attempts, next);
  }

  // A 429 or 529 (spec step 5): the review waits `ms` with no attempt used, at most 12 times in a row (MAX_WAITS); the
  // 13th counts as an attempt.
  waited(review, ms, now) {
    const waits = review.waits + 1;
    if (waits > MAX_WAITS) return this.attempted(review, now, ms);
    this.saveCall(review, "status = 'queued', waits = ?, next_try = ?", waits, now + ms);
  }

  // The coach gives up on a review after its third attempt, or on an error no retry would fix (spec steps 5 and 6): it
  // fails and its count goes back. A Redo instead goes back to Bryan as it was, its old draft with a red "Redo failed"
  // line, and its count stays: the review itself didn't fail.
  gaveUp(review, attempts) {
    if (review.redos > 0) {
      const warnings = fromJson(review.warnings);
      if (!warnings.includes("redo_failed")) warnings.push("redo_failed");
      const set = "status = 'drafted', attempts = ?, next_try = NULL, warnings = ?";
      this.saveCall(review, set, attempts, JSON.stringify(warnings));
      return;
    }
    this.ctx.storage.transactionSync(() => {
      if (this.saveCall(review, "status = 'failed', attempts = ?, next_try = NULL", attempts)) this.giveBack(review.id);
    });
  }

  // Back in the queue, due now, with no attempt used: a hold that began while the room was asked, or an error that is
  // the key's, the model's or the money's, not this review's.
  putBack(review, now = this.now()) {
    this.saveCall(review, "status = 'queued', next_try = ?", now);
  }

  // A banned account's review (spec step 2): rejected with no call, its key frames gone, its count not given back.
  skipBanned(review) {
    this.ctx.storage.transactionSync(() => {
      if (this.saveCall(review, "status = 'rejected', hold = 0, next_try = NULL")) this.dropFrames(review.id);
    });
  }

  // What a call cost in US$ at the [vars] prices: from the answer's token counts, or at its worst case (all of the
  // request, and every token max_tokens allows) when it gave none.
  callCost(usage, estIn) {
    const { priceIn, priceOut } = this.config();
    const prices = { in: priceIn, out: priceOut };
    return usage ? costUsd(usage, prices) : worstUsd(estIn, MAX_TOKENS, prices);
  }

  // ---- Pause and Start again ---------------------------------------------------------------------------------------

  // Bryan's Pause, the kill switch (spec "Money"): no new reviews and no AI calls while it holds. Turning it off brings
  // the alarm to now, so the reviews waiting go at once.
  async setPaused(paused) {
    this.setMeta("paused", paused === true);
    if (paused !== true) await this.alarmBy(this.now());
  }

  // Start again, after a key or model error stopped the coach (ruling R10): stopped is cleared, and paused with it, and
  // the alarm comes to now.
  async startAgain() {
    this.setMeta("stopped", false);
    this.setMeta("paused", false);
    await this.alarmBy(this.now());
  }
}
