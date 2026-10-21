// The room: the one Durable Object behind the Taiwan chat, named "taiwan". All the chat's data lives in its
// SQLite storage. The design is in docs/superpowers/specs/2026-10-21-taiwan-chat-design.md, "Data (room
// SQLite)", "Alarm", "Retention (daily)" and "Free-plan budget".
//
//   migrate()                  creates the tables, once per schema version, before the room does anything else
//   history(beforeId, limit)   a page of the room, as the public frames readers get
//   reportsFor(spot, nowMs)    the spot card's reports, from a memory copy kept for 60 s per spot
//   messagesChanged(spot)      called by every write to messages, so the memory copies follow
//   usage(kind, n)             approximate daily counts of room requests and SQL rows, for the free-plan guard
//   ensureAlarm() / alarm()    one alarm for both the daily retention and the 45 s keepalive tick
//
// Times are epoch milliseconds. The Worker calls the room as https://room/<route> with a JSON body.
import { DurableObject } from "cloudflare:workers";
import { SPOTS } from "./mod.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The schema this code expects. A change to the tables bumps it and adds a step to migrate().
const SCHEMA_VER = 1;

const PAGE_MAX = 100; // the room opens with the last 100 messages
const REPORT_WINDOW = 4 * HOUR; // a report shows on its spot's card for 4 hours
const REPORTS_MAX = 20;
const REPORT_COPY_MS = 60_000; // how long reportsFor() reuses its memory copy of a spot's reports
const KEEPALIVE_MS = 45_000; // the tick while any socket is open; chat.js gives up on a socket after 100 s
const RETENTION_HOUR_UTC = 19; // 03:00 in Taiwan
const BATCH = 1000; // rows per retention statement
const USAGE_SAVE_EVERY = 100; // requests between saves of the usage counts

// How long things are kept (spec "How long things are kept" and "Retention (daily)").
const KEEP_MESSAGES = 30 * DAY; // text messages and shared session cards
const KEEP_REPORT_POSTER = 30 * DAY; // then a report shows as "a surfer"
const KEEP_REPORTS = 365 * DAY;
const KEEP_FLAGS = 180 * DAY;
const KEEP_HOLDS = 180 * DAY;
const LOGIN_TTL = 10 * MINUTE; // logins and handoffs
const KEEP_ACCOUNT = 730 * DAY; // accounts not seen for 24 months
const KEEP_DELETED_SUB = 30 * DAY; // a deleted, unbanned LINE account's row

