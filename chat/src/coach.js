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
//   route({method, path, who, body})   every /coach/... and /admin/coach/... route, from the Worker over RPC (ruling R2)
//   where()                    the second line of GET /admin/where: which Cloudflare data centre the coach lives in
//   roomStub()                 the room's stub (stubs.js), which tests replace
//   alarmBy(at)                makes sure the coach's one alarm goes off by `at`
//
// Times are epoch milliseconds. Nothing reaches the coach but RPC calls from the Worker and the room, and its alarm.
// Every route answers {status, json}, or {status, jpeg: Uint8Array} for a key frame.
import { DurableObject } from "cloudflare:workers";
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

  // ---- Routes (ruling R2) ------------------------------------------------------------------------------------------

  // Every coach route, from the Worker, as route({method, path, who, body}): who = {uid, sub_hash, role} is the
  // signed-in caller as the room's whoIs() gave it (never anything the surfer sent), and body is the request's text.
  // No route is open yet, so every path is 404 not_found.
  async route() {
    this.usage("req");
    return refuse(404, "not_found");
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
}
