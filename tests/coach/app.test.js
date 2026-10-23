// Browser checks of the AI coach (web/coach.js) against the real backend (chat/), a fake LINE and a fake AI (ruling R15): the flows, the
// resumes, the backend's error codes and Bryan's Drafts run here; only what the real backend can't give runs offline in
// tests/coach/shell.test.js.
// Usage: node tests/coach/app.test.js <page.html>   (a page built with tests/map/tool.py)
// Prints ok / FAIL for each step, and exits 1 on any FAIL or page error. The steps are one story, each building on the last, so after a FAIL
// the rest are skipped. It needs chat/'s node_modules (npm ci in chat/).
// - `wrangler dev` runs the Worker, the room and the coach with test secrets, ALLOWED_ORIGINS and APP_URL set to the page's origin,
//   LINE_AUTH_URL and LINE_TOKEN_URL pointing at tests/chat/fake-line.mjs (every sign-in approved at once, for one LINE account), and
//   COACH_API_URL and COACH_MAIL_URL at tests/coach/fake-ai.mjs (a good review for every call, unless a step says otherwise), with the
//   stand-in keys. `python3 -m http.server` serves the page with chat.js, coach.js and coach-example/ next to it, as the site does (both
//   started by tests/chat/servers.js, as for tests/chat/flow.test.js).
// - Every page is a phone, 390x844, dpr 2, touch, reduced motion, English, Taiwan mode, the Forecast view, the intro done, in a fresh
//   context. The chat and the coach are switched on the way the tests do it (window.__chatUrl and window.__chatContact) and shown as
//   everyone will see them once Bryan opens them (window.__chatPublic and window.__coachPublic). Anything but the page, the backend, the
//   fake LINE and the fake AI is cut off.
// - Helpers for the steps: signIn(page) signs a page in with LINE; makeAdmin() makes the seeded account u-bryan the admin, whose session
//   token is token("u-bryan"), and seeds the surfers u-ana to u-gus (SURFERS, token(uid) each), so the New review checks each have
//   an account of their own, with its 2 reviews a month; coachPage(s, token) opens a page signed in with the Coach panel open, and
//   coachTab(s, page) another tab of its browser; pick(page, clip) gives the coach's clip picker a clip from tests/coach/clips.js
//   (makeClip), and toCheck(page, …) runs New review to the check screen; coachTrip(page)
//   runs the coach's sign-in (CHAT.signIn("coach"), or the panel's Sign in with LINE) to LINE and back, and landed(page) waits for the
//   Coach panel with the room shut; coachApi(token, path, …) calls the backend as the page does, and sendReview(token) sends a review
//   through it.
// Playwright wherever node finds it (npm install playwright), else the copy this container keeps.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { spawnSync } = require("child_process");
const { SECRETS, wait, start } = require("../chat/servers.js");
const { makeClip } = require("./clips.js");

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: node tests/coach/app.test.js <page.html>"); process.exit(2); }
const ROOT = path.join(__dirname, "..", ".."), HTML = fs.readFileSync(file, "utf8");
const LOCK = (HTML.match(/\bH="([0-9a-f]{64})"/) || [])[1]; // a site build opens on the passcode screen: start unlocked
const CONTACT = { name: "Test Operator", email: "chat@example.com" }, DAY = 864e5;
const TAB = '.tabs button[data-v="coach"]';

// A session token for a seeded account, as chat/src/auth.js signToken makes one: base64url {uid, tv, exp}, a dot, its HMAC-SHA256
// (tests/chat/room.test.js's token()).
const token = uid => { const p = Buffer.from(JSON.stringify({ uid, tv: 0, exp: Date.now() + DAY })).toString("base64url");
  return p + "." + crypto.createHmac("sha256", SECRETS.SESSION_SECRET).update(p).digest("base64url"); };

// ---- The servers (tests/chat/servers.js), with the fake LINE and the fake AI.
let srv = null, line = null, ai = null;
const ORIGIN = () => srv.origin, CHAT = () => srv.chat;
async function setUp() {
  const { startFakeLine } = await import(path.join(ROOT, "tests", "chat", "fake-line.mjs"));
  const { startFakeAi } = await import(path.join(__dirname, "fake-ai.mjs"));
  line = await startFakeLine({ channelId: SECRETS.LINE_CHANNEL_ID, secret: SECRETS.LINE_CHANNEL_SECRET });
  ai = await startFakeAi();
  srv = await start({ file, name: "coach", line, ai });
  await srv.startWrangler();
}
async function tearDown() { if (srv) await srv.tearDown(); if (line) await line.close(); if (ai) await ai.close(); }

// Makes u-bryan the admin, as Bryan is: wrangler dev stops, the account goes straight into the room's SQLite file (python3's sqlite3) with
// role admin and the room's meta admin_uid, and wrangler dev starts again on it (tests/chat/room.test.js seeds its room the same way).
// Its session token is token("u-bryan"). The New review checks' surfers (SURFERS) go in the same way, with role user. Doing it again
// changes nothing.
const SURFERS = ["u-ana", "u-ben", "u-cho", "u-dan", "u-eve", "u-fay", "u-gus"];
const ADMIN = String.raw`
import json, sqlite3, sys
d = json.load(sys.stdin); c = sqlite3.connect(d["db"])
with c:
    for u in d["users"]:
        c.execute("INSERT OR IGNORE INTO users (id, sub_hash, nick, nick_key, role, tv, created, last_seen, nick_changed, consent_at, consent_ver) VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, 'v1')",
                  (u["id"], u["sub"], u["nick"], u["key"], u["role"], d["created"], d["now"], d["created"]))
        c.execute("INSERT OR IGNORE INTO subs (sub_hash, banned) VALUES (?, 0)", (u["sub"],))
    c.execute("INSERT INTO meta (key, value) VALUES ('admin_uid', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", (d["admin"],))
c.close()
`;
async function makeAdmin() {
  await srv.stopWrangler();
  const now = Date.now(), users = [{ id: "u-bryan", sub: "sub-bryan", nick: "Bryan", key: "key-bryan", role: "admin" },
    ...SURFERS.map(id => ({ id, sub: "sub-" + id.slice(2), nick: id.slice(2, 3).toUpperCase() + id.slice(3), key: "key-" + id.slice(2), role: "user" }))];
  const run = spawnSync("python3", ["-I", "-c", ADMIN], { encoding: "utf8", input: JSON.stringify({ db: srv.roomDb(), users, admin: "u-bryan", created: now - 40 * DAY, now }) });
  if (run.status !== 0) throw new Error("making u-bryan the admin failed: " + run.stderr);
  await srv.startWrangler();
}
// The coach's own SQLite file (its Durable Object's), while wrangler dev is stopped; and its meta "today" (the reviews sent this Taiwan
// day) read, or written when value is given, with wrangler dev stopped and started again round it. Resolves to the value before.
function coachDb() {
  const dos = path.join(srv.tmp, "state", "v3", "do"), dir = fs.existsSync(dos) && fs.readdirSync(dos).find(n => /-Coach$/.test(n));
  const db = dir && fs.readdirSync(path.join(dos, dir)).find(n => /^[0-9a-f]{64}\.sqlite$/.test(n));
  if (!db) throw new Error("wrangler dev made no coach database"); return path.join(dos, dir, db);
}
const TODAY = String.raw`
import json, sqlite3, sys
d = json.load(sys.stdin); c = sqlite3.connect(d["db"])
row = c.execute("SELECT value FROM meta WHERE key = 'today'").fetchone()
with c:
    if d["value"] is not None: c.execute("INSERT INTO meta (key, value) VALUES ('today', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", (d["value"],))
c.close(); print(json.dumps(row[0] if row else None))
`;
async function coachToday(value) {
  await srv.stopWrangler();
  try { const run = spawnSync("python3", ["-I", "-c", TODAY], { encoding: "utf8", input: JSON.stringify({ db: coachDb(), value }) });
    if (run.status !== 0) throw new Error("the coach's meta today: " + run.stderr); return JSON.parse(run.stdout); }
  finally { await srv.startWrangler(); }
}

// ---- Helpers on a page.
// Waits up to 15 s for fn(arg) in the page to come true, and says what it waited for when it doesn't.
const until = (page, what, fn, arg, timeout = 15e3) => page.waitForFunction(fn, arg, { timeout }).catch(e => { throw new Error(`waited ${timeout / 1e3} s for ${what}: ${e.message.split("\n")[0]}`); });
const panelOpen = page => until(page, "the Coach panel", () => { const p = document.querySelector(".coachpanel");
  return document.documentElement.classList.contains("coach-open") && !!p && !p.hidden && !!p.getClientRects().length; });
