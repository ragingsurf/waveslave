// Tests for chat/src/room.js: the room's tables and their upgrade from schema version 1, the two read paths (history
// and the spot-card reports) and what they cost in rows, the usage counters, the alarm and the daily retention. They
// run inside the Workers runtime (see vitest.config.mjs). Run from chat/: npx vitest run test/room.storage.spec.mjs
//
// Each test uses its own room, so no test sees another's rows. The room's clock is room.now(); tests that
// need a fixed time replace it.
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { randomB64u, sha256b64u, subHash } from "../src/auth.js";
import { CONDS, CROWDS, SIZES, SPOTS } from "../src/mod.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// "Now" for the tests: a 19:00 UTC (03:00 in Taiwan, when retention runs). It is years ahead, so no alarm a
// test sets can go off by itself while the tests run.
const T = Date.UTC(2030, 5, 1, 19, 0);

const PUBLIC_KEYS = ["id", "ts", "nick", "role", "kind", "spot", "body", "reply_to", "likes"];

const freshRoom = () => env.ROOM.getByName(`storage-${crypto.randomUUID()}`, { locationHint: "apac-ne" });

// Runs fn(), counting the rows read and written by every SQL statement the room runs meanwhile.
function cost(room, fn) {
  const real = room.sql;
  const cursors = [];
  room.sql = {
    exec(...args) {
      const cursor = real.exec(...args);
      cursors.push(cursor);
      return cursor;
    },
  };
  try {
    const result = fn();
    const add = (key) => cursors.reduce((n, c) => n + c[key], 0);
    return { result, read: add("rowsRead"), written: add("rowsWritten") };
  } finally {
    room.sql = real;
  }
}

const rows = (room, query, ...binds) => room.sql.exec(query, ...binds).toArray();
const value = (room, query, ...binds) => {
  const row = rows(room, query, ...binds)[0];
  return row === undefined ? undefined : Object.values(row)[0];
};

// ---- Seeding: straight into the tables, the way the room's own write paths will store rows ----

const USERS = [
  { id: "u1", nick: "阿凱", role: "user" },
  { id: "u2", nick: "Leo_88", role: "user" },
  { id: "u3", nick: "Mika", role: "user" },
  { id: "u4", nick: "WaveSlave", role: "admin" },
];

function addUser(room, { id, nick, role = "user", lastSeen, sub = `sub-${id}` }) {
  room.sql.exec(
    `INSERT INTO users (id, sub_hash, nick, nick_key, role, tv, created, last_seen, nick_changed, consent_at, consent_ver)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, 'v1')`,
    id, sub, nick, nick.toLowerCase(), role, lastSeen - DAY, lastSeen, lastSeen - DAY,
  );
}

