// Helpers for the Worker tests that work on a room of their own and open sockets on it: socket.spec.mjs,
// mod-admin.spec.mjs and me.spec.mjs. Each test gets a room of its own, calls it straight on its /r/ routes the way the
// Worker passes the app's requests on (worker.spec.mjs covers the Worker's part), and writes accounts and messages
// straight into its tables, with session tokens signed by the test secret.
//
// Vitest runs only the *.spec.mjs files (vitest.config.mjs), so this file is never run on its own. A file that opens
// sockets closes them after each test with afterEach(closeClients).
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { signToken } from "../src/auth.js";
import { checkNick } from "../src/mod.js";

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

// Waits until fn() gives something truthy, and returns it.
export async function until(fn, what = "a condition", ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

// ---- Rooms, accounts and messages ---------------------------------------------------------------------------------

// A room of its own, named "<name>-<random>". With `at`, its clock (room.now) stands at that time until the test moves
// clock.t; without, it keeps the real clock. Returns {stub, clock, inRoom, rows, now}: inRoom runs fn on the room
// object, rows runs a query on its storage, and now is the room's time.
export async function newRoom(name, at) {
  const stub = env.ROOM.getByName(`${name}-${crypto.randomUUID()}`, { locationHint: "apac-ne" });
  const clock = { t: at };
  if (at !== undefined) {
    await runInDurableObject(stub, (room) => {
      room.now = () => clock.t;
    });
  }
  const inRoom = (fn) => runInDurableObject(stub, fn);
  const rows = (query, ...binds) => inRoom((room) => room.sql.exec(query, ...binds).toArray());
  return { stub, clock, inRoom, rows, now: () => clock.t ?? Date.now() };
}

// Writes one account into a room's tables (room is the room object, inside runInDurableObject): user is {id, sub, nick},
// where sub stands for its sub_hash, created and last seen `age` before `now`.
export function insertUser(room, user, { age, role, now, nickChanged = null }) {
  room.sql.exec("INSERT INTO subs (sub_hash) VALUES (?) ON CONFLICT (sub_hash) DO NOTHING", user.sub);
  room.sql.exec(
    `INSERT INTO users (id, sub_hash, nick, nick_key, role, tv, created, last_seen, nick_changed, consent_at, consent_ver)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'v1')`,
    user.id, user.sub, user.nick, checkNick(user.nick).key, role, now - age, now - age, nickChanged, now - age,
  );
}

// An account, written straight into the room: `age` old, with `posts` text messages of its own in the room (two hours
// old), and a session token good for 30 days. user.sub stands for its sub_hash.
export async function addUser(r, { nick = `Surfer_${hex(3)}`, age = 2 * DAY, role = "user", nickChanged = null, posts = 0, sub = `sub-${hex(8)}` } = {}) {
  const user = { id: crypto.randomUUID(), sub, nick };
  await r.inRoom((room) => insertUser(room, user, { age, role, now: r.now(), nickChanged }));
  if (posts > 0) await addMessages(r, user.id, posts, { ts: r.now() - 2 * HOUR });
  user.token = await signToken({ uid: user.id, tv: 0, exp: r.now() + 30 * DAY }, env.SESSION_SECRET);
  return user;
}

// Messages written straight into the room, oldest first, one millisecond apart from ts. Returns their ids.
export function addMessages(r, uid, n, { ts = r.now() - HOUR, hidden_by = null, kind = "text", spot = null, body } = {}) {
  return r.inRoom((room) => {
    const ids = [];
    for (let k = 0; k < n; k++) {
      ids.push(
        room.sql
          .exec(
            "INSERT INTO messages (ts, uid, kind, spot, body, hidden_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            ts + k, uid, kind, spot, JSON.stringify(body ?? { text: `seeded ${k}` }), hidden_by,
          )
          .one().id,
      );
    }
    room.messagesChanged();
    return ids;
  });
}

// ---- Sockets -------------------------------------------------------------------------------------------------------

export const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

// Every client socket a test opened. closeClients() closes them; each file that opens sockets runs it after each test.
const clients = [];
export function closeClients() {
  for (const c of clients.splice(0)) {
    try {
      c.ws.close(1000, "done");
    } catch {
      // Closed already.
    }
  }
}

// Wraps an accepted client socket: its frames as they arrive (JSON parsed; anything else as text), send(frame), and
// closed (the close code once it closes).
export function client(ws) {
  const c = { status: 101, ws, frames: [], taken: new Set(), closed: null };
  ws.accept();
  ws.addEventListener("message", (e) => {
    c.frames.push(typeof e.data === "string" ? parse(e.data) : e.data);
  });
  ws.addEventListener("close", (e) => {
    c.closed = e.code;
  });
  c.send = (frame) => ws.send(typeof frame === "string" ? frame : JSON.stringify(frame));
  clients.push(c);
  return c;
}

// Opens a socket on a room ({stub}, as newRoom() gives it) as the Worker passes chat.js's upgrade on, from the address
// `ip`. A refusal comes back as {status, body}.
export async function connect(r, ip = randomIp()) {
  const res = await r.stub.fetch("https://room/r/ws", { headers: { Upgrade: "websocket", "CF-Connecting-IP": ip } });
  if (res.status !== 101) return { status: res.status, body: await res.json() };
  return client(res.webSocket);
}

// Waits for the first frame on c that passes `match` and hasn't been taken yet, and takes it.
export async function take(c, match, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const i = c.frames.findIndex((f, k) => !c.taken.has(k) && match(f));
    if (i >= 0) {
      c.taken.add(i);
      return c.frames[i];
    }
    if (Date.now() > end) throw new Error(`no such frame; got ${JSON.stringify(c.frames).slice(0, 800)}`);
    await sleep(5);
  }
}
export const ofType = (type) => (f) => f?.type === type;
export const nextError = (c) => take(c, ofType("error"));
export const all = (c, type) => c.frames.filter(ofType(type));
// Long enough for any frame on its way to arrive, before a test checks that none did.
export const settle = () => sleep(60);

// A socket that has said hello, as `user` or as a reader, and has its history.
export async function join(r, user = null, ip) {
  const c = await connect(r, ip);
  if (c.status !== 101) throw new Error(`the room refused the socket: ${JSON.stringify(c)}`);
  c.send({ type: "hello", v: 1, ...(user ? { token: user.token } : {}) });
  c.history = await take(c, ofType("history"));
  return c;
}

// Waits until the room has handled every frame c has sent so far. The room handles one socket's frames in turn, so
// once the answer to an older sent now is back (a page, or slow), everything before it is done.
export async function synced(c) {
  c.send({ type: "older", before_id: 1 });
  await take(c, (f) => (f?.type === "history" && f.before_id === 1) || (f?.type === "error" && f.for === "older"));
}

export const say = (c, text, more = {}) => c.send({ type: "say", text, ...more });