// Every table in the spec, including the ones that later parts of the room first write to.
const SCHEMA_V1 = [
  // People who signed up. The LINE account is kept only as a one-way code (sub_hash), with no LINE ID, name,
  // email or picture. nick_key is the folded nickname that must be unique (mod.js checkNick). tv goes up to
  // sign the user out everywhere. role is "user" or "admin".
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    sub_hash TEXT NOT NULL UNIQUE,
    nick TEXT NOT NULL,
    nick_key TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'user',
    tv INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    nick_changed INTEGER,
    consent_at INTEGER NOT NULL,
    consent_ver TEXT NOT NULL
  )`,
  // One row per LINE account. It outlives account deletion, so deleting an account doesn't undo a ban or reset
  // limits. A deleted, unbanned row goes after 30 days.
  `CREATE TABLE subs (
    sub_hash TEXT PRIMARY KEY,
    banned INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  )`,
  // Everything posted in the room. body is JSON, and never holds the nickname (that is looked up from users).
  // uid is NULL on a report over 30 days old. hidden_by says why a message is hidden, when it is.
  `CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    uid TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'report', 'session')),
    spot TEXT,
    body TEXT NOT NULL,
    reply_to INTEGER,
    likes INTEGER NOT NULL DEFAULT 0,
    hidden_by TEXT CHECK (hidden_by IN ('flags', 'ban', 'admin')),
    flag_immune INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX messages_ts ON messages (ts)",
  "CREATE INDEX messages_spot_ts ON messages (spot, ts)",
  "CREATE INDEX messages_uid_ts ON messages (uid, ts)",
  // For the spot cards. It holds only visible reports, so reportsFor() reads just the rows it returns; with
  // (spot, ts) alone it would also read every tagged message and hidden report on the way.
  "CREATE INDEX messages_reports ON messages (spot, ts) WHERE kind = 'report' AND hidden_by IS NULL",
  // One 👍 per person per message; messages.likes is kept in step with it.
  "CREATE TABLE likes (msg_id INTEGER NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (msg_id, uid)) WITHOUT ROWID",
  // Flags count once per LINE account, so they are keyed by sub_hash.
  `CREATE TABLE flags (
    msg_id INTEGER NOT NULL,
    sub_hash TEXT NOT NULL,
    reason TEXT NOT NULL,
    ts INTEGER NOT NULL,
    rejected INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (msg_id, sub_hash)
  )`,
  // The surf diary: private until shared, when shared_msg is the session card's message id. cond is JSON.
  `CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    spot TEXT NOT NULL,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    board TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    cond TEXT,
    shared_msg INTEGER
  )`,
  "CREATE INDEX sessions_uid_start ON sessions (uid, start)",
  // A LINE sign-in in progress (spec "Login", step 2), for 10 minutes.
  `CREATE TABLE logins (
    state TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    pkce_verifier TEXT NOT NULL,
    h TEXT NOT NULL,
    created INTEGER NOT NULL
  )`,
  // A finished LINE sign-in waiting to be redeemed (spec "Login", step 3), for 10 minutes. This is the only row
  // that ever holds a raw LINE ID (sub).
  `CREATE TABLE handoffs (
    code_hash TEXT PRIMARY KEY,
    h TEXT NOT NULL,
    sub_hash TEXT NOT NULL,
    sub TEXT NOT NULL,
    line_name TEXT,
    pin TEXT NOT NULL,
    created INTEGER NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0
  )`,
  // Rate-limit counters, keyed by sub_hash and kind.
  "CREATE TABLE limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, window_end INTEGER NOT NULL)",
  // Copies Bryan keeps (child-safety hides, "Keep as evidence"), for 180 days whatever else is deleted.
  "CREATE TABLE holds (msg_id INTEGER, body TEXT, uid TEXT, sub_hash TEXT, reason TEXT, ts INTEGER NOT NULL)",
];

