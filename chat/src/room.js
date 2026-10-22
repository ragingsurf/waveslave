// The room: the one Durable Object behind the Taiwan chat, named "taiwan". All the chat's data lives in its
// SQLite storage. The design is in docs/superpowers/specs/2026-10-21-taiwan-chat-design.md, "Data (room
// SQLite)", "Alarm", "Retention (daily)", "Moderation" and "Free-plan budget".
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
//   signOut                    POST /me/signout: every token of the user stops working, and their sockets close
//   canWrite(user, kind)       the one gate for every write, from the socket and from /me: sign-in, ban, lock, limits
//   openSocket, webSocket*     the socket and its frames (spec "Socket protocol"; the frames are listed there below)
//   onFlag, flagger()          the report button, and when a flag counts (spec "Moderation", step 4)
//   onAdmin                    Bryan's claim to the admin role (step 7)
//   onBan ... onHiddenList     Bryan's tools (step 5), plus his Delete in onDelete
//   where                      GET /admin/where: which Cloudflare data centre the room lives in
//   mySessions ... deleteAccount   the /me routes: the surf diary, the user's own data, and deleting the account
//   shareSession, onShare      a log from the diary as a session card in the room, and out of it again (onUnshare)
//   rest()                     the free-plan guard: past 90% of a daily limit the chat rests until 00:00 UTC
//
// Times are epoch milliseconds. The Worker calls the room as https://room/<route> with a JSON body.
import { DurableObject } from "cloudflare:workers";
import { hmacB64u, pin6, randomB64u, readToken, sameText, sha256b64u, signToken, subHash } from "./auth.js";
import { blocked, checkNick, normalise, REASONS, SPOTS, validReport, validSession } from "./mod.js";
import BLOCKLIST from "../blocklist.json";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
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

// The socket (spec "Socket protocol").
const PROTO = 1; // the protocol version this room speaks; chat.js sends its own in hello
const PROTO_OLDEST = Math.max(1, PROTO - 1); // the room takes the current version and the one before it
const FRAME_MAX = 4096; // bytes of UTF-8 in one frame; a bigger one closes the socket
const BAD_FRAMES = 5; // bad frames that close a socket
const SOCKETS_PER_IP = 5;
// Frames one socket may send, of any kind (ruling R22). Every frame the room's code sees is a room request against the
// free plan's 100,000 a day (DAILY_LIMITS), refused or not, so without this one connection could spend the whole day's
// budget and put the chat to rest. 1,000 is 1% of it. The room's own limits keep a person far below that: 20 messages
// and 30 likes per 10 minutes, a page of older messages a second. A reconnecting client counts from nothing on each new
// socket, and chat.js starts a new one after 5 minutes in the background. The next frame past it is not answered: the
// socket is closed with 1008, as for bad frames, which chat.js takes as a drop and opens a new socket after 1 s.
// Bryan's sockets (role "admin") aren't counted, so his tools always work.
const FRAMES_PER_SOCKET = 1000;
const OLDER_PAGE = 50; // messages in each page of older ones
const OLDER_EVERY = SECOND; // one page of older messages a second per socket
const TEXT_MAX = 500; // characters in a text message
// Close codes. 1008 and 1009 are the standard ones; the 44xx ones are the chat's own, for chat.js to read.
const CLOSE_BAD = 1008; // five bad frames, or more than FRAMES_PER_SOCKET
const CLOSE_TOO_BIG = 1009; // a frame over 4 KB
const CLOSE_SIGNED_OUT = 4401; // the account signed out everywhere, or was deleted: its tokens no longer work
const CLOSE_BANNED = 4403; // Bryan banned the account: "This LINE account can't post here"
const CLOSE_UPDATE = 4426; // the app speaks a protocol version the room no longer takes, so it must reload
const CLOSE_RESTING = 4429; // the chat is resting (rest()): "Chat is resting until 08:00"

// What a socket's attachment holds (it lives with the socket, through hibernation): uid, tv and role once it has said
// hello with a good token, and null for a reader; v, its protocol version, once it has said hello; bad, the bad frames
// it has sent; olderAt, when it last got a page of older messages; and frames, every frame it has sent (but "ping").
const NEW_SOCKET = Object.freeze({ uid: null, tv: null, role: null, v: null, bad: 0, olderAt: 0, frames: 0 });

// The frames a socket may send, and the method that answers each. Reading needs no sign-in (Bryan, Oct 21: sign in
// with LINE to post), so hello and older work for everyone; the writes need a socket that said hello signed in, and
// Bryan's tools need Bryan (role "admin").
const READS = { hello: "onHello", older: "onOlder" };
const WRITES = {
  say: "onSay", report: "onReport", like: "onLike", delete: "onDelete", nick: "onNick", flag: "onFlag", admin: "onAdmin",
  share: "onShare", unshare: "onUnshare",
};
const ADMIN_TOOLS = {
  ban: "onBan", unban: "onUnban", restore: "onRestore", keep: "onKeep", lock: "onLock", unlock: "onUnlock",
  hidden_list: "onHiddenList",
};

// The rate limits (spec "Moderation", step 3), per LINE account. Each rule lets `max` writes through in a window of
// `ms` that opens with the first of them. The counts are kept in limits as "<sub_hash>:<rule>", so the room can sleep
// between writes. Deleting the account deletes them with it, as the spec's list of what deletion removes says
// (forgetAccount()). An account made again starts as a new one, under the new-account limit below, and a ban still
// holds through subs.
const SAY_LIMITS = [{ rule: "say:5s", max: 1, ms: 5 * SECOND }, { rule: "say:10m", max: 20, ms: 10 * MINUTE }];
const NEW_ACCOUNT = DAY; // accounts younger than this may also post only...
const NEW_SAY_LIMIT = { rule: "say:1h", max: 10, ms: HOUR }; // ...10 messages an hour
const REPORT_LIMIT = { rule: "report:1d", max: 6, ms: DAY }; // plus one per spot every 2 hours, "report:<spot>"
const REPORT_SPOT_EVERY = 2 * HOUR;
const LIKE_LIMIT = { rule: "like:10m", max: 30, ms: 10 * MINUTE };
const FLAG_LIMIT = { rule: "flag:1d", max: 20, ms: DAY };
const NICK_EVERY = 7 * DAY; // one nickname change a week, counted from users.nick_changed
const NICK_HELD = 30 * DAY; // how long a freed nickname is kept for the account that had it
const SESSION_LIMIT = { rule: "session:1d", max: 20, ms: DAY }; // private logs: 20 a day...
const SESSIONS_MAX = 1000; // ...and 1,000 in all, counted from sessions
const SHARE_LIMIT = { rule: "share:1d", max: 5, ms: DAY }; // shared session cards: 5 a day

// The writes a locked room (meta "locked" = 1) stops: the ones that post to the room. Bryan still can.
const POSTS = new Set(["say", "report", "share"]);

// The free plan's daily limits (spec "Free-plan budget", checked 2026-10-21): Durable Object requests, and SQL rows read
// and written. The Worker's own limit is also 100,000 requests a day, and nearly every Worker request is a room
// request too, so the room's count stands for both. Past 90% of any of them the chat rests (rest()) until the counts
// start again at 00:00 UTC. The counts are approximate (see usage()), and the tenth left over covers that, and the
// alarm's daily clean-up, which still runs.
const DAILY_LIMITS = Object.freeze({ req: 100_000, read: 5_000_000, write: 100_000 });
const REST_AT = 0.9;

// The report button (spec "Moderation", step 4). A flag counts only from an account at least 24 hours old with a
// post, that isn't banned and has fewer than 2 flags Bryan has rejected; 3 counted flags hide a message. A sexual or
// child-safety flag hides it alone when it comes from an account at least 7 days old with 5 posts or more, at most 3
// times a day per LINE account; past that it counts as one of the 3.
const FLAGS_TO_HIDE = 3;
const FLAGGER_AGE = DAY;
const FLAGGER_REJECTED = 2;
const ONE_FLAG_REASONS = new Set(["sexual", "child"]);
const ONE_FLAG_AGE = 7 * DAY;
const ONE_FLAG_POSTS = 5;
const ONE_FLAG_LIMIT = { rule: "oneflag:1d", max: 3, ms: DAY };

// Bryan's tools (step 5) and his claim (step 7).
const BAN_HIDES = DAY; // a ban hides the user's messages from the last 24 hours
const ADMIN_CODE_MIN = 32; // an ADMIN_CODE shorter than this switches the claim off
const CLAIM_TRIES = 3; // wrong codes that stop one LINE account claiming...
const CLAIM_TRIES_ALL = 10; // ...and wrong codes in all that stop everyone, until ADMIN_CODE is changed
// "/admin <code>" as typed, with either slash, in front of the code in an admin frame; and any slash command.
const ADMIN_COMMAND = /^[/／]admin\s+/iu;
const SLASH = /^[/／]/u;
const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace"; // Cloudflare's own page, which says where it was served
const COLO = /^colo=[A-Z]{3}$/;

// A message's columns as the room reads them to send it out (toPublic()).
const MSG_COLS = "id, ts, uid, kind, spot, body, reply_to, likes";