function addMessage(room, { ts, uid = "u1", kind = "text", spot = null, body = { text: "hi" }, reply_to = null, hidden_by = null }) {
  return room.sql
    .exec(
      `INSERT INTO messages (ts, uid, kind, spot, body, reply_to, hidden_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      ts, uid, kind, spot, JSON.stringify(body), reply_to, hidden_by,
    )
    .one().id;
}

const reportBody = (k) => ({
  size: SIZES[k % SIZES.length],
  cond: CONDS[k % CONDS.length],
  crowd: CROWDS[k % CROWDS.length],
  snap: { hs: 1.2, hs_t: "2030-06-01T07:00" },
});
const pick = ({ size, cond, crowd }) => ({ size, cond, crowd });

// A year of traffic before `now`: 365 days x 100 text messages by the four users in turn, every other one
// tagged with a spot, and 2,000 reports spread over the same year on each spot in turn. Rows go in in time
// order, so ids rise with time as they do live.
function seedYear(room, now) {
  for (const user of USERS) addUser(room, { ...user, lastSeen: now });
  const year = [];
  for (let i = 0; i < 36_500; i++) {
    year.push({ ts: now - 365 * DAY + i * (DAY / 100), uid: USERS[i % 4].id, spot: i % 2 ? null : SPOTS[(i / 2) % 8], body: { text: `message ${i}` } });
  }
  for (let j = 0; j < 2000; j++) {
    year.push({ ts: now - 365 * DAY + j * ((365 * DAY) / 2000) + 1, uid: USERS[j % 4].id, kind: "report", spot: SPOTS[j % 8], body: reportBody(j) });
  }
  addInOrder(room, year);
}

function addInOrder(room, list) {
  list.sort((a, b) => a.ts - b.ts);
  return list.map((m) => addMessage(room, m));
}

// ---- Schema -------------------------------------------------------------------------------------------

const TABLES = {
  users: ["id", "sub_hash", "nick", "nick_key", "role", "tv", "created", "last_seen", "nick_changed", "consent_at", "consent_ver"],
  subs: ["sub_hash", "banned", "deleted_at"],
  messages: ["id", "ts", "uid", "kind", "spot", "body", "reply_to", "likes", "hidden_by", "flag_immune"],
  likes: ["msg_id", "uid"],
  flags: ["msg_id", "sub_hash", "reason", "ts", "rejected"],
  sessions: ["id", "uid", "spot", "start", "end", "stars", "board", "note", "cond", "shared_msg"],
  logins: ["state", "nonce", "pkce_verifier", "h", "created"],
  handoffs: ["code_hash", "h", "sub_hash", "line_name", "pin", "created", "tries", "net"],
  limits: ["key", "n", "window_end"],
  holds: ["msg_id", "body", "uid", "sub_hash", "reason", "ts"],
  meta: ["key", "value"],
};

// Each index on a table, as "col,col" plus whether it is partial (has a WHERE).
const indexes = (room, table) =>
  rows(room, "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL", table)
    .map(({ name, sql }) => ({
      cols: rows(room, "SELECT name FROM pragma_index_info(?) ORDER BY seqno", name).map((r) => r.name).join(","),
      partial: /\bWHERE\b/i.test(sql),
    }))
    .sort((a, b) => (a.cols + a.partial).localeCompare(b.cols + b.partial));

describe("schema", () => {
  it("has every table in the spec, with the spec's columns, after the first get", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      for (const [table, columns] of Object.entries(TABLES)) {
        expect(rows(room, "SELECT name FROM pragma_table_info(?)", table).map((r) => r.name), table).toEqual(columns);
      }
      expect(value(room, "SELECT value FROM meta WHERE key = 'schema_ver'")).toBe(3);
    });
  });

  it("indexes messages on (ts), (spot, ts) and (uid, ts), plus the public reports per spot, and sessions on (uid, start)", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      expect(indexes(room, "messages")).toEqual([
        { cols: "id", partial: true }, // the hidden ones, for Bryan's list
        { cols: "spot,ts", partial: false },
        { cols: "spot,ts", partial: true },
        { cols: "ts", partial: false },
        { cols: "uid,ts", partial: false },
      ]);
      expect(indexes(room, "sessions")).toEqual([{ cols: "uid,start", partial: false }]);
    });
  });

  it("indexes flags by LINE account, and the banned LINE accounts, for the moderation tools", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      expect(indexes(room, "flags")).toEqual([{ cols: "sub_hash,rejected", partial: false }]);
      expect(indexes(room, "subs")).toEqual([{ cols: "sub_hash", partial: true }]);
    });
  });

  it("running migrate() again changes nothing", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      const schema = () => rows(room, "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name");
      const meta = () => rows(room, "SELECT key, value FROM meta WHERE key = 'schema_ver'");
      const before = { schema: schema(), meta: meta() };
      const { written } = cost(room, () => room.migrate());
      expect(written).toBe(0);
      expect({ schema: schema(), meta: meta() }).toEqual(before);
    });
  });

  it("makes a new room's tables all at once: when the last write fails, the room is left with only meta", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      // Back to empty storage, as for a room that has never run.
      for (const name of ownTables(room)) room.sql.exec(`DROP TABLE "${name}"`);
      const atFailure = failSchemaVer(room);
      expect(() => room.migrate()).toThrow("schema_ver write failed");
      delete room.setMeta;
      // Versions 1 to 3 had all run when schema_ver failed...
      expect(atFailure.tables).toEqual(Object.keys(TABLES).sort());
      expect(atFailure.handoffs).toEqual(TABLES.handoffs);
      // ...and the transaction undid them. meta is made before it, so it stays, with no schema_ver.
      expect(ownTables(room)).toEqual(["meta"]);
      expect(value(room, "SELECT value FROM meta WHERE key = 'schema_ver'")).toBeUndefined();
      // So the next migrate() makes them all again.
      room.migrate();
      expect(ownTables(room)).toEqual(Object.keys(TABLES).sort());
      expect(value(room, "SELECT value FROM meta WHERE key = 'schema_ver'")).toBe(3);
    });
  });

  it("keeps the rules later writes rely on: one like per person, unique sign-ins and nicknames, known kinds", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      addUser(room, { id: "a", nick: "Leo", lastSeen: T });
      const id = addMessage(room, { ts: T, uid: "a" });
      room.sql.exec("INSERT INTO likes (msg_id, uid) VALUES (?, 'a')", id);
      expect(() => room.sql.exec("INSERT INTO likes (msg_id, uid) VALUES (?, 'a')", id)).toThrow();
      room.sql.exec("INSERT INTO flags (msg_id, sub_hash, reason, ts) VALUES (?, 's', 'spam', ?)", id, T);
      expect(() => room.sql.exec("INSERT INTO flags (msg_id, sub_hash, reason, ts) VALUES (?, 's', 'other', ?)", id, T)).toThrow();
      // Same LINE account, or same folded nickname, as an existing user.
      expect(() => addUser(room, { id: "b", nick: "Kai", lastSeen: T, sub: "sub-a" })).toThrow();
      expect(() => addUser(room, { id: "c", nick: "LEO", lastSeen: T })).toThrow();
      expect(() => addMessage(room, { ts: T, kind: "video" })).toThrow();
      expect(() => addMessage(room, { ts: T, hidden_by: "bored" })).toThrow();
    });
  });

  it("never reuses a message id, even after the newest message is deleted", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      const first = addMessage(room, { ts: T });
      room.sql.exec("DELETE FROM messages WHERE id = ?", first);
      expect(addMessage(room, { ts: T })).toBeGreaterThan(first);
    });
  });
});

// ---- Upgrading a version-1 room -------------------------------------------------------------------------

// Schema version 1 as merged in PR #97 (main at a09fbd4), which is what the "Deploy chat" workflow creates when it is
// run from that main: the statements of its SCHEMA_V1, in their order. They are copied here, not imported from room.js,
// so this list keeps describing what was really deployed whatever room.js says later. Its handoffs table has LINE's
// raw sub; version 2 drops it.
const MERGED_V1 = [
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
  `CREATE TABLE subs (
    sub_hash TEXT PRIMARY KEY,
    banned INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  )`,
  "CREATE INDEX subs_banned ON subs (sub_hash) WHERE banned = 1",
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
  "CREATE INDEX messages_reports ON messages (spot, ts) WHERE kind = 'report' AND hidden_by IS NULL",
  "CREATE INDEX messages_hidden ON messages (id) WHERE hidden_by IS NOT NULL",
  "CREATE TABLE likes (msg_id INTEGER NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (msg_id, uid)) WITHOUT ROWID",
  `CREATE TABLE flags (
    msg_id INTEGER NOT NULL,
    sub_hash TEXT NOT NULL,
    reason TEXT NOT NULL,
    ts INTEGER NOT NULL,
    rejected INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (msg_id, sub_hash)
  )`,
  "CREATE INDEX flags_sub ON flags (sub_hash, rejected)",
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
  `CREATE TABLE logins (
    state TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    pkce_verifier TEXT NOT NULL,
    h TEXT NOT NULL,
    created INTEGER NOT NULL
  )`,
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
  "CREATE TABLE limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, window_end INTEGER NOT NULL)",
  "CREATE TABLE holds (msg_id INTEGER, body TEXT, uid TEXT, sub_hash TEXT, reason TEXT, ts INTEGER NOT NULL)",
];

// The names of the room's own tables, leaving out SQLite's and Cloudflare's.
const ownTables = (room) =>
  rows(room, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    .map(({ name }) => name);

// Every value in every table of the room's own, as text.
const everyValue = (room) =>
  ownTables(room).flatMap((name) => rows(room, `SELECT * FROM "${name}"`).flatMap((row) => Object.values(row).map(String)));

// Makes migrate()'s last write, the new schema_ver, fail: this room's setMeta() throws once every step has run. Returns
// what the room had at that moment (its tables, and the columns of handoffs if it had one). The test deletes
// room.setMeta afterwards to give the room its own back.
function failSchemaVer(room) {
  const atFailure = {};
  room.setMeta = (key) => {
    atFailure.tables = ownTables(room);
    atFailure.handoffs = rows(room, "SELECT name FROM pragma_table_info('handoffs')").map((r) => r.name);
    throw new Error(`${key} write failed`);
  };
  return atFailure;
}

// Every table of the room's own with its columns as SQLite has them (name, type, NOT NULL, default, primary key) and
// its indexes, so two rooms' tables can be compared.
const shape = (room) =>
  Object.fromEntries(
    rows(room, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
      .map(({ name }) => [name, {
        columns: rows(room, `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?) ORDER BY cid`, name),
        indexes: rows(room, "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name", name),
      }]),
  );

const lineSub = () => `U${[...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

// A room as main's code left it, with someone's sign-in waiting to be redeemed: this room's own tables are dropped,
// then main's migrate() is done by hand (meta, its SCHEMA_V1 and schema_ver 1). The waiting handoff is written the way
// main's createHandoff() wrote one, with LINE's raw sub in it, a minute ago on the real clock. The room also has an
// account and a message, which the upgrade must leave as they are. Returns the room and the person: their verifier v,
// LINE sub and its sub_hash, LINE name, handoff code and pin.
async function mergedV1Room() {
  const stub = freshRoom();
  const who = { v: randomB64u(32), sub: lineSub(), name: "Kai", code: randomB64u(16), pin: "482913" };
  who.subHash = await subHash(who.sub, env.SUB_PEPPER);
  const h = await sha256b64u(who.v);
  const codeHash = await sha256b64u(who.code);
  await runInDurableObject(stub, (room) => {
    const own = rows(room, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
    for (const { name } of own) room.sql.exec(`DROP TABLE "${name}"`);
    room.sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value)");
    for (const statement of MERGED_V1) room.sql.exec(statement);
    room.sql.exec("INSERT INTO meta (key, value) VALUES ('schema_ver', 1)");
    room.sql.exec(
      "INSERT INTO handoffs (code_hash, h, sub_hash, sub, line_name, pin, created, tries) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      codeHash, h, who.subHash, who.sub, who.name, who.pin, Date.now() - MIN,
    );
    addUser(room, { id: "u1", nick: "Leo_88", lastSeen: T });
    addMessage(room, { ts: T, uid: "u1", body: { text: "Clean sets at the point" } });
  });
  return { stub, who, h, codeHash };
}

// The room's sign-in routes, called as the Worker calls them.
async function roomPost(stub, route, body) {
  const res = await stub.fetch(`https://room/r/${route}`, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("a room made by schema version 1, as merged in PR #97", () => {
  it("is what main's code made: handoffs has a sub column, with a raw LINE sub in it, and schema_ver is 1", async () => {
    const { stub, who } = await mergedV1Room();
    await runInDurableObject(stub, (room) => {
      expect(rows(room, "SELECT name FROM pragma_table_info('handoffs')").map((r) => r.name)).toEqual(
        ["code_hash", "h", "sub_hash", "sub", "line_name", "pin", "created", "tries"],
      );
      expect(value(room, "SELECT sub FROM handoffs")).toBe(who.sub);
      expect(value(room, "SELECT value FROM meta WHERE key = 'schema_ver'")).toBe(1);
    });
  });

  it("migrate() makes it version 3: handoffs loses sub and gains net, its live row stays with its sub_hash, and the raw sub is gone", async () => {
    const { stub, who, h, codeHash } = await mergedV1Room();
    const fresh = await runInDurableObject(freshRoom(), (room) => shape(room));
    await runInDurableObject(stub, (room) => {
      const before = { users: rows(room, "SELECT * FROM users"), messages: rows(room, "SELECT * FROM messages") };
      room.migrate();
      expect(value(room, "SELECT value FROM meta WHERE key = 'schema_ver'")).toBe(3);
      expect(rows(room, "SELECT name FROM pragma_table_info('handoffs')").map((r) => r.name)).toEqual(TABLES.handoffs);
      expect(rows(room, "SELECT * FROM handoffs")).toEqual([
        { code_hash: codeHash, h, sub_hash: who.subHash, line_name: who.name, pin: who.pin, created: expect.any(Number), tries: 0, net: null },
      ]);
      expect(everyValue(room).filter((v) => v.includes(who.sub))).toEqual([]);
      // Every table now has the same columns and indexes as in a room made new by this code.
      expect(shape(room)).toEqual(fresh);
      // The rest is as it was.
      expect({ users: rows(room, "SELECT * FROM users"), messages: rows(room, "SELECT * FROM messages") }).toEqual(before);
    });
  });

  it("running migrate() again on the upgraded room changes nothing", async () => {
    const { stub } = await mergedV1Room();
    await runInDurableObject(stub, (room) => {
      room.migrate();
      const state = () => ({
        schema: rows(room, "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name"),
        values: everyValue(room).sort(),
      });
      const before = state();
      const { written } = cost(room, () => room.migrate());
      expect(written).toBe(0);
      expect(state()).toEqual(before);
    });
  });

  it("migrate() makes version 2 all at once: when the last write fails, the dropped column comes back and it stays at 1", async () => {
    const { stub, who } = await mergedV1Room();
    await runInDurableObject(stub, (room) => {
      const before = { shape: shape(room), handoffs: rows(room, "SELECT * FROM handoffs") };
      const atFailure = failSchemaVer(room);
      expect(() => room.migrate()).toThrow("schema_ver write failed");
      delete room.setMeta;
      // The version-2 step had run when schema_ver failed...
      expect(atFailure.handoffs).toEqual(TABLES.handoffs);
      // ...and the transaction undid it: the room is version 1 again, raw sub and all.
      expect(value(room, "SELECT value FROM meta WHERE key = 'schema_ver'")).toBe(1);
      expect({ shape: shape(room), handoffs: rows(room, "SELECT * FROM handoffs") }).toEqual(before);
      expect(value(room, "SELECT sub FROM handoffs")).toBe(who.sub);
      // So the next migrate() runs the step again, and this time it holds.
      room.migrate();
      expect(value(room, "SELECT value FROM meta WHERE key = 'schema_ver'")).toBe(3);
      expect(rows(room, "SELECT name FROM pragma_table_info('handoffs')").map((r) => r.name)).toEqual(TABLES.handoffs);
    });
  });

  it("takes sign-ins once this code runs on it: a new handoff is made and redeemed, and so is the one left waiting", async () => {
    const { stub, who } = await mergedV1Room();
    // The new code starts on the old room's storage, as after a deploy: the constructor's migrate() upgrades it.
    await evictDurableObject(stub);
    const next = { v: randomB64u(32), sub: lineSub(), name: "Nami" };
    const made = await roomPost(stub, "handoffs", { h: await sha256b64u(next.v), sub: next.sub, line_name: next.name });
    expect(made.status).toBe(200);
    expect(Object.keys(made.body).sort()).toEqual(["code", "pin"]);
    const { code, pin } = made.body;
    // A new person: redeeming by code, and by pin, finds the handoff and asks for a nickname; the handoff stays.
    expect(await roomPost(stub, "redeem", { v: next.v, code })).toEqual({ status: 200, body: { needs_signup: true, line_name: "Nami" } });
    expect(await roomPost(stub, "redeem", { v: next.v, pin })).toEqual({ status: 200, body: { needs_signup: true, line_name: "Nami" } });
    const signed = await roomPost(stub, "signup", { v: next.v, code, nick: "Nami_01", consent: "v1" });
    expect(signed.status).toBe(200);
    expect(typeof signed.body.token).toBe("string");
    // The handoff written before the upgrade still works, by its code and by its pin.
    expect(await roomPost(stub, "redeem", { v: who.v, code: who.code })).toEqual({ status: 200, body: { needs_signup: true, line_name: "Kai" } });
    expect(await roomPost(stub, "redeem", { v: who.v, pin: who.pin })).toEqual({ status: 200, body: { needs_signup: true, line_name: "Kai" } });
    const old = await roomPost(stub, "signup", { v: who.v, pin: who.pin, nick: "Kai_01", consent: "v1" });
    expect(old.status).toBe(200);
    await runInDurableObject(stub, async (room) => {
      expect(value(room, "SELECT value FROM meta WHERE key = 'schema_ver'")).toBe(3);
      expect(rows(room, "SELECT nick, sub_hash FROM users WHERE nick IN ('Nami_01', 'Kai_01') ORDER BY nick")).toEqual([
        { nick: "Kai_01", sub_hash: who.subHash },
        { nick: "Nami_01", sub_hash: await subHash(next.sub, env.SUB_PEPPER) },
      ]);
      expect(rows(room, "SELECT * FROM handoffs")).toEqual([]);
      const values = everyValue(room);
      expect(values.filter((v) => v.includes(who.sub) || v.includes(next.sub))).toEqual([]);
    });
  });
});

// ---- Read paths -----------------------------------------------------------------------------------------

describe("history()", () => {
  it("sends only the public fields, joins the nickname and role, and leaves hidden messages out", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      addUser(room, { ...USERS[0], lastSeen: T });
      addUser(room, { ...USERS[3], lastSeen: T });
      const a = addMessage(room, { ts: T - 9 * MIN, uid: "u1", spot: "jinshan", body: { text: "Clean sets at the point" } });
      addMessage(room, { ts: T - 8 * MIN, uid: "u4", hidden_by: "flags" });
      const c = addMessage(room, { ts: T - 7 * MIN, uid: null, kind: "report", spot: "fulong", body: reportBody(2) });
      addMessage(room, { ts: T - 6 * MIN, uid: "u1", hidden_by: "ban" });
      addMessage(room, { ts: T - 5 * MIN, uid: "u1", hidden_by: "admin" });
      const f = addMessage(room, { ts: T - 4 * MIN, uid: "someone-deleted" });
      const g = addMessage(room, { ts: T - 3 * MIN, uid: "u4", body: { text: "Thanks!" }, reply_to: a });

      const list = room.history();
      expect(list.map((m) => m.id)).toEqual([a, c, f, g]);
      for (const m of list) expect(Object.keys(m).sort()).toEqual([...PUBLIC_KEYS].sort());
      expect(list[0]).toEqual({
        id: a, ts: T - 9 * MIN, nick: "阿凱", role: "user", kind: "text", spot: "jinshan",
        body: { text: "Clean sets at the point" }, reply_to: null, likes: 0,
      });
      expect(list[1]).toMatchObject({ nick: null, role: null, kind: "report", body: reportBody(2) });
      expect(list[2]).toMatchObject({ nick: null, role: null });
      expect(list[3]).toMatchObject({ nick: "WaveSlave", role: "admin", reply_to: a });
      // No user id or LINE data anywhere in what goes out.
      const text = JSON.stringify(list);
      for (const secret of ["u1", "u4", "sub-", "someone-deleted"]) expect(text).not.toContain(secret);
    });
  });

  it("caps a page at 100 and treats a bad before-id or limit as none", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      addUser(room, { ...USERS[0], lastSeen: T });
      const ids = addInOrder(room, Array.from({ length: 120 }, (_, i) => ({ ts: T - (120 - i) * MIN })));
      expect(room.history(undefined, 500).map((m) => m.id)).toEqual(ids.slice(-100));
      expect(room.history("12", 5).map((m) => m.id)).toEqual(ids.slice(-5));
      expect(room.history(ids[10], 0)).toHaveLength(10);
      expect(room.history(-1, 3).map((m) => m.id)).toEqual(ids.slice(-3));
      expect(room.history(ids[0])).toEqual([]);
    });
  });
});