// The first 19:00 UTC after t (19:00 itself counts as past).
function retentionTimeAfter(t) {
  const today = Math.floor(t / DAY) * DAY + RETENTION_HOUR_UTC * HOUR;
  return today > t ? today : today + DAY;
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.reportCopies = new Map(); // spot -> {at, reports}, the 60 s copies behind reportsFor()
    this.lastId = 0; // the newest visible message's id, for the CHAT button's dot; see messagesChanged()
    this.used = null; // today's usage counts, read from meta on first use
    this.unsaved = 0; // requests counted since the usage counts were last saved
    this.retentionAt = null; // when retention next runs (meta next_retention), read on first use
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      this.messagesChanged();
    });
  }

  // The room's clock. Tests replace it to run the room at a chosen time.
  now() {
    return Date.now();
  }

  // ---- SQL ---------------------------------------------------------------------------------------------

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

  getMeta(key) {
    return this.one("SELECT value FROM meta WHERE key = ?", key)?.value ?? null;
  }

  setMeta(key, value) {
    this.all("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value);
  }

  // Creates the tables. meta.schema_ver records what is done, so this runs once per version and changes nothing
  // after that. The constructor calls it before the room takes any request.
  migrate() {
    this.all("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value)");
    const ver = this.getMeta("schema_ver") ?? 0;
    if (ver >= SCHEMA_VER) return;
    this.ctx.storage.transactionSync(() => {
      if (ver < 1) for (const statement of SCHEMA_V1) this.all(statement);
      this.setMeta("schema_ver", SCHEMA_VER);
    });
  }

  // Runs a statement that changes at most BATCH rows (it ends in "... LIMIT 1000)") again and again until a
  // run changes fewer, so no single statement grows with the size of the room. Returns the rows changed.
  batched(statement, ...binds) {
    let total = 0;
    for (;;) {
      const changed = this.all(`${statement} RETURNING 1`, ...binds).length;
      total += changed;
      if (changed < BATCH) return total;
    }
  }

  // ---- Reading ---------------------------------------------------------------------------------------------

  // A page of the room for a reader: the newest `limit` visible messages before `beforeId` (or the newest of
  // all), oldest first. A limit over 100 means 100, and one that isn't a whole number from 1 up means 100 too.
  // A beforeId that isn't a whole number from 1 up is ignored.
  history(beforeId, limit = PAGE_MAX) {
    const n = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, PAGE_MAX) : PAGE_MAX;
    const before = Number.isSafeInteger(beforeId) && beforeId > 0 ? beforeId : Number.MAX_SAFE_INTEGER;
    const rows = this.all(
      `SELECT id, ts, uid, kind, spot, body, reply_to, likes FROM messages
       WHERE hidden_by IS NULL AND id < ? ORDER BY id DESC LIMIT ?`,
      before, n,
    );
    return this.toPublic(rows.reverse());
  }

  // Messages as the public frames every reader gets: {id, ts, nick, role, kind, spot, body, reply_to, likes},
  // and nothing else, so no user id or LINE data goes out. The nickname and role are looked up once per author,
  // one row each (cheaper here than a join, which reads a users row for every message). A message whose author
  // is gone (a report over 30 days old, or a deleted account) has no nickname, and shows as "a surfer".
  toPublic(rows) {
    const authors = new Map();
    const author = (uid) => {
      if (uid === null) return null;
      if (!authors.has(uid)) authors.set(uid, this.one("SELECT nick, role FROM users WHERE id = ?", uid));
      return authors.get(uid);
    };
    return rows.map((m) => {
      const who = author(m.uid);
      return {
        id: m.id,
        ts: m.ts,
        nick: who?.nick ?? null,
        role: who?.role ?? null,
        kind: m.kind,
        spot: m.spot,
        body: JSON.parse(m.body),
        reply_to: m.reply_to,
        likes: m.likes,
      };
    });
  }

  // The spot card's strip: {reports, online, last_id}. reports are the spot's newest 20 visible reports from the
  // last 4 hours, newest first, each only {ts, size, cond, crowd}. They are read from storage at most once a
  // minute per spot, and from a memory copy in between (messagesChanged() drops the copy when a report could have
  // changed). Returns null for a spot that isn't one of the 8.
  reportsFor(spot, nowMs) {
    if (!SPOTS.includes(spot)) return null;
    let copy = this.reportCopies.get(spot);
    if (!copy || nowMs - copy.at >= REPORT_COPY_MS) {
      const reports = this.all(
        `SELECT ts, json_extract(body, '$.size') AS size, json_extract(body, '$.cond') AS cond,
                json_extract(body, '$.crowd') AS crowd
         FROM messages WHERE kind = 'report' AND hidden_by IS NULL AND spot = ? AND ts > ?
         ORDER BY ts DESC LIMIT ?`,
        spot, nowMs - REPORT_WINDOW, REPORTS_MAX,
      );
      copy = { at: nowMs, reports };
      this.reportCopies.set(spot, copy);
    }
    const since = nowMs - REPORT_WINDOW;
    return { reports: copy.reports.filter((r) => r.ts > since), online: this.online(), last_id: this.lastId };
  }

  // Every write to messages (a new message, a hide, a restore, a delete) calls this, so the memory copies that
  // reportsFor() answers from follow it. It drops that spot's reports, or every spot's when no spot is given, and
  // looks up the newest visible message again (hidden ones don't light the CHAT button's dot).
  messagesChanged(spot) {
    if (spot === undefined) this.reportCopies.clear();
    else this.reportCopies.delete(spot);
    this.lastId = this.one("SELECT id FROM messages WHERE hidden_by IS NULL ORDER BY id DESC LIMIT 1")?.id ?? 0;
  }

  // How many sockets are open. Closing ones don't count.
  online() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).length;
  }

  // ---- Usage -----------------------------------------------------------------------------------------------

  // Approximate counts for today of room requests ("req") and SQL rows read and written ("read", "write"), for
  // the guard that rests the chat before the free plan's daily limits run out. all() adds the rows itself. The day
  // is UTC's, as the free limits reset at 00:00 UTC. The counts live in memory and are saved to meta every 100
  // requests, so a restart loses at most the last 99. Returns today's totals so far.
  usage(kind, n = 1) {
    if (kind !== "req" && kind !== "read" && kind !== "write") throw new Error(`usage: unknown kind ${kind}`);
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (this.used?.day !== day) this.used = this.savedUsage(day);
    this.used[kind] += n;
    if (kind === "req" && ++this.unsaved >= USAGE_SAVE_EVERY) this.saveUsage();
    return { ...this.used };
  }

  // These two use sql.exec directly, not all(): all() counts its rows through usage(), which they are part of.
  savedUsage(day) {
    const row = this.sql.exec("SELECT value FROM meta WHERE key = 'usage'").toArray()[0];
    const saved = row ? JSON.parse(row.value) : null;
    if (saved?.day === day) return { day, req: saved.req, read: saved.read, write: saved.write };
    return { day, req: 0, read: 0, write: 0 };
  }

  saveUsage() {
    this.unsaved = 0;
    const cursor = this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('usage', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      JSON.stringify(this.used),
    );
    cursor.toArray();
    this.used.write += cursor.rowsWritten;
  }

  // ---- Requests from the Worker ------------------------------------------------------------------------------

  // Every call from the Worker comes here. Each one counts as a request against the free plan's daily limit and
  // makes sure the alarm is set. There are no routes yet.
  async fetch() {
    this.usage("req");
    await this.ensureAlarm();
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // ---- Alarm -------------------------------------------------------------------------------------------------

  // When retention next runs. Kept in meta, and in memory once read.
  nextRetention() {
    if (this.retentionAt === null) {
      this.retentionAt = this.getMeta("next_retention");
      if (this.retentionAt === null) this.setNextRetention(this.now());
    }
    return this.retentionAt;
  }

  setNextRetention(nowMs) {
    this.retentionAt = retentionTimeAfter(nowMs);
    this.setMeta("next_retention", this.retentionAt);
  }

  // When the alarm should next go off: at the next retention run, or in 45 s for the keepalive tick while any
  // socket is open, whichever is sooner.
  alarmTime(nowMs) {
    const retention = this.nextRetention();
    return this.online() > 0 ? Math.min(retention, nowMs + KEEPALIVE_MS) : retention;
  }

  // Every room request calls this. It sets the alarm when none is set, and brings it forward when it is later than
  // needed (a socket has just opened, say). An earlier alarm is kept: alarm() works out the next one itself.
  async ensureAlarm() {
    const want = this.alarmTime(this.now());
    const set = await this.ctx.storage.getAlarm();
    if (set === null || set > want) await this.ctx.storage.setAlarm(want);
  }

  // The one alarm. Retention runs once it's past next_retention, then the keepalive tick goes out while sockets
  // are open, and the next alarm is always set, whatever happened before.
  async alarm() {
    const now = this.now();
    try {
      this.usage("req");
      if (now >= this.nextRetention()) {
        // The next run is set first, so a run that fails waits until tomorrow instead of retrying in a loop.
        this.setNextRetention(now);
        this.retention(now);
      } else {
        // Expired sign-ins go on every alarm, not only at 19:00: a handoff holds a raw LINE ID.
        this.dropExpiredLogins(now);
      }
      this.tick();
    } finally {
      await this.ctx.storage.setAlarm(this.alarmTime(now));
    }
  }

  // While any socket is open, each alarm tells every socket how many are online.
  tick() {
    const online = this.online();
    if (online > 0) this.broadcast({ type: "tick", online });
  }

  // Sends one frame to every open socket. A frame is a JSON object whose "type" is the spec's frame name.
  broadcast(frame) {
    const text = JSON.stringify(frame);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(text);
      } catch {
        // It closed in the meantime.
      }
    }
  }

  // ---- Retention -------------------------------------------------------------------------------------------

  // The daily clean-up, in the spec's order ("Retention (daily)"). Every step runs in batches of 1,000 rows.
  retention(now) {
    // Text messages and shared session cards after 30 days.
    this.batched(
      `DELETE FROM messages WHERE id IN (
         SELECT id FROM messages WHERE kind IN ('text', 'session') AND ts < ? LIMIT ${BATCH})`,
      now - KEEP_MESSAGES,
    );
    // Reports after a year; before that, the poster comes off them after 30 days.
    this.batched(
      `DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE kind = 'report' AND ts < ? LIMIT ${BATCH})`,
      now - KEEP_REPORTS,
    );
    this.batched(
      `UPDATE messages SET uid = NULL WHERE id IN (
         SELECT id FROM messages WHERE kind = 'report' AND ts < ? AND uid IS NOT NULL LIMIT ${BATCH})`,
      now - KEEP_REPORT_POSTER,
    );
    // Accounts not seen for 24 months, with their logs.
    this.deleteStaleAccounts(now - KEEP_ACCOUNT, now);
    // What pointed at messages that are gone now: shared session cards, likes and flags.
    this.batched(
      `UPDATE sessions SET shared_msg = NULL WHERE id IN (
         SELECT id FROM sessions s WHERE shared_msg IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = s.shared_msg) LIMIT ${BATCH})`,
    );
    this.batched(
      `DELETE FROM likes WHERE (msg_id, uid) IN (
         SELECT msg_id, uid FROM likes l WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = l.msg_id) LIMIT ${BATCH})`,
    );
    this.batched(
      `DELETE FROM flags WHERE rowid IN (
         SELECT rowid FROM flags f WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = f.msg_id) LIMIT ${BATCH})`,
    );
    // Flags after 180 days.
    this.batched(`DELETE FROM flags WHERE rowid IN (SELECT rowid FROM flags WHERE ts < ? LIMIT ${BATCH})`, now - KEEP_FLAGS);
    // Logins and handoffs past their 10 minutes, and holds after 180 days.
    this.dropExpiredLogins(now);
    this.batched(`DELETE FROM holds WHERE rowid IN (SELECT rowid FROM holds WHERE ts < ? LIMIT ${BATCH})`, now - KEEP_HOLDS);
    // A deleted LINE account's row after 30 days, unless it is banned (or has signed up again).
    this.batched(
      `DELETE FROM subs WHERE rowid IN (
         SELECT rowid FROM subs s WHERE banned = 0 AND deleted_at < ?
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.sub_hash = s.sub_hash) LIMIT ${BATCH})`,
      now - KEEP_DELETED_SUB,
    );
    this.messagesChanged();
  }

  dropExpiredLogins(now) {
    this.batched(`DELETE FROM logins WHERE rowid IN (SELECT rowid FROM logins WHERE created < ? LIMIT ${BATCH})`, now - LOGIN_TTL);
    this.batched(`DELETE FROM handoffs WHERE rowid IN (SELECT rowid FROM handoffs WHERE created < ? LIMIT ${BATCH})`, now - LOGIN_TTL);
  }

  // Deletes the accounts last seen before `cutoff`: their private logs go, their LINE account's row is marked
  // deleted (it goes 30 days later unless banned), and no message keeps their user id. Their text messages,
  // session cards and likes went long before (texts after 30 days, and a like needs a recent sign-in), and the
  // earlier steps already took them off their reports.
  deleteStaleAccounts(cutoff, now) {
    for (;;) {
      const stale = this.all(`SELECT id, sub_hash FROM users WHERE last_seen < ? LIMIT ${BATCH}`, cutoff);
      for (const { id, sub_hash } of stale) {
        this.batched(`DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE uid = ? LIMIT ${BATCH})`, id);
        this.batched(`UPDATE messages SET uid = NULL WHERE id IN (SELECT id FROM messages WHERE uid = ? LIMIT ${BATCH})`, id);
        this.all(
          `INSERT INTO subs (sub_hash, deleted_at) VALUES (?, ?)
           ON CONFLICT (sub_hash) DO UPDATE SET deleted_at = excluded.deleted_at`,
          sub_hash, now,
        );
        this.all("DELETE FROM users WHERE id = ?", id);
      }
      if (stale.length < BATCH) return;
    }
  }
}