// DELETE /me/sessions/<id> reaches the room as this path and the log's id. The id is written as the room writes it:
// a whole number from 1 up, with no leading zero.
const SESSION_PATH = "/r/me/sessions/";
const SESSION_ID = /^[1-9]\d{0,15}$/;

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
  // One row per LINE account. It outlives account deletion, so deleting an account doesn't undo a ban (the limit
  // counts do go with the account: see SAY_LIMITS). A deleted, unbanned row goes after 30 days.
  `CREATE TABLE subs (
    sub_hash TEXT PRIMARY KEY,
    banned INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  )`,
  // The banned LINE accounts, for Bryan's Unban list.
  "CREATE INDEX subs_banned ON subs (sub_hash) WHERE banned = 1",
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
  // Bryan's hidden list, which reads only the hidden messages.
  "CREATE INDEX messages_hidden ON messages (id) WHERE hidden_by IS NOT NULL",
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
  // One LINE account's flags: how many Bryan has rejected (flagger()), and the ones that go with the account.
  "CREATE INDEX flags_sub ON flags (sub_hash, rejected)",
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

// A /me route's answer to a write canWrite() refused: 401 auth, 403 banned or locked, 429 slow:<seconds>.
function refuseWrite(code) {
  if (code === "auth") return refuse(401, code);
  return refuse(code.startsWith("slow:") ? 429 : 403, code);
}

const resting = () => Response.json({ resting: true }, { status: 503 });

