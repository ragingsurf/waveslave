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
//   startLogin ... signup      the LINE sign-in's rows: logins, handoffs, users and subs (spec "Login")
//   userFromToken(token)       the signed-in user a session token stands for, or null
//   closeUser(uid, code)       closes every socket signed in as that user
//
// Times are epoch milliseconds. The Worker calls the room as https://room/<route> with a JSON body.
import { DurableObject } from "cloudflare:workers";
import { pin6, randomB64u, readToken, sha256b64u, signToken, subHash } from "./auth.js";
import { checkNick, SPOTS } from "./mod.js";

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
const USAGE_SAVE_EVERY = 100; // requests between saves of the usage counts...
const USAGE_SAVE_MS = 30_000; // ...or time, whichever comes first

// How long things are kept (spec "How long things are kept" and "Retention (daily)").
const KEEP_MESSAGES = 30 * DAY; // text messages and shared session cards
const KEEP_REPORT_POSTER = 30 * DAY; // then a report shows as "a surfer"
const KEEP_REPORTS = 365 * DAY;
const KEEP_FLAGS = 180 * DAY;
const KEEP_HOLDS = 180 * DAY;
const LOGIN_TTL = 10 * MINUTE; // logins and handoffs
const LOGIN_GRACE = 1000; // the alarm comes back this long after a handoff runs out, so it is surely past
const KEEP_ACCOUNT = 730 * DAY; // accounts not seen for 24 months
const KEEP_DELETED_SUB = 30 * DAY; // a deleted, unbanned LINE account's row

// Signing in (spec "Login (LINE, web flow)").
const SESSION_TTL = 180 * DAY; // a session token is good for 180 days
const PIN_TRIES = 3; // wrong pins that void a handoff
const CONSENT_VER = "v1"; // the version of the house rules and privacy note a new account agrees to
const BODY_MAX = 4096; // bytes of JSON the room reads from a request body; the socket's frame limit is the same
const B64U_32 = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, or a SHA-256, as base64url: h and state
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/; // the app's own verifier v: 32 random bytes or more, as base64url
const CODE = /^[A-Za-z0-9_-]{22}$/; // the handoff code: 128 bits as base64url
const PIN = /^\d{6}$/;
const LINE_SUB_MAX = 100; // LINE writes a sub as "U" and 32 hex digits
const LINE_NAME_MAX = 50; // characters of the LINE name kept in a handoff, only to prefill the nickname box

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

const isText = (x, shape) => typeof x === "string" && shape.test(x);

const refuse = (status, error, more = {}) => Response.json({ error, ...more }, { status });