describe("read costs, on a room seeded with a year of messages", () => {
  const stub = freshRoom();
  let seed;

  beforeAll(async () => {
    seed = await runInDurableObject(stub, (room) => {
      seedYear(room, T);
      // The last few hours: 30 jinshan reports, 10 fulong ones, 5 jinshan ones just over 4 hours old, a hidden
      // jinshan report (the newest row of all) and a jinshan-tagged text message.
      const recent = [];
      for (let k = 1; k <= 30; k++) recent.push({ ts: T - k * 7 * MIN, uid: "u2", kind: "report", spot: "jinshan", body: reportBody(k) });
      for (let k = 1; k <= 10; k++) recent.push({ ts: T - k * 11 * MIN - 30_000, uid: "u3", kind: "report", spot: "fulong", body: reportBody(k) });
      for (let k = 1; k <= 5; k++) recent.push({ ts: T - 4 * HOUR - k * 10 * MIN, uid: "u3", kind: "report", spot: "jinshan", body: reportBody(k) });
      recent.push({ ts: T - MIN, uid: "u1", kind: "report", spot: "jinshan", body: reportBody(0), hidden_by: "flags" });
      recent.push({ ts: T - 2 * MIN, uid: "u1", spot: "jinshan", body: { text: "Jinshan is pumping" } });
      addInOrder(room, recent);
      // Two more hidden messages inside the newest page.
      room.sql.exec("UPDATE messages SET hidden_by = 'ban' WHERE id = (SELECT id FROM messages ORDER BY id DESC LIMIT 1 OFFSET 60)");
      room.sql.exec("UPDATE messages SET hidden_by = 'admin' WHERE id = (SELECT id FROM messages ORDER BY id DESC LIMIT 1 OFFSET 80)");
      // The seed wrote messages straight into the table, so tell the room, as every write path does.
      room.messagesChanged();
      return {
        newest100: rows(room, "SELECT id FROM messages WHERE hidden_by IS NULL ORDER BY id DESC LIMIT 100").map((r) => r.id).reverse(),
        next50: rows(room, "SELECT id FROM messages WHERE hidden_by IS NULL ORDER BY id DESC LIMIT 50 OFFSET 100").map((r) => r.id).reverse(),
        lastVisible: value(room, "SELECT max(id) FROM messages WHERE hidden_by IS NULL"),
        hiddenInPage: value(room, "SELECT count(*) FROM messages WHERE hidden_by IS NOT NULL AND id >= ?",
          value(room, "SELECT min(id) FROM (SELECT id FROM messages WHERE hidden_by IS NULL ORDER BY id DESC LIMIT 100)")),
        total: value(room, "SELECT count(*) FROM messages"),
      };
    });
  }, 120_000);

  it("is a big enough room to mean something", () => {
    expect(seed.total).toBe(36_500 + 2000 + 47);
    expect(seed.hiddenInPage).toBe(3);
  });

  it("history() returns the newest 100 visible messages in ascending id order, reading at most 110 rows", async () => {
    await runInDurableObject(stub, (room) => {
      const { result, read } = cost(room, () => room.history());
      expect(result.map((m) => m.id)).toEqual(seed.newest100);
      expect(result.at(-1).id).toBe(seed.lastVisible);
      expect(read).toBeLessThanOrEqual(110);
    });
  });

  it("history(before) returns the 50 before it, also cheaply", async () => {
    await runInDurableObject(stub, (room) => {
      const { result, read } = cost(room, () => room.history(seed.newest100[0], 50));
      expect(result.map((m) => m.id)).toEqual(seed.next50);
      expect(read).toBeLessThanOrEqual(60);
    });
  });

  it("usage() counts the rows that the room's own queries read", async () => {
    await runInDurableObject(stub, (room) => {
      room.now = () => T;
      const before = room.usage("read", 0).read;
      const { read } = cost(room, () => room.history());
      expect(room.usage("read", 0).read - before).toBe(read);
    });
  });

  it("reportsFor() returns the spot's newest 20 reports from the last 4 hours, reading at most 20 rows", async () => {
    await runInDurableObject(stub, (room) => {
      const { result, read } = cost(room, () => room.reportsFor("jinshan", T));
      const expected = Array.from({ length: 20 }, (_, i) => {
        const { size, cond, crowd } = reportBody(i + 1);
        return { ts: T - (i + 1) * 7 * MIN, size, cond, crowd };
      });
      expect(result).toEqual({ reports: expected, online: 0, last_id: seed.lastVisible });
      expect(read).toBeLessThanOrEqual(20);
    });
  });

  it("reportsFor() answers from its memory copy for 60 s, then reads again", async () => {
    await runInDurableObject(stub, (room) => {
      const first = room.reportsFor("fulong", T);
      expect(first.reports).toHaveLength(10);
      expect(first.reports.every((r, i, all) => i === 0 || all[i - 1].ts > r.ts)).toBe(true);
      const again = cost(room, () => room.reportsFor("fulong", T + 59 * 1000));
      expect(again.read).toBe(0);
      expect(again.result).toEqual(first);
      const later = cost(room, () => room.reportsFor("fulong", T + 60 * 1000));
      expect(later.read).toBeGreaterThan(0);
      expect(later.result.reports).toEqual(first.reports);
    });
  });

  it("reportsFor() refuses a spot that isn't one of the 8, without remembering it", async () => {
    await runInDurableObject(stub, (room) => {
      expect(room.reportsFor("pipeline", T)).toBeNull();
      expect(room.reportsFor("__proto__", T)).toBeNull();
      expect(room.reportCopies.has("pipeline")).toBe(false);
    });
  });
});