// Signs the page in with LINE as a surfer does: the chat room's Log in with LINE, LINE (approved at once), back on the page, and Join on
// the sign-up sheet the first time the LINE account comes. Resolves once the session token is kept and the room is shut again.
async function signIn(page) {
  await page.click(".chatfab");
  await until(page, "the LINE button", () => { const b = document.querySelector(".chatroom .cr-line"); return !!b && !!b.getClientRects().length; });
  // Back from LINE: the backend's callback sends the browser to the page's ?chat#c=…, which chat.js tidies at once.
  let back = null; const seen = r => { if (r.url().startsWith(CHAT() + "/auth/line/callback")) back = r.headers().location || null; };
  page.on("response", seen);
  try { await Promise.all([page.waitForURL(u => u.href.startsWith(ORIGIN()) && /\?chat#c=/.test(back || ""), { timeout: 20e3, waitUntil: "load" }), page.click(".chatroom .cr-line")]); }
  finally { page.off("response", seen); }
  await until(page, "the sign-up sheet or the message box", () => !!document.querySelector('.chatroom .cr-sheet [data-k="nick"]')
    || (!!document.querySelector(".chatroom .cr-in") && !!document.querySelector(".chatroom .cr-in").getClientRects().length));
  if (await page.$('.chatroom .cr-sheet [data-k="nick"]')) { await page.check('.chatroom .cr-sheet [data-k="consent"]'); await page.click('.chatroom .cr-sheet [data-k="join"]'); }
  await until(page, "the session token", () => !!localStorage.getItem("waveslave-chat-token") && !!document.querySelector(".chatroom .cr-in").getClientRects().length);
  await page.keyboard.press("Escape"); await until(page, "the room to shut", () => !document.documentElement.classList.contains("chat-open"));
}
// The coach's sign-in (CHAT.signIn("coach"), which the Coach panel's Sign in with LINE calls, or go() to start it another way), to LINE
// (approved at once, unless line.deny()) and back on the page's ?chat#c=… (or ?chat#e=… when ret says so). Resolves to where the backend
// sent the browser back to, once the page there has loaded.
async function coachTrip(page, ret = /\?chat#c=/, go = () => page.evaluate(() => { CHAT.signIn("coach"); })) {
  let back = null; const seen = r => { if (r.url().startsWith(CHAT() + "/auth/line/callback")) back = r.headers().location || null; };
  page.on("response", seen);
  try { await Promise.all([page.waitForURL(u => u.href.startsWith(ORIGIN()) && ret.test(back || ""), { timeout: 20e3, waitUntil: "load" }), go()]); }
  finally { page.off("response", seen); }
  return back;
}
// Landed on the Coach panel (ruling P2): html.coach-open set, the panel shown, and the room shut.
const landed = page => until(page, "the Coach panel with the room shut", () => { const p = document.querySelector(".coachpanel"), c = document.documentElement.classList;
  return c.contains("coach-open") && !c.contains("chat-open") && !!p && !p.hidden && !!p.getClientRects().length; });
// The room shows on top when it opens for a coach sign-in: what's at the centre of sel (in the room) is sel itself, not the Coach panel.
const onTop = (page, what, sel) => until(page, `${what} on top`, sel => { const e = document.querySelector(sel), r = e && e.getBoundingClientRect();
  if (!r || !r.width || !r.height) return false; const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!at && (at === e || e.contains(at)); }, sel, 5e3);
// After a coach sign-in: whether the token is kept, what waveslave-chat-v holds, whether the room was ever built, the spot, and the CHAT
// button's display (none under the Coach panel).
const signedInState = page => page.evaluate(() => ({ token: !!localStorage.getItem("waveslave-chat-token"), v: localStorage.getItem("waveslave-chat-v"), room: !!document.querySelector(".chatroom"), cur: CUR,
  fab: getComputedStyle(document.querySelector(".chatfab")).display }));
// The home-screen app's coach sign-in with LINE finished elsewhere (tests/chat/flow.test.js's autoPath): B opens the Coach panel, sends
// its redeems from 203.0.113.7, starts the coach's sign-in (LINE held back) and is opened again (a reload, as after iOS closed the app),
// so its panel is shut and its room not built; then A, with no v, finishes LINE from lineIp and shows the code. Resolves to
// {a, b, redeems, pin}, redeems being what B sent to /auth/redeem.
async function appTrip(s, lineIp) {
  const redeems = []; let start = null;
  const b = await s.open({}); await b.tap(TAB); await panelOpen(b);
  await b.route(`${CHAT()}/auth/line/start**`, r => { start = r.request().url(); return r.fulfill({ status: 204 }); });
  await b.route(`${CHAT()}/auth/redeem`, r => { if (r.request().method() === "POST") redeems.push(r.request().postDataJSON());
    return r.continue({ headers: { ...r.request().headers(), "cf-connecting-ip": "203.0.113.7" } }); });
  await b.evaluate(() => { CHAT.signIn("coach"); });
  for (let i = 0; i < 50 && !start; i++) await wait(100);
  if (!start) throw new Error("CHAT.signIn(\"coach\") didn't start a sign-in");
  await b.reload({ waitUntil: "load" });
  await until(b, "the page again", () => { const f = document.querySelector(".chatfab"); return !!f && !!window.CHAT && !!window.COACH; });
  const before = await b.evaluate(() => ({ v: JSON.parse(localStorage.getItem("waveslave-chat-v") || "null"), coach: document.documentElement.classList.contains("coach-open"), room: !!document.querySelector(".chatroom") }));
  if (!before.v || before.v.then !== "coach" || before.coach || before.room) throw new Error(`opened again before LINE finished: ${JSON.stringify(before)}`);
  const a = await s.open({ go: false });
  await a.setExtraHTTPHeaders({ "cf-connecting-ip": lineIp }); // on every request, the callback LINE redirects to included
  await a.goto(start, { waitUntil: "load" }); await a.waitForURL(u => u.href.startsWith(ORIGIN()), { waitUntil: "load" });
  await a.waitForSelector(".chatroom .cr-pin-code", { state: "attached" });
  return { a, b, redeems, pin: await a.textContent(".chatroom .cr-pin-code") };
}
// Gives the coach's clip picker a clip (a path from makeClip), as the phone's own picker would.
const pick = (page, clip) => page.setInputFiles('.coachpanel input[type="file"]', clip);
// ---- New review. The test clip: 640x360, 6 s, its white box (the surfer) sliding left to right halfway down (tests/coach/clips.js), in
// the scratch folder. Here is at 3.0 s, where the box's centre is at (320, 180) in the video's pixels, and the 12 key frames fall every
// 0.25 s from 1.5 s to 4.25 s.
const clip = () => makeClip(path.join(srv.tmp, "clips"), { w: 640, h: 360, secs: 6 });
const HERE = 3, AT = { x: 320, y: 180 }, TIMES = [1500, 1750, 2000, 2250, 2500, 2750, 3000, 3250, 3500, 3750, 4000, 4250];
const inPanel = (page, what, sel, timeout = 15e3) => page.waitForSelector(".coachpanel " + sel, { timeout }).catch(e => { throw new Error(`waited for ${what}: ${e.message.split("\n")[0]}`); });
const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(".coachpanel " + s); return e ? e.textContent : null; }, sel);
// Runs New review from the panel's main view to the check screen: New review, the clip, the questions (answer()), Find the move and Tap
// yourself (tapYourself()). Resolves once all 12 close-ups show, none lost; with go: false, on Find the move with the slider at Here.
async function toCheck(page, { move = "top_turn", note = null, go = true } = {}) {
  await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
  await pick(page, clip()); await answer(page, { move, note });
  if (go) await tapYourself(page);
}
// The questions: the move, and the level, board and stance unless the profile has them (starting to turn, shortboard, goofy), the note
// when there is one, and Next; then the slider at Here.
async function answer(page, { move = "top_turn", note = null } = {}) {
  await inPanel(page, "the questions", `[data-k="move-${move}"]`); await page.click(`.coachpanel [data-k="move-${move}"]`);
  if (!await page.$(".coachpanel .co-sum")) for (const k of ["level-starting_turns", "board-shortboard", "stance-goofy"]) await page.click(`.coachpanel [data-k="${k}"]`);
  if (note !== null) await page.fill('.coachpanel [data-k="note"]', note);
  await page.click('.coachpanel [data-k="next"]');
  await inPanel(page, "the slider", '[data-k="slider"]:not([disabled])');
  await page.evaluate(t => { const r = document.querySelector('.coachpanel [data-k="slider"]'); r.value = String(t); r.dispatchEvent(new Event("input", { bubbles: true })); }, HERE);
  await page.waitForFunction(t => { const v = document.querySelector(".coachpanel video"); return !!v && !v.seeking && Math.abs(v.currentTime - t) < 0.02; }, HERE);
}
// Here, then a tap on the white box in the frame; resolves once the 12 close-ups show, none lost.
async function tapYourself(page) {
  await page.click('.coachpanel [data-k="here"]'); await inPanel(page, "the frame, ready for a tap", ".co-frame[data-ready]");
  const p = await page.evaluate(([x, y]) => { const r = document.querySelector(".coachpanel .co-zoom").getBoundingClientRect(), v = document.querySelector(".coachpanel .co-zoom video");
    return { x: r.left + x / v.videoWidth * r.width, y: r.top + y / v.videoHeight * r.height }; }, [AT.x, AT.y]);
  await page.touchscreen.tap(p.x, p.y);
  await inPanel(page, "the 12 close-ups", ".co-grid", 30e3);
  const lost = await page.$$eval(".coachpanel .co-tile.co-lost", e => e.length);
  if (lost) throw new Error(`the tracker lost the white box in ${lost} key frames`);
}
// The draft in IndexedDB (waveslave-coach, draft: "current", with the id and sent of "progress" when it's the same flow's and save's),
// each key frame's blob as its size; null when there's none.
const draft = page => page.evaluate(() => new Promise(ok => { const q = indexedDB.open("waveslave-coach");
  q.onerror = () => ok({ error: String(q.error) });
  q.onsuccess = () => { const d = q.result; if (!d.objectStoreNames.contains("draft")) { d.close(); return ok(null); }
    const tx = d.transaction("draft"), g = tx.objectStore("draft").get("current"), p = tx.objectStore("draft").get("progress");
    tx.oncomplete = () => { const r = g.result, pr = p.result && r && p.result.flow === r.flow && p.result.stamp === r.stamp ? p.result : null; d.close();
      ok(r ? { ...r, frames: r.frames.map(f => ({ ...f, blob: f.blob instanceof Blob ? f.blob.size : null })), id: pr ? pr.id : null, sent: pr ? pr.sent : [] } : null); };
    tx.onerror = () => ok({ error: String(tx.error) }); }; }));
// An init script counting the coach's IndexedDB writes by key (window.__puts): "current" holds the key frames, "progress" the id and sent.
function countPuts() { if (window.__puts) return; window.__puts = {}; const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v, k) { window.__puts[k] = (window.__puts[k] || 0) + 1; return put.call(this, v, k); }; }
// Notes the coach's calls a page makes (method, path, the body as text, and the answer's status), in s.calls.
function watchCalls(page) {
  const calls = [];
  page.on("requestfinished", async r => { if (!r.url().startsWith(CHAT() + "/coach/reviews")) return; const res = await r.response().catch(() => null);
    calls.push({ method: r.method(), path: r.url().slice(CHAT().length), body: r.postData(), status: res ? res.status() : 0 }); });
  page.on("requestfailed", r => { if (r.url().startsWith(CHAT() + "/coach/reviews")) calls.push({ method: r.method(), path: r.url().slice(CHAT().length), body: r.postData(), status: 0 }); });
  return calls;
}
const framesOf = calls => calls.filter(c => c.method === "POST" && /\/frames\/\d+$/.test(c.path)).map(c => ({ n: +c.path.split("/").pop(), status: c.status, body: c.body }));
const startsOf = calls => calls.filter(c => c.method === "POST" && c.path === "/coach/reviews");
// Each key frame sent (base64 text), decoded in the page: its size and its bytes.
const decode = (page, bodies) => page.evaluate(bodies => Promise.all(bodies.map(async b => { const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0));
  const bm = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" })); return { w: bm.width, h: bm.height, bytes: bytes.length }; })), bodies);
// This Taiwan month's name, and its number.
const twMonth = () => { const d = new Date(Date.now() + 8 * 3600e3); return { name: d.toLocaleString("en", { month: "long", timeZone: "UTC" }), n: d.getUTCMonth() + 1 }; };
// Holds a page's coach calls matching `match` (method and path) while shut: valve.held is how many wait; release() lets the first go,
// open() lets them all go and the rest through.
// drop() aborts the ones waiting (after a reload, so they never reach the backend).
async function valve(page, match) {
  const v = { shut: true, held: [] };
  await page.route(CHAT() + "/coach/reviews/**", r => { const q = r.request(), p = q.url().slice(CHAT().length);
    if (!match(q.method(), p) || !v.shut) return r.continue();
    return new Promise(done => v.held.push(how => { done(); return (how === "abort" ? r.abort() : r.continue()).catch(() => {}); })); });
  v.release = () => { const f = v.held.shift(); if (f) f(); };
  v.drop = () => { while (v.held.length) v.held.shift()("abort"); };
  v.open = () => { v.shut = false; while (v.held.length) v.release(); };
  v.wait = (n, what) => (async () => { for (let i = 0; i < 300 && v.held.length < n; i++) await wait(100); if (v.held.length < n) throw new Error(`waited 30 s for ${what}`); })();
  return v;
}
const isFrame = (m, p) => m === "POST" && /\/frames\/\d+$/.test(p);
// An init script noting each play() and pause() of a video (window.__media).
function watchMedia() { window.__media = []; for (const k of ["play", "pause"]) { const f = HTMLMediaElement.prototype[k];
  HTMLMediaElement.prototype[k] = function () { window.__media.push(k); return f.apply(this, arguments); }; } }
// Waits up to 10 s for check() to come true (calls the page made, a draft written), and says what it waited for when it doesn't.
async function soon(what, check) { for (let i = 0; i < 100; i++) { if (await check()) return; await wait(100); } throw new Error(`waited 10 s for ${what}`); }
// The picker: "Choose a clip", the privacy line just under it, and the phone's picker for videos.
const picker = page => page.evaluate(() => { const c = document.querySelector(".coachpanel .co-choose"), p = document.querySelector(".coachpanel .co-privacy"), i = c && c.querySelector('input[type="file"]');
  return { choose: c && c.textContent, privacy: p && p.textContent, under: !!c && !!p && c.nextElementSibling === p && p.getBoundingClientRect().top >= c.getBoundingClientRect().bottom - 1, accept: i && i.accept }; });
// Signed in on a page of its own: the token in localStorage (and more of store), the Coach panel open, its count shown. coachTab(s, page)
// is another tab of page's browser, the same.
async function coachPage(s, tok, { store = {}, init = [] } = {}) {
  return panelUp(await s.open({ store: { "waveslave-chat-token": tok, ...store }, init }));
}
const coachTab = async (s, page) => panelUp(await s.tab(page));
async function panelUp(page) {
  await page.tap(TAB); await panelOpen(page);
  await until(page, "the signed-in panel", () => !!document.querySelector(".coachpanel .co-left"));
  return page;
}
const agreeFor = async tok => { const r = await coachApi(tok, "/coach/agree", { method: "POST", body: { ver: "c1", adult: true } }); if (r.status !== 200) throw new Error(`POST /coach/agree answered ${r.status}`); };
const twDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const SENT = "Sent. Your feedback comes within a day.", PRIVACY = "Only key frames are sent. Your video never leaves your phone.", FAILED = "Couldn't send. Tap to try again.";
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A call to the coach's backend as the page makes it, from the page's origin with tok as the session token: body goes as JSON, text as
// text/plain (a key frame's base64). Resolves to {status, json}.
async function coachApi(tok, p, { method = "GET", body, text } = {}) {
  const headers = { Origin: ORIGIN(), Authorization: "Bearer " + tok };
  if (text !== undefined) headers["Content-Type"] = "text/plain"; else if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(CHAT() + p, { method, headers, body: text !== undefined ? text : body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
// Sends a review for tok's account straight through the backend's routes, as the New review flow does: the agreement, the start with 8
// key frames (a stand-in 784x784 JPEG each), each frame, then send. Resolves to its id once the fake AI's draft is in (status drafted, as
// GET /coach/reviews/<id> tells its owner).
async function sendReview(tok) {
  const { jpegB64 } = await import(path.join(ROOT, "chat", "test", "coach-fixtures.mjs"));
  const b64 = jpegB64(), frames = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ n, ms: 10000 + 250 * n, box: [100, 100, 360] }));
  const must = async (what, r) => { r = await r; if (r.status !== 200) throw new Error(`${what} answered ${r.status} ${JSON.stringify(r.json)}`); return r.json; };
  await must("POST /coach/agree", coachApi(tok, "/coach/agree", { method: "POST", body: { ver: "c1", adult: true } }));
  const { id } = await must("POST /coach/reviews", coachApi(tok, "/coach/reviews", { method: "POST",
    body: { lang: "en", move: "top_turn", move_other: "", level: "turning_well", board: "shortboard", stance: "regular", note: "", frames } }));
  for (const f of frames) await must(`key frame ${f.n}`, coachApi(tok, `/coach/reviews/${id}/frames/${f.n}`, { method: "POST", text: b64 }));
  await must("send", coachApi(tok, `/coach/reviews/${id}/send`, { method: "POST", body: {} }));
  for (let i = 0; i < 60; i++) { const r = await coachApi(tok, `/coach/reviews/${id}`); if (r.json && r.json.status === "drafted") return id; await wait(500); }
  throw new Error(`review ${id} wasn't drafted within 30 s`);
}
// The Coach tab's dot: there, and drawn.
const tabDot = page => page.evaluate(t => { const b = document.querySelector(t); return b.classList.contains("co-dot") && getComputedStyle(b, "::after").content !== "none"; }, TAB);

const STEPS = {
  // The fake AI answers as the backend expects (chat/src/coach-guide.js): for a request built by the backend's own buildRequest, in English
  // and in 中文, a reply that passes every check on the frames sent; without the test key, the real API's 401. Mail is noted.
  async fakeAi() {
    const { buildRequest, readReply, checkReply } = await import(path.join(ROOT, "chat", "src", "coach-guide.js"));
    const { jpegB64 } = await import(path.join(ROOT, "chat", "test", "coach-fixtures.mjs"));
    const sentNums = [1, 2, 3, 5, 6, 7, 8, 9, 10, 12], b64 = jpegB64(), answers = { move: "top_turn", level: "turning_well", board: "shortboard", stance: "regular" };
    const post = (p, body, headers) => fetch(ai.url + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    for (const lang of ["en", "zh"]) {
      const req = buildRequest({ model: "coach-test-model", maxTokens: 16000, lang, answers, frames: sentNums.map(n => ({ n, ms: 10000 + 250 * n, b64 })), userId: "test-user" });
      const r = await post("/v1/messages", req, { "x-api-key": "test-only-anthropic-key", "anthropic-version": "2023-06-01" });
      const { reply, stop } = readReply(await r.json()), checked = checkReply(reply, { sentNums, hadHistory: false, lang });
      if (r.status !== 200 || stop !== "end_turn" || checked.errors.length || checked.warnings.length || checked.flags.length) throw new Error(`in ${lang} the fake AI answered ${r.status} ${stop}, checks ${JSON.stringify(checked)}`);
    }
    const refused = await post("/v1/messages", {}, { "x-api-key": "wrong", "anthropic-version": "2023-06-01" });
    const sent = await post("/emails", { from: "WaveSlave <onboarding@resend.dev>", to: ["waveslave050@gmail.com"], subject: "test", text: "test" }, { Authorization: "Bearer test-only-resend-key" });
    if (refused.status !== 401 || sent.status !== 200 || ai.mails.length !== 1 || ai.requests.length !== 4) throw new Error(`a wrong key got ${refused.status}, a mail ${sent.status}; ${ai.mails.length} mails and ${ai.requests.length} requests noted`);
    if (!eq(ai.problems, ["messages: no test key"])) throw new Error(`the fake AI noted ${JSON.stringify(ai.problems)}`);
    ai.requests.length = 0; ai.mails.length = 0; ai.problems.length = 0;
  },
  // wrangler dev runs with the fake AI (the coach's addresses point at it) and the page, with the coach switched on, shows the Coach tab;
  // tapping it opens the Coach panel over Forecast, and ✕ shuts it.
  async panelOpens(s) {
    const env = fs.readFileSync(path.join(srv.tmp, "dev.env"), "utf8");
    for (const want of [`COACH_API_URL=${ai.url}/v1/messages`, `COACH_MAIL_URL=${ai.url}/emails`, "ANTHROPIC_API_KEY=test-only-anthropic-key", "RESEND_API_KEY=test-only-resend-key"])
      if (!env.split("\n").includes(want)) throw new Error(`wrangler dev's env has no ${want}`);
    s.main = await s.open({}); const page = s.main;
    await until(page, "the Coach tab", t => { const b = document.querySelector(t); return !!b && !b.hidden && !!b.getClientRects().length; }, TAB);
    await page.tap(TAB); await panelOpen(page);
    const v = await page.evaluate(() => ({ view: VIEW, saved: localStorage.getItem("waveslave-view"), fc: !document.getElementById("viewFc").hidden }));
    if (v.view !== "fc" || v.saved !== "fc" || !v.fc) throw new Error(`the Coach panel opened over ${JSON.stringify(v)}`);
    await page.tap(".coachpanel .co-x"); await until(page, "the panel to shut", () => !document.documentElement.classList.contains("coach-open"));
  },
  // ---- Signing in from the Coach panel, through the chat's LINE sign-in, comes back to the Coach panel, not the room (AI coach spec,
  // "Sign-in"). The checks call CHAT.signIn("coach") with the empty Coach panel open (ruling P2); Task 18's button calls the same.
  // From the panel, with the room never opened, the sign-in goes to /auth/line/start?h=<SHA-256(v)> with no page error, and keeps
  // {v, at, then: "coach"} in waveslave-chat-v. (LINE is held back here, so the page stays.)
  async coachSignInStarts(s) {
    s.coach = await s.open({}); const page = s.coach; let start = null;
    await page.tap(TAB); await panelOpen(page);
    await page.route(`${CHAT()}/auth/line/start**`, r => { start = r.request().url(); return r.fulfill({ status: 204 }); });
    await page.evaluate(() => { CHAT.signIn("coach"); });
    for (let i = 0; i < 50 && !start; i++) await wait(100);
    await page.unroute(`${CHAT()}/auth/line/start**`);
    const kept = await page.evaluate(() => ({ v: JSON.parse(localStorage.getItem("waveslave-chat-v") || "null"), room: !!document.querySelector(".chatroom"),
      chat: document.documentElement.classList.contains("chat-open"), coach: document.documentElement.classList.contains("coach-open") }));
    const h = start && start.startsWith(CHAT() + "/auth/line/start?h=") ? start.slice((CHAT() + "/auth/line/start?h=").length) : null;
    if (!h || !kept.v || h !== crypto.createHash("sha256").update(String(kept.v.v)).digest("base64url")) throw new Error(`the sign-in went to ${start} with ${JSON.stringify(kept.v)} kept`);
    if (!eq(Object.keys(kept.v).sort(), ["at", "then", "v"]) || kept.v.then !== "coach" || !(Math.abs(Date.now() - kept.v.at) < 60e3)) throw new Error(`waveslave-chat-v holds ${JSON.stringify(kept.v)}`);
    if (kept.room || kept.chat || !kept.coach) throw new Error(`after CHAT.signIn("coach") the room is ${kept.room ? "built" : "not built"}${kept.chat ? " and open" : ""}, the panel ${kept.coach ? "open" : "shut"}`);
  },
  // The room opens for a waiting coach sign-in only from the Coach panel: with the panel shut (or in a second tab), the page coming back
  // into view leaves the room shut. CHAT.signIn() with anything but "coach" starts nothing.
  async coachPanelShut(s) {
    const page = s.coach;
    await page.tap(".coachpanel .co-x"); await until(page, "the panel to shut", () => !document.documentElement.classList.contains("coach-open"));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await wait(300);
    if (await page.evaluate(() => !!document.querySelector(".chatroom") || document.documentElement.classList.contains("chat-open"))) throw new Error("with the Coach panel shut, coming back to the page opened the room");
    const before = await page.evaluate(() => localStorage.getItem("waveslave-chat-v"));
    await page.evaluate(() => { CHAT.signIn(); CHAT.signIn("chat"); }); await wait(500);
    const st = await page.evaluate(() => ({ v: localStorage.getItem("waveslave-chat-v"), url: location.href }));
    if (st.v !== before || st.url !== `${ORIGIN()}/#jinshan`) throw new Error(`CHAT.signIn() without "coach" started a sign-in: ${JSON.stringify(st)}`);
  },
  // LINE says no (the person tapped Cancel) to a sign-in from the Coach panel: back on the page the Coach panel is open under the room, and
  // the room is on top with "Couldn't sign in with LINE, try again"; shutting the room lands on the Coach panel.
  async coachDenied(s) {
    const page = s.coach; await page.tap(TAB); await panelOpen(page); line.deny();
    const back = await coachTrip(page, /\?chat#e=/);
    if (!/#e=access_denied$/.test(back || "")) throw new Error(`the backend sent the browser back to ${back}`);
    await until(page, "the room and the Coach panel", () => { const c = document.documentElement.classList; return c.contains("chat-open") && c.contains("coach-open"); });
    await onTop(page, "the room's note", ".chatroom .cr-note");
    const st = await page.evaluate(() => ({ note: document.querySelector(".chatroom .cr-note").textContent, v: localStorage.getItem("waveslave-chat-v"),
      token: localStorage.getItem("waveslave-chat-token"), focus: !!document.activeElement && !!document.activeElement.closest(".chatroom") }));
    if (st.note !== "Couldn't sign in with LINE, try again" || st.v !== null || st.token !== null || !st.focus) throw new Error(`back from a cancelled sign-in: ${JSON.stringify(st)}`);
    await page.keyboard.press("Escape"); await landed(page);
  },
  // A new person (the fake LINE's account has none yet): back from LINE the room opens, on top of the Coach panel, with the sign-up sheet;
  // Join signs them in and lands on the Coach panel, the room shut, the token kept and v gone.
  async coachSignUp(s) {
    const page = s.coach, back = await coachTrip(page);
    if (!/\?chat#c=[A-Za-z0-9_-]{22}&p=\d{6}$/.test(back || "")) throw new Error(`the backend sent the browser back to ${back}`);
    await until(page, "the sign-up sheet over the Coach panel", () => { const c = document.documentElement.classList;
      return !!document.querySelector('.chatroom .cr-sheet [data-k="nick"]') && c.contains("chat-open") && c.contains("coach-open"); });
    await onTop(page, "the sign-up sheet's Join", '.chatroom .cr-sheet [data-k="join"]');
    await page.check('.chatroom .cr-sheet [data-k="consent"]'); await page.click('.chatroom .cr-sheet [data-k="join"]');
    await landed(page);
    const st = await signedInState(page);
    if (!st.token || st.v !== null || st.cur !== "jinshan" || st.fab !== "none") throw new Error(`after Join: ${JSON.stringify(st)}`);
  },
  // A known account, from a fresh page: back from LINE the code is redeemed without the room ever being built, and the page lands on the
  // Coach panel signed in.
  async coachDirect(s) {
    const page = await s.open({}); await page.tap(TAB); await panelOpen(page);
    const back = await coachTrip(page);
    if (!/\?chat#c=/.test(back || "")) throw new Error(`the backend sent the browser back to ${back}`);
    await landed(page);
    const st = await signedInState(page);
    if (!st.token || st.v !== null || st.room || st.fab !== "none") throw new Error(`back from LINE: ${JSON.stringify(st)}`);
  },
  // The ?chat return's race, forced (merge review). Back from LINE, the page redeems LINE's code at start-up, and on pageshow it also
  // asks {v, auto: true} (main's #111). Here the ask goes first: the code's redeem is held until the ask has answered 200 and signed the
  // page in. (One page sends both, from the one address wrangler dev gives every local request, which the callback had too.) The known
  // account lands on the Coach panel, and the code then finds the sign-in used up (410 expired), which changes nothing: the room is
  // never built and there's no note.
  async coachAutoFirst(s) {
    const page = await s.open({}), asks = []; let asked = null;
    const askedFirst = new Promise(r => { asked = r; });
    await page.tap(TAB); await panelOpen(page);
    await page.route(`${CHAT()}/auth/redeem`, async r => {
      const body = r.request().method() === "POST" ? r.request().postDataJSON() : null;
      if (body && body.auto === true) { // the ask CHAT.signIn() sends before it leaves for LINE may be cut off by the page going
        let res; try { res = await r.fetch(); } catch (e) { return r.abort().catch(() => {}); }
        asks.push(res.status()); if (res.status() === 200) asked();
        return r.fulfill({ response: res }).catch(() => {});
      }
      // Held for up to 20 s: should the ask not come, the code goes on, and the 410 check below says so.
      if (body && body.code) { await Promise.race([askedFirst, wait(20e3)]); await until(page, "the ask's token", () => !!localStorage.getItem("waveslave-chat-token")).catch(() => {}); }
      return r.continue();
    });
    const coded = page.waitForResponse(r => r.url() === `${CHAT()}/auth/redeem` && r.request().method() === "POST" && !!(r.request().postDataJSON() || {}).code, { timeout: 60e3 });
    const back = await coachTrip(page);
    if (!/\?chat#c=/.test(back || "")) throw new Error(`the backend sent the browser back to ${back}`);
    const code = await coded;
    if (code.status() !== 410) throw new Error(`the code's redeem answered ${code.status()}; the asks before it answered ${JSON.stringify(asks)}`);
    await landed(page); await wait(500);
    const st = await signedInState(page), note = await page.evaluate(() => { const n = document.querySelector(".chatroom .cr-note"); return n && !n.hidden ? n.textContent : null; });
    if (!st.token || st.v !== null || st.room || st.fab !== "none" || note) throw new Error(`after the code came back used up: ${JSON.stringify({ ...st, note })}`);
    await landed(page);
  },
  // The home-screen app's way (tests/chat/flow.test.js's pinPath): B, whose room was built before its Coach panel (it came in on a ?chat
  // link and shut the room), starts the coach's sign-in from the panel, and LINE finishes it in A, a browser with no v, which shows the pin.
  // B is in the background meanwhile (document.visibilityState "hidden"), as the app is while the person is in LINE and Safari, so it
  // doesn't ask to finish by itself, and A and B are on different networks (a CF-Connecting-IP each; wrangler dev would give them the same
  // one). Back on B (the page visible again), the room opens on top with the code box at once; B's own ask then answers "net", which leaves
  // the room and the code box as they are, without "Finishing your LINE sign-in…"; the pin signs B in and lands on the Coach panel.
  async coachCodeBox(s) {
    const b = await s.open({ go: false }); let start = null;
    await b.goto(`${ORIGIN()}/?chat#jinshan`, { waitUntil: "load" });
    await until(b, "the room from the ?chat link", () => document.documentElement.classList.contains("chat-open"));
    await b.keyboard.press("Escape"); await until(b, "the room to shut", () => !document.documentElement.classList.contains("chat-open"));
    await b.tap(TAB); await panelOpen(b);
    await b.route(`${CHAT()}/auth/line/start**`, r => { start = r.request().url(); return r.fulfill({ status: 204 }); });
    await b.route(`${CHAT()}/auth/redeem`, r => r.continue({ headers: { ...r.request().headers(), "cf-connecting-ip": "203.0.113.7" } }));
    await b.evaluate(() => { CHAT.signIn("coach"); });
    for (let i = 0; i < 50 && !start; i++) await wait(100);
    if (!start) throw new Error("CHAT.signIn(\"coach\") didn't start a sign-in");
    await b.evaluate(() => { window.__away = true; Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__away ? "hidden" : "visible" }); });
    const a = await s.open({ go: false });
    await a.setExtraHTTPHeaders({ "cf-connecting-ip": "198.51.100.7" }); // another network: on every request, the callback LINE redirects to included
    await a.goto(start, { waitUntil: "load" }); await a.waitForURL(u => u.href.startsWith(ORIGIN()), { waitUntil: "load" });
    await a.waitForSelector(".chatroom .cr-pin-code", { state: "attached" });
    const pin = await a.textContent(".chatroom .cr-pin-code");
    if (await b.evaluate(() => document.documentElement.classList.contains("chat-open"))) throw new Error("B opened the room before it came back to the page");
    const back = await b.evaluate(() => { window.__away = false; document.dispatchEvent(new Event("visibilitychange")); return document.documentElement.classList.contains("chat-open"); });
    if (!back) throw new Error("coming back to the page didn't open the room at once");
    await until(b, "the code box", () => { const i = document.querySelector(".chatroom .cr-pinbox input"); return document.documentElement.classList.contains("chat-open") && !!i && !!i.getClientRects().length; });
    await until(b, "the code box without \"Finishing your LINE sign-in…\" (B's own ask answered net)", () => document.querySelector(".chatroom .cr-pin-wait").hidden);
    await onTop(b, "the code box", ".chatroom .cr-pinbox input");
    await b.fill(".chatroom .cr-pinbox input", pin); await b.click(".chatroom .cr-pinbox button");
    await landed(b);
    const st = await signedInState(b);
    if (!st.token || st.v !== null || st.fab !== "none") throw new Error(`after the code: ${JSON.stringify(st)}`);
    if (await a.evaluate(() => localStorage.getItem("waveslave-chat-token"))) throw new Error("A got signed in too");
  },
  // The home-screen app finishing the coach's sign-in by itself (tests/chat/flow.test.js's autoPath, with then: "coach"), through appTrip().
  // On B's network (A finishes LINE from B's 203.0.113.7): B signs itself in, the known account, with nothing typed and only {v, auto: true}
  // asked, and lands on the Coach panel with the room never built. On another network (198.51.100.7): B's ask answers "net", and the
  // Coach panel and the room open together, the room on top with the code box (no "Finishing your LINE sign-in…"); the pin from A signs B
  // in and lands on the Coach panel. A, which has no v, never signs in.
  async coachAutoFinish(s) {
    let { a, b, redeems, pin } = await appTrip(s, "203.0.113.7");
    await until(b, "the session token", () => !!localStorage.getItem("waveslave-chat-token"));
    await landed(b);
    let st = await signedInState(b);
    if (!st.token || st.v !== null || st.room || st.fab !== "none") throw new Error(`after finishing by itself: ${JSON.stringify(st)}`);
    if (!redeems.length || redeems.some(r => r.auto !== true || "pin" in r || "code" in r)) throw new Error(`B asked ${JSON.stringify(redeems.map(r => Object.keys(r).sort()))}`);
    if (await a.evaluate(() => localStorage.getItem("waveslave-chat-token"))) throw new Error("A got signed in too");
    // "net": LINE finished on another network.
    ({ a, b, redeems, pin } = await appTrip(s, "198.51.100.7"));
    await until(b, "the Coach panel and the room", () => { const c = document.documentElement.classList; return c.contains("coach-open") && c.contains("chat-open"); });
    await onTop(b, "the code box", ".chatroom .cr-pinbox input");
    const waiting = await b.evaluate(() => ({ wait: document.querySelector(".chatroom .cr-pin-wait").hidden, token: !!localStorage.getItem("waveslave-chat-token"),
      v: !!localStorage.getItem("waveslave-chat-v"), panel: !document.querySelector(".coachpanel").hidden }));
    if (!waiting.wait || waiting.token || !waiting.v || !waiting.panel) throw new Error(`after "net": ${JSON.stringify(waiting)}`);
    await b.fill(".chatroom .cr-pinbox input", pin); await b.click(".chatroom .cr-pinbox button");
    await landed(b);
    st = await signedInState(b);
    if (!st.token || st.v !== null || st.fab !== "none") throw new Error(`after the code: ${JSON.stringify(st)}`);
    const pins = redeems.filter(r => "pin" in r);
    if (pins.length !== 1 || redeems.some(r => !("pin" in r) && r.auto !== true) || "code" in pins[0]) throw new Error(`B asked ${JSON.stringify(redeems.map(r => Object.keys(r).sort()))}`);
    if (await a.evaluate(() => localStorage.getItem("waveslave-chat-token"))) throw new Error("A got signed in too");
  },
  // CHAT.token() gives the coach the token; after the backend refuses it (401: signed out everywhere), CHAT.token(old) signs out quietly:
  // waveslave-chat-token is cleared and it answers null. A token that isn't the one kept clears nothing.
  async coachTokenRefused(s) {
    const got = await s.coach.evaluate(async chat => {
      const old = CHAT.token(), stored = localStorage.getItem("waveslave-chat-token"), ask = () => fetch(chat + "/coach/me", { headers: { Authorization: "Bearer " + old } });
      const before = (await ask()).status, out = (await fetch(chat + "/me/signout", { method: "POST", headers: { Authorization: "Bearer " + old } })).status, after = (await ask()).status;
      const other = CHAT.token("not the token kept") === old, refused = CHAT.token(old);
      return { same: !!old && old === stored, before, out, after, other, refused, now: CHAT.token(), kept: localStorage.getItem("waveslave-chat-token") };
    }, CHAT());
    if (!got.same || got.before === 401 || got.out !== 200 || got.after !== 401) throw new Error(`the token and the backend: ${JSON.stringify(got)}`);
    if (!got.other || got.refused !== null || got.now !== null || got.kept !== null) throw new Error(`after the 401: ${JSON.stringify(got)}`);
  },
  // signIn() signs a page in through the chat with the fake LINE (the account coachSignUp made, so straight in), and the Coach panel
  // still opens afterwards.
  async signedIn(s) {
    const page = s.main; await signIn(page);
    await page.tap(TAB); await panelOpen(page);
    await page.tap(".coachpanel .co-x");
  },
  // makeAdmin() makes u-bryan the admin: before it, the backend doesn't know token("u-bryan"); after, Bryan's own route takes it (it may
  // still say 502 when wrangler dev can't read Cloudflare's trace page from here, but it no longer refuses him).
  async admin() {
    const where = () => fetch(CHAT() + "/admin/where", { headers: { Origin: ORIGIN(), Authorization: "Bearer " + token("u-bryan") } });
    const before = await where();
    if (before.status !== 401) throw new Error(`before makeAdmin() /admin/where answered u-bryan ${before.status}`);
    await makeAdmin();
    const after = await where(), body = await after.text();
    if (![200, 502].includes(after.status) || (after.status === 200 && !/^room colo=.+\ncoach colo=.+\n$/.test(body)) || (after.status === 502 && !/"trace"/.test(body)))
      throw new Error(`after makeAdmin() /admin/where answered u-bryan ${after.status} ${body.slice(0, 200)}`);
  },
  // ---- The Coach panel (AI coach spec, "The Coach tab"). Signed out it says what the coach does, shows the example review (Bryan's
  // trial clip as a top-turn review: what went well, the main fix and the drill, with its four key frames and their times) and Sign in
  // with LINE, in English and in 中文. The example's key frames are asked for only once the panel shows them, never with the page, and
  // the coach asks the backend nothing.
  async signedOut(s) {
    const page = await s.open({ go: false }), coach = [], shown = [];
    page.on("request", r => { const u = r.url(); if (u.startsWith(CHAT() + "/coach")) coach.push(u); if (u.includes("/coach-example/")) shown.push(u.slice(ORIGIN().length)); });
    await s.go(page); await wait(500);
    if (shown.length) throw new Error(`the page asked for ${shown.join(", ")} before the panel showed them`);
    await page.tap(TAB); await panelOpen(page);
    await until(page, "the example's four key frames", () => { const i = [...document.querySelectorAll(".coachpanel .co-example img")]; return i.length === 4 && i.every(x => x.complete && x.naturalWidth === 784); });
    const want = {
      en: { lead: "Your coach breaks your clip down frame by frame: what went well, one main fix and a drill.", signIn: "Sign in with LINE",
        has: ["Low and ready going in", "Stay over your front foot", "Front-knee turns on the sand", "Key frame at 0:11.5", "Key frame at 0:11.7", "Key frame at 0:12.0", "Key frame at 0:12.2"] },
      zh: { lead: "教練會逐格拆解你的影片：做得好的地方、一個主要修正，再加一個練習。", signIn: "使用LINE帳號登入",
        has: ["壓低身體，準備好進轉向", "重心留在前腳", "沙灘上練前膝轉向", "0:11.5 的關鍵影格", "0:11.7 的關鍵影格", "0:12.0 的關鍵影格", "0:12.2 的關鍵影格"] },
    };
    for (const lang of ["en", "zh", "en"]) {
      await page.evaluate(l => setLang(l), lang); await wait(100);
      const got = await page.evaluate(() => { const q = sel => document.querySelector(".coachpanel " + sel);
        return { lead: q(".co-lead") && q(".co-lead").textContent, signIn: q(".co-signin .co-line-w") && q(".co-signin .co-line-w").textContent, text: q(".co-example") && q(".co-example").textContent,
          srcs: [...document.querySelectorAll(".coachpanel .co-example img")].map(i => new URL(i.src).pathname) }; });
      const w = want[lang], missing = w.has.filter(t => !(got.text || "").includes(t));
      if (got.lead !== w.lead || got.signIn !== w.signIn || missing.length) throw new Error(`in ${lang} the panel shows ${JSON.stringify({ lead: got.lead, signIn: got.signIn })}${missing.length ? `, without ${missing.join(", ")}` : ""}`);
      if (!eq(got.srcs, ["/coach-example/1.jpg", "/coach-example/2.jpg", "/coach-example/3.jpg", "/coach-example/4.jpg"])) throw new Error(`in ${lang} the key frames are ${got.srcs.join(", ")}`);
    }
    if (coach.length) throw new Error(`signed out, the coach asked the backend for ${coach.join(", ")}`);
  },
  // The panel's Sign in with LINE (ruling P2) starts the coach's sign-in: through LINE and back, the known account lands on the Coach
  // panel, signed in, and the panel shows the signed-in view.
  async signInButton(s) {
    s.surfer = await s.open({}); const page = s.surfer;
    await page.tap(TAB); await panelOpen(page);
    const back = await coachTrip(page, /\?chat#c=/, () => page.click(".coachpanel .co-signin"));
    if (!/\?chat#c=/.test(back || "")) throw new Error(`the backend sent the browser back to ${back}`);
    await landed(page);
    const st = await signedInState(page);
    if (!st.token || st.v !== null || st.room) throw new Error(`back from LINE: ${JSON.stringify(st)}`);
    await until(page, "the signed-in panel", () => !!document.querySelector(".coachpanel .co-left") && !document.querySelector(".coachpanel .co-signin"));
  },
  // Signed in, before the first review: "2 of 2 reviews left in <this Taiwan month>", How to film open with the spec's list, and the coach
  // agreement where New review goes: the spec's points, the privacy line word for word, WaveSlave and no person by name, and the 18+ tick.
  // I agree without the tick says who the coach is for and sends nothing; with it, it sends {ver: "c1", adult: true} and New review shows.
  // The backend keeps it: after a reload there's no agreement.
  async agreement(s) {
    const page = s.surfer, agrees = [];
    page.on("request", r => { if (r.url() === CHAT() + "/coach/agree" && r.method() === "POST") agrees.push(r.postDataJSON()); });
    const month = new Date(Date.now() + 8 * 3600e3).toLocaleString("en", { month: "long", timeZone: "UTC" });
    const look = () => page.evaluate(() => { const q = sel => document.querySelector(".coachpanel " + sel), err = q(".co-agree .co-err");
      return { left: q(".co-left") && q(".co-left").textContent, film: q(".co-film") && { open: q(".co-film").open, head: q(".co-film summary").textContent, n: q(".co-film").querySelectorAll("li").length },
        agree: q(".co-agree") && q(".co-agree").textContent, err: !!err && !err.hidden && err.textContent, newReview: !!q(".co-new") && !!q(".co-new").getClientRects().length }; });
    let st = await look();
    if (st.left !== `2 of 2 reviews left in ${month}`) throw new Error(`the panel says ${JSON.stringify(st.left)}, want "2 of 2 reviews left in ${month}"`);
    if (!st.film || !st.film.open || st.film.head !== "How to film" || st.film.n !== 7) throw new Error(`before the first review How to film is ${JSON.stringify(st.film)}, want open with the spec's 7 points`);
    if (!st.agree || st.newReview) throw new Error(`before agreeing the panel has ${st.agree ? "the agreement" : "no agreement"} and ${st.newReview ? "New review" : "no New review"}`);
    for (const t of ["Only key frames are sent. Your video never leaves your phone.", "Anthropic (USA)", "a person at WaveSlave", "Cloudflare", "I'm 18 or older, and the surfer in every clip I send is me."])
      if (!st.agree.includes(t)) throw new Error(`the agreement doesn't say ${JSON.stringify(t)}: ${st.agree}`);
    if (/bryan/i.test(st.agree)) throw new Error("the agreement names Bryan");
    await page.click('.coachpanel [data-k="agree"]'); await wait(500); st = await look();
    if (st.err !== "The coach is for surfers 18 and over, sending clips of themselves." || agrees.length || st.newReview) throw new Error(`I agree without the tick: ${JSON.stringify({ err: st.err, sent: agrees, newReview: st.newReview })}`);
    await page.check('.coachpanel [data-k="adult"]'); st = await look();
    if (st.err) throw new Error(`with the tick the panel still says ${JSON.stringify(st.err)}`);
    await page.click('.coachpanel [data-k="agree"]');
    await until(page, "New review", () => { const b = document.querySelector(".coachpanel .co-new"); return !!b && !!b.getClientRects().length && !document.querySelector(".coachpanel .co-agree"); });
    if (!eq(agrees, [{ ver: "c1", adult: true }])) throw new Error(`I agree sent ${JSON.stringify(agrees)}`);
    await page.reload({ waitUntil: "load" }); await page.tap(TAB); await panelOpen(page);
    await until(page, "New review after a reload", () => !!document.querySelector(".coachpanel .co-new") && !document.querySelector(".coachpanel .co-agree"));
  },
  // How to film folds to its one line once there's a review, and the list shows each review with its move, date and status in the
  // surfer's words. The review is u-bryan's (so the LINE account keeps both its reviews for the New review flow's checks), sent through
  // the backend's routes and drafted by the fake AI: "Coach is reviewing".
  async filmFolds(s) {
    const t = token("u-bryan"); s.bryan = await s.open({ store: { "waveslave-chat-token": t } }); let page = s.bryan;
    await page.tap(TAB); await panelOpen(page);
    await until(page, "How to film open, with no reviews yet", () => { const d = document.querySelector(".coachpanel .co-film"); return !!d && d.open && !document.querySelector(".coachpanel .co-list"); });
    s.review = await sendReview(t);
    await page.reload({ waitUntil: "load" }); await page.tap(TAB); await panelOpen(page);
    await until(page, "the review in the list", () => !!document.querySelector(".coachpanel .co-list li"));
    const today = new Date(Date.now() + 8 * 3600e3), date = `${today.getUTCDate()} ${today.toLocaleString("en", { month: "long", timeZone: "UTC" })}`;
    const st = await page.evaluate(() => { const d = document.querySelector(".coachpanel .co-film");
      return { open: d.open, line: d.querySelector("summary").textContent, rows: [...document.querySelectorAll(".coachpanel .co-list li")].map(li => [...li.querySelectorAll(".co-mv, .co-date, .co-st")].map(e => e.textContent)) }; });
    if (st.open || st.line !== "How to film") throw new Error(`with a review How to film is ${st.open ? "open" : "folded"}, its line ${JSON.stringify(st.line)}`);
    if (!eq(st.rows, [["Top turn", date, "Coach is reviewing"]])) throw new Error(`the list shows ${JSON.stringify(st.rows)}, want [["Top turn", "${date}", "Coach is reviewing"]]`);
  },
  // The dot: once Bryan approves the review it's ready, and the next page load's GET /coach/me puts a dot on the Coach tab with the panel
  // shut. The list says "Ready"; opening the review clears the dot, for good (waveslave-coach-seen keeps when it was published).
  async dot(s) {
    const t = token("u-bryan"), page = s.bryan, asks = [];
    const ok = await coachApi(t, `/admin/coach/drafts/${s.review}`, { method: "POST", body: { action: "approve" } });
    if (ok.status !== 200) throw new Error(`approving answered ${ok.status} ${JSON.stringify(ok.json)}`);
    const me = await coachApi(t, "/coach/me"), published = me.json && me.json.reviews[0] && me.json.reviews[0].published;
    page.on("request", r => { if (r.url() === CHAT() + "/coach/me" && r.method() === "GET") asks.push(r.url()); });
    await page.reload({ waitUntil: "load" });
    await until(page, "the dot on the Coach tab", t => { const b = document.querySelector(t); return b.classList.contains("co-dot") && getComputedStyle(b, "::after").content !== "none"; }, TAB);
    if (asks.length !== 1 || await page.evaluate(() => document.documentElement.classList.contains("coach-open"))) throw new Error(`the page asked GET /coach/me ${asks.length} times, the panel ${await page.evaluate(() => document.documentElement.classList.contains("coach-open")) ? "open" : "shut"}`);
    await page.tap(TAB); await panelOpen(page);
    await until(page, "the review ready in the list", () => { const st = document.querySelector(".coachpanel .co-list .co-st"); return !!st && st.textContent === "Ready"; });
    await page.click(".coachpanel .co-list button");
    await page.tap(".coachpanel .co-x"); await until(page, "the panel to shut", () => !document.documentElement.classList.contains("coach-open"));
    const seen = await page.evaluate(() => localStorage.getItem("waveslave-coach-seen"));
    if (await tabDot(page) || seen !== String(published)) throw new Error(`after opening the review the dot is ${await tabDot(page) ? "still there" : "gone"} and waveslave-coach-seen is ${seen}, want ${published}`);
    await page.reload({ waitUntil: "load" }); for (let i = 0; i < 100 && asks.length < 2; i++) await wait(100); await wait(500);
    if (asks.length !== 2 || await tabDot(page)) throw new Error(`after a reload (${asks.length - 1} asks) the dot is ${await tabDot(page) ? "back" : "gone"}`);
  },
  // Bryan's email link, ?coach=drafts (ruling R18), out of developer mode: the address is tidied at once to the spot, the World PIN is
  // asked for before anything, and once it's in, the panel opens at Drafts with the focus on it, which only the admin has (ruling P40).
  // The surfer following the same link gets the panel without Drafts. A cancelled PIN drops the link: developer mode coming on later
  // (the PIN in) leaves the panel shut and asks the coach nothing until then.
  async draftsLink(s) {
    {
      const page = await s.open({ pub: false, pin: true, unlocked: false, store: { "waveslave-chat-token": token("u-bryan") }, at: "/?coach=drafts" }), asked = [];
      page.on("request", r => { if (r.url().startsWith(CHAT() + "/coach")) asked.push(r.url()); });
      await wait(500);
      if (!await page.evaluate(() => !!window.__pinAsked)) throw new Error("?coach=drafts didn't ask for the PIN");
      await page.evaluate(() => window.__pinAsked.cancel()); await wait(300);
      const cancelled = await page.evaluate(() => ({ world: WORLD, open: document.documentElement.classList.contains("coach-open") }));
      if (cancelled.world || cancelled.open || asked.length) throw new Error(`after a cancelled PIN: ${JSON.stringify(cancelled)}, the coach asked ${JSON.stringify(asked)}`);
      await page.evaluate(() => { sessionStorage.setItem("waveslave-unlock", window.__lockHash); return setWorld(true); }); await wait(1000);
      const later = await page.evaluate(t => ({ world: WORLD, tab: !document.querySelector(t).hidden, open: document.documentElement.classList.contains("coach-open") }), TAB);
      if (!later.world || !later.tab || later.open) throw new Error(`developer mode on after a cancelled PIN: ${JSON.stringify(later)}, want the tab and the panel shut`);
    }
    const surfer = await s.surfer.evaluate(() => CHAT.token());
    for (const [who, tok, admin] of [["u-bryan", token("u-bryan"), true], ["the surfer", surfer, false]]) {
      const page = await s.open({ pub: false, pin: true, unlocked: false, store: { "waveslave-chat-token": tok }, at: "/?coach=drafts" }), asked = [];
      page.on("request", r => { if (r.url().startsWith(CHAT() + "/coach")) asked.push(r.url()); });
      await wait(500);
      const before = await page.evaluate(() => ({ href: location.href, cur: CUR, pin: !!window.__pinAsked, open: document.documentElement.classList.contains("coach-open") }));
      if (before.href !== `${ORIGIN()}/#${before.cur}` || !before.pin || before.open || asked.length) throw new Error(`${who}, before the PIN: ${JSON.stringify(before)}, the coach asked ${JSON.stringify(asked)}`);
      await page.evaluate(() => { sessionStorage.setItem("waveslave-unlock", window.__lockHash); window.__pinAsked.done(); });
      await panelOpen(page);
      await until(page, `${who}'s panel, signed in`, () => !!document.querySelector(".coachpanel .co-left"));
      const st = await page.evaluate(() => { const h = document.querySelector(".coachpanel .co-drafts h3"), b = document.querySelector(".coachpanel .co-body"), r = h && h.getBoundingClientRect(), br = b.getBoundingClientRect();
        return { text: h && h.textContent, focus: !!h && document.activeElement === h, seen: !!r && r.top >= br.top && r.top < br.bottom }; });
      if (admin && (st.text !== "Drafts" || !st.focus || !st.seen)) throw new Error(`the admin's panel at Drafts: ${JSON.stringify(st)}`);
      if (!admin && st.text) throw new Error(`the surfer's panel has ${JSON.stringify(st.text)}`);
    }
  },
  // ---- New review (AI coach spec, "New review", steps 1-6), against the real backend, with the 640x360 test clip. The LINE account
  // (agreed, both its reviews left): New review shows "Choose a clip" with the privacy line just under it, the phone's picker for videos;
  // the clip goes into a muted inline <video> and isn't played until the first tap on the questions, which plays it and pauses it at once.
  // The questions (no profile yet, so the level, board and stance too, and a note), Find the move at Here, a tap on the white box, the 12
  // close-ups, and Send: POST /coach/reviews with the answers, en, and the 12 key frames' times and boxes (inside the clip), 12 uploads of
  // a 784x784 JPEG of at most 100 KB each (decoded in the page), then send. "Sent. Your feedback comes within a day.", one review fewer
  // left, the review in the list, and no draft kept.
  async flowEn(s) {
    const m = twMonth(), page = await coachPage(s, await s.surfer.evaluate(() => CHAT.token()), { init: [watchMedia] }), calls = watchCalls(page);
    const left = await text(page, ".co-left");
    if (left !== `2 of 2 reviews left in ${m.name}`) throw new Error(`before sending the panel says ${JSON.stringify(left)}`);
    await page.click('.coachpanel [data-k="new"]'); await inPanel(page, "the picker", ".co-choose");
    const pk = await picker(page);
    if (!eq(pk, { choose: "Choose a clip", privacy: PRIVACY, under: true, accept: "video/*" })) throw new Error(`the picker: ${JSON.stringify(pk)}`);
    await pick(page, clip()); await inPanel(page, "the questions", '[data-k="move-top_turn"]');
    const v = await page.evaluate(() => { const v = document.querySelector(".coachpanel video"); return v && { muted: v.muted, inline: v.playsInline, blob: v.src.startsWith("blob:"), media: window.__media.slice() }; });
    if (!eq(v, { muted: true, inline: true, blob: true, media: [] })) throw new Error(`the clip, before a tap: ${JSON.stringify(v)}`);
    await page.click('.coachpanel [data-k="move-top_turn"]');
    const media = await page.evaluate(() => window.__media.slice());
    if (!eq(media, ["play", "pause"])) throw new Error(`the first tap on the questions called ${JSON.stringify(media)}, want play then pause`);
    await answer(page, { note: "Trying to make my carve better." }); await tapYourself(page);
    const grid = await page.$$eval(".coachpanel .co-tile", t => t.map(e => e.querySelector(".co-t").textContent));
    if (grid.length !== 12) throw new Error(`the check screen shows ${grid.length} close-ups`);
    await page.click('.coachpanel [data-k="send"]');
    await until(page, "Sent", t => { const e = document.querySelector('.coachpanel [data-k="sent"]'); return !!e && e.textContent === t; }, SENT, 60e3);
    await soon("the send in the calls", () => calls.some(c => c.method === "POST" && /\/send$/.test(c.path)));
    await until(page, "one review fewer left", t => { const e = document.querySelector(".coachpanel .co-left"); return !!e && e.textContent === t; }, `1 of 2 reviews left in ${m.name}`);
    const starts = startsOf(calls), frames = framesOf(calls), sends = calls.filter(c => c.method === "POST" && /\/send$/.test(c.path));
    if (starts.length !== 1 || starts[0].status !== 200) throw new Error(`POST /coach/reviews went ${starts.length} times: ${JSON.stringify(starts.map(c => c.status))}`);
    const body = JSON.parse(starts[0].body), { frames: kf, ...rest } = body;
    if (!eq(rest, { lang: "en", move: "top_turn", move_other: "", level: "starting_turns", board: "shortboard", stance: "goofy", note: "Trying to make my carve better." })) throw new Error(`the start sent ${JSON.stringify(rest)}`);
    if (!eq(kf.map(f => f.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) || !eq(kf.map(f => f.ms), TIMES)) throw new Error(`the start's key frames: ${JSON.stringify(kf.map(f => [f.n, f.ms]))}`);
    const out = kf.filter(f => !(Array.isArray(f.box) && f.box[2] === 120 && f.box[0] >= 0 && f.box[1] >= 0 && f.box[0] + f.box[2] <= 640 && f.box[1] + f.box[2] <= 360));
    if (out.length) throw new Error(`boxes outside the 640x360 clip: ${JSON.stringify(out)}`);
    if (!eq(frames.map(f => [f.n, f.status]), kf.map(f => [f.n, 200]))) throw new Error(`the uploads: ${JSON.stringify(frames.map(f => [f.n, f.status]))}`);
    const jpegs = await decode(page, frames.map(f => f.body)), bad = jpegs.filter(j => j.w !== 784 || j.h !== 784 || j.bytes > 102400);
    if (bad.length) throw new Error(`uploads that aren't 784x784 JPEGs of at most 100 KB: ${JSON.stringify(bad)}`);
    if (sends.length !== 1 || sends[0].status !== 200) throw new Error(`send went ${sends.length} times: ${JSON.stringify(sends.map(c => c.status))}`);
    const today = new Date(Date.now() + 8 * 3600e3), date = `${today.getUTCDate()} ${m.name}`;
    await until(page, "the review in the list", () => !!document.querySelector(".coachpanel .co-list li"));
    const rows = await page.$$eval(".coachpanel .co-list li", ls => ls.map(li => [...li.querySelectorAll(".co-mv, .co-date, .co-st")].map(e => e.textContent)));
    if (!eq(rows, [["Top turn", date, "Coach is reviewing"]])) throw new Error(`the list shows ${JSON.stringify(rows)}`);
    await soon("the draft to go", async () => await draft(page) === null);
  },
  // The same in 中文 (u-ana's account): the count, the picker with the privacy line under it, Find the move's line naming the move, the
  // check screen and Send in 中文, "已送出。一天內會收到講評。", and POST /coach/reviews with lang zh; 12 uploads of 784x784 JPEGs of at
  // most 100 KB.
  async flowZh(s) {
    const tok = token("u-ana"), m = twMonth(); await agreeFor(tok);
    const page = await coachPage(s, tok, { store: { "waveslave-lang": "zh" } }), calls = watchCalls(page);
    const left = await text(page, ".co-left");
    if (left !== `${m.n}月還剩 2 次講評（共 2 次）`) throw new Error(`before sending the panel says ${JSON.stringify(left)}`);
    await page.click('.coachpanel [data-k="new"]'); await inPanel(page, "the picker", ".co-choose");
    const pk = await picker(page);
    if (!eq(pk, { choose: "選擇影片", privacy: "只會傳送關鍵影格，你的影片不會離開你的手機。", under: true, accept: "video/*" })) throw new Error(`the picker: ${JSON.stringify(pk)}`);
    await pick(page, clip()); await answer(page);
    const find = await page.evaluate(() => [...document.querySelectorAll(".coachpanel .co-flow h3, .coachpanel .co-flow h3 + p, .coachpanel [data-k=\"here\"]")].map(e => e.textContent));
    if (!eq(find, ["找到動作", "拖動滑桿到你的頂部轉向，再按「這裡」。", "這裡"])) throw new Error(`Find the move in 中文: ${JSON.stringify(find)}`);
    await tapYourself(page);
    const check = await page.evaluate(() => [document.querySelector(".coachpanel .co-flow h3").textContent, document.querySelector('.coachpanel [data-k="send"]').textContent]);
    if (!eq(check, ["每個關鍵影格裡都是你嗎？", "傳送給教練"])) throw new Error(`the check screen in 中文: ${JSON.stringify(check)}`);
    await page.click('.coachpanel [data-k="send"]');
    await until(page, "已送出", t => { const e = document.querySelector('.coachpanel [data-k="sent"]'); return !!e && e.textContent === t; }, "已送出。一天內會收到講評。", 60e3);
    await until(page, "one review fewer left", t => { const e = document.querySelector(".coachpanel .co-left"); return !!e && e.textContent === t; }, `${m.n}月還剩 1 次講評（共 2 次）`);
    await soon("the send in the calls", () => calls.some(c => c.method === "POST" && /\/send$/.test(c.path)));
    const starts = startsOf(calls), frames = framesOf(calls);
    if (starts.length !== 1 || JSON.parse(starts[0].body).lang !== "zh") throw new Error(`the starts: ${JSON.stringify(starts.map(c => c.body))}`);
    const jpegs = await decode(page, frames.map(f => f.body)), bad = jpegs.filter(j => j.w !== 784 || j.h !== 784 || j.bytes > 102400);
    if (frames.length !== 12 || bad.length) throw new Error(`${frames.length} uploads, these not 784x784 JPEGs of at most 100 KB: ${JSON.stringify(bad)}`);
  },
  // A reload during the slider (u-ben's account): the draft says find, with the answers. The panel then asks "Pick up where you left
  // off?" naming the move; Pick up asks for the same clip again, which goes straight to Find the move, the questions answered. ‹ Back to
  // the questions (still answered), ‹ Back to the panel, and Start over clears the draft: a fresh picker.
  async reloadSlider(s) {
    const tok = token("u-ben"); await agreeFor(tok);
    const page = s.ben = await coachPage(s, tok);
    await toCheck(page, { move: "cutback", note: "Left hand lower", go: false });
    let d = null; await soon("the draft at Find the move", async () => (d = await draft(page)) && d.step === "find");
    if (!eq(d.answers, { move: "cutback", move_other: "", note: "Left hand lower", level: "starting_turns", board: "shortboard", stance: "goofy" }) || d.frames.length || d.id !== null)
      throw new Error(`the draft at Find the move: ${JSON.stringify(d)}`);
    await page.reload({ waitUntil: "load" }); await page.tap(TAB); await panelOpen(page);
    await inPanel(page, "Pick up where you left off?", ".co-resume");
    const offer = await page.$$eval(".coachpanel .co-resume > *", e => e.map(x => x.textContent));
    if (!eq(offer, ["Pick up where you left off?", "Cutback", "Pick up", "Start over"])) throw new Error(`the offer: ${JSON.stringify(offer)}`);
    await page.click('.coachpanel [data-k="pickup"]'); await inPanel(page, "the picker", ".co-choose");
    const again = await page.evaluate(() => [...document.querySelectorAll(".coachpanel .co-flow .co-note")].map(e => e.textContent));
    if (!again.includes("Choose the same clip again to pick up where you left off.")) throw new Error(`picking up shows ${JSON.stringify(again)}`);
    await pick(page, clip()); await inPanel(page, "Find the move", '[data-k="slider"]:not([disabled])');
    const find = await page.evaluate(() => ({ head: document.querySelector(".coachpanel .co-flow h3").textContent, line: document.querySelector(".coachpanel .co-flow h3 + p").textContent, questions: !!document.querySelector('.coachpanel [data-k^="move-"]') }));
    if (!eq(find, { head: "Find the move", line: "Slide to your cutback and tap Here.", questions: false })) throw new Error(`after the same clip: ${JSON.stringify(find)}`);
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "the questions", '[data-k="move-cutback"]');
    const q = await page.evaluate(() => ({ move: document.querySelector('.coachpanel [data-k="move-cutback"]').getAttribute("aria-pressed"), note: document.querySelector('.coachpanel [data-k="note"]').value }));
    if (!eq(q, { move: "true", note: "Left hand lower" })) throw new Error(`‹ Back to the questions: ${JSON.stringify(q)}`);
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "Pick up where you left off?", ".co-resume");
    await page.click('.coachpanel [data-k="over"]'); await inPanel(page, "the picker", ".co-choose");
    const fresh = await page.evaluate(() => ({ head: document.querySelector(".coachpanel .co-flow h3").textContent, again: [...document.querySelectorAll(".coachpanel .co-flow .co-note")].some(e => /same clip/.test(e.textContent)) }));
    if (!eq(fresh, { head: "New review", again: false })) throw new Error(`after Start over: ${JSON.stringify(fresh)}`);
    await soon("Start over to clear the draft", async () => await draft(page) === null);
  },
  // A reload after the key frames are cut, partway through sending: 5 of the 12 are on the server when the page reloads (the 6th never
  // got there). Pick up where you left off? says the key frames are ready, and Pick up goes straight to the check screen, all 12 there
  // without the clip (so no + or −). Send asks GET /coach/reviews/{id} first and sends only the 7 the server lacks, then send; no new
  // start. The review is sent, all 12 key frames on the server.
  async reloadAfterFrames(s) {
    const page = s.ben, tok = token("u-ben"), calls = watchCalls(page);
    await pick(page, clip()); await answer(page, { move: "cutback" }); await tapYourself(page);
    const v = await valve(page, (m, p) => isFrame(m, p) && +p.split("/").pop() > 5);
    await page.context().addInitScript(countPuts); await page.evaluate(countPuts);
    await page.click('.coachpanel [data-k="send"]'); await v.wait(1, "the 6th key frame's upload");
    let d = null; await soon("the draft with 5 key frames sent", async () => (d = await draft(page)) && eq(d.sent, [1, 2, 3, 4, 5]));
    if (d.step !== "check" || d.frames.length !== 12 || d.frames.some(f => !f.blob) || !/^[A-Za-z0-9_-]{22}$/.test(d.id || "")) throw new Error(`the draft partway: ${JSON.stringify({ ...d, frames: d.frames.length })}`);
    // Each step of the send writes only the id and what has landed, never the 12 key frames again.
    const puts = await page.evaluate(() => window.__puts);
    if (puts.current || !(puts.progress >= 6)) throw new Error(`sending wrote IndexedDB ${JSON.stringify(puts)}, want only "progress" (the start and 5 key frames)`);
    await page.reload({ waitUntil: "load" }); v.drop(); await page.unroute(CHAT() + "/coach/reviews/**");
    const mark = calls.length;
    await page.tap(TAB); await panelOpen(page); await inPanel(page, "Pick up where you left off?", ".co-resume");
    const offer = await page.$$eval(".coachpanel .co-resume > *", e => e.map(x => x.textContent));
    if (!eq(offer, ["Pick up where you left off?", "Cutback", "Your key frames are ready.", "Pick up", "Start over"])) throw new Error(`the offer: ${JSON.stringify(offer)}`);
    await page.click('.coachpanel [data-k="pickup"]'); await inPanel(page, "the check screen", ".co-grid");
    const st = await page.evaluate(() => ({ tiles: document.querySelectorAll(".coachpanel .co-tile").length, size: !!document.querySelector('.coachpanel [data-k="bigger"], .coachpanel [data-k="smaller"]') }));
    if (!eq(st, { tiles: 12, size: false })) throw new Error(`the check screen after a reload: ${JSON.stringify(st)}`);
    await page.click('.coachpanel [data-k="send"]');
    await until(page, "Sent", t => { const e = document.querySelector('.coachpanel [data-k="sent"]'); return !!e && e.textContent === t; }, SENT, 60e3);
    await soon("the send in the calls", () => calls.slice(mark).some(c => /\/send$/.test(c.path)));
    const after = calls.slice(mark).map(c => [c.method, c.path.replace(d.id, "{id}"), c.status]);
    const want = [["GET", "/coach/reviews/{id}", 200], ...[6, 7, 8, 9, 10, 11, 12].map(n => ["POST", `/coach/reviews/{id}/frames/${n}`, 200]), ["POST", "/coach/reviews/{id}/send", 200]];
    if (!eq(after, want)) throw new Error(`after the reload the page asked ${JSON.stringify(after)}`);
    const again = await page.evaluate(() => window.__puts);
    if (again.current) throw new Error(`the send after the reload wrote the key frames again: ${JSON.stringify(again)}`);
    const r = await coachApi(tok, `/coach/reviews/${d.id}`);
    if (r.status !== 200 || r.json.status === "uploading" || !eq(r.json.have, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) throw new Error(`the server's review: ${r.status} ${JSON.stringify(r.json)}`);
  },
  // The day fills up (meta today at the daily limit) between the start and send (u-dan's account): send answers 429 full_today and the
  // page says "Couldn't send. Tap to try again.", the draft still in IndexedDB with all 12 key frames, the review's id and every frame sent.
  async fullToday(s) {
    const tok = token("u-dan"); await agreeFor(tok);
    const page = await coachPage(s, tok), calls = watchCalls(page);
    await toCheck(page);
    const v = await valve(page, (m, p) => m === "POST" && /\/send$/.test(p));
    await page.click('.coachpanel [data-k="send"]'); await v.wait(1, "send");
    const old = await coachToday(JSON.stringify({ day: twDay(), n: 10 }));
    try {
      v.open();
      await until(page, "Couldn't send", t => { const e = document.querySelector('.coachpanel [data-k="retry"]'); return !!e && e.textContent === t; }, FAILED, 30e3);
      const sends = calls.filter(c => /\/send$/.test(c.path)).map(c => c.status);
      if (!eq(sends, [429])) throw new Error(`send answered ${JSON.stringify(sends)}`);
      const d = await draft(page);
      if (!d || d.step !== "check" || d.frames.length !== 12 || d.frames.some(f => !f.blob) || !d.id || !eq(d.sent, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) throw new Error(`after full_today the draft is ${JSON.stringify(d && { ...d, frames: d.frames.length })}`);
    } finally { await coachToday(old !== null ? old : JSON.stringify({ day: "2000-01-01", n: 0 })); }
    const me = await coachApi(tok, "/coach/me");
    if (me.status !== 200 || me.json.left !== 2) throw new Error(`after full_today u-dan has ${me.json && me.json.left} reviews left, want 2`);
  },
  // Review Focus 2: the same account in two tabs (u-cho's), here in two browsers (two contexts, so each has its own IndexedDB: two
  // devices; twoTabsOneBrowser is the one-browser case). Both get to Send; A starts, then B starts, which drops A's review still
  // uploading (R12). A's first key frame then meets not_found and A starts again once, silently, dropping B's; B's first key frame meets
  // not_found too and B starts again and goes through; A's next key frame meets not_found again and A ends on "Couldn't send. Tap to try
  // again.", its draft kept. One review on the server, one fewer left, and B's draft gone.
  async twoTabs(s) {
    const tok = token("u-cho"); await agreeFor(tok);
    const a = await coachPage(s, tok), b = await coachPage(s, tok), ca = watchCalls(a), cb = watchCalls(b);
    await toCheck(a); await toCheck(b);
    const va = await valve(a, isFrame), vb = await valve(b, isFrame);
    await a.click('.coachpanel [data-k="send"]'); await va.wait(1, "A's first key frame");
    await b.click('.coachpanel [data-k="send"]'); await vb.wait(1, "B's first key frame");
    va.release(); await va.wait(1, "A's first key frame after starting again");
    vb.open();
    await until(b, "B's Sent", t => { const e = document.querySelector('.coachpanel [data-k="sent"]'); return !!e && e.textContent === t; }, SENT, 60e3);
    va.open();
    await until(a, "A's Couldn't send", t => { const e = document.querySelector('.coachpanel [data-k="retry"]'); return !!e && e.textContent === t; }, FAILED, 30e3);
    await soon("A's calls", () => framesOf(ca).length >= 2);
    const got = { aStarts: startsOf(ca).map(c => c.status), aFrames: framesOf(ca).map(f => f.status), bStarts: startsOf(cb).map(c => c.status), bFrames: framesOf(cb).map(f => f.status) };
    if (!eq(got, { aStarts: [200, 200], aFrames: [404, 404], bStarts: [200, 200], bFrames: [404, ...Array(12).fill(200)] })) throw new Error(`the two tabs: ${JSON.stringify(got)}`);
    const me = await coachApi(tok, "/coach/me");
    if (me.status !== 200 || me.json.reviews.length !== 1 || me.json.left !== 1) throw new Error(`the server has ${me.json && me.json.reviews.length} reviews for u-cho, ${me.json && me.json.left} left`);
    const da = await draft(a), db = await draft(b);
    if (db !== null || !da || da.frames.length !== 12) throw new Error(`the drafts: A's ${da ? "kept" : "gone"}, B's ${db ? "kept" : "gone"}`);
  },
  // The same in two tabs of one browser (u-eve's), which share IndexedDB's one draft: B gets to the check screen first and A after, so
  // the draft kept is A's. R12 goes as above; B's send, done, deletes only its own draft, so A's is still there, and still after A's
  // "Couldn't send", and a reload of A's tab offers it.
  async twoTabsOneBrowser(s) {
    const tok = token("u-eve"); await agreeFor(tok);
    const b = await coachPage(s, tok), a = await coachTab(s, b), ca = watchCalls(a), cb = watchCalls(b);
    let d = null;
    await toCheck(b); await soon("B's draft", async () => (d = await draft(b)) && d.frames.length === 12);
    const flowB = d.flow;
    await toCheck(a); await soon("A's draft in B's place", async () => (d = await draft(a)) && d.frames.length === 12 && d.flow !== flowB);
    const flowA = d.flow;
    const va = await valve(a, isFrame), vb = await valve(b, isFrame);
    await a.click('.coachpanel [data-k="send"]'); await va.wait(1, "A's first key frame");
    await b.click('.coachpanel [data-k="send"]'); await vb.wait(1, "B's first key frame");
    va.release(); await va.wait(1, "A's first key frame after starting again");
    vb.open();
    await until(b, "B's Sent", t => { const e = document.querySelector('.coachpanel [data-k="sent"]'); return !!e && e.textContent === t; }, SENT, 60e3);
    await wait(500); d = await draft(a);
    if (!d || d.flow !== flowA || d.frames.length !== 12) throw new Error(`once B sent, the draft is ${d ? (d.flow === flowB ? "B's" : "another") : "gone"}, want A's`);
    va.open();
    await until(a, "A's Couldn't send", t => { const e = document.querySelector('.coachpanel [data-k="retry"]'); return !!e && e.textContent === t; }, FAILED, 30e3);
    await soon("A's calls", () => framesOf(ca).length >= 2);
    const got = { aStarts: startsOf(ca).map(c => c.status), aFrames: framesOf(ca).map(f => f.status), bStarts: startsOf(cb).map(c => c.status), bFrames: framesOf(cb).map(f => f.status) };
    if (!eq(got, { aStarts: [200, 200], aFrames: [404, 404], bStarts: [200, 200], bFrames: [404, ...Array(12).fill(200)] })) throw new Error(`the two tabs: ${JSON.stringify(got)}`);
    const me = await coachApi(tok, "/coach/me");
    if (me.status !== 200 || me.json.reviews.length !== 1 || me.json.left !== 1) throw new Error(`the server has ${me.json && me.json.reviews.length} reviews for u-eve, ${me.json && me.json.left} left`);
    d = await draft(a);
    if (!d || d.flow !== flowA || d.frames.length !== 12) throw new Error(`after A's Couldn't send the draft is ${d ? "another" : "gone"}, want A's`);
    await a.reload({ waitUntil: "load" }); await a.tap(TAB); await panelOpen(a); await inPanel(a, "Pick up where you left off?", ".co-resume");
  },
  // A draft belongs to its account (ruling P51), on one browser. u-fay gets to the check screen; then u-gus signs in in the same page (as
  // a code-box sign-in does): the review on its way there is let go (its clip's address revoked), u-gus gets New review and no Pick up,
  // and nothing is sent; after a reload u-gus still isn't offered it, and u-fay's draft is still stored. u-fay signing in again gets it
  // back: Pick up where you left off?, the key frames ready, the check screen with all 12.
  async accountSwitch(s) {
    const fay = token("u-fay"), gus = token("u-gus"); await agreeFor(fay); await agreeFor(gus);
    // The token goes in by hand (not by s.open's store, which would put it back on every load).
    const page = await s.open({}), calls = watchCalls(page);
    await page.evaluate(t => localStorage.setItem("waveslave-chat-token", t), fay); await page.reload({ waitUntil: "load" }); await panelUp(page);
    await toCheck(page); let d = null;
    await soon("u-fay's draft", async () => (d = await draft(page)) && d.frames.length === 12);
    if (d.account !== "u-fay") throw new Error(`the draft is kept for ${JSON.stringify(d.account)}, want "u-fay"`);
    const src = await page.evaluate(() => document.querySelector(".coachpanel video").src), mark = calls.length;
    // Another sign-in in this page: a new token kept, and the panel opened again (chat.js calls COACH.open() once a sign-in is done).
    const signIn = async tok => { await page.tap(".coachpanel .co-x"); await until(page, "the panel to shut", () => !document.documentElement.classList.contains("coach-open"));
      await page.evaluate(t => localStorage.setItem("waveslave-chat-token", t), tok); await page.tap(TAB); await panelOpen(page); };
    const offered = async who => { await until(page, `${who}'s panel`, () => !!document.querySelector(".coachpanel .co-left") && !!document.querySelector(".coachpanel .co-new, .coachpanel .co-resume"));
      await wait(500); return page.evaluate(() => ({ resume: !!document.querySelector(".coachpanel .co-resume"), video: !!document.querySelector(".coachpanel video") })); };
    await signIn(gus);
    let st = await offered("u-gus"); const clip = await page.evaluate(u => fetch(u).then(() => "alive", () => "revoked"), src);
    if (!eq({ ...st, clip }, { resume: false, video: false, clip: "revoked" })) throw new Error(`u-gus signed in after u-fay: ${JSON.stringify({ ...st, clip })}`);
    await page.reload({ waitUntil: "load" }); await page.tap(TAB); await panelOpen(page); st = await offered("u-gus");
    if (st.resume) throw new Error("after a reload u-gus is offered u-fay's draft");
    d = await draft(page);
    if (!d || d.account !== "u-fay" || d.frames.length !== 12) throw new Error(`with u-gus signed in the draft became ${JSON.stringify(d && { account: d.account, frames: d.frames.length })}`);
    await signIn(fay); await inPanel(page, "Pick up where you left off?", ".co-resume");
    const offer = await page.$$eval(".coachpanel .co-resume > *", e => e.map(x => x.textContent));
    if (!eq(offer, ["Pick up where you left off?", "Top turn", "Your key frames are ready.", "Pick up", "Start over"])) throw new Error(`u-fay again is offered ${JSON.stringify(offer)}`);
    await page.click('.coachpanel [data-k="pickup"]'); await inPanel(page, "the check screen", ".co-grid");
    const tiles = await page.$$eval(".coachpanel .co-tile", t => t.length), posts = calls.slice(mark).filter(c => c.method === "POST");
    if (tiles !== 12 || posts.length) throw new Error(`u-fay's draft back: ${tiles} close-ups; sent meanwhile ${JSON.stringify(posts.map(c => c.path))}`);
  },
};

(async () => {
  let browser, bad = false, ctxs = [], errs = [];
  const s = {
    // A fresh context: the page, the backend, the fake LINE and the fake AI load, everything else is cut off. go: false leaves it on a
    // blank page (s.go(page) opens it there). pub: false leaves the chat and the coach to developer mode, which is off; unlocked: false
    // leaves the World PIN out of this visit, and pin: true puts a stand-in for its box (web/head.html's wsPin) that only notes it was
    // asked (window.__pinAsked = {done, cancel}), as tests/chat/shell.test.js does; store is put in localStorage on every load; at is the
    // address to open, by default /#<spot>; init are more init scripts (functions).
    async open({ spot = "jinshan", go = true, pub = true, unlocked = true, pin = false, store = {}, at = null, init = [] }) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: true });
      ctxs.push(ctx);
      await ctx.route("**/*", r => { const u = r.request().url(); return [ORIGIN(), CHAT(), line.url, ai.url].some(o => u.startsWith(o + "/")) ? r.continue() : r.abort(); });
      await ctx.addInitScript(([o, lock]) => {
        try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", "fc"); localStorage.setItem("waveslave-lang", "en"); localStorage.setItem("waveslave-world", "0");
          for (const k in o.store) localStorage.setItem(k, o.store[k]); if (lock && o.unlocked) sessionStorage.setItem("waveslave-unlock", lock); } catch (e) {}
        window.__chatUrl = o.url; window.__chatContact = o.contact; if (o.pub) { window.__chatPublic = true; window.__coachPublic = true; }
        if (o.pin) { const stub = (done, cancel) => { window.__pinAsked = { done, cancel }; };
          Object.defineProperty(window, "wsPin", { configurable: true, get: () => stub, set: () => {} }); } },
        [{ url: CHAT(), contact: CONTACT, pub, unlocked, pin, store }, LOCK]);
      for (const i of init) await ctx.addInitScript(i);
      const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e)));
      page.at = at || `/#${spot}`; page.pub = pub;
      if (go) await s.go(page);
      return page;
    },
    // Another tab of page's browser (its context, so the same storage), at the same address.
    async tab(page) {
      const p = await page.context().newPage(); p.on("pageerror", e => errs.push(String(e)));
      p.at = page.at; p.pub = page.pub; await s.go(p); return p;
    },
    // Opens the page's address (page.at), and waits for the CHAT button when the chat is on for everyone.
    async go(page) {
      await page.goto(ORIGIN() + page.at, { waitUntil: "load" });
      if (page.pub) await page.waitForFunction(() => { const f = document.querySelector(".chatfab"); return !!f && getComputedStyle(f).display !== "none"; });
    },
  };
  let stopped = null;
  async function step(name, run) {
    if (stopped) return console.log(`skip ${name} (after ${stopped})`);
    let status = "ok", note = ""; errs = [];
    try { await run(); } catch (e) { status = "FAIL"; note = e.message; }
    if (errs.length) [status, note] = ["FAIL", "page error: " + errs.join("; ")];
    if (status === "FAIL") { bad = true; stopped = name; }
    console.log(status === "FAIL" ? `FAIL ${name}: ${note}` : `ok ${name}`);
  }
  const quit = () => tearDown().finally(() => process.exit(1));
  process.once("SIGINT", quit); process.once("SIGTERM", quit);
  try {
    await setUp(); browser = await chromium.launch();
    for (const [name, run] of Object.entries(STEPS)) await step(name, () => run(s));
    await step("fakeServices", async () => {
      if (line.problems.length || ai.problems.length) throw new Error(`the fakes refused: ${[...line.problems, ...ai.problems].join("; ")}`); });
  } catch (e) { bad = true; console.log(`FAIL setup: ${e.message}`); }
  finally { if (browser) await browser.close(); await tearDown(); }
  process.exitCode = bad ? 1 : 0;
})();