// Two short codes of a fixed length (a pin, a hash), compared in time that doesn't depend on where they differ.
// Synchronous, unlike auth.js's sameText, so handoffFor() can read a handoff and write to it with no await between.
function sameCode(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The token in an "Authorization: Bearer <token>" header, or null.
const bearer = (request) => /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;

const isId = (x) => Number.isSafeInteger(x) && x > 0;

// The size of a frame in bytes. A string's UTF-8 is never shorter than its UTF-16 length, so only a short string has
// to be encoded to be measured.
function frameBytes(message) {
  if (typeof message !== "string") return message.byteLength;
  return message.length > FRAME_MAX ? message.length : new TextEncoder().encode(message).byteLength;
}

// A frame as the room reads it: a JSON object with a string type. null for anything else, a binary frame included.
function readFrame(message) {
  if (typeof message !== "string") return null;
  try {
    const frame = JSON.parse(message);
    return frame !== null && typeof frame === "object" && !Array.isArray(frame) && typeof frame.type === "string" ? frame : null;
  } catch {
    return null;
  }
}

// error {code}, with the type of the frame it answers when that is one the room knows, so chat.js can show it in the
// right place (the message box, the report sheet, the nickname box).
const errorFrame = (code, about) => ({ type: "error", code, ...(about ? { for: about } : {}) });

// The field a gone answer copies from the frame it answers: what that frame named, so chat.js knows which message, log
// or LINE account to take off its screen.
const GONE_TARGET = {
  say: "reply_to", like: "id", flag: "id", delete: "id", ban: "msg_id", unban: "sub_hash", restore: "id", keep: "id",
  share: "session_id", unshare: "session_id",
};

// slow:<seconds>, the wait rounded up to a whole second.
const slowFor = (ms) => `slow:${Math.ceil(ms / SECOND)}`;

// The limits a write of `kind` counts against (see SAY_LIMITS).
function limitsFor(user, kind, spot, now) {
  switch (kind) {
    case "say":
      return user.created > now - NEW_ACCOUNT ? [...SAY_LIMITS, NEW_SAY_LIMIT] : SAY_LIMITS;
    case "report":
      return [REPORT_LIMIT, { rule: `report:${spot}`, max: 1, ms: REPORT_SPOT_EVERY }];
    case "like":
      return [LIKE_LIMIT];
    case "flag":
      return [FLAG_LIMIT];
    case "session":
      return [SESSION_LIMIT];
    case "share":
      return [SHARE_LIMIT];
    default:
      return [];
  }
}

// A freed nickname's hold, kept in limits until it runs out: "held:<nick_key>:<sub_hash of the account that had it>".
// A nickname key has no ":" or ";" (checkNick allows only letters, digits, spaces, "_", "." and "-", and the key drops
// all but the letters and digits), so every hold on one name sorts between "held:<key>:" and "held:<key>;".
const heldKey = (nickKey, sub) => `held:${nickKey}:${sub}`;

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
    // chat.js sends "ping" when it comes back to the foreground. The runtime answers it without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
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

  // ---- Resting (spec "Free-plan budget") ---------------------------------------------------------------------

  // The guard that keeps the chat inside the free plan. It says whether the chat is resting: today's counts are past
  // 90% of one of the daily limits (DAILY_LIMITS). If so, it closes every open socket with 4429, which chat.js shows
  // as "Chat is resting until 08:00" (the counts start again at 00:00 UTC, 08:00 in Taiwan), and fetch() answers 503
  // {resting: true}. fetch() and every frame ask this before anything else, once they have counted themselves; the
  // alarm asks before its tick (it counts itself at its end).
  rest() {
    const used = this.usage("req", 0);
    if (!Object.entries(DAILY_LIMITS).some(([kind, limit]) => used[kind] > limit * REST_AT)) return false;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close(CLOSE_RESTING, "resting");
      } catch {
        // It closed in the meantime.
      }
    }
    return true;
  }

  // ---- Requests from the Worker ------------------------------------------------------------------------------

  // Every call from the Worker comes here (the front Worker's header lists the routes). Each one counts as a request
  // against the free plan's daily limit and makes sure the alarm is set. /r/logins, /r/logins/take and /r/handoffs
  // are the Worker's own steps of a LINE sign-in; the rest carry the app's request. While the chat rests, every one of
  // them is answered 503 {resting: true}, and a new socket is closed at once with 4429 (restingSocket()).
  async fetch(request) {
    this.usage("req");
    await this.ensureAlarm();
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    if (this.rest()) return route === "GET /r/ws" ? this.restingSocket(request) : resting();
    switch (route) {
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
      case "GET /r/ws":
        return this.openSocket(request);
      case "POST /r/me/signout":
        return this.signOut(request);
      case "GET /r/me/sessions":
        return this.mySessions(request);
      case "POST /r/me/sessions":
        return this.logSession(request);
      case "GET /r/me/export":
        return this.exportMine(request);
      case "DELETE /r/me":
        return this.deleteAccount(request);
      case "GET /r/where":
        return this.where(request);
      default:
        if (request.method === "DELETE" && url.pathname.startsWith(SESSION_PATH)) {
          return this.deleteSession(request, url.pathname.slice(SESSION_PATH.length));
        }
        return refuse(404, "not found");
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
  //   nick     400  with code: checkNick's "length", "chars" or "reserved", "blocked:<rule>" for a name the filters
  //                 stop, or "taken" (in use, or freed by another account in the last 30 days); see nickFor()

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
    const now = this.now();
    const nick = this.nickFor(body.nick, row.sub_hash, null, now);
    if (nick.code) return refuse(400, "nick", { code: nick.code });
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

  // The user a session token stands for, as account() gives it, or null: a token that isn't ours or has expired, a
  // user who is gone or whose LINE account is banned, or a tv that has moved on (signed out everywhere). Every /me call
  // checks this, and passes the user to canWrite(). The socket's hello uses signedIn(), which also says which it was.
  async userFromToken(token) {
    return (await this.signedIn(token)).user ?? null;
  }

  // {user} for a session token that checks out, or {error}: "banned" for a banned LINE account, "auth" for the rest.
  async signedIn(token) {
    const claims = await readToken(token, this.env.SESSION_SECRET, this.now());
    const user = claims ? this.account(claims.uid, claims.tv) : null;
    if (!user) return { error: "auth" };
    if (user.banned) return { error: "banned" };
    return { user };
  }

  // The account uid as of token version tv: {id, nick, nick_key, role, tv, created, nick_changed, sub_hash, banned},
  // or null when the user is gone or has signed out everywhere since (tv has moved on). Two rows read, both by key.
  // Only the room reads this; nothing in it goes out in a public frame.
  account(uid, tv) {
    if (typeof uid !== "string") return null;
    const user = this.one(
      `SELECT u.id, u.nick, u.nick_key, u.role, u.tv, u.created, u.nick_changed, u.sub_hash, s.banned
       FROM users u LEFT JOIN subs s ON s.sub_hash = u.sub_hash WHERE u.id = ?`,
      uid,
    );
    if (!user || user.tv !== tv) return null;
    return { ...user, banned: Boolean(user.banned) };
  }

  // Whether `raw` may be the nickname of LINE account `sub` (user uid, or null for a new account): {nick, key} to
  // store, or {code}: checkNick's "length", "chars" or "reserved"; "blocked:<rule>" for a name the hard-block filters
  // stop (a nickname shows on every post, so no phone numbers, links or LINE IDs there either); or "taken" when another
  // user has it, or another account gave it up less than 30 days ago (spec "Moderation", step 3).
  nickFor(raw, sub, uid, now) {
    const nick = checkNick(raw);
    if (!nick.ok) return { code: nick.code };
    const hit = blocked(normalise(nick.nick).check, BLOCKLIST);
    if (hit) return { code: `blocked:${hit.rule}` };
    const owner = this.one("SELECT id FROM users WHERE nick_key = ?", nick.key);
    if (owner && owner.id !== uid) return { code: "taken" };
    const holds = this.all(
      "SELECT key FROM limits WHERE key > ? AND key < ? AND window_end > ?",
      `held:${nick.key}:`, `held:${nick.key};`, now,
    );
    if (holds.some((hold) => hold.key !== heldKey(nick.key, sub))) return { code: "taken" };
    return { nick: nick.nick, key: nick.key };
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

  // POST /me/signout (Authorization: Bearer <token>): signs the user out everywhere. tv goes up, so every token they
  // hold stops working, and each of their sockets closes with 4401. 401 {error: "auth"} without a good token.
  async signOut(request) {
    const user = await this.userFromToken(bearer(request));
    if (!user) return refuse(401, "auth");
    this.all("UPDATE users SET tv = tv + 1 WHERE id = ?", user.id);
    this.closeUser(user.id, CLOSE_SIGNED_OUT);
    return Response.json({ ok: true });
  }

  // ---- The gate for writes ---------------------------------------------------------------------------------------

  // The one gate for every write, from the socket and from /me: null when `user` (as account() or userFromToken()
  // gives it) may make a write of this kind now, or the error code that says why not:
  //   auth       no user: not signed in, or the account is gone or signed out everywhere
  //   banned     the LINE account is banned
  //   locked     the room is locked (meta "locked" = 1); only posting stops (POSTS), and never for Bryan
  //   slow:<s>   over a rate limit, with the seconds until the write would go through
  // Kinds: say, report (with its spot), like, delete, nick, flag and admin (a claim), and the name of each of Bryan's
  // tools; from the diary, session (a private log), share and unshare (a log's card in the room), and account (deleting
  // it). A null answer also counts the write against its limits, so the caller asks last, once nothing else can
  // refuse it. A nickname change is limited by users.nick_changed, which the change itself sets, so for "nick" this
  // only checks.
  canWrite(user, kind, spot = null) {
    if (!user) return "auth";
    if (user.banned) return "banned";
    if (POSTS.has(kind) && user.role !== "admin" && this.getMeta("locked") === 1) return "locked";
    const now = this.now();
    if (kind === "nick") {
      const wait = user.nick_changed === null ? 0 : user.nick_changed + NICK_EVERY - now;
      return wait > 0 ? slowFor(wait) : null;
    }
    const wait = this.useLimits(user.sub_hash, limitsFor(user, kind, spot, now), now);
    return wait > 0 ? slowFor(wait) : null;
  }

  // Counts one use of each of `limits` (see SAY_LIMITS) for LINE account `sub` and returns 0, when every one of them
  // has room. Otherwise it counts nothing, and returns how long until they all have room again, in ms.
  useLimits(sub, limits, now) {
    const counts = limits.map((limit) => {
      const key = `${sub}:${limit.rule}`;
      const row = this.one("SELECT n, window_end FROM limits WHERE key = ?", key);
      return { ...limit, key, open: row !== null && row.window_end > now ? row : null };
    });
    const wait = Math.max(0, ...counts.map(({ open, max }) => (open && open.n >= max ? open.window_end - now : 0)));
    if (wait > 0) return wait;
    for (const { key, ms, open } of counts) {
      this.all(
        "INSERT INTO limits (key, n, window_end) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET n = excluded.n, window_end = excluded.window_end",
        key, open ? open.n + 1 : 1, open ? open.window_end : now + ms,
      );
    }
    return 0;
  }

  // ---- The socket (spec "Socket protocol") ---------------------------------------------------------------------
  //
  // JSON frames of at most 4 KB, each an object whose "type" is the frame's name. From the app:
  //   hello {v, token?}                    first, once per socket
  //   older {before_id}                    a page of 50 older messages
  //   say {text, spot?, reply_to?}         a text message
  //   report {spot, size, cond, crowd, snap?}
  //   like {id}, delete {id}, nick {nick}
  //   share {session_id}, unshare {session_id}   one of the user's logs as a session card in the room, or out of it
  //   flag {id, reason}                    the report button; reason is spam, harass, sexual, child or other
  //   admin {code}                         Bryan's claim: chat.js sends any text that starts with a slash this way
  //   "ping"                               plain text, answered "pong" by the runtime without waking the room
  // From Bryan only (role "admin"; from anyone else they get error invalid):
  //   ban {msg_id}, unban {sub_hash}, restore {id}, keep {id}, lock, unlock, hidden_list
  // To the app:
  //   me {nick, role, locked?}             who the socket is signed in as: after hello, after a nickname change, and
  //                                        after Bryan's claim (role "admin"). Bryan's also says whether the room is
  //                                        locked, so his menu offers Lock or Unlock
  //   history {messages, before_id?}       after hello (the last 100), or the answer to older
  //   msg {msg}                            a message, to every socket: a new one, or one Bryan restored
  //   update {id, likes} | {id, deleted: true} | {id, hidden: true}
  //   online {online}                      when a socket says hello or closes
  //   tick {online}                        every 45 s while any socket is open (alarm())
  //   error {code, for?}                   auth, banned, locked, slow:<s>, blocked:<rule>, invalid, gone, update,
  //                                        size, nick:<length|chars|reserved|taken>, or admin (a claim refused); "for"
  //                                        is the frame's type. gone answers a frame that is well formed but names
  //                                        something that isn't there (any more): a message deleted or hidden a
  //                                        moment ago, a log deleted on another screen, a LINE account with no row.
  //                                        A gone answer also carries what the frame named, as it named it (id,
  //                                        msg_id, reply_to, session_id or sub_hash: GONE_TARGET)
  //   ok {for: "share", session_id, shared_msg} | {for: "unshare", session_id}   to the socket that asked
  // To Bryan's sockets only:
  //   msg {msg} with msg.hidden            a message just hidden, with why ("flags", "ban" or "admin"), where everyone
  //                                        else gets update {id, hidden: true}
  //   hidden {count, messages, banned, banned_count}   the answer to hidden_list
  //   ok {for, ...}                        one of his tools did its work; lock and unlock go to all his sockets
  // Messages are always the public frame (toPublic()), so no user id or LINE data goes out; only Bryan's sockets learn
  // why a message was hidden, and the LINE account code (sub_hash) that unban takes. A socket that sends five bad
  // frames (invalid ones, or writes before signing in) is closed with 1008. gone is not a bad frame: a working app gets
  // it from ordinary races (a double tap, a like on a message hidden just as it was tapped). A frame over 4 KB closes
  // it with 1009. A socket that has sent 1,000 frames of any kind is closed with 1008 at the next one, unanswered
  // (FRAMES_PER_SOCKET); Bryan's never are. Each address may hold 5 sockets. The room's own close codes: 4401 signed out
  // everywhere (or the account is deleted), 4403 banned, 4426 reload for the new chat, and 4429 resting.

  // GET /ws, once the Worker has checked the Origin: a new socket, unless the visitor's address already holds 5. The
  // address is kept only as a tag on its sockets, and only as its HMAC under SUB_PEPPER, so the room never holds an IP
  // address. Tags live with the sockets, through hibernation, and never in storage (the spec counts them "in memory
  // only").
  async openSocket(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return refuse(426, "upgrade");
    const tag = `ip:${await hmacB64u(this.env.SUB_PEPPER, request.headers.get("CF-Connecting-IP") ?? "")}`;
    // Counted and accepted with no await in between, so two sockets at once can't both take the last place.
    if (this.ctx.getWebSockets(tag).filter((ws) => ws.readyState === WebSocket.OPEN).length >= SOCKETS_PER_IP) {
      return refuse(429, "sockets");
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [tag]);
    server.serializeAttachment(NEW_SOCKET);
    // fetch() set the alarm before this socket was open; now the 45 s keepalive starts.
    await this.ensureAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  // GET /ws while the chat rests: the socket is accepted only to be closed at once with 4429. A refused upgrade would
  // look to chat.js like any other failure ("Chat is offline · Retry"); the close code says "Chat is resting until
  // 08:00". It is never one of the room's sockets, so it takes no place and isn't counted online.
  restingSocket(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return refuse(426, "upgrade");
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.close(CLOSE_RESTING, "resting");
    return new Response(null, { status: 101, webSocket: client });
  }

  // Every frame from a socket but "ping". Each one is a room request against the free plan's daily limit. While the
  // chat rests, a frame isn't answered: the socket is closed with 4429, with every other open one (rest()). A frame past
  // the socket's 1,000 isn't answered either: the socket is closed with 1008 (overFrames()).
  async webSocketMessage(ws, message) {
    this.usage("req");
    await this.ensureAlarm();
    if (this.rest()) return;
    if (this.overFrames(ws)) return;
    if (frameBytes(message) > FRAME_MAX) {
      this.send(ws, errorFrame("size"));
      ws.close(CLOSE_TOO_BIG, "frame too big");
      return;
    }
    const frame = readFrame(message);
    const known = (list) => Object.hasOwn(list, frame.type);
    const type = frame && (known(READS) || known(WRITES) || known(ADMIN_TOOLS)) ? frame.type : null;
    let code = "invalid";
    try {
      if (type) code = await this.onFrame(ws, { ...NEW_SOCKET, ...ws.deserializeAttachment() }, type, frame);
    } catch (err) {
      // A fault in the room, not in the frame, so it isn't held against the socket. Only the error's name is logged:
      // its message could hold what was sent.
      console.error("chat: a frame failed:", err?.name ?? "error");
      this.send(ws, errorFrame("invalid", type));
      return;
    }
    if (!code) return;
    const key = code === "gone" && Object.hasOwn(GONE_TARGET, type) ? GONE_TARGET[type] : null;
    this.send(ws, { ...errorFrame(code, type), ...(key ? { [key]: frame[key] } : {}) });
    // Bad frames: ones the room can't read or that break the protocol, and writes from a socket not signed in. A
    // token that doesn't check out (hello's auth) isn't one, and neither is a blocked or slowed-down write, nor a frame
    // about something that has gone (gone).
    if (code === "invalid" || (code === "auth" && type !== "hello")) {
      const at = { ...NEW_SOCKET, ...ws.deserializeAttachment() };
      if (at.bad + 1 >= BAD_FRAMES) ws.close(CLOSE_BAD, "bad frames");
      else ws.serializeAttachment({ ...at, bad: at.bad + 1 });
    }
  }

  // Counts one more frame from ws, in its attachment, so the count lives through hibernation. Past FRAMES_PER_SOCKET the
  // socket is closed with 1008 and this says so: the frame goes unanswered. Bryan's sockets aren't counted.
  overFrames(ws) {
    const at = { ...NEW_SOCKET, ...ws.deserializeAttachment() };
    if (at.role === "admin") return false;
    ws.serializeAttachment({ ...at, frames: at.frames + 1 });
    if (at.frames + 1 <= FRAMES_PER_SOCKET) return false;
    try {
      ws.close(CLOSE_BAD, "too many frames");
    } catch {
      // It closed in the meantime.
    }
    return true;
  }

  // A socket closed (the runtime has already answered its close, as the compatibility date asks): everyone left hears
  // how many are online now.
  webSocketClose() {
    this.broadcast({ type: "online", online: this.online() });
  }

  webSocketError() {
    this.webSocketClose();
  }

  // Answers one frame of a known type. at is the socket's attachment. Returns nothing when it is done (it sends its
  // own answer, if any), or the error code to send back.
  async onFrame(ws, at, type, frame) {
    if (Object.hasOwn(READS, type)) return this[READS[type]](ws, at, frame);
    if (at.uid === null) return "auth";
    // The account as it is now, not as it was at hello. A ban or a sign-out closes its sockets, but a frame already on
    // its way is checked against it too.
    const user = this.account(at.uid, at.tv);
    if (!user) return "auth";
    if (Object.hasOwn(WRITES, type)) return this[WRITES[type]](ws, user, frame);
    if (user.role !== "admin") return "invalid";
    const refused = this.canWrite(user, type);
    if (refused) return refused;
    return this[ADMIN_TOOLS[type]](ws, user, frame);
  }

  // hello {v, token?}. A version the room doesn't take gets error update and the socket closes with 4426: the app shows
  // "Reload for the new chat". A token that checks out signs the socket in, and the app learns who it is (me); one that
  // doesn't gets error auth (or banned), and the socket reads on. Then the room's last 100 messages (history), and
  // everyone hears how many are online. One hello per socket: to sign in later, the app opens a new socket.
  async onHello(ws, at, frame) {
    if (at.v !== null) return "invalid";
    if (!Number.isInteger(frame.v) || frame.v < PROTO_OLDEST || frame.v > PROTO) {
      this.send(ws, errorFrame("update", "hello"));
      ws.close(CLOSE_UPDATE, "update");
      return;
    }
    // The version first, so a second hello sent meanwhile is refused while the token is checked.
    ws.serializeAttachment({ ...at, v: frame.v });
    if (frame.token !== undefined && frame.token !== null) {
      const found = await this.signedIn(frame.token);
      if (found.user) {
        const { id, tv, role, nick } = found.user;
        ws.serializeAttachment({ ...ws.deserializeAttachment(), uid: id, tv, role });
        this.send(ws, this.meFrame(nick, role));
      } else {
        this.send(ws, errorFrame(found.error, "hello"));
      }
    }
    this.send(ws, { type: "history", messages: this.history() });
    this.broadcast({ type: "online", online: this.online() });
  }

  // me {nick, role}, and for Bryan whether the room is locked.
  meFrame(nick, role) {
    return { type: "me", nick, role, ...(role === "admin" ? { locked: this.getMeta("locked") === 1 } : {}) };
  }

  // older {before_id}: the 50 visible messages before that id, oldest first, at most one page a second per socket.
  onOlder(ws, at, frame) {
    if (!isId(frame.before_id)) return "invalid";
    const now = this.now();
    const wait = at.olderAt + OLDER_EVERY - now;
    if (wait > 0) return slowFor(wait);
    ws.serializeAttachment({ ...at, olderAt: now });
    this.send(ws, { type: "history", before_id: frame.before_id, messages: this.history(frame.before_id, OLDER_PAGE) });
  }

  // say {text, spot?, reply_to?}: a text message of up to 500 characters, as normalise() leaves it, trimmed. It is
  // tagged with the spot the app's filter showed (none for All), and a reply takes its parent's tag instead, from a
  // parent that is there to see (gone when it isn't). A say that starts with a slash is dropped: chat.js sends those as
  // admin frames, so one that comes as say is not from chat.js. The hard-block filters read the checking copy; a
  // blocked text stays in the sender's box, and counts against no limit.
  onSay(ws, user, frame) {
    if (typeof frame.text !== "string") return "invalid";
    const { stored, check } = normalise(frame.text);
    const text = stored.trim();
    // NFKC has already made a full-width slash a plain one.
    if (text === "" || [...text].length > TEXT_MAX || text.startsWith("/")) return "invalid";
    let spot = frame.spot ?? null;
    if (spot !== null && !SPOTS.includes(spot)) return "invalid";
    const replyTo = frame.reply_to ?? null;
    if (replyTo !== null) {
      if (!isId(replyTo)) return "invalid";
      const parent = this.one("SELECT spot FROM messages WHERE id = ? AND hidden_by IS NULL", replyTo);
      if (!parent) return "gone";
      spot = parent.spot;
    }
    const hit = blocked(check, BLOCKLIST);
    if (hit) return `blocked:${hit.rule}`;
    const refused = this.canWrite(user, "say");
    if (refused) return refused;
    this.post(user, "text", spot, { text }, replyTo);
  }

  // report {spot, size, cond, crowd, snap?}: a tap-only report (mod.js validReport), in the room and on the spot's card
  // for 4 hours. One per spot every 2 hours, and 6 a day.
  onReport(ws, user, frame) {
    const report = validReport(frame);
    if (!report) return "invalid";
    const refused = this.canWrite(user, "report", report.spot);
    if (refused) return refused;
    const { spot, ...body } = report;
    this.post(user, "report", spot, body);
  }

  // like {id}: one 👍 per person, on a message that is there to see (gone when it isn't). A second like from the same
  // person changes nothing and says nothing.
  onLike(ws, user, frame) {
    if (!isId(frame.id)) return "invalid";
    if (!this.one("SELECT 1 FROM messages WHERE id = ? AND hidden_by IS NULL", frame.id)) return "gone";
    if (this.one("SELECT 1 FROM likes WHERE msg_id = ? AND uid = ?", frame.id, user.id)) return;
    const refused = this.canWrite(user, "like");
    if (refused) return refused;
    const { likes } = this.ctx.storage.transactionSync(() => {
      this.all("INSERT INTO likes (msg_id, uid) VALUES (?, ?)", frame.id, user.id);
      return this.one("UPDATE messages SET likes = likes + 1 WHERE id = ? RETURNING likes", frame.id);
    });
    this.broadcast({ type: "update", id: frame.id, likes });
  }

  // delete {id}: a user deletes a message of their own (removeOwn()), and its likes go with it; a session card's log
  // is unshared. Every socket is told, so it goes from every screen. Replies keep their reply_to: the app shows
  // "Message deleted" for a parent it doesn't have. A message that is gone already (a second tap) is gone; someone
  // else's is invalid.
  //
  // Bryan's Delete on anyone else's message hides it instead ("admin"): it goes from every screen but his, and stays in
  // his hidden list, where he can restore it or keep it as evidence, until the daily clean-up takes it with the rest.
  // One that is hidden already (by flags, a ban or an earlier Delete) is left as it is: it keeps the reason it was
  // hidden for, which his hidden list shows, and nobody is told about it a second time. He gets ok {for: "delete", id},
  // as it is hidden from everyone, which is what his Delete does.
  onDelete(ws, user, frame) {
    if (!isId(frame.id)) return "invalid";
    const refused = this.canWrite(user, "delete");
    if (refused) return refused;
    if (user.role === "admin") {
      const theirs = this.one("SELECT hidden_by FROM messages WHERE id = ? AND uid IS NOT ?", frame.id, user.id);
      if (theirs) {
        if (theirs.hidden_by !== null) {
          this.send(ws, { type: "ok", for: "delete", id: frame.id });
          return;
        }
        const hidden = this.all(
          `UPDATE messages SET hidden_by = 'admin' WHERE id = ? AND hidden_by IS NULL RETURNING ${MSG_COLS}`,
          frame.id,
        );
        this.announceHidden(hidden, "admin");
        return;
      }
    }
    const gone = this.ctx.storage.transactionSync(() => this.removeOwn(frame.id, user.id));
    if (!gone) return this.one("SELECT 1 FROM messages WHERE id = ?", frame.id) ? "invalid" : "gone";
    this.announceDeleted([gone]);
  }

  // Deletes message id if uid posted it, with the likes on it, and unshares the log it was the card of, if it was one
  // (the owner check is in the WHERE). Runs inside the caller's transaction. Returns the message's {id, spot, kind}, or
  // null when uid has no such message.
  removeOwn(id, uid) {
    const row = this.one("DELETE FROM messages WHERE id = ? AND uid = ? RETURNING id, spot, kind", id, uid);
    if (!row) return null;
    this.all("DELETE FROM likes WHERE msg_id = ?", id);
    if (row.kind === "session") this.all("UPDATE sessions SET shared_msg = NULL WHERE uid = ? AND shared_msg = ?", uid, id);
    return row;
  }

  // Tells everyone that messages ({id, spot} each) are gone, once that is stored: update {id, deleted: true} for each,
  // oldest first. The spot cards and the CHAT button's dot follow (messagesChanged()).
  announceDeleted(rows) {
    if (rows.length === 0) return;
    this.messagesChanged(rows.length === 1 ? rows[0].spot : undefined);
    for (const { id } of [...rows].sort((a, b) => a.id - b.id)) this.broadcast({ type: "update", id, deleted: true });
  }

  // nick {nick}: a new nickname (see nickFor()), at most once a week. The old one is held for 30 days for this LINE
  // account, so nobody else can take it and pass as them. Each of the user's sockets gets me with the new name. The
  // name they already have (exactly: a change of case is a change) changes nothing and doesn't use up the week: this
  // socket gets me as it is.
  onNick(ws, user, frame) {
    const refused = this.canWrite(user, "nick");
    if (refused) return refused;
    const now = this.now();
    const nick = this.nickFor(frame.nick, user.sub_hash, user.id, now);
    if (nick.code) return nick.code.startsWith("blocked:") ? nick.code : `nick:${nick.code}`;
    if (nick.nick === user.nick) {
      this.send(ws, this.meFrame(user.nick, user.role));
      return;
    }
    this.ctx.storage.transactionSync(() => {
      this.all("UPDATE users SET nick = ?, nick_key = ?, nick_changed = ? WHERE id = ?", nick.nick, nick.key, now, user.id);
      if (nick.key !== user.nick_key) {
        this.all(
          "INSERT INTO limits (key, n, window_end) VALUES (?, 1, ?) ON CONFLICT (key) DO UPDATE SET window_end = excluded.window_end",
          heldKey(user.nick_key, user.sub_hash), now + NICK_HELD,
        );
      }
    });
    this.sendToUser(user.id, this.meFrame(nick.nick, user.role));
  }

  // ---- The report button (spec "Moderation", step 4) -------------------------------------------------------------

  // flag {id, reason}, on a message that is there to see (gone when it isn't). Flags are kept by LINE account
  // (sub_hash), so an account flags a message once, however often it signs up again. A self-flag, a flag on Bryan's
  // messages and one on a message he restored are ignored, and nothing is kept. Otherwise the message hides once 3
  // counted flags reach it, or at once on a one-flag hide (see FLAGS_TO_HIDE and flagger()). The flagger gets no answer
  // either way, so nobody learns whether their flag counted. 20 flags a day.
  onFlag(ws, user, frame) {
    if (!isId(frame.id) || !REASONS.includes(frame.reason)) return "invalid";
    const msg = this.one(
      `SELECT m.uid, m.flag_immune, u.role FROM messages m LEFT JOIN users u ON u.id = m.uid
       WHERE m.id = ? AND m.hidden_by IS NULL`,
      frame.id,
    );
    if (!msg) return "gone";
    const refused = this.canWrite(user, "flag");
    if (refused) return refused;
    if (msg.uid === user.id || msg.role === "admin" || msg.flag_immune) return;
    const now = this.now();
    const added = this.one(
      "INSERT INTO flags (msg_id, sub_hash, reason, ts) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING msg_id",
      frame.id, user.sub_hash, frame.reason, now,
    );
    if (!added) return;
    // The one-flag allowance is used only when it hides something.
    const alone = ONE_FLAG_REASONS.has(frame.reason) && this.flagger(user.sub_hash, now).trusted
      && this.useLimits(user.sub_hash, [ONE_FLAG_LIMIT], now) === 0;
    if (alone || this.flaggedEnough(frame.id, now)) this.hideForFlags(frame.id, now);
  }

  // What the flags of LINE account `sub` weigh now: {counts} when they count toward the 3 that hide a message, and
  // {trusted} when its sexual and child-safety flags may also hide one on their own. A flag counts from an account at
  // least 24 hours old with a post, that isn't banned and has fewer than 2 flags Bryan has rejected; trusted is at
  // least 7 days old with 5 posts. Posts are the account's messages still in the room and not hidden: text and session
  // cards go after 30 days, so in practice this is posts of the last 30 days. It is worked out when a flag comes in, so
  // a ban or a rejection stops an account's flags counting from then on. A few rows read, all by index.
  flagger(sub, now) {
    const no = { counts: false, trusted: false };
    const user = this.one(
      "SELECT u.id, u.created, s.banned FROM users u LEFT JOIN subs s ON s.sub_hash = u.sub_hash WHERE u.sub_hash = ?",
      sub,
    );
    if (!user || user.banned || user.created > now - FLAGGER_AGE) return no;
    const posts = this.one(
      `SELECT count(*) AS n FROM (SELECT 1 FROM messages WHERE uid = ? AND hidden_by IS NULL LIMIT ${ONE_FLAG_POSTS})`,
      user.id,
    ).n;
    if (posts === 0) return no;
    const rejected = this.one(
      `SELECT count(*) AS n FROM (SELECT 1 FROM flags WHERE sub_hash = ? AND rejected = 1 LIMIT ${FLAGGER_REJECTED})`,
      sub,
    ).n;
    if (rejected >= FLAGGER_REJECTED) return no;
    return { counts: true, trusted: user.created <= now - ONE_FLAG_AGE && posts >= ONE_FLAG_POSTS };
  }

  // Whether 3 of a message's flags count now (see flagger()). It stops looking at the third.
  flaggedEnough(msgId, now) {
    let counted = 0;
    for (const { sub_hash } of this.all("SELECT sub_hash FROM flags WHERE msg_id = ? AND rejected = 0", msgId)) {
      if (this.flagger(sub_hash, now).counts && ++counted >= FLAGS_TO_HIDE) return true;
    }
    return false;
  }

  // Hides a message for its flags. One hidden with a child-safety flag on it is copied to holds as well, in the same
  // step: Bryan keeps it for 180 days, whatever else is deleted (spec "Moderation", step 5).
  hideForFlags(msgId, now) {
    const hidden = this.ctx.storage.transactionSync(() => {
      const rows = this.all(
        `UPDATE messages SET hidden_by = 'flags' WHERE id = ? AND hidden_by IS NULL RETURNING ${MSG_COLS}`,
        msgId,
      );
      if (rows.length > 0 && this.one("SELECT 1 FROM flags WHERE msg_id = ? AND reason = 'child' AND rejected = 0", msgId)) {
        this.hold(rows[0], "child", now);
      }
      return rows;
    });
    this.announceHidden(hidden, "flags");
  }

  // Tells everyone that messages (rows as MSG_COLS reads them) are hidden now, once that is stored. Readers get update
  // {id, hidden: true} and take each one off their screens; Bryan's sockets get it again as msg, marked with why. The
  // spot cards and the CHAT button's dot follow (messagesChanged()).
  announceHidden(rows, reason) {
    if (rows.length === 0) return;
    this.messagesChanged(rows.length === 1 ? rows[0].spot : undefined);
    const sorted = [...rows].sort((a, b) => a.id - b.id);
    for (const msg of this.toPublic(sorted)) {
      this.broadcast({ type: "update", id: msg.id, hidden: true }, { type: "msg", msg: { ...msg, hidden: reason } });
    }
  }

  // A copy of a message (a row as MSG_COLS reads it) in holds, which Bryan keeps for 180 days, whatever else is
  // deleted: the message as it was (body holds its time, kind, spot, reply and body, as JSON), its author's user id and
  // LINE account code, and why it is kept ("child" or "keep").
  hold(row, reason, now) {
    const sub = row.uid === null ? null : (this.one("SELECT sub_hash FROM users WHERE id = ?", row.uid)?.sub_hash ?? null);
    const copy = { ts: row.ts, kind: row.kind, spot: row.spot, reply_to: row.reply_to, body: JSON.parse(row.body) };
    this.all(
      "INSERT INTO holds (msg_id, body, uid, sub_hash, reason, ts) VALUES (?, ?, ?, ?, ?, ?)",
      row.id, JSON.stringify(copy), row.uid, sub, reason, now,
    );
  }

  // ---- Bryan's claim (spec "Moderation", step 7) -----------------------------------------------------------------

  // admin {code}. chat.js sends any text that starts with a slash as this frame, never as say, so the code may come as
  // the line Bryan typed ("/admin <code>", with either slash) or alone. It is compared with ADMIN_CODE in constant time,
  // on SHA-256 digests (sameText). The first right code makes that account Bryan's: meta admin_uid and role "admin",
  // and each of its sockets gets me with the new role. Claims are closed after that.
  //   - An ADMIN_CODE under 32 characters, or none, switches claiming off.
  //   - 3 wrong codes stop that LINE account claiming, and 10 in all stop everyone, until ADMIN_CODE is changed: the
  //     counts are kept with a digest of the code they were tried against, and a new code starts them again.
  //     Deleting the account takes its own count away, not its part of the total (forgetAccount()).
  //   - Any other slash command ("/shrug") is not a claim, so people who type those can't use up the 10.
  //   - A claim refused for any of these reasons is not counted.
  // Each of these refusals is error admin, whatever the reason, and none is a bad frame. A banned account gets banned.
  async onAdmin(ws, user, frame) {
    if (typeof frame.code !== "string") return "invalid";
    const code = this.env.ADMIN_CODE;
    if (typeof code !== "string" || code.length < ADMIN_CODE_MIN) return "admin";
    const line = frame.code.trim();
    const typed = ADMIN_COMMAND.test(line);
    if (!typed && SLASH.test(line)) return "admin";
    const tried = typed ? line.replace(ADMIN_COMMAND, "") : line;
    const [right, against] = await Promise.all([sameText(tried, code), sha256b64u(`admin code ${code}`)]);
    // Nothing awaits from here on, so two claims at once can't both get in, or both count as one. The account is read
    // again first: it may have been banned, signed out or deleted while the digests were made.
    const refused = this.canWrite(this.account(user.id, user.tv), "admin");
    if (refused) return refused;
    if (this.getMeta("admin_uid") !== null) return "admin";
    const claims = this.claims(against);
    const mine = claims.by[user.sub_hash] ?? 0;
    if (claims.total >= CLAIM_TRIES_ALL || mine >= CLAIM_TRIES) return "admin";
    if (!right) {
      const by = { ...claims.by, [user.sub_hash]: mine + 1 };
      this.setMeta("admin_claims", JSON.stringify({ ...claims, total: claims.total + 1, by }));
      return "admin";
    }
    this.ctx.storage.transactionSync(() => {
      this.setMeta("admin_uid", user.id);
      this.all("UPDATE users SET role = 'admin' WHERE id = ?", user.id);
    });
    // His sockets are admin sockets from now on (the attachment's role), so hidden messages reach them.
    for (const socket of this.ctx.getWebSockets()) {
      const at = socket.deserializeAttachment();
      if (at?.uid === user.id) socket.serializeAttachment({ ...at, role: "admin" });
    }
    this.sendToUser(user.id, this.meFrame(user.nick, "admin"));
  }

  // The wrong codes tried against the ADMIN_CODE whose digest is `against`: {code: that digest, total, by: {sub_hash:
  // n}}. Counts made against an older code don't apply.
  claims(against) {
    const saved = JSON.parse(this.getMeta("admin_claims") ?? "null");
    return saved?.code === against ? saved : { code: against, total: 0, by: {} };
  }

  // ---- Bryan's tools (spec "Moderation", step 5) -----------------------------------------------------------------
  //
  // Each needs role "admin" (onFrame checks it) and answers ok {for, ...} to the socket that asked.

  // ban {msg_id}: bans the author of that message. Their LINE account is marked banned in subs, which outlives the
  // account, so they can't sign in or sign up again; tv goes up, so their tokens stop working; their sockets close
  // with 4403; and their flags stop counting (flagger()). Their messages from the last 24 hours are hidden ("ban"),
  // and so is the one the ban was for, whatever its age. Bryan's own account can't be banned. ok carries the account's
  // sub_hash, which unban takes. A message that isn't there, or whose author has no account left, is gone.
  onBan(ws, user, frame) {
    if (!isId(frame.msg_id)) return "invalid";
    const target = this.one(
      "SELECT u.id, u.sub_hash, u.role FROM messages m JOIN users u ON u.id = m.uid WHERE m.id = ?",
      frame.msg_id,
    );
    if (!target) return "gone";
    if (target.role === "admin") return "invalid";
    const hidden = this.ctx.storage.transactionSync(() => {
      this.all("INSERT INTO subs (sub_hash, banned) VALUES (?, 1) ON CONFLICT (sub_hash) DO UPDATE SET banned = 1", target.sub_hash);
      this.all("UPDATE users SET tv = tv + 1 WHERE id = ?", target.id);
      return this.all(
        `UPDATE messages SET hidden_by = 'ban' WHERE uid = ? AND hidden_by IS NULL AND (ts > ? OR id = ?) RETURNING ${MSG_COLS}`,
        target.id, this.now() - BAN_HIDES, frame.msg_id,
      );
    });
    this.closeUser(target.id, CLOSE_BANNED);
    this.announceHidden(hidden, "ban");
    this.send(ws, { type: "ok", for: "ban", msg_id: frame.msg_id, sub_hash: target.sub_hash });
  }

  // unban {sub_hash}: lifts a LINE account's ban. Its hidden messages stay hidden until Bryan restores them, and its old
  // tokens stay dead: the person signs in with LINE again. An account that isn't banned (a second tap) gets ok too, and
  // one the room has no row for is gone.
  onUnban(ws, user, frame) {
    if (typeof frame.sub_hash !== "string") return "invalid";
    const lifted = this.one("UPDATE subs SET banned = 0 WHERE sub_hash = ? RETURNING sub_hash", frame.sub_hash);
    if (!lifted) return "gone";
    this.send(ws, { type: "ok", for: "unban", sub_hash: frame.sub_hash });
  }

  // restore {id}: Bryan says a message is fine. Its flags are marked rejected (an account with 2 rejected flags stops
  // counting) and it is made immune, so flags can't hide it again. A hidden one comes back for everyone: each socket
  // gets it as msg, which chat.js merges by id. One that isn't there (retention or its author took it) is gone.
  onRestore(ws, user, frame) {
    if (!isId(frame.id)) return "invalid";
    const restored = this.ctx.storage.transactionSync(() => {
      const was = this.one("SELECT hidden_by FROM messages WHERE id = ?", frame.id);
      if (!was) return null;
      this.all("UPDATE flags SET rejected = 1 WHERE msg_id = ?", frame.id);
      const row = this.one(`UPDATE messages SET hidden_by = NULL, flag_immune = 1 WHERE id = ? RETURNING ${MSG_COLS}`, frame.id);
      return { row, wasHidden: was.hidden_by !== null };
    });
    if (!restored) return "gone";
    if (restored.wasHidden) {
      this.messagesChanged(restored.row.spot);
      this.broadcast({ type: "msg", msg: this.toPublic([restored.row])[0] });
    }
    this.send(ws, { type: "ok", for: "restore", id: frame.id });
  }

  // keep {id}: "Keep as evidence". A copy goes to holds for 180 days, whatever happens to the message; keeping it again
  // keeps no second copy. One that isn't there any more is gone.
  onKeep(ws, user, frame) {
    if (!isId(frame.id)) return "invalid";
    const row = this.one(`SELECT ${MSG_COLS} FROM messages WHERE id = ?`, frame.id);
    if (!row) return "gone";
    if (!this.one("SELECT 1 FROM holds WHERE msg_id = ? AND reason = 'keep'", frame.id)) this.hold(row, "keep", this.now());
    this.send(ws, { type: "ok", for: "keep", id: frame.id });
  }

  // lock and unlock. While the room is locked (meta "locked" = 1), everyone can read but only Bryan can post (spec
  // "Error handling"). Only posting stops (POSTS, in canWrite()), so likes, flags and deletes still work, and so does
  // anything else that isn't a post. ok goes to every one of Bryan's sockets, so the menu on each of his screens
  // offers the one that applies.
  onLock() {
    this.setMeta("locked", 1);
    this.sendToAdmins({ type: "ok", for: "lock" });
  }

  onUnlock() {
    this.setMeta("locked", 0);
    this.sendToAdmins({ type: "ok", for: "unlock" });
  }

  // hidden_list: hidden {count, messages, banned, banned_count}. messages are the newest 100 hidden messages, newest
  // first, each as its public frame plus why it was hidden (hidden: "flags", "ban" or "admin") and the reasons it was
  // flagged for (flags: {spam: 2, child: 1}, from the flags Bryan hasn't rejected). count is how many are hidden in all.
  // banned lists the banned LINE accounts, up to 100, the newest accounts first (by the subs row, made when the
  // account signed up), so the same ones come back each time: each one's sub_hash, for unban, and its nickname while
  // it still has an account (null after). banned_count is how many are banned in all, so the Unban menu can say when
  // there are more than it shows.
  onHiddenList(ws) {
    const rows = this.all(
      `SELECT ${MSG_COLS}, hidden_by FROM messages WHERE hidden_by IS NOT NULL ORDER BY id DESC LIMIT ?`,
      PAGE_MAX,
    );
    const flags = new Map(rows.map((row) => [row.id, {}]));
    const counted = this.all(
      `SELECT msg_id, reason, count(*) AS n FROM flags
       WHERE rejected = 0 AND msg_id IN (SELECT value FROM json_each(?)) GROUP BY msg_id, reason`,
      JSON.stringify(rows.map((row) => row.id)),
    );
    for (const { msg_id, reason, n } of counted) flags.get(msg_id)[reason] = n;
    const shown = this.toPublic(rows);
    this.send(ws, {
      type: "hidden",
      count: this.one("SELECT count(*) AS n FROM messages WHERE hidden_by IS NOT NULL").n,
      messages: shown.map((msg, k) => ({ ...msg, hidden: rows[k].hidden_by, flags: flags.get(msg.id) })),
      banned: this.all(
        `SELECT s.sub_hash, u.nick FROM subs s LEFT JOIN users u ON u.sub_hash = s.sub_hash
         WHERE s.banned = 1 ORDER BY s.rowid DESC LIMIT ?`,
        PAGE_MAX,
      ),
      banned_count: this.one("SELECT count(*) AS n FROM subs WHERE banned = 1").n,
    });
  }

  // GET /admin/where (Bryan only): where the room lives. It asks Cloudflare's trace page, served by the data centre the
  // room runs in, and answers its colo= line as text ("colo=NRT"), and nothing else from it. 401 {error: "auth"}
  // without a good token, 403 {error: "admin"} for anyone but Bryan, and 502 {error: "trace"} when the page can't be
  // read.
  async where(request) {
    const user = await this.userFromToken(bearer(request));
    if (!user) return refuse(401, "auth");
    if (user.role !== "admin") return refuse(403, "admin");
    try {
      const res = await fetch(TRACE_URL);
      const line = res.ok ? (await res.text()).split("\n").map((l) => l.trim()).find((l) => COLO.test(l)) : undefined;
      if (line) return new Response(`${line}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    } catch (err) {
      console.error("chat: the trace failed:", err?.name ?? "error");
    }
    return refuse(502, "trace");
  }

  // Stores a new message from `user` and sends it to every socket as msg.
  post(user, kind, spot, body, replyTo = null) {
    this.announce(this.addMessage(user, kind, spot, body, replyTo));
  }

  // Stores a new message from `user`, inside the caller's transaction when there is one, and returns its row as
  // MSG_COLS reads it, for announce().
  addMessage(user, kind, spot, body, replyTo = null) {
    return this.one(
      `INSERT INTO messages (ts, uid, kind, spot, body, reply_to) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${MSG_COLS}`,
      this.now(), user.id, kind, spot, JSON.stringify(body), replyTo,
    );
  }

  // Sends a message just stored to every socket as msg. The spot cards and the CHAT button's dot follow; spot is null
  // for a message with no tag, which drops no spot's reports.
  announce(row) {
    this.messagesChanged(row.spot);
    this.broadcast({ type: "msg", msg: this.toPublic([row])[0] });
  }

  // Sends one frame to one socket.
  send(ws, frame) {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // It closed in the meantime.
    }
  }

  // Sends one frame to every open socket signed in as uid.
  sendToUser(uid, frame) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN && ws.deserializeAttachment()?.uid === uid) this.send(ws, frame);
    }
  }

  // Sends one frame to Bryan's open sockets only (their attachment's role is "admin"), for news of a hidden message.
  sendToAdmins(frame) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN && ws.deserializeAttachment()?.role === "admin") this.send(ws, frame);
    }
  }

  // ---- The user's own routes (/me) -----------------------------------------------------------------------------
  //
  // Each takes the session token as "Authorization: Bearer <token>" (userFromToken()) and answers JSON. A refusal is
  // {error} with one of:
  //   auth       401  no token, or one that doesn't check out: expired, signed out everywhere, banned or deleted
  //   invalid    400  POST /me/sessions with a body that isn't a log the room takes (mod.js validSession; share, when
  //                   given, is true or false)
  //   slow:<s>   429  past the 20 logs a day, with the seconds until the next one goes
  //   full       429  1,000 logs kept already: one has to be deleted first
  //   not found  404  DELETE /me/sessions/<id> for a log that isn't this user's
  //
  //   GET    /me/sessions       mySessions()
  //   POST   /me/sessions       logSession()
  //   DELETE /me/sessions/<id>  deleteSession()
  //   GET    /me/export         exportMine()
  //   DELETE /me                deleteAccount()
  //   POST   /me/signout        signOut(), with the sign-in above

  // GET /me/sessions: the user's logs, newest first (sessionsOf()).
  async mySessions(request) {
    const user = await this.userFromToken(bearer(request));
    if (!user) return refuse(401, "auth");
    return Response.json(this.sessionsOf(user.id));
  }

  // The logs of uid, newest first, each {id, spot, start, end, stars, board, note, cond, shared}: cond is the
  // conditions snapshot or null ("No conditions recorded"), and shared says whether its card is in the room.
  sessionsOf(uid) {
    return this.all(
      "SELECT id, spot, start, end, stars, board, note, cond, shared_msg FROM sessions WHERE uid = ? ORDER BY start DESC, id DESC",
      uid,
    ).map(({ cond, shared_msg, ...log }) => ({ ...log, cond: cond === null ? null : JSON.parse(cond), shared: shared_msg !== null }));
  }

  // POST /me/sessions {spot, start, end, stars, board, note?, cond?, share?}: a new log in the diary, private unless
  // share is true. It answers {id}; with share, {id, shared_msg} once its card is in the room (shareSession()), or
  // {id, error} when the card can't go: the log is kept either way, private, and can be shared later. 20 logs a day,
  // and 1,000 in all.
  async logSession(request) {
    // The body is read before the account. Reading it isn't a storage call, so other requests run in the meantime,
    // and one of them could delete the account, ban it or sign it out. Nothing awaits once userFromToken() has read
    // the account, so the log is written for the account as it is at that moment, or not at all.
    const body = await readJson(request);
    const user = await this.userFromToken(bearer(request));
    if (!user) return refuse(401, "auth");
    const log = validSession(body, this.now());
    if (!log || (body.share !== undefined && typeof body.share !== "boolean")) return refuse(400, "invalid");
    const kept = this.one(`SELECT count(*) AS n FROM (SELECT 1 FROM sessions WHERE uid = ? LIMIT ${SESSIONS_MAX})`, user.id).n;
    if (kept >= SESSIONS_MAX) return refuse(429, "full");
    const refused = this.canWrite(user, "session");
    if (refused) return refuseWrite(refused);
    const row = this.one(
      `INSERT INTO sessions (uid, spot, start, end, stars, board, note, cond) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      user.id, log.spot, log.start, log.end, log.stars, log.board, log.note, log.cond === null ? null : JSON.stringify(log.cond),
    );
    if (!body.share) return Response.json({ id: row.id });
    return Response.json({ id: row.id, ...this.shareSession(user, row) });
  }

  // DELETE /me/sessions/<id>: deletes one of the user's logs. A shared one's card goes from the room too, and every
  // socket is told. {ok: true}, or 404 for a log that isn't the user's.
  async deleteSession(request, idText) {
    const user = await this.userFromToken(bearer(request));
    if (!user) return refuse(401, "auth");
    const id = SESSION_ID.test(idText) ? Number(idText) : null;
    const refused = this.canWrite(user, "delete");
    if (refused) return refuseWrite(refused);
    const gone = this.ctx.storage.transactionSync(() => {
      const log = isId(id) ? this.one("DELETE FROM sessions WHERE id = ? AND uid = ? RETURNING shared_msg", id, user.id) : null;
      if (!log) return null;
      return { card: log.shared_msg === null ? null : this.removeOwn(log.shared_msg, user.id) };
    });
    if (!gone) return refuse(404, "not found");
    if (gone.card) this.announceDeleted([gone.card]);
    return Response.json({ ok: true });
  }

  // GET /me/export ("Download my data"): what the room keeps about the user, as {nick, created, messages, reports,
  // sessions}. messages are their text messages and session cards, and reports their reports, each {id, ts, kind,
  // spot, body, reply_to, likes, hidden}, oldest first; hidden ones are there too, marked, without why. sessions are
  // their logs as GET /me/sessions gives them. A report over 30 days old no longer says who posted it (retention), so
  // it isn't theirs any more. No user id or LINE account code is in it.
  async exportMine(request) {
    const user = await this.userFromToken(bearer(request));
    if (!user) return refuse(401, "auth");
    const posted = this.all(
      "SELECT id, ts, kind, spot, body, reply_to, likes, hidden_by FROM messages WHERE uid = ? ORDER BY ts, id",
      user.id,
    ).map(({ body, hidden_by, ...msg }) => ({ ...msg, body: JSON.parse(body), hidden: hidden_by !== null }));
    return Response.json({
      nick: user.nick,
      created: user.created,
      messages: posted.filter((msg) => msg.kind !== "report"),
      reports: posted.filter((msg) => msg.kind === "report"),
      sessions: this.sessionsOf(user.id),
    });
  }

  // DELETE /me ("Delete my account"; spec "Deleting an account"): everything of the account goes, in one transaction
  // (forgetAccount()). Then every open screen is told: their text messages and session cards go (update {id, deleted:
  // true}), and each message they liked has its new count (update {id, likes}); for a message hidden since, only
  // Bryan's screens are told, as only they show it. Their sockets close with 4401, as on signing out everywhere. A
  // locked room doesn't stop it (canWrite()). {ok: true}.
  async deleteAccount(request) {
    const user = await this.userFromToken(bearer(request));
    if (!user) return refuse(401, "auth");
    const refused = this.canWrite(user, "account");
    if (refused) return refuseWrite(refused);
    const { gone, liked } = this.forgetAccount(user, this.now());
    this.closeUser(user.id, CLOSE_SIGNED_OUT);
    this.announceDeleted(gone);
    for (const { id, likes, hidden_by } of liked) {
      if (hidden_by === null) this.broadcast({ type: "update", id, likes });
      else this.sendToAdmins({ type: "update", id, likes });
    }
    return Response.json({ ok: true });
  }

  // The transaction of DELETE /me, for `user` (as account() gives it), at `now`:
  //   - their text messages and session cards go, with the likes on them;
  //   - their reports stay, without their user id, and show as "a surfer";
  //   - their likes go, and the counts of the messages they liked come down;
  //   - their flags go, and nothing they helped hide comes back;
  //   - their logs go, and so do their LINE account's rate-limit counts and held nicknames, and any sign-in of theirs
  //     still waiting to be redeemed (with LINE's raw sub);
  //   - if it is Bryan's account, meta admin_uid goes, so he can claim the role again from a new account;
  //   - their count of wrong /admin codes goes from meta admin_claims, which then no longer names their LINE account;
  //     the total stays, so the 10 in all still count them;
  //   - their LINE account's row in subs stays, marked deleted: a ban on it stays, and an unbanned one goes after 30
  //     days (retention);
  //   - and the account itself goes.
  // Bryan's copies in holds stay, whatever else is deleted (spec "Moderation", step 5). Nothing else in the room keeps
  // their user id. Returns what the open screens must be told: gone, the messages deleted ({id, spot}), and liked,
  // the messages whose like counts changed ({id, likes, hidden_by}), each oldest first.
  forgetAccount(user, now) {
    const sub = user.sub_hash;
    return this.ctx.storage.transactionSync(() => {
      const gone = this.all("DELETE FROM messages WHERE uid = ? AND kind IN ('text', 'session') RETURNING id, spot", user.id);
      this.all("DELETE FROM likes WHERE msg_id IN (SELECT value FROM json_each(?))", JSON.stringify(gone.map((msg) => msg.id)));
      this.all("UPDATE messages SET uid = NULL WHERE uid = ? AND kind = 'report'", user.id);
      const unliked = this.all("DELETE FROM likes WHERE uid = ? RETURNING msg_id", user.id).map((like) => like.msg_id);
      const liked = this.all(
        "UPDATE messages SET likes = likes - 1 WHERE id IN (SELECT value FROM json_each(?)) RETURNING id, likes, hidden_by",
        JSON.stringify(unliked),
      ).sort((a, b) => a.id - b.id);
      this.all("DELETE FROM flags WHERE sub_hash = ?", sub);
      this.all("DELETE FROM sessions WHERE uid = ?", user.id);
      // Their counts are keyed "<sub_hash>:<rule>", and their held nicknames "held:<nick_key>:<sub_hash>" (heldKey()).
      this.all("DELETE FROM limits WHERE key > ? AND key < ?", `${sub}:`, `${sub};`);
      this.all("DELETE FROM limits WHERE key > 'held:' AND key < 'held;' AND substr(key, ?) = ?", -(sub.length + 1), `:${sub}`);
      this.all("DELETE FROM handoffs WHERE sub_hash = ?", sub);
      this.forgetAdmin(user.id, sub);
      this.all(
        "INSERT INTO subs (sub_hash, deleted_at) VALUES (?, ?) ON CONFLICT (sub_hash) DO UPDATE SET deleted_at = excluded.deleted_at",
        sub, now,
      );
      this.all("DELETE FROM users WHERE id = ?", user.id);
      return { gone, liked };
    });
  }

  // An account that goes (DELETE /me, or 24 months unseen): if it is Bryan's, meta admin_uid goes, so he can claim the
  // role again from a new account; and its count of wrong /admin codes goes from meta admin_claims, which then no
  // longer names its LINE account (the total stays, so the 10 in all still count them).
  forgetAdmin(uid, sub) {
    if (this.getMeta("admin_uid") === uid) this.all("DELETE FROM meta WHERE key = 'admin_uid'");
    const claims = JSON.parse(this.getMeta("admin_claims") ?? "null");
    if (claims?.by && Object.hasOwn(claims.by, sub)) {
      delete claims.by[sub];
      this.setMeta("admin_claims", JSON.stringify(claims));
    }
  }

  // ---- Session cards: a log from the diary, shared to the room for tips ----------------------------------------

  // Posts one of the user's logs (a sessions row) as a session card, for the share frame and POST /me/sessions {share:
  // true}. The note goes through the same filters as a message. Returns {shared_msg}, the card's message id, or
  // {error}: blocked:<rule> for a note the filters stop, or what canWrite() says (locked; slow:<s> past 5 a day). A log
  // whose card is still in the room keeps it, and nothing new is posted. The card's body is {start, end, stars, board,
  // note, cond}, and its spot the log's, so the spot's filter shows it (spec "The room").
  shareSession(user, log) {
    if (log.shared_msg !== null && this.one("SELECT 1 FROM messages WHERE id = ?", log.shared_msg)) {
      return { shared_msg: log.shared_msg };
    }
    const hit = blocked(normalise(log.note).check, BLOCKLIST);
    if (hit) return { error: `blocked:${hit.rule}` };
    const refused = this.canWrite(user, "share");
    if (refused) return { error: refused };
    const { start, end, stars, board, note } = log;
    const body = { start, end, stars, board, note, cond: log.cond === null ? null : JSON.parse(log.cond) };
    const card = this.ctx.storage.transactionSync(() => {
      const row = this.addMessage(user, "session", log.spot, body);
      this.all("UPDATE sessions SET shared_msg = ? WHERE id = ?", row.id, log.id);
      return row;
    });
    this.announce(card);
    return { shared_msg: card.id };
  }

  // One of uid's logs, as its sessions row, or null.
  ownSession(id, uid) {
    return isId(id) ? this.one("SELECT * FROM sessions WHERE id = ? AND uid = ?", id, uid) : null;
  }

  // share {session_id}: shareSession(). The socket gets ok {for: "share", session_id, shared_msg}, and everyone the card
  // as msg. A log that isn't one of the user's (deleted on another screen) is gone.
  onShare(ws, user, frame) {
    if (!isId(frame.session_id)) return "invalid";
    const log = this.ownSession(frame.session_id, user.id);
    if (!log) return "gone";
    const shared = this.shareSession(user, log);
    if (shared.error) return shared.error;
    this.send(ws, { type: "ok", for: "share", session_id: log.id, shared_msg: shared.shared_msg });
  }

  // unshare {session_id}: the log's card goes from the room (every socket gets update {id, deleted: true}), and the log
  // stays, private. ok {for: "unshare", session_id}, also for a log that wasn't shared; gone for one that isn't the
  // user's.
  onUnshare(ws, user, frame) {
    if (!isId(frame.session_id)) return "invalid";
    const log = this.ownSession(frame.session_id, user.id);
    if (!log) return "gone";
    const refused = this.canWrite(user, "unshare");
    if (refused) return refused;
    if (log.shared_msg !== null) {
      const card = this.ctx.storage.transactionSync(() => {
        this.all("UPDATE sessions SET shared_msg = NULL WHERE id = ?", log.id);
        return this.removeOwn(log.shared_msg, user.id);
      });
      if (card) this.announceDeleted([card]);
    }
    this.send(ws, { type: "ok", for: "unshare", session_id: log.id });
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

  // The one alarm. Expired sign-ins go first, then retention runs once it's past next_retention, then the keepalive
  // tick goes out while sockets are open, or, while the chat rests, the sockets are closed instead (rest()). Whatever
  // happened before, the alarm is counted as a request, the usage counts are saved and the next alarm is set: the
  // next retention or tick, or sooner when a handoff still waiting runs out before them.
  async alarm() {
    const now = this.now();
    let handoffsDue = Infinity;
    try {
      // Expired sign-ins go on every alarm, not only at 19:00, and before anything that might fail: a handoff holds
      // a raw LINE ID. The handoffs still waiting are read here too, so a retention run that fails can't leave one
      // waiting for tomorrow's run.
      this.dropExpiredLogins(now);
      handoffsDue = this.handoffsDue();
      if (now >= this.nextRetention()) {
        // The next run is set first, so a run that fails waits until tomorrow instead of retrying in a loop.
        this.setNextRetention(now);
        this.retention(now);
      }
      if (!this.rest()) this.tick();
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

  // Sends one frame to every open socket, or `forAdmin` instead to Bryan's (their attachment's role is "admin"). A
  // frame is a JSON object whose "type" is the spec's frame name.
  broadcast(frame, forAdmin = frame) {
    const text = JSON.stringify(frame);
    const adminText = forAdmin === frame ? text : JSON.stringify(forAdmin);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(adminText !== text && ws.deserializeAttachment()?.role === "admin" ? adminText : text);
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
    // Rate-limit windows that have run out, and nicknames no longer held (canWrite() and nickFor() ignore those), so
    // limits doesn't keep, for ever, which LINE account once had which nickname.
    this.batched(`DELETE FROM limits WHERE rowid IN (SELECT rowid FROM limits WHERE window_end <= ? LIMIT ${BATCH})`, now);
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
  // deleted (it goes 30 days later unless banned), no message keeps their user id, and meta forgets them as
  // DELETE /me does (forgetAdmin()), so a stale admin_uid can't lock Bryan out of the role. Their text messages,
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
        this.forgetAdmin(id, sub_hash);
        this.all("DELETE FROM users WHERE id = ?", id);
      }
      if (stale.length < BATCH) return;
    }
  }
}