describe("reportsFor() and writes", () => {
  it("a write that tells the room shows up at once, and the memory copy never shows reports past 4 hours", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      addUser(room, { ...USERS[0], lastSeen: T });
      const old = addMessage(room, { ts: T - 4 * HOUR + 30_000, kind: "report", spot: "suao", body: reportBody(1) });
      room.messagesChanged("suao");
      expect(room.reportsFor("suao", T)).toEqual({ reports: [{ ts: T - 4 * HOUR + 30_000, ...pick(reportBody(1)) }], online: 0, last_id: old });
      // 45 s later the copy is still in use, but that report is now over 4 hours old.
      const copy = cost(room, () => room.reportsFor("suao", T + 45_000));
      expect(copy.read).toBe(0);
      expect(copy.result.reports).toEqual([]);

      const fresh = addMessage(room, { ts: T + 10_000, kind: "report", spot: "suao", body: reportBody(4) });
      room.messagesChanged("suao");
      const next = room.reportsFor("suao", T + 40_000);
      expect(next.reports.map((r) => r.ts)).toEqual([T + 10_000]);
      expect(next.last_id).toBe(fresh);

      // A hidden message is not the newest one for the CHAT button's dot.
      room.sql.exec("UPDATE messages SET hidden_by = 'flags' WHERE id = ?", fresh);
      room.messagesChanged("suao");
      expect(room.reportsFor("suao", T + 50_000)).toEqual({ reports: [], online: 0, last_id: old });
    });
  });
});