// The JSON object in a request body, or null: no body, over 4 KB, not UTF-8 JSON, or not an object. It stops reading
// at the limit, so a huge body costs the room no more than a small one.
async function readJson(request) {
  try {
    if (!request.body) return null;
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_MAX) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return data !== null && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// Two short codes of a fixed length (a pin, a hash), compared in time that doesn't depend on where they differ.
// Synchronous, unlike auth.js's sameText, so handoffFor() can read a handoff and write to it with no await between.
function sameCode(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.reportCopies = new Map(); // spot -> {at, reports}, the 60 s copies behind reportsFor()
    this.lastId = 0; // the newest visible message's id, for the CHAT button's dot; see messagesChanged()
    this.used = null; // today's usage counts, read from meta on first use
    this.unsaved = 0; // requests counted since the usage counts were last saved
    this.savedAt = null; // when the usage counts were last saved, by this copy of the room or an earlier one
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
  // is UTC's, as the free limits reset at 00:00 UTC. Returns today's totals so far; usage("req", 0) only reads them.
  //
  // The counts are kept in memory and saved to one meta row. The room sleeps after a few idle seconds and wakes as
  // a new copy that starts from that row, so it is saved often: on a request when 30 s have passed since the last
  // save (by any copy of the room, so the first request after a quiet spell saves), on the 100th request since
  // then, and at the end of every alarm (which also covers a room that wakes only for the 45 s keepalive). When a
  // copy goes, it loses only what came in since its last save: under 30 s of traffic, and fewer than 100 requests.
  // Saving on every request would cost a row written per request, which is the whole write limit at the request
  // limit; this costs at most about 5,000 rows a day (two saves per 45 s, plus one per 100 requests).
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

  // ---- Requests from the Worker ------------------------------------------------------------------------------

  // Every call from the Worker comes here (the front Worker's header lists the routes). Each one counts as a request
  // against the free plan's daily limit and makes sure the alarm is set. /r/logins, /r/logins/take and /r/handoffs
  // are the Worker's own steps of a LINE sign-in; the rest carry the app's request.
  async fetch(request) {
    this.usage("req");
    await this.ensureAlarm();
    const url = new URL(request.url);
    switch (`${request.method} ${url.pathname}`) {
      case "GET /r/reports": {
        const answer = this.reportsFor(url.searchParams.get("spot"), this.now());
        return answer ? Response.json(answer) : Response.json({ error: "spot" }, { status: 400 });
      }
      case "POST /r/logins":
        return this.startLogin(await readJson(request));
      case "POST /r/logins/take":
        return this.takeLogin(await readJson(request));
      case "POST /r/handoffs":
        return this.createHandoff(await readJson(request));
      case "POST /r/redeem":
        return this.redeem(await readJson(request));
      case "POST /r/signup":
        return this.signup(await readJson(request));
      default:
        return Response.json({ error: "not found" }, { status: 404 });
    }
  }

  // ---- Signing in (spec "Login (LINE, web flow)") -----------------------------------------------------------
  //
  // The Worker talks to LINE; the room keeps the rows. Every answer is JSON, and a refusal is {error} with one of:
  //   invalid  400  the body isn't the right shape
  //   state    404  no sign-in has that state, or it is over 10 minutes old
  //   expired  410  no live handoff for that code or v: never made, over 10 minutes old, used, or voided by 3 wrong pins
  //   v        403  the code's handoff was made for another verifier (SHA-256(v) isn't its h)
  //   pin      403  a wrong pin; the third voids the handoff
  //   banned   403  this LINE account can't sign in here
  //   consent  400  signup without the tick (consent "v1")
  //   nick     400  with code: checkNick's "length", "chars" or "reserved", or "taken"

  // Step 2: the app's sign-in starts, bound to h = SHA-256(v). The row keeps what the callback needs: state finds it,
  // nonce must come back inside LINE's ID token, and the PKCE verifier proves to LINE that the code came to us. The
  // Worker gets the state, the nonce and the code challenge (SHA-256 of the verifier) for LINE's address.
  async startLogin(body) {
    if (!isText(body?.h, B64U_32)) return refuse(400, "invalid");
    const state = randomB64u(32);
    const nonce = randomB64u(32);
    const verifier = randomB64u(32);
    const challenge = await sha256b64u(verifier);
    this.all(
      "INSERT INTO logins (state, nonce, pkce_verifier, h, created) VALUES (?, ?, ?, ?, ?)",
      state, nonce, verifier, body.h, this.now(),
    );
    return Response.json({ state, nonce, code_challenge: challenge });
  }

  // Step 3.1: LINE's callback brings the state back. Its row is read and deleted in one statement, so a state works
  // once, and one over 10 minutes old works not at all.
  takeLogin(body) {
    const row = typeof body?.state === "string"
      ? this.one("DELETE FROM logins WHERE state = ? RETURNING nonce, pkce_verifier, h, created", body.state)
      : null;
    if (!row || !(this.now() - row.created < LOGIN_TTL)) return refuse(404, "state");
    return Response.json({ nonce: row.nonce, pkce_verifier: row.pkce_verifier, h: row.h });
  }

  // Steps 3.4 and 3.5: LINE has said who this is (sub, checked by the Worker). The account code is made here, a banned
  // account stops here, and otherwise the handoff is stored for 10 minutes: the one row that holds a raw LINE sub. The
  // app gets the code, which is kept only as its SHA-256, and the pin.
  async createHandoff(body) {
    if (!isText(body?.h, B64U_32) || typeof body.sub !== "string" || body.sub === "" || body.sub.length > LINE_SUB_MAX) {
      return refuse(400, "invalid");
    }
    const lineName = typeof body.line_name === "string" ? [...body.line_name].slice(0, LINE_NAME_MAX).join("") : null;
    const account = await subHash(body.sub, this.env.SUB_PEPPER);
    const code = randomB64u(16);
    const codeHash = await sha256b64u(code);
    const pin = pin6();
    if (this.isBanned(account)) return refuse(403, "banned");
    const created = this.now();
    this.all(
      `INSERT INTO handoffs (code_hash, h, sub_hash, sub, line_name, pin, created, tries) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      codeHash, body.h, account, body.sub, lineName, pin, created,
    );
    // The raw sub must not outlive its 10 minutes, even in a room nobody visits, so the alarm comes back for it.
    await this.alarmBy(created + LOGIN_TTL + LOGIN_GRACE);
    return Response.json({ code, pin });
  }

  // Step 4 (and step 5, by pin): the app comes back with {v, code} or {v, pin}. A known user gets a session token and
  // the handoff goes. A new person gets {needs_signup, line_name}, and the handoff stays for the signup.
  async redeem(body) {
    const proof = await this.proof(body);
    if (!proof) return refuse(400, "invalid");
    const found = this.handoffFor(proof);
    if (found.error) return refuse(found.status, found.error);
    const known = this.signInKnown(found.row);
    if (known) return this.answerKnown(known);
    return Response.json({ needs_signup: true, line_name: found.row.line_name });
  }

  // Step 6: a new person signs up with the same proof, a nickname and the tick (consent "v1"). The account is made only
  // then, with when and to which version they agreed. The LINE name only prefilled the nickname box and is not kept,
  // and the handoff goes, with LINE's raw sub. A LINE account that already has an account is just signed in.
  async signup(body) {
    const proof = await this.proof(body);
    if (!proof) return refuse(400, "invalid");
    const found = this.handoffFor(proof);
    if (found.error) return refuse(found.status, found.error);
    const { row } = found;
    const known = this.signInKnown(row);
    if (known) return this.answerKnown(known);
    if (body.consent !== CONSENT_VER) return refuse(400, "consent");
    const nick = checkNick(body.nick);
    if (!nick.ok) return refuse(400, "nick", { code: nick.code });
    if (this.one("SELECT 1 FROM users WHERE nick_key = ?", nick.key)) return refuse(400, "nick", { code: "taken" });
    const now = this.now();
    const user = { id: crypto.randomUUID(), tv: 0 };
    this.ctx.storage.transactionSync(() => {
      // The LINE account's own row, which outlives the account. A ban on it stays; a past deletion no longer applies.
      this.all("INSERT INTO subs (sub_hash) VALUES (?) ON CONFLICT (sub_hash) DO UPDATE SET deleted_at = NULL", row.sub_hash);
      this.all(
        `INSERT INTO users (id, sub_hash, nick, nick_key, role, tv, created, last_seen, nick_changed, consent_at, consent_ver)
         VALUES (?, ?, ?, ?, 'user', 0, ?, ?, NULL, ?, ?)`,
        user.id, row.sub_hash, nick.nick, nick.key, now, now, now, CONSENT_VER,
      );
      this.all("DELETE FROM handoffs WHERE code_hash = ?", row.code_hash);
    });
    return Response.json({ token: await this.tokenFor(user, now) });
  }

  // What a redeem or signup body proves: h = SHA-256(v), plus the code's SHA-256 or the pin (the code wins if both
  // come). The hashing happens here, before any handoff is read. null for a body with neither, or a field of the
  // wrong shape.
  async proof(body) {
    if (!isText(body?.v, VERIFIER)) return null;
    const h = await sha256b64u(body.v);
    if (body.code !== undefined) return isText(body.code, CODE) ? { h, codeHash: await sha256b64u(body.code) } : null;
    if (body.pin !== undefined) return isText(body.pin, PIN) ? { h, pin: body.pin } : null;
    return null;
  }

  // The live handoff a proof opens ({row}), or what to refuse with ({status, error}). Live means under 10 minutes old
  // and not voided.
  //   By code: the handoff must have been made for this v. A wrong v leaves it as it is, so the app that does hold v
  //     can still use the pin (the "login finished in another browser" case).
  //   By pin: the live handoffs made for this v are checked against it. A wrong pin counts against each of them, and
  //     the third voids (deletes) them. Nothing here awaits, so no other request runs between reading the count and
  //     writing it: guesses sent at the same moment still get three tries in all.
  handoffFor(proof) {
    const since = this.now() - LOGIN_TTL;
    if (proof.codeHash) {
      const row = this.one(
        "SELECT * FROM handoffs WHERE code_hash = ? AND created > ? AND tries < ?",
        proof.codeHash, since, PIN_TRIES,
      );
      if (!row) return { status: 410, error: "expired" };
      if (!sameCode(row.h, proof.h)) return { status: 403, error: "v" };
      return { row };
    }
    const live = this.all("SELECT * FROM handoffs WHERE h = ? AND created > ? AND tries < ?", proof.h, since, PIN_TRIES);
    if (live.length === 0) return { status: 410, error: "expired" };
    const row = live.find((r) => sameCode(r.pin, proof.pin));
    if (row) return { row };
    this.all("UPDATE handoffs SET tries = tries + 1 WHERE h = ? AND created > ? AND tries < ?", proof.h, since, PIN_TRIES);
    this.all("DELETE FROM handoffs WHERE h = ? AND tries >= ?", proof.h, PIN_TRIES);
    return { status: 403, error: "pin" };
  }

  // A handoff that was opened, for an account that is banned or already exists: the handoff goes, and a known user's
  // last_seen comes up to now (signing in is what keeps an account from the 24-month clean-up). Returns "banned", the
  // user {id, tv}, or null for a new person, whose handoff stays.
  signInKnown(row) {
    if (this.isBanned(row.sub_hash)) {
      this.all("DELETE FROM handoffs WHERE code_hash = ?", row.code_hash);
      return "banned";
    }
    const user = this.one("SELECT id, tv FROM users WHERE sub_hash = ?", row.sub_hash);
    if (!user) return null;
    this.ctx.storage.transactionSync(() => {
      this.all("DELETE FROM handoffs WHERE code_hash = ?", row.code_hash);
      this.all("UPDATE users SET last_seen = ? WHERE id = ?", this.now(), user.id);
    });
    return user;
  }

  async answerKnown(known) {
    if (known === "banned") return refuse(403, "banned");
    return Response.json({ token: await this.tokenFor(known, this.now()) });
  }

  isBanned(account) {
    return Boolean(this.one("SELECT banned FROM subs WHERE sub_hash = ?", account)?.banned);
  }

  // Step 7: the session token, base64url {uid, tv, exp} signed with SESSION_SECRET, good for 180 days.
  tokenFor(user, now) {
    return signToken({ uid: user.id, tv: user.tv, exp: now + SESSION_TTL }, this.env.SESSION_SECRET);
  }

  // The user a session token stands for, as {id, nick, role, tv}, or null: a token that isn't ours or has expired, a
  // user who is gone or whose LINE account is banned, or a tv that has moved on (signed out everywhere). The socket's
  // hello and every /me call check this. Two rows read, both by key.
  async userFromToken(token) {
    const claims = await readToken(token, this.env.SESSION_SECRET, this.now());
    if (!claims) return null;
    const user = this.one(
      `SELECT u.id, u.nick, u.role, u.tv, s.banned FROM users u LEFT JOIN subs s ON s.sub_hash = u.sub_hash WHERE u.id = ?`,
      claims.uid,
    );
    if (!user || user.banned || user.tv !== claims.tv) return null;
    return { id: user.id, nick: user.nick, role: user.role, tv: user.tv };
  }

  // Closes every socket signed in as uid (its attachment says whose it is) with the close code given: on signing out
  // everywhere, a ban or an account deletion.
  closeUser(uid, code) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (ws.deserializeAttachment()?.uid === uid) ws.close(code);
      } catch {
        // It closed in the meantime.
      }
    }
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
    await this.alarmBy(this.alarmTime(this.now()));
  }

  // Makes sure the alarm goes off by `at`: sets it when none is set or the one set is later.
  async alarmBy(at) {
    const set = await this.ctx.storage.getAlarm();
    if (set === null || set > at) await this.ctx.storage.setAlarm(at);
  }

  // When the oldest handoff left runs out (just after), or Infinity when there is none. One row read at most per
  // handoff waiting, and the table only holds sign-ins of the last 10 minutes.
  handoffsDue() {
    const oldest = this.one("SELECT min(created) AS created FROM handoffs")?.created ?? null;
    return oldest === null ? Infinity : oldest + LOGIN_TTL + LOGIN_GRACE;
  }

  // The one alarm. Retention runs once it's past next_retention, then the keepalive tick goes out while sockets
  // are open. Whatever happened before, the alarm is counted as a request, the usage counts are saved and the next
  // alarm is set: the next retention or tick, or sooner when a handoff still waiting runs out before them.
  async alarm() {
    const now = this.now();
    let handoffsDue = Infinity;
    try {
      if (now >= this.nextRetention()) {
        // The next run is set first, so a run that fails waits until tomorrow instead of retrying in a loop.
        this.setNextRetention(now);
        this.retention(now);
      } else {
        // Expired sign-ins go on every alarm, not only at 19:00: a handoff holds a raw LINE ID.
        this.dropExpiredLogins(now);
      }
      handoffsDue = this.handoffsDue();
      this.tick();
    } finally {
      try {
        // Counted last, so the save covers the rows the alarm itself read and wrote. usage() may have saved
        // already (30 s since the last save); then there is nothing left to save.
        this.usage("req");
        if (this.unsaved > 0) this.saveUsage();
      } finally {
        await this.ctx.storage.setAlarm(Math.min(this.alarmTime(now), handoffsDue));
      }
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