// ---- Usage counters ---------------------------------------------------------------------------------------

const savedUsage = (room) => {
  const text = value(room, "SELECT value FROM meta WHERE key = 'usage'");
  return text === undefined ? undefined : JSON.parse(text);
};

// Counts how many times the room saves its usage counts while fn() runs.
async function saves(room, fn) {
  let n = 0;
  const save = room.saveUsage;
  room.saveUsage = function () {
    n += 1;
    return save.call(this);
  };
  try {
    await fn();
    return n;
  } finally {
    delete room.saveUsage;
  }
}

describe("usage()", () => {
  it("saves today's counts to meta on the first request, then after 100 requests or 30 s, whichever comes first", async () => {
    await runInDurableObject(freshRoom(), async (room) => {
      let now = T;
      room.now = () => now;
      // Nothing is saved yet, so the first request saves.
      room.usage("req", 1);
      expect(savedUsage(room)).toMatchObject({ day: "2030-06-01", req: 1 });
      // 99 more in the same moment stay in memory; the 100th since that save writes them all.
      for (let i = 0; i < 99; i++) room.usage("req", 1);
      room.usage("read", 500);
      room.usage("write", 7);
      expect(savedUsage(room).req).toBe(1);
      const totals = room.usage("req", 1);
      expect(totals).toMatchObject({ day: "2030-06-01", req: 101 });
      expect(totals.read).toBeGreaterThanOrEqual(500);
      expect(totals.write).toBeGreaterThanOrEqual(7);
      expect(savedUsage(room)).toMatchObject({ day: "2030-06-01", req: 101 });
      expect(savedUsage(room).read).toBeGreaterThanOrEqual(500);
      expect(savedUsage(room).write).toBeGreaterThanOrEqual(7);
      // Fewer than 100 requests, but 30 s after the last save.
      now = T + 29_999;
      room.usage("req", 1);
      expect(savedUsage(room).req).toBe(101);
      now = T + 30_000;
      room.usage("req", 1);
      expect(savedUsage(room).req).toBe(103);
      // Only reading the totals saves nothing.
      now = T + 90_000;
      expect(await saves(room, () => expect(room.usage("req", 0).req).toBe(103))).toBe(0);
      expect(() => room.usage("bytes", 1)).toThrow();
    });
  });

  it("starts again from zero at 00:00 UTC, when the free plan's limits reset", async () => {
    await runInDurableObject(freshRoom(), (room) => {
      room.now = () => Date.UTC(2030, 5, 1, 23, 59);
      for (let i = 0; i < 150; i++) room.usage("req", 1);
      room.now = () => Date.UTC(2030, 5, 2, 0, 0);
      const today = room.usage("req", 1);
      expect(today).toMatchObject({ day: "2030-06-02", req: 1, read: 0 });
      expect(today.write).toBeLessThanOrEqual(1); // at most the row that saved them
      expect(savedUsage(room)).toMatchObject({ day: "2030-06-02", req: 1, read: 0 });
    });
  });

  it("keeps fewer than 100 requests across a restart, once 30 s have passed since the last save", async () => {
    const stub = freshRoom();
    await runInDurableObject(stub, (room) => {
      let now = T;
      room.now = () => now;
      for (let i = 0; i < 10; i++) room.usage("req", 1);
      now = T + 30_000;
      room.usage("req", 1);
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, (room) => {
      room.now = () => T + 30_000;
      expect(room.usage("req", 0).req).toBe(11);
    });
  });

  it("counts the 30 s from the last save by any copy of the room, so waking up doesn't cost a write each time", async () => {
    const stub = freshRoom();
    await runInDurableObject(stub, (room) => {
      room.now = () => T;
      room.usage("req", 1); // nothing saved yet, so this saves
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (room) => {
      let now = T + 10_000;
      room.now = () => now;
      expect(await saves(room, () => room.usage("req", 1))).toBe(0);
      now = T + 30_000;
      expect(await saves(room, () => room.usage("req", 1))).toBe(1);
      expect(savedUsage(room).req).toBe(3);
    });
  });

  it("saves the counts once at the end of every alarm, so a room that sleeps between ticks keeps them", async () => {
    const stub = freshRoom();
    // Fewer than 100 requests in one moment, then an alarm.
    const first = await runInDurableObject(stub, async (room) => {
      room.now = () => T - HOUR;
      for (let i = 0; i < 10; i++) room.usage("req", 1);
      room.usage("read", 500);
      room.usage("write", 7);
      const n = await saves(room, () => room.alarm());
      // The save came after the alarm's own queries.
      expect(savedUsage(room).read).toBe(room.usage("read", 0).read);
      return n;
    });
    expect(first).toBe(1);
    await evictDurableObject(stub);
    // The next keepalive alarm, 45 s later, in a new copy of the room: still one save.
    const second = await runInDurableObject(stub, async (room) => {
      room.now = () => T - HOUR + 45_000;
      const used = room.usage("req", 0);
      expect(used.req).toBe(11); // the 10, and the alarm
      expect(used.read).toBeGreaterThanOrEqual(500);
      expect(used.write).toBeGreaterThanOrEqual(7);
      const n = await saves(room, () => room.alarm());
      expect(savedUsage(room).read).toBe(room.usage("read", 0).read);
      return n;
    });
    expect(second).toBe(1);
    await evictDurableObject(stub);
    await runInDurableObject(stub, (room) => {
      room.now = () => T - HOUR + 45_000;
      expect(room.usage("req", 0).req).toBe(12);
    });
  });
});

// ---- Alarm --------------------------------------------------------------------------------------------

describe("ensureAlarm()", () => {
  it("sets the alarm for the next 19:00 UTC when there is none", async () => {
    await runInDurableObject(freshRoom(), async (room, state) => {
      room.now = () => T - 5 * HOUR;
      expect(await state.storage.getAlarm()).toBeNull();
      await room.ensureAlarm();
      expect(await state.storage.getAlarm()).toBe(T);
      expect(value(room, "SELECT value FROM meta WHERE key = 'next_retention'")).toBe(T);
    });
  });

  it("counts 19:00 UTC itself as past, so the next run is a day later", async () => {
    await runInDurableObject(freshRoom(), async (room, state) => {
      room.now = () => T;
      await room.ensureAlarm();
      expect(await state.storage.getAlarm()).toBe(T + DAY);
    });
  });

  it("keeps an existing earlier alarm, and moves a later one forward", async () => {
    await runInDurableObject(freshRoom(), async (room, state) => {
      room.now = () => T - 5 * HOUR;
      await state.storage.setAlarm(T - 4 * HOUR);
      await room.ensureAlarm();
      expect(await state.storage.getAlarm()).toBe(T - 4 * HOUR);
      await state.storage.setAlarm(T + 2 * DAY);
      await room.ensureAlarm();
      expect(await state.storage.getAlarm()).toBe(T);
    });
  });

  it("is called by every request to the room", async () => {
    const stub = freshRoom();
    const res = await stub.fetch("https://room/nothing-here");
    expect(res.status).toBe(404);
    await runInDurableObject(stub, async (room, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
      expect(room.usage("req", 0).req).toBe(1);
    });
  });
});

describe("alarm()", () => {
  it("with a socket open, sends tick {online} and comes back in 45 s", async () => {
    await runInDurableObject(freshRoom(), async (room, state) => {
      room.now = () => T - HOUR;
      const [client, server] = Object.values(new WebSocketPair());
      state.acceptWebSocket(server);
      client.accept();
      const frames = [];
      client.addEventListener("message", (e) => {
        frames.push(JSON.parse(e.data));
      });
      await room.ensureAlarm();
      expect(await state.storage.getAlarm()).toBe(T - HOUR + 45_000);
      await room.alarm();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(frames).toEqual([{ type: "tick", online: 1 }]);
      expect(await state.storage.getAlarm()).toBe(T - HOUR + 45_000);
      client.close(1000, "done");
    });
  });

  it("before 19:00 UTC runs no retention, and with no socket open comes back at 19:00", async () => {
    const stub = freshRoom();
    const old = await runInDurableObject(stub, async (room) => {
      room.now = () => T - HOUR;
      const id = addMessage(room, { ts: T - 40 * DAY });
      await room.ensureAlarm();
      return id;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (room, state) => {
      expect(value(room, "SELECT count(*) FROM messages WHERE id = ?", old)).toBe(1);
      expect(await state.storage.getAlarm()).toBe(T);
    });
  });

  it("drops expired sign-ins on every run, since a handoff holds the person's LINE name", async () => {
    await runInDurableObject(freshRoom(), async (room) => {
      room.now = () => T - HOUR;
      for (const [code, created] of [["expired", T - HOUR - 11 * MIN], ["live", T - HOUR - 9 * MIN]]) {
        room.sql.exec(
          "INSERT INTO handoffs (code_hash, h, sub_hash, line_name, pin, created, tries) VALUES (?, 'h', 'sub-x', 'Kai', '123456', ?, 0)",
          code, created,
        );
        room.sql.exec("INSERT INTO logins (state, nonce, pkce_verifier, h, created) VALUES (?, 'n', 'p', 'h', ?)", code, created);
      }
      await room.alarm();
      expect(rows(room, "SELECT code_hash FROM handoffs")).toEqual([{ code_hash: "live" }]);
      expect(rows(room, "SELECT state FROM logins")).toEqual([{ state: "live" }]);
    });
  });
});

describe("retention, run by the alarm at 19:00 UTC", () => {
  const stub = freshRoom();
  let id;

  beforeAll(async () => {
    id = await runInDurableObject(stub, async (room) => {
      room.now = () => T;
      seedYear(room, T);
      addUser(room, { id: "gone", nick: "Gone", lastSeen: T - 731 * DAY });
      addUser(room, { id: "kept", nick: "Still", lastSeen: T - 729 * DAY });
      const session = { text: "Kept nosediving", stars: 3 };
      const ids = {
        text31: addMessage(room, { ts: T - 31 * DAY }),
        text29: addMessage(room, { ts: T - 29 * DAY }),
        session31: addMessage(room, { ts: T - 31 * DAY, kind: "session", spot: "wushi", body: session }),
        session29: addMessage(room, { ts: T - 29 * DAY, kind: "session", spot: "wushi", body: session }),
        report29: addMessage(room, { ts: T - 29 * DAY, kind: "report", spot: "jinshan", body: reportBody(1) }),
        report31: addMessage(room, { ts: T - 31 * DAY, kind: "report", spot: "jinshan", body: reportBody(2) }),
        report364: addMessage(room, { ts: T - 364 * DAY, kind: "report", spot: "jinshan", body: reportBody(3) }),
        report366: addMessage(room, { ts: T - 366 * DAY, kind: "report", spot: "jinshan", body: reportBody(4) }),
      };
      const addSession = (uid, start, shared) =>
        room.sql
          .exec(
            `INSERT INTO sessions (uid, spot, start, end, stars, board, note, cond, shared_msg)
             VALUES (?, 'wushi', ?, ?, 3, 'short', 'Kept nosediving', NULL, ?) RETURNING id`,
            uid, start, start + 2 * HOUR, shared,
          )
          .one().id;
      ids.sharedOld = addSession("u1", T - 31 * DAY, ids.session31);
      ids.sharedNew = addSession("u1", T - 29 * DAY, ids.session29);
      ids.goneLog = addSession("gone", T - 732 * DAY, null);
      ids.keptLog = addSession("kept", T - 730 * DAY, null);
      for (const [msg, uid] of [[ids.text31, "u2"], [999_999, "u3"], [ids.text29, "u2"], [ids.report364, "u3"]]) {
        room.sql.exec("INSERT INTO likes (msg_id, uid) VALUES (?, ?)", msg, uid);
      }
      for (const [msg, sub, ts] of [
        [ids.text31, "s1", T - 31 * DAY], // its message goes today
        [999_999, "s1", T - DAY], // already orphaned
        [ids.text29, "s2", T - 29 * DAY],
        [ids.report364, "s1", T - 181 * DAY], // over 180 days old
        [ids.report364, "s2", T - 179 * DAY],
      ]) {
        room.sql.exec("INSERT INTO flags (msg_id, sub_hash, reason, ts, rejected) VALUES (?, ?, 'spam', ?, 0)", msg, sub, ts);
      }
      for (const [state, created] of [["stale", T - 11 * MIN], ["fresh", T - 9 * MIN]]) {
        room.sql.exec("INSERT INTO logins (state, nonce, pkce_verifier, h, created) VALUES (?, 'n', 'p', 'h', ?)", state, created);
        room.sql.exec(
          "INSERT INTO handoffs (code_hash, h, sub_hash, line_name, pin, created, tries) VALUES (?, 'h', 'sub-x', 'Kai', '123456', ?, 0)",
          state, created,
        );
      }
      for (const [msg, ts] of [[1, T - 181 * DAY], [2, T - 179 * DAY]]) {
        room.sql.exec("INSERT INTO holds (msg_id, body, uid, sub_hash, reason, ts) VALUES (?, '{}', 'u1', 'sub-u1', 'child', ?)", msg, ts);
      }
      // Rate-limit windows and held nicknames: two run out (one just now), two still running.
      for (const [key, end] of [
        ["sub-u1:say:10m", T - MIN],
        ["held:kai:sub-u1", T],
        ["sub-u2:like:10m", T + MIN],
        ["held:mika:sub-u2", T + DAY],
      ]) {
        room.sql.exec("INSERT INTO limits (key, n, window_end) VALUES (?, 1, ?)", key, end);
      }
      for (const [sub, banned, deletedAt] of [
        ["sub-deleted-31", 0, T - 31 * DAY],
        ["sub-deleted-29", 0, T - 29 * DAY],
        ["sub-banned", 1, T - 400 * DAY],
        ["sub-u1", 0, T - 60 * DAY], // deleted once, then signed up again as u1
      ]) {
        room.sql.exec("INSERT INTO subs (sub_hash, banned, deleted_at) VALUES (?, ?, ?)", sub, banned, deletedAt);
      }
      room.sql.exec("INSERT INTO meta (key, value) VALUES ('next_retention', ?)", T);
      // The stale account was Bryan's, and it and the kept one each tried a wrong /admin code.
      room.sql.exec("INSERT INTO meta (key, value) VALUES ('admin_uid', 'gone')");
      room.sql.exec("INSERT INTO meta (key, value) VALUES ('admin_claims', ?)", JSON.stringify({ total: 3, by: { "sub-gone": 2, "sub-kept": 1 } }));
      await room.ensureAlarm();
      return ids;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
  }, 120_000);

  const check = (fn) => runInDurableObject(stub, fn);
  const has = (room, query, ...binds) => value(room, query, ...binds) !== undefined;

  it("deletes text and session messages older than 30 days, and no others", () =>
    check((room) => {
      expect(value(room, "SELECT count(*) FROM messages WHERE kind IN ('text', 'session') AND ts < ?", T - 30 * DAY)).toBe(0);
      // The seeded year leaves 3,000 text messages inside 30 days, plus the one at 29 days.
      expect(value(room, "SELECT count(*) FROM messages WHERE kind = 'text'")).toBe(3001);
      expect(has(room, "SELECT id FROM messages WHERE id = ?", id.text31)).toBe(false);
      expect(has(room, "SELECT id FROM messages WHERE id = ?", id.session31)).toBe(false);
      expect(has(room, "SELECT id FROM messages WHERE id = ?", id.text29)).toBe(true);
      expect(has(room, "SELECT id FROM messages WHERE id = ?", id.session29)).toBe(true);
    }));

  it("clears a session's shared card once the card is gone", () =>
    check((room) => {
      expect(value(room, "SELECT shared_msg FROM sessions WHERE id = ?", id.sharedOld)).toBeNull();
      expect(value(room, "SELECT shared_msg FROM sessions WHERE id = ?", id.sharedNew)).toBe(id.session29);
    }));

  it("removes the poster from reports older than 30 days, and deletes reports older than a year", () =>
    check((room) => {
      expect(value(room, "SELECT uid FROM messages WHERE id = ?", id.report29)).toBe("u1");
      expect(rows(room, "SELECT uid FROM messages WHERE id = ?", id.report31)).toEqual([{ uid: null }]);
      expect(rows(room, "SELECT uid FROM messages WHERE id = ?", id.report364)).toEqual([{ uid: null }]);
      expect(has(room, "SELECT id FROM messages WHERE id = ?", id.report366)).toBe(false);
      expect(value(room, "SELECT count(*) FROM messages WHERE kind = 'report' AND ts < ? AND uid IS NOT NULL", T - 30 * DAY)).toBe(0);
      expect(value(room, "SELECT count(*) FROM messages WHERE kind = 'report' AND ts < ?", T - 365 * DAY)).toBe(0);
    }));

  it("deletes orphaned likes and flags, and flags older than 180 days", () =>
    check((room) => {
      expect(rows(room, "SELECT msg_id, uid FROM likes ORDER BY msg_id")).toEqual(
        [{ msg_id: id.report364, uid: "u3" }, { msg_id: id.text29, uid: "u2" }].sort((a, b) => a.msg_id - b.msg_id),
      );
      expect(rows(room, "SELECT msg_id, sub_hash FROM flags ORDER BY msg_id")).toEqual(
        [{ msg_id: id.report364, sub_hash: "s2" }, { msg_id: id.text29, sub_hash: "s2" }].sort((a, b) => a.msg_id - b.msg_id),
      );
    }));

  it("deletes logins and handoffs past their 10 minutes, and holds after 180 days", () =>
    check((room) => {
      expect(rows(room, "SELECT state FROM logins")).toEqual([{ state: "fresh" }]);
      expect(rows(room, "SELECT code_hash FROM handoffs")).toEqual([{ code_hash: "fresh" }]);
      expect(rows(room, "SELECT msg_id FROM holds")).toEqual([{ msg_id: 2 }]);
    }));

  it("deletes rate-limit windows that have run out, and nicknames no longer held", () =>
    check((room) => {
      expect(rows(room, "SELECT key FROM limits ORDER BY key")).toEqual([{ key: "held:mika:sub-u2" }, { key: "sub-u2:like:10m" }]);
    }));

  it("deletes accounts not seen for 730 days, with their logs, and keeps their LINE account's row for 30 days", () =>
    check((room) => {
      expect(has(room, "SELECT id FROM users WHERE id = 'gone'")).toBe(false);
      expect(has(room, "SELECT id FROM sessions WHERE id = ?", id.goneLog)).toBe(false);
      expect(has(room, "SELECT id FROM users WHERE id = 'kept'")).toBe(true);
      expect(has(room, "SELECT id FROM sessions WHERE id = ?", id.keptLog)).toBe(true);
      expect(rows(room, "SELECT banned, deleted_at FROM subs WHERE sub_hash = 'sub-gone'")).toEqual([{ banned: 0, deleted_at: T }]);
      for (const table of ["messages", "likes", "sessions"]) {
        expect(value(room, `SELECT count(*) FROM ${table} WHERE uid = 'gone'`), table).toBe(0);
      }
    }));

  it("forgets a stale account in meta as DELETE /me does: admin_uid goes, and so does its count of wrong /admin codes", () =>
    check((room) => {
      expect(has(room, "SELECT value FROM meta WHERE key = 'admin_uid'")).toBe(false);
      expect(JSON.parse(value(room, "SELECT value FROM meta WHERE key = 'admin_claims'"))).toEqual({ total: 3, by: { "sub-kept": 1 } });
    }));

  it("deletes the rows of deleted, unbanned LINE accounts after 30 days, and keeps bans", () =>
    check((room) => {
      expect(rows(room, "SELECT sub_hash FROM subs WHERE sub_hash != 'sub-gone' ORDER BY sub_hash")).toEqual([
        { sub_hash: "sub-banned" },
        { sub_hash: "sub-deleted-29" },
        { sub_hash: "sub-u1" },
      ]);
    }));

  it("sets the next run for 19:00 UTC tomorrow, and the alarm for it, or sooner for a handoff still waiting", () =>
    check(async (room, state) => {
      expect(value(room, "SELECT value FROM meta WHERE key = 'next_retention'")).toBe(T + DAY);
      // The "fresh" handoff, made 9 minutes before the run, runs out first: the alarm comes back just after that to
      // delete it (the LINE name in it must not wait for tomorrow's run). Then it goes back to 19:00, as login.spec.mjs
      // checks.
      const alarm = await state.storage.getAlarm();
      expect(alarm).toBeGreaterThan(T + MIN);
      expect(alarm).toBeLessThanOrEqual(T + MIN + 2000);
    }));
});

// ---- The front Worker ---------------------------------------------------------------------------------------

describe("the Worker", () => {
  it("answers 404 with JSON to anything for now", async () => {
    const res = await SELF.fetch("https://chat.example/anything");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
