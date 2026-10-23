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
// (tests/chat/room.test.js's token()). tv is the account's token version: 0 as seeded, one more after each ban or Sign out everywhere.
const token = (uid, tv = 0) => { const p = Buffer.from(JSON.stringify({ uid, tv, exp: Date.now() + DAY })).toString("base64url");
  return p + "." + crypto.createHmac("sha256", SECRETS.SESSION_SECRET).update(p).digest("base64url"); };

// ---- The servers (tests/chat/servers.js), with the fake LINE and the fake AI. The fake AI answers a good review (goodAnswer) unless a
// step sets aiReply(request) to answer in its place; FX holds the fake's and the backend fixtures' helpers.
let srv = null, line = null, ai = null, aiReply = null, FX = null;
const ORIGIN = () => srv.origin, CHAT = () => srv.chat;
async function setUp() {
  const { startFakeLine } = await import(path.join(ROOT, "tests", "chat", "fake-line.mjs"));
  const { startFakeAi, goodAnswer, sentOf, langOf } = await import(path.join(__dirname, "fake-ai.mjs"));
  const { apiMessage, goodReply } = await import(path.join(ROOT, "chat", "test", "coach-fixtures.mjs"));
  FX = { goodAnswer, sentOf, langOf, apiMessage, goodReply };
  line = await startFakeLine({ channelId: SECRETS.LINE_CHANNEL_ID, secret: SECRETS.LINE_CHANNEL_SECRET });
  ai = await startFakeAi({ reply: r => (aiReply || goodAnswer)(r) });
  srv = await start({ file, name: "coach", line, ai });
  await srv.startWrangler();
}
async function tearDown() { if (srv) await srv.tearDown(); if (line) await line.close(); if (ai) await ai.close(); }

// Makes u-bryan the admin, as Bryan is: wrangler dev stops, the account goes straight into the room's SQLite file (python3's sqlite3) with
// role admin and the room's meta admin_uid, and wrangler dev starts again on it (tests/chat/room.test.js seeds its room the same way).
// Its session token is token("u-bryan"). The New review checks' surfers (SURFERS) go in the same way, with role user. Doing it again
// changes nothing.
const SURFERS = ["u-ana", "u-ben", "u-cho", "u-dan", "u-eve", "u-fay", "u-gus", "u-hal", "u-ivy", "u-kim"];
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
// The coach's own SQLite file (its Durable Object's), while wrangler dev is stopped; and one of its meta values (JSON text) read, or
// written when value is given (and the meta values in `also` with it), with wrangler dev stopped and started again round it:
// coachToday is "today" (the reviews sent this Taiwan day). Resolves to the value before.
function coachDb() {
  const dos = path.join(srv.tmp, "state", "v3", "do"), dir = fs.existsSync(dos) && fs.readdirSync(dos).find(n => /-Coach$/.test(n));
  const db = dir && fs.readdirSync(path.join(dos, dir)).find(n => /^[0-9a-f]{64}\.sqlite$/.test(n));
  if (!db) throw new Error("wrangler dev made no coach database"); return path.join(dos, dir, db);
}
const META = String.raw`
import json, sqlite3, sys
d = json.load(sys.stdin); c = sqlite3.connect(d["db"])
row = c.execute("SELECT value FROM meta WHERE key = ?", (d["key"],)).fetchone()
with c:
    for k, v in d["set"].items():
        if v is not None: c.execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", (k, v))
c.close(); print(json.dumps(row[0] if row else None))
`;
async function coachMeta(key, value, also = {}) {
  await srv.stopWrangler();
  try { const run = spawnSync("python3", ["-I", "-c", META], { encoding: "utf8", input: JSON.stringify({ db: coachDb(), key, set: { ...also, [key]: value } }) });
    if (run.status !== 0) throw new Error(`the coach's meta ${key}: ${run.stderr}`); return JSON.parse(run.stdout); }
  finally { await srv.startWrangler(); }
}
const coachToday = value => coachMeta("today", value);

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
// Sends a top-turn review for tok's account straight through the backend's routes, as the New review flow does: the agreement, the start
// with 8 key frames (a stand-in 784x784 JPEG each, at 10.25 s to 12.0 s), each frame, then send, in lang, with the surfer's note. Resolves
// to its id once the fake AI's answer is in: status want (drafted, or published on autopilot, or rejected), as GET /coach/reviews/<id>
// tells its owner.
async function sendReview(tok, { lang = "en", want = "drafted", note = "" } = {}) {
  const { jpegB64 } = await import(path.join(ROOT, "chat", "test", "coach-fixtures.mjs"));
  const b64 = jpegB64(), frames = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ n, ms: 10000 + 250 * n, box: [100, 100, 360] }));
  const must = async (what, r) => { r = await r; if (r.status !== 200) throw new Error(`${what} answered ${r.status} ${JSON.stringify(r.json)}`); return r.json; };
  await must("POST /coach/agree", coachApi(tok, "/coach/agree", { method: "POST", body: { ver: "c1", adult: true } }));
  const { id } = await must("POST /coach/reviews", coachApi(tok, "/coach/reviews", { method: "POST",
    body: { lang, move: "top_turn", move_other: "", level: "turning_well", board: "shortboard", stance: "regular", note, frames } }));
  for (const f of frames) await must(`key frame ${f.n}`, coachApi(tok, `/coach/reviews/${id}/frames/${f.n}`, { method: "POST", text: b64 }));
  await must("send", coachApi(tok, `/coach/reviews/${id}/send`, { method: "POST", body: {} }));
  for (let i = 0; i < 60; i++) { const r = await coachApi(tok, `/coach/reviews/${id}`); if (r.json && r.json.status === want) return id; await wait(500); }
  throw new Error(`review ${id} wasn't ${want} within 30 s`);
}
// Bryan's action on a review (POST /admin/coach/drafts/<id>), and his settings (POST /admin/coach/settings), each refused at anything but
// 200; and his Drafts list.
const act = async (id, body) => { const r = await coachApi(token("u-bryan"), `/admin/coach/drafts/${id}`, { method: "POST", body });
  if (r.status !== 200) throw new Error(`${body.action} on ${id} answered ${r.status} ${JSON.stringify(r.json)}`); };
const settings = async body => { const r = await coachApi(token("u-bryan"), "/admin/coach/settings", { method: "POST", body });
  if (r.status !== 200) throw new Error(`settings ${JSON.stringify(body)} answered ${r.status} ${JSON.stringify(r.json)}`); };
const draftsList = async () => { const r = await coachApi(token("u-bryan"), "/admin/coach/drafts"); if (r.status !== 200) throw new Error(`GET /admin/coach/drafts answered ${r.status}`); return r.json; };
// A fake AI answer: a good review of the key frames the request carries, in its language, with `more` over it and, for a 中文 one, `en`
// over its English copy.
const replyWith = (more, en = {}) => r => { const m = FX.goodReply(FX.sentOf(r.body), FX.langOf(r.body)); Object.assign(m, more); if (m.english) Object.assign(m.english, en); return FX.apiMessage(m); };
// The review open in the panel: its heading and date, each part's heading, its lines, its key frames (caption, and whether the image is a
// blob URL) and its button, the footer, and the buttons under it.
const reviewView = page => page.evaluate(() => { const v = document.querySelector(".coachpanel .co-review"); if (!v) return null;
  const t = s => { const e = v.querySelector(s); return e ? e.textContent : null; };
  return { head: t('[data-k="fh"]'), date: t(".co-rdate"), parts: [...v.querySelectorAll(".co-part")].map(p => ({ h: p.querySelector("h4").textContent,
      lines: [...p.querySelectorAll("p")].map(e => e.textContent), frames: [...p.querySelectorAll(".co-kf")].map(f => [f.querySelector("figcaption").textContent, !!f.querySelector('img[src^="blob:"]')]),
      button: p.querySelector("button.co-btn") && p.querySelector("button.co-btn").textContent })),
    foot: t(".co-foot"), acts: [...v.querySelectorAll(".co-acts button")].map(b => b.textContent) }; });
// Opens review id from the list (asking GET /coach/me again first when it isn't there yet) and waits for its key frames, n of them.
async function openReview(page, id, n = 4) {
  await until(page, `review ${id} in the list`, k => !!document.querySelector(`.coachpanel [data-k="${k}"]`), "r-" + id);
  await page.click(`.coachpanel [data-k="r-${id}"]`);
  await until(page, `the review's ${n} key frames`, n => { const i = [...document.querySelectorAll(".coachpanel .co-review .co-kf img")]; return i.length === n && i.every(x => x.src.startsWith("blob:")); }, n);
}
// This Taiwan day as the list writes it, in English and 中文.
const twDate = () => { const d = new Date(Date.now() + 8 * 3600e3); return { en: `${d.getUTCDate()} ${d.toLocaleString("en", { month: "long", timeZone: "UTC" })}`, zh: `${d.getUTCMonth() + 1}月${d.getUTCDate()}日` }; };
// The Coach tab's dot: there, and drawn.
const tabDot = page => page.evaluate(t => { const b = document.querySelector(t); return b.classList.contains("co-dot") && getComputedStyle(b, "::after").content !== "none"; }, TAB);

// ---- Bryan's Drafts list. The 9 lines of a review he can edit (TEXT_FIELDS in chat/src/coach-guide.js), the value at one of them, and
// a time as the page shows it (COACHM.fmtTime).
const PATHS = ["went_well.title", "went_well.detail", "main_fix.title", "main_fix.what", "main_fix.why", "drill.title", "drill.how", "heads_up.text", "progress"];
const at = (o, p) => p.split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), o);
const put = (o, p, v) => { const [a, b] = p.split("."); if (b === undefined) o[a] = v; else o[a][b] = v; };
const fmt = ms => { const t = Math.round(Math.round(Math.max(0, ms) / 10) / 10), s = t % 600; return Math.floor(t / 600) + ":" + String(Math.floor(s / 10)).padStart(2, "0") + "." + (s % 10); };
const MARKUP = `<img src=x onerror="window.__xss=1"><b>bold</b><script>window.__xss=2</script>`;
// Bryan's page, in developer mode (the coach shows only there until go-live), signed in, the Coach panel open, with its Drafts list
// loaded; and its calls to his own routes (watchAdmin) from the first.
async function draftsPage(s) {
  const page = await s.open({ pub: false, go: false, store: { "waveslave-chat-token": token("u-bryan"), "waveslave-world": "1" } }), calls = watchAdmin(page);
  await s.go(page); await page.tap(TAB); await panelOpen(page);
  await until(page, "the Drafts list", () => !!document.querySelector('.coachpanel [data-k="drefresh"]'));
  return { page, calls };
}
// Notes a page's calls to Bryan's own routes (/admin/…) as they go: method, path, the body (from JSON) and the Authorization header, and
// the status once answered (null until then). posts(calls, from) are the POSTs from the from-th call on, as {path, body, status}.
function watchAdmin(page) {
  const calls = [];
  page.on("request", r => { const u = r.url(); if (!u.startsWith(CHAT() + "/admin/") || r.method() === "OPTIONS") return;
    let body = r.postData(); try { body = body ? JSON.parse(body) : null; } catch (e) {}
    const c = { method: r.method(), path: u.slice(CHAT().length), body, auth: r.headers().authorization || null, status: null }; calls.push(c);
    r.response().then(res => { c.status = res ? res.status() : 0; }, () => { c.status = 0; }); });
  return calls;
}
const posts = (calls, from = 0) => calls.slice(from).filter(c => c.method === "POST").map(c => ({ path: c.path, body: c.body, status: c.status }));
const answered = (calls, from, what) => soon(what, () => posts(calls, from).length > 0 && posts(calls, from).every(c => c.status !== null));
// Review id's card in the Drafts list, read: its heading, its lines (the surfer's answers, their note, how long it has waited, Reported,
// the status of a handled one, Bryan's Redo notes), its red warnings and red line, its key frames (caption, and whether the image is a blob
// URL), whether they wait behind Show anyway, its images, its edit boxes (value by path) and English copy (by path), its lines shown as
// they are, and its buttons; null when it isn't there.
const dcard = (page, id) => page.evaluate(id => { const c = document.querySelector(`.coachpanel .co-dr[data-id="${id}"]`); if (!c) return null;
  const t = s => { const e = c.querySelector(s); return e ? e.textContent : null; };
  return { head: t(".co-dr-h"), who: t(".co-dr-who"), note: t(".co-dr-note"), wait: t(".co-dr-wait"), rep: t(".co-dr-rep"), st: t(".co-dr-st"), redo: t(".co-dr-redo"),
    warn: [...c.querySelectorAll(".co-warn li")].map(e => e.textContent), err: t(".co-dr-err"),
    frames: [...c.querySelectorAll(".co-kf")].map(f => [f.querySelector("figcaption").textContent, !!f.querySelector('img[src^="blob:"]')]),
    hidden: !!c.querySelector(`[data-k="show-${id}"]`), imgs: [...c.querySelectorAll("img")].map(i => i.src.startsWith("blob:")),
    fields: Object.fromEntries([...c.querySelectorAll("textarea")].map(e => [e.getAttribute("data-k").slice(id.length + 4), e.value])),
    english: Object.fromEntries([...c.querySelectorAll(".co-en")].map(e => [e.getAttribute("data-p"), e.textContent])),
    lines: [...c.querySelectorAll(".co-part p")].map(e => e.textContent), handled: !!c.closest("details.co-dr-old"),
    acts: [...c.querySelectorAll(".co-dr-acts button, .co-ask button")].map(b => b.textContent) }; }, id);
// Waits for review id's card in the Drafts list, with what `want` says of it: blobs, that many key frames shown as blob URLs; handled,
// among the handled ones (or waiting); warn, that red warning; err, that red line. With want.gone, waits for it to be gone.
const hasCard = (page, id, what, want = {}) => until(page, what, ([id, w]) => { const c = document.querySelector(`.coachpanel .co-dr[data-id="${id}"]`);
  if (w.gone) return !c; if (!c) return false;
  return (w.blobs === undefined || c.querySelectorAll('.co-kf img[src^="blob:"]').length === w.blobs) && (w.handled === undefined || !!c.closest("details.co-dr-old") === w.handled)
    && (w.warn === undefined || [...c.querySelectorAll(".co-warn li")].some(l => l.textContent === w.warn)) && (w.err === undefined || (c.querySelector(".co-dr-err") || {}).textContent === w.err); },
  [id, want], 30e3);
// The Drafts list's line saying what was just done.
const dsaid = (page, t) => until(page, JSON.stringify(t), t => { const e = document.querySelector('.coachpanel [data-k="dsaid"]'); return !!e && e.textContent === t; }, t, 30e3);
// Asks for the Drafts list again (its Check again) and waits for the answer.
async function recheck(page, calls) {
  const gets = () => calls.filter(c => c.method === "GET" && c.path === "/admin/coach/drafts"), n = gets().length;
  await page.click('.coachpanel [data-k="drefresh"]');
  await soon("the Drafts list asked for again", () => gets().length > n && gets().every(c => c.status !== null)); await wait(200);
}

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
  // page says "Coach is full today. Try again tomorrow." over Send, the draft still in IndexedDB with all 12 key frames, the review's id
  // and every frame sent.
  async fullToday(s) {
    const tok = token("u-dan"); await agreeFor(tok);
    const page = await coachPage(s, tok), calls = watchCalls(page);
    await toCheck(page);
    const v = await valve(page, (m, p) => m === "POST" && /\/send$/.test(p));
    await page.click('.coachpanel [data-k="send"]'); await v.wait(1, "send");
    const old = await coachToday(JSON.stringify({ day: twDay(), n: 10 }));
    try {
      v.open();
      await until(page, "Coach is full today", t => { const e = document.querySelector(".coachpanel .co-said"), b = document.querySelector('.coachpanel [data-k="send"]');
        return !!e && e.textContent === t && !!b && !b.disabled; }, "Coach is full today. Try again tomorrow.", 30e3);
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
  // ---- The review (AI coach spec, "The review"), u-hal's. The fake AI answers with a heads-up about the bottom turn, and Bryan approves
  // it through the admin route with an edit that adds a progress line. In the list it's Ready; opened, it shows the move and the date,
  // What went well with its key frame and time, The main fix with its three, Your drill, the Heads-up with "Get a review of your bottom
  // turn", Progress, and "Reviewed by WaveSlave Coach (AI), checked by a person. Surf within your limits.", then Something wrong? and
  // Delete. Each key frame is a blob URL, fetched with the session token.
  async reviewEn(s) {
    const tok = token("u-hal"), g = FX.goodReply([1, 2, 3, 4, 5, 6, 7, 8], "en");
    aiReply = replyWith({ heads_up: { text: HEADS_EN, move: "bottom_turn" } });
    try { s.halEn = await sendReview(tok); } finally { aiReply = null; }
    await act(s.halEn, { action: "approve", edits: { progress: PROGRESS_EN } });
    const page = s.hal = await coachPage(s, tok), asks = [];
    page.on("request", r => { if (/\/coach\/reviews\/[\w-]{22}\/frames\/\d+$/.test(r.url()) && r.method() === "GET") asks.push([+r.url().split("/").pop(), r.headers().authorization]); });
    await openReview(page, s.halEn);
    const got = await reviewView(page), when = twDate().en;
    const want = { head: "Top turn", date: when, parts: [
      { h: "What went well", lines: [g.went_well.title, g.went_well.detail], frames: [["Key frame at 0:10.3", true]], button: null },
      { h: "The main fix", lines: [g.main_fix.title, "What's happening: " + g.main_fix.what, "Why it matters: " + g.main_fix.why],
        frames: [["Key frame at 0:11.5", true], ["Key frame at 0:11.8", true], ["Key frame at 0:12.0", true]], button: null },
      { h: "Your drill", lines: [g.drill.title, g.drill.how], frames: [], button: null },
      { h: "Heads-up", lines: [HEADS_EN], frames: [], button: "Get a review of your bottom turn" },
      { h: "Progress", lines: [PROGRESS_EN], frames: [], button: null }],
      foot: "Reviewed by WaveSlave Coach (AI), checked by a person. Surf within your limits.", acts: ["Something wrong?", "Delete"] };
    if (!eq(got, want)) throw new Error(`the review shows ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    const bearer = "Bearer " + tok;
    if (!eq(asks.map(a => a[0]).sort((a, b) => a - b), [1, 6, 7, 8]) || !asks.every(a => a[1] === bearer)) throw new Error(`the key frames were asked for as ${JSON.stringify(asks.map(a => [a[0], a[1] === bearer ? "the token" : a[1]]))}`);
  },
  // A review asked for in 中文 (u-hal's second top turn, so with a progress line from the AI, and a heads-up about the cutback), approved
  // as it is, opened in 中文: every part with its heading in 中文 and the review's own words, 「讓教練講評你的回切」 and the checked
  // footer in 中文.
  async reviewZh(s) {
    const tok = token("u-hal"), g = FX.goodReply([1, 2, 3, 4, 5, 6, 7, 8], "zh"), page = s.hal;
    aiReply = replyWith({ heads_up: { text: HEADS_ZH, move: "cutback" }, progress: PROGRESS_ZH }, { heads_up: { text: "Your back knee locks straight on your cutback." }, progress: "Better than last time." });
    try { s.halZh = await sendReview(tok, { lang: "zh" }); } finally { aiReply = null; }
    await act(s.halZh, { action: "approve" });
    await page.reload({ waitUntil: "load" }); await page.evaluate(() => setLang("zh")); await page.tap(TAB); await panelOpen(page);
    await openReview(page, s.halZh);
    const got = await reviewView(page);
    const want = { head: "頂部轉向", date: twDate().zh, parts: [
      { h: "做得好的地方", lines: [g.went_well.title, g.went_well.detail], frames: [["0:10.3 的關鍵影格", true]], button: null },
      { h: "主要修正", lines: [g.main_fix.title, "發生了什麼：" + g.main_fix.what, "為什麼重要：" + g.main_fix.why],
        frames: [["0:11.5 的關鍵影格", true], ["0:11.8 的關鍵影格", true], ["0:12.0 的關鍵影格", true]], button: null },
      { h: "你的練習", lines: [g.drill.title, g.drill.how], frames: [], button: null },
      { h: "提醒", lines: [HEADS_ZH], frames: [], button: "讓教練講評你的回切" },
      { h: "和上次相比", lines: [PROGRESS_ZH], frames: [], button: null }],
      foot: "由 WaveSlave 教練（AI）講評，並經真人檢查。在自己的能力範圍內衝浪。", acts: ["哪裡不對嗎？", "刪除"] };
    if (!eq(got, want)) throw new Error(`the 中文 review shows ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    await page.evaluate(() => setLang("en")); await page.click('.coachpanel [data-k="back"]');
  },
  // Autopilot (u-ivy): a review published at once, checked by no one, has the short footer, "Reviewed by WaveSlave Coach (AI). Surf within
  // your limits.", and no heads-up or progress.
  async reviewAuto(s) {
    const tok = token("u-ivy");
    await settings({ autopilot: true });
    try { s.ivyReview = await sendReview(tok, { want: "published" }); } finally { await settings({ autopilot: false }); }
    const page = await coachPage(s, tok); await openReview(page, s.ivyReview);
    const got = await reviewView(page);
    if (got.foot !== "Reviewed by WaveSlave Coach (AI). Surf within your limits." || !eq(got.parts.map(p => p.h), ["What went well", "The main fix", "Your drill"])) throw new Error(`the autopilot review shows ${JSON.stringify(got)}`);
  },
  // Bryan's own review (u-bryan's, approved in dot), opened in the panel: GET /coach/reviews/<id> gives him, the admin, the row (final,
  // frames, checked as 1) rather than the surfer's view, and the page draws it all the same: every part, its four key frames as blob
  // URLs, and the checked footer.
  async adminReview(s) {
    const t = token("u-bryan"), row = await coachApi(t, `/coach/reviews/${s.review}`), g = FX.goodReply([1, 2, 3, 4, 5, 6, 7, 8], "en");
    if (row.status !== 200 || !row.json || row.json.review !== undefined || row.json.checked !== 1 || !row.json.final || !Array.isArray(row.json.frames)) throw new Error(`the admin's GET /coach/reviews/<id> answered ${row.status} ${JSON.stringify(row.json && { review: row.json.review, checked: row.json.checked, final: !!row.json.final, frames: row.json.frames && row.json.frames.length })}`);
    const page = await s.open({ store: { "waveslave-chat-token": t } }); await page.tap(TAB); await panelOpen(page);
    await openReview(page, s.review);
    const got = await reviewView(page), want = { head: "Top turn", date: twDate().en, parts: [
      { h: "What went well", lines: [g.went_well.title, g.went_well.detail], frames: [["Key frame at 0:10.3", true]], button: null },
      { h: "The main fix", lines: [g.main_fix.title, "What's happening: " + g.main_fix.what, "Why it matters: " + g.main_fix.why],
        frames: [["Key frame at 0:11.5", true], ["Key frame at 0:11.8", true], ["Key frame at 0:12.0", true]], button: null },
      { h: "Your drill", lines: [g.drill.title, g.drill.how], frames: [], button: null }],
      foot: "Reviewed by WaveSlave Coach (AI), checked by a person. Surf within your limits.", acts: ["Something wrong?", "Delete"] };
    if (!eq(got, want)) throw new Error(`Bryan's own review shows ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  },
  // The heads-up's "Get a review of your bottom turn" starts New review with the bottom turn picked (ruling P12): the picker, then, once the
  // clip is chosen, the questions with the bottom turn already pressed.
  async headsUp(s) {
    const page = s.hal; await openReview(page, s.halEn);
    await page.click('.coachpanel [data-k="headsup"]'); await inPanel(page, "the picker", ".co-choose");
    if (await text(page, '[data-k="fh"]') !== "New review") throw new Error(`the heads-up's button opened ${JSON.stringify(await text(page, '[data-k="fh"]'))}`);
    await pick(page, clip()); await inPanel(page, "the questions", '[data-k="move-bottom_turn"]');
    const pressed = await page.$$eval('.coachpanel [data-k^="move-"][aria-pressed="true"]', b => b.map(x => x.getAttribute("data-k")));
    if (!eq(pressed, ["move-bottom_turn"])) throw new Error(`New review from the heads-up has ${JSON.stringify(pressed)} picked`);
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "Pick up where you left off?", ".co-resume");
    await page.click('.coachpanel [data-k="over"]'); await inPanel(page, "the picker", ".co-choose"); await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "New review", '[data-k="new"]');
  },
  // Something wrong? sends the review back with its line: the panel thanks the surfer and the list says Coach is reviewing; Bryan's
  // Drafts list has it waiting, reported, with the line. Something wrong? on a review that was reported meanwhile (elsewhere) answers
  // 409 state, and the panel goes back to the list, asked for again, where it's Coach is reviewing too (ruling P56). Bryan approves both
  // again.
  async reportReview(s) {
    const page = s.hal, tok = token("u-hal"), said = "The drill doesn't fit my board.";
    await openReview(page, s.halEn);
    await page.click('.coachpanel [data-k="wrong"]'); await page.fill('.coachpanel [data-k="wrongline"]', said); await page.click('.coachpanel [data-k="wrongsend"]');
    await until(page, "the thanks", t => { const e = document.querySelector('.coachpanel [data-k="said"]'); return !!e && e.textContent === t; }, "Thanks. We'll check this review again.");
    await until(page, "the review back with the coach", k => { const b = document.querySelector(`.coachpanel [data-k="${k}"]`), li = [...document.querySelectorAll(".coachpanel .co-list li")].find(l => /Top turn/.test(l.textContent) && !l.querySelector("button"));
      return !b && !!li && li.querySelector(".co-st").textContent === "Coach is reviewing"; }, "r-" + s.halEn);
    const back = (await draftsList()).waiting.find(r => r.id === s.halEn);
    if (!back || back.reported !== true || back.report !== said || back.status !== "drafted") throw new Error(`Bryan's Drafts have it as ${JSON.stringify(back && { status: back.status, reported: back.reported, report: back.report })}`);
    await openReview(page, s.halZh);
    const elsewhere = await coachApi(tok, `/coach/reviews/${s.halZh}/report`, { method: "POST", body: { line: "" } });
    if (elsewhere.status !== 200) throw new Error(`reporting it elsewhere answered ${elsewhere.status}`);
    await page.click('.coachpanel [data-k="wrong"]'); await page.click('.coachpanel [data-k="wrongsend"]');
    await until(page, "the list, both reviews back with the coach", () => !document.querySelector(".coachpanel .co-review")
      && [...document.querySelectorAll(".coachpanel .co-list li")].filter(l => /Top turn/.test(l.textContent) && !l.querySelector("button") && l.querySelector(".co-st").textContent === "Coach is reviewing").length === 2);
    for (const id of [s.halEn, s.halZh]) await act(id, { action: "approve" });
  },
  // Delete asks first ("Delete this review? It and its key frames are deleted from WaveSlave."); Cancel keeps it, and Delete removes the
  // review and its key frames from the backend: the panel says "Review deleted." and the list no longer has it.
  async deleteReview(s) {
    const page = s.hal, tok = token("u-hal");
    await page.reload({ waitUntil: "load" }); await page.tap(TAB); await panelOpen(page); await openReview(page, s.halEn);
    await page.click('.coachpanel [data-k="del"]'); await inPanel(page, "Delete's question", '[data-k="delyes"]');
    const ask = await text(page, ".co-ask p");
    if (ask !== "Delete this review? It and its key frames are deleted from WaveSlave.") throw new Error(`Delete asks ${JSON.stringify(ask)}`);
    await page.click('.coachpanel [data-k="delno"]'); await inPanel(page, "the review's buttons", '[data-k="del"]');
    if ((await coachApi(tok, `/coach/reviews/${s.halEn}`)).status !== 200) throw new Error("Cancel deleted the review");
    await page.click('.coachpanel [data-k="del"]'); await page.click('.coachpanel [data-k="delyes"]');
    await until(page, "Review deleted", t => { const e = document.querySelector('.coachpanel [data-k="said"]'); return !!e && e.textContent === t; }, "Review deleted.");
    const rows = await page.$$eval(".coachpanel .co-list button", b => b.map(x => x.getAttribute("data-k")));
    const gone = [(await coachApi(tok, `/coach/reviews/${s.halEn}`)).status, (await coachApi(tok, `/coach/reviews/${s.halEn}/frames/1`)).status];
    if (rows.includes("r-" + s.halEn) || !rows.includes("r-" + s.halZh) || !eq(gone, [404, 404])) throw new Error(`after Delete the list has ${JSON.stringify(rows)}, the backend answers ${gone}`);
  },
  // ---- The backend's refusals at send (AI coach spec, "When something goes wrong"), each with its message on the check screen and Send
  // there again (u-kim's account, one clip): Bryan's Pause (503 break), a money rest (meta rest, until a day ahead: "Coach is resting until
  // <that Taiwan day>."), a review already with the coach (409 in_progress), a flagged clip (403 blocked; the list then says "We couldn't
  // review this clip." and the panel that no reviews are left), and once Bryan clears it, no reviews left (429 no_reviews_left, naming the
  // server's month and the next). The draft keeps its key frames all along. (The day's count starts again with the rest's end, as the
  // checks before have sent nearly the coach's 10 a day.)
  async refusals(s) {
    const tok = token("u-kim"); await agreeFor(tok);
    const page = s.kim = await coachPage(s, tok), calls = watchCalls(page), m = twMonth();
    await toCheck(page);
    const refused = async (what, status, said) => { const n = startsOf(calls).length;
      await page.click('.coachpanel [data-k="send"], .coachpanel [data-k="retry"]');
      await soon(`the start for ${what}`, () => startsOf(calls).length > n);
      await until(page, what, t => { const e = document.querySelector(".coachpanel .co-said"), b = document.querySelector('.coachpanel [data-k="send"]'); return !!e && e.textContent === t && !!b && !b.disabled; }, said, 30e3);
      const got = startsOf(calls).slice(n).map(c => c.status); if (got[got.length - 1] !== status) throw new Error(`${what}: the start answered ${JSON.stringify(got)}, want ${status}`); };
    await settings({ paused: true });
    try { await refused("a break", 503, "Coach is taking a break. Try again later."); } finally { await settings({ paused: false }); }
    const ends = Date.now() + 5 * DAY, d = new Date(ends + 8 * 3600e3), y = new Date(Date.now() + 8 * 3600e3).getUTCFullYear();
    const day = `${d.getUTCDate()} ${d.toLocaleString("en", { month: "long", timeZone: "UTC" })}${d.getUTCFullYear() !== y ? " " + d.getUTCFullYear() : ""}`;
    await coachMeta("rest", JSON.stringify({ kind: "limit", until: ends, probe_at: null }));
    try { await refused("a money rest", 503, `Coach is resting until ${day}.`); }
    finally { await coachMeta("rest", "null", { today: JSON.stringify({ day: twDay(), n: 0 }) }); }
    const first = await sendReview(tok);
    await refused("a review with the coach", 409, "Your last review is still with the coach.");
    await act(first, { action: "approve" });
    aiReply = replyWith({ sexual_content: true });
    try { s.kimFlagged = await sendReview(tok, { want: "rejected" }); } finally { aiReply = null; }
    await refused("a flagged clip", 403, "This account can't use the coach.");
    const next = new Date(Date.UTC(new Date(Date.now() + 8 * 3600e3).getUTCFullYear(), m.n, 1)).toLocaleString("en", { month: "long", timeZone: "UTC" });
    const none = `You've used your 2 reviews for ${m.name}. More on ${next} 1.`;
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "Pick up where you left off?", ".co-resume");
    await until(page, "the flagged review in the list", k => { const li = [...document.querySelectorAll(".coachpanel .co-list li")].find(l => l.querySelector(".co-st-not_reviewed"));
      return !!li && li.querySelector(".co-rnote").textContent === k; }, "We couldn't review this clip.");
    const why = await text(page, ".co-why");
    if (why !== none) throw new Error(`with no reviews left the panel says ${JSON.stringify(why)}, want ${JSON.stringify(none)}`);
    await act(s.kimFlagged, { action: "clear" });
    await page.click('.coachpanel [data-k="pickup"]'); await inPanel(page, "the check screen", ".co-grid");
    await refused("no reviews left", 429, none);
    const kept = await draft(page);
    if (!kept || kept.frames.length !== 12 || kept.id !== null) throw new Error(`after the refusals the draft is ${JSON.stringify(kept && { frames: kept.frames.length, id: kept.id })}`);
  },
  // A sign-in that has gone (signed out everywhere): Send answers 401, the page hands the token back (CHAT.token(old)) and shows Sign in
  // with LINE, and the draft stays in IndexedDB with its 12 key frames.
  async refusedAuth(s) {
    const page = s.kim, tok = token("u-kim");
    const out = await fetch(CHAT() + "/me/signout", { method: "POST", headers: { Origin: ORIGIN(), Authorization: "Bearer " + tok } });
    if (out.status !== 200) throw new Error(`signing out answered ${out.status}`);
    await page.click('.coachpanel [data-k="send"]'); await inPanel(page, "Sign in with LINE", ".co-signin", 30e3);
    const st = await page.evaluate(() => localStorage.getItem("waveslave-chat-token")), d = await draft(page);
    if (st !== null || !d || d.account !== "u-kim" || d.frames.length !== 12 || !d.frames.every(f => f.blob > 0)) throw new Error(`after a 401 at send: the token ${st === null ? "gone" : "kept"}, the draft ${JSON.stringify(d && { account: d.account, frames: d.frames.length })}`);
  },
  // A banned account (Bryan's Ban, on u-ivy's review): the ban ends its sign-ins (its token version goes up), so a page signed in with
  // the old token shows Sign in with LINE; with a token of the new version GET /coach/me answers 403 banned, and the panel says "This
  // account can't use the coach." with no Try again.
  async banned(s) {
    await act(s.ivyReview, { action: "ban" });
    let page = await s.open({ store: { "waveslave-chat-token": token("u-ivy") } }); await page.tap(TAB); await panelOpen(page);
    await inPanel(page, "Sign in with LINE", ".co-signin");
    page = await s.open({ store: { "waveslave-chat-token": token("u-ivy", 1) } }); await page.tap(TAB); await panelOpen(page);
    await until(page, "the banned line", t => { const e = document.querySelector(".coachpanel .co-err"); return !!e && e.textContent === t; }, "This account can't use the coach.");
    if (await page.$('.coachpanel [data-k="retry"]') || await page.$(".coachpanel .co-left")) throw new Error("a banned account gets Try again or the count");
  },
  // ---- Bryan's Drafts (AI coach spec, "The Drafts list"), against the real backend, in developer mode (where the coach shows until
  // go-live). A surfer never sees it, even in developer mode: their panel has no Drafts, and the page asks none of Bryan's routes.
  async draftsHidden(s) {
    const page = await s.open({ pub: false, go: false, store: { "waveslave-chat-token": await s.surfer.evaluate(() => CHAT.token()), "waveslave-world": "1" } }), calls = watchAdmin(page);
    await s.go(page); await page.tap(TAB); await panelOpen(page);
    await until(page, "the surfer's panel, signed in", () => !!document.querySelector(".coachpanel .co-left")); await wait(1000);
    const st = await page.evaluate(() => ({ world: WORLD, drafts: !!document.querySelector(".coachpanel .co-drafts") }));
    if (!st.world || st.drafts || calls.length) throw new Error(`a surfer's panel in developer mode: ${JSON.stringify(st)}, asking ${JSON.stringify(calls.map(c => c.path))}`);
  },
  // Bryan's list: the drafts the New review flow made (flowEn's, in English, and flowZh's, in 中文) wait in it, in the backend's order
  // (waiting longest first), each with its move, the surfer's answers and note, how long it has waited, its 12 key frames with their times
  // (what went well's and the main fix's marked), and its text in edit boxes, the 中文 one with its English copy beside each. In 中文 the
  // list speaks 中文. Editing one line and approving sends only that edit: the review is published with it, checked, and its card goes
  // among the handled ones.
  async draftsList(s) {
    const surfer = await s.surfer.evaluate(() => CHAT.token()), en = (await coachApi(surfer, "/coach/me")).json.reviews[0].id, zh = (await coachApi(token("u-ana"), "/coach/me")).json.reviews[0].id;
    const list = await draftsList(), row = id => list.waiting.find(r => r.id === id);
    if (!row(en) || !row(zh)) throw new Error(`the Drafts list has ${JSON.stringify(list.waiting.map(r => r.id))}, without flowEn's ${en} or flowZh's ${zh}`);
    s.zhDraft = zh; s.admin = await draftsPage(s); const { page, calls } = s.admin;
    for (const id of [en, zh]) await hasCard(page, id, "a draft's 12 key frames", { blobs: 12 });
    const order = await page.$$eval(".coachpanel .co-drafts > .co-dr", a => a.map(x => x.getAttribute("data-id")));
    if (!eq(order, list.waiting.map(r => r.id))) throw new Error(`the list's order is ${JSON.stringify(order)}, the backend's ${JSON.stringify(list.waiting.map(r => r.id))}`);
    for (const [id, lang] of [[en, "en"], [zh, "zh"]]) {
      const r = row(id), d = r.draft, got = await dcard(page, id), mark = n => (n === d.went_well.frame ? " · went well" : "") + (d.main_fix.frames.includes(n) ? " · main fix" : "");
      const want = { head: "Top turn", who: `Starting to turn · Shortboard · Goofy · ${lang === "en" ? "English" : "中文"}`, note: lang === "en" ? "Their note: “Trying to make my carve better.”" : null,
        warn: [], frames: TIMES.map((ms, i) => [fmt(ms) + mark(i + 1), true]), fields: Object.fromEntries(PATHS.map(p => [p, at(d, p)])),
        english: lang === "zh" ? Object.fromEntries(PATHS.filter(p => at(r.english, p).trim()).map(p => [p, "English: " + at(r.english, p)])) : {}, acts: ["Approve", "Redo", "Reject", "Ban"] };
      const have = Object.fromEntries(Object.keys(want).map(k => [k, got[k]]));
      if (!eq(have, want)) throw new Error(`the ${lang} draft shows ${JSON.stringify(have)}, want ${JSON.stringify(want)}`);
      if (!/^waiting \d+ (min|h)$/.test(got.wait || "")) throw new Error(`the ${lang} draft says ${JSON.stringify(got.wait)}`);
    }
    await page.evaluate(() => setLang("zh"));
    await until(page, "the Drafts list in 中文", () => { const h = document.querySelector(".coachpanel .co-drafts h3"); return !!h && h.textContent === "草稿"; });
    const z = await dcard(page, zh);
    if (z.head !== "頂部轉向" || !eq(z.acts, ["核准", "重寫", "退回", "封鎖"]) || !Object.values(z.english).every(t => t.startsWith("英文：")) || !/^已等 \d+ (分鐘|小時)$/.test(z.wait || ""))
      throw new Error(`the 中文 draft in 中文: ${JSON.stringify({ head: z.head, acts: z.acts, english: z.english, wait: z.wait })}`);
    await page.evaluate(() => setLang("en"));
    const title = "Low and ready, both knees bent", from = calls.length;
    await page.fill(`.coachpanel [data-k="ed-${en}-went_well.title"]`, title); await page.click(`.coachpanel [data-k="act-${en}-approve"]`);
    await dsaid(page, "Published."); await answered(calls, from, "the approval's answer");
    const sent = posts(calls, from);
    if (!eq(sent, [{ path: `/admin/coach/drafts/${en}`, body: { action: "approve", edits: { "went_well.title": title } }, status: 200 }])) throw new Error(`Approve sent ${JSON.stringify(sent)}`);
    const pub = (await coachApi(surfer, `/coach/reviews/${en}`)).json, text = pub && pub.review && pub.review.text;
    if (!text || pub.status !== "published" || pub.review.checked !== true || text.went_well.title !== title || !PATHS.filter(p => p !== "went_well.title").every(p => at(text, p) === at(row(en).draft, p)))
      throw new Error(`the surfer's review after Approve: ${JSON.stringify(pub)}`);
    await hasCard(page, en, "the approved card among the handled ones", { handled: true });
    const st = (await dcard(page, en)).st;
    if (!/^Published · /.test(st || "")) throw new Error(`the approved card says ${JSON.stringify(st)}`);
  },
  // A draft whose every line and the surfer's note hold markup (u-dan's; the fake AI's answer also says the coach couldn't see the surfer,
  // marks key frame 2 unusable and uses a word surfers mustn't read) shows it all as text, in its edit boxes: no element is added (no image
  // but its 8 key frames, no script) and nothing runs. Its red warnings say what the coach found, and key frame 2 is marked unusable.
  // Reject needs a note: without one nothing is sent and the card says so; with one it's rejected with that note, which the surfer sees,
  // and given back.
  async draftsMarkup(s) {
    const tok = token("u-dan"), { page, calls } = s.admin;
    aiReply = r => { const m = FX.goodReply(FX.sentOf(r.body), "en"); m.can_see_surfer = false; m.unusable_frames = [2];
      for (const p of PATHS.filter(p => p !== "progress")) put(m, p, `${MARKUP} ${p}`); m.drill.how += " Keep the photo."; return FX.apiMessage(m); };
    let id; try { id = await sendReview(tok, { note: MARKUP }); } finally { aiReply = null; }
    await recheck(page, calls); await hasCard(page, id, "u-dan's draft with its 8 key frames", { blobs: 8 });
    const r = (await draftsList()).waiting.find(x => x.id === id), got = await dcard(page, id);
    const want = { note: `Their note: “${MARKUP}”`, fields: Object.fromEntries(PATHS.map(p => [p, at(r.draft, p)])), imgs: Array(8).fill(true),
      warn: ["The coach couldn't see the surfer.", "The coach marked key frames as unusable.", "It used a word surfers shouldn't see. Find it and change it before you approve."] };
    const have = Object.fromEntries(Object.keys(want).map(k => [k, got[k]]));
    if (!eq(have, want) || !PATHS.filter(p => p !== "progress").every(p => got.fields[p].startsWith(MARKUP))) throw new Error(`the markup draft shows ${JSON.stringify(have)}, want ${JSON.stringify(want)}`);
    if (got.frames[1][0] !== fmt(10500) + " · unusable") throw new Error(`key frame 2 says ${JSON.stringify(got.frames[1])}`);
    const ran = await page.evaluate(() => ({ xss: window.__xss || null, scripts: document.querySelectorAll(".coachpanel script, .coachpanel b").length }));
    if (ran.xss || ran.scripts) throw new Error(`the markup ran or made elements: ${JSON.stringify(ran)}`);
    const from = calls.length, note = "We couldn't see you. Try filming closer.";
    await page.click(`.coachpanel [data-k="act-${id}-reject"]`); await inPanel(page, "Reject's note", `[data-k="note-${id}"]`);
    await page.click(`.coachpanel [data-k="yes-${id}"]`); await wait(500);
    const need = await text(page, `.co-dr[data-id="${id}"] .co-ask .co-err`);
    if (need !== "Write a short note first." || posts(calls, from).length) throw new Error(`Reject without a note says ${JSON.stringify(need)}, sent ${JSON.stringify(posts(calls, from))}`);
    await page.fill(`.coachpanel [data-k="note-${id}"]`, note); await page.click(`.coachpanel [data-k="yes-${id}"]`);
    await dsaid(page, "Rejected. The surfer gets your note and the review back."); await answered(calls, from, "the rejection's answer");
    if (!eq(posts(calls, from), [{ path: `/admin/coach/drafts/${id}`, body: { action: "reject", note }, status: 200 }])) throw new Error(`Reject sent ${JSON.stringify(posts(calls, from))}`);
    const me = (await coachApi(tok, "/coach/me")).json, mine = me.reviews.find(x => x.id === id);
    if (!mine || mine.status !== "not_reviewed" || mine.note !== note || me.left !== 2) throw new Error(`u-dan after Reject: ${JSON.stringify({ left: me.left, review: mine })}`);
  },
  // Redo needs a note too (u-ben's draft). A Redo with a note goes to the coach; the fake AI answering 400 this time, the draft comes back
  // as it was with a red "Redo failed", and Bryan's note listed. A second Redo comes back as a new draft, without it. A third is refused
  // (409 redo_limit): a red line on the draft.
  async draftsRedo(s) {
    const { page, calls } = s.admin, id = (await coachApi(token("u-ben"), "/coach/me")).json.reviews.find(r => r.status === "reviewing").id;
    const back = async (what, test) => { await soon(what, async () => test((await draftsList()).waiting.find(x => x.id === id))); await recheck(page, calls); };
    const redo = async (note, status) => { const from = calls.length;
      await page.click(`.coachpanel [data-k="act-${id}-redo"]`); await inPanel(page, "Redo's note", `[data-k="note-${id}"]`);
      await page.fill(`.coachpanel [data-k="note-${id}"]`, note); await page.click(`.coachpanel [data-k="yes-${id}"]`); await answered(calls, from, "the Redo's answer");
      if (!eq(posts(calls, from), [{ path: `/admin/coach/drafts/${id}`, body: { action: "redo", note }, status }])) throw new Error(`Redo sent ${JSON.stringify(posts(calls, from))}`); };
    let from = calls.length;
    await page.click(`.coachpanel [data-k="act-${id}-redo"]`); await inPanel(page, "Redo's note", `[data-k="note-${id}"]`); await page.click(`.coachpanel [data-k="yes-${id}"]`); await wait(500);
    const need = await text(page, `.co-dr[data-id="${id}"] .co-ask .co-err`);
    if (need !== "Write a short note first." || posts(calls, from).length) throw new Error(`Redo without a note says ${JSON.stringify(need)}, sent ${JSON.stringify(posts(calls, from))}`);
    await page.click(`.coachpanel [data-k="no-${id}"]`); await inPanel(page, "the draft's buttons again", `[data-k="act-${id}-redo"]`);
    aiReply = () => ({ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "A test refusal." } } });
    try { await redo("Focus on the back foot.", 200); await dsaid(page, "Sent to the coach for a Redo. Check again in a minute.");
      await back("the failed Redo back", r => !!r && r.redos === 1 && r.warnings.includes("redo_failed")); } finally { aiReply = null; }
    await hasCard(page, id, "Redo failed on the draft", { warn: "Redo failed: this is the draft from before." });
    let c = await dcard(page, id);
    if (c.redo !== "Your Redo notes: Focus on the back foot.") throw new Error(`after a failed Redo the draft says ${JSON.stringify(c.redo)}`);
    await redo("Look at the front knee.", 200);
    await back("the second Redo's new draft", r => !!r && r.redos === 2 && !r.warnings.includes("redo_failed"));
    await hasCard(page, id, "the new draft"); c = await dcard(page, id);
    if (c.warn.length || c.redo !== "Your Redo notes: Focus on the back foot. · Look at the front knee.") throw new Error(`after the second Redo the draft says ${JSON.stringify({ warn: c.warn, redo: c.redo })}`);
    await redo("One more look.", 409);
    await hasCard(page, id, "the red line", { err: "No more Redo: this review has had its 2." });
  },
  // Ban asks first: the question, and Cancel sends nothing. Ban there bans the account (u-cho's): its draft is rejected and leaves the
  // list, and its sign-in no longer works.
  async draftsBan(s) {
    const { page, calls } = s.admin, id = (await coachApi(token("u-cho"), "/coach/me")).json.reviews[0].id, from = calls.length;
    await page.click(`.coachpanel [data-k="act-${id}-ban"]`); await inPanel(page, "Ban's question", `[data-k="yes-${id}"]`);
    const q = await text(page, `.co-dr[data-id="${id}"] .co-ask p`);
    if (q !== BAN_ASK || posts(calls, from).length) throw new Error(`Ban asks ${JSON.stringify(q)}, sent ${JSON.stringify(posts(calls, from))}`);
    await page.click(`.coachpanel [data-k="no-${id}"]`); await inPanel(page, "the draft's buttons again", `[data-k="act-${id}-ban"]`);
    if (posts(calls, from).length) throw new Error(`Cancel sent ${JSON.stringify(posts(calls, from))}`);
    await page.click(`.coachpanel [data-k="act-${id}-ban"]`); await page.click(`.coachpanel [data-k="yes-${id}"]`);
    await dsaid(page, "Banned."); await answered(calls, from, "the ban's answer");
    if (!eq(posts(calls, from), [{ path: `/admin/coach/drafts/${id}`, body: { action: "ban" }, status: 200 }])) throw new Error(`Ban sent ${JSON.stringify(posts(calls, from))}`);
    if ((await coachApi(token("u-cho"), "/coach/me")).status !== 401 || (await draftsList()).waiting.some(r => r.id === id)) throw new Error("after Ban the account still signs in, or its draft still waits");
  },
  // A clip the fake AI finds isn't surfing (u-fay's) waits with its red warning, its key frames hidden behind Show anyway and none of them
  // asked for until then; Show anyway shows them, and Give back gives the review back. A flagged one (u-gus's, sexual content) shows only
  // its warnings: no key frames (none asked for), no text, no Show anyway; Clear lifts the account's block.
  async draftsHeld(s) {
    const { page, calls } = s.admin, asked = [];
    page.on("request", r => { if (r.method() === "GET" && /\/frames\/\d+$/.test(r.url())) asked.push(r.url()); });
    let fay, gus;
    aiReply = replyWith({ is_surf_clip: false }); try { fay = await sendReview(token("u-fay"), { want: "rejected" }); } finally { aiReply = null; }
    aiReply = replyWith({ sexual_content: true }); try { gus = await sendReview(token("u-gus"), { want: "rejected" }); } finally { aiReply = null; }
    await recheck(page, calls); await hasCard(page, fay, "u-fay's clip"); await hasCard(page, gus, "u-gus's clip"); await wait(1000);
    const f = await dcard(page, fay), g = await dcard(page, gus);
    const pick = (c, ks) => Object.fromEntries(ks.map(k => [k, c[k]]));
    if (!eq(pick(f, ["warn", "imgs", "hidden", "acts"]), { warn: ["The coach thinks this isn't a surf clip."], imgs: [], hidden: true, acts: ["Give back", "Ban"] }) || asked.some(u => u.includes(fay)))
      throw new Error(`the not-surf clip shows ${JSON.stringify(f)}, its key frames asked for ${asked.filter(u => u.includes(fay)).length} times`);
    const flagged = { warn: ["Flagged: sexual content.", FLAGGED], imgs: [], hidden: false, fields: {}, lines: [], acts: ["Clear", "Ban"] };
    if (!eq(pick(g, Object.keys(flagged)), flagged) || asked.some(u => u.includes(gus))) throw new Error(`the flagged clip shows ${JSON.stringify(g)}, its key frames asked for ${asked.filter(u => u.includes(gus)).length} times`);
    await page.click(`.coachpanel [data-k="show-${fay}"]`); await hasCard(page, fay, "u-fay's 8 key frames", { blobs: 8 });
    let from = calls.length;
    await page.click(`.coachpanel [data-k="act-${fay}-giveback"]`); await dsaid(page, "Given back."); await answered(calls, from, "Give back's answer");
    if (!eq(posts(calls, from), [{ path: `/admin/coach/drafts/${fay}`, body: { action: "giveback" }, status: 200 }]) || (await coachApi(token("u-fay"), "/coach/me")).json.left !== 2)
      throw new Error(`Give back sent ${JSON.stringify(posts(calls, from))}`);
    from = calls.length;
    await page.click(`.coachpanel [data-k="act-${gus}-clear"]`); await dsaid(page, "Cleared. The account can send reviews again."); await answered(calls, from, "Clear's answer");
    const h = (await draftsList()).handled.find(r => r.id === gus);
    if (!eq(posts(calls, from), [{ path: `/admin/coach/drafts/${gus}`, body: { action: "clear" }, status: 200 }]) || !h || h.hold !== 0 || h.profile.blocked) throw new Error(`Clear sent ${JSON.stringify(posts(calls, from))}`);
  },
  // A review the surfer reported (u-hal's 中文 one) comes back marked Reported, with their line. Withdraw needs a note, and takes it down
  // with it: the surfer sees the note.
  async draftsReported(s) {
    const { page, calls } = s.admin, id = s.halZh, said = "The drill doesn't fit my board.", note = "Sorry, this one missed. It's given back.";
    if ((await coachApi(token("u-hal"), `/coach/reviews/${id}/report`, { method: "POST", body: { line: said } })).status !== 200) throw new Error("the report was refused");
    await recheck(page, calls); await hasCard(page, id, "the reported review", { handled: false });
    const c = await dcard(page, id);
    if (c.rep !== `Reported: “${said}”` || !eq(c.acts, ["Approve", "Redo", "Withdraw", "Ban"])) throw new Error(`the reported review shows ${JSON.stringify({ rep: c.rep, acts: c.acts })}`);
    const from = calls.length;
    await page.click(`.coachpanel [data-k="act-${id}-withdraw"]`); await page.click(`.coachpanel [data-k="yes-${id}"]`); await wait(500);
    if (await text(page, `.co-dr[data-id="${id}"] .co-ask .co-err`) !== "Write a short note first." || posts(calls, from).length) throw new Error("Withdraw went without a note");
    await page.fill(`.coachpanel [data-k="note-${id}"]`, note); await page.click(`.coachpanel [data-k="yes-${id}"]`);
    await dsaid(page, "Withdrawn. The surfer gets your note and the review back."); await answered(calls, from, "Withdraw's answer");
    const r = (await coachApi(token("u-hal"), `/coach/reviews/${id}`)).json;
    if (!eq(posts(calls, from), [{ path: `/admin/coach/drafts/${id}`, body: { action: "withdraw", note }, status: 200 }]) || r.status !== "rejected" || r.note !== note) throw new Error(`Withdraw: ${JSON.stringify(r)}`);
  },
  // A draft that changed elsewhere (u-ana's, approved meanwhile through the route): Reject on the list as it was answers 409 state, a red
  // line on the card, and the list is asked again, the card now among the handled ones.
  async draftsState(s) {
    const { page, calls } = s.admin, id = s.zhDraft;
    await hasCard(page, id, "u-ana's draft, waiting", { handled: false });
    await act(id, { action: "approve" });
    const from = calls.length;
    await page.click(`.coachpanel [data-k="act-${id}-reject"]`); await page.fill(`.coachpanel [data-k="note-${id}"]`, "Too late."); await page.click(`.coachpanel [data-k="yes-${id}"]`);
    await answered(calls, from, "the stale Reject's answer");
    if (!eq(posts(calls, from), [{ path: `/admin/coach/drafts/${id}`, body: { action: "reject", note: "Too late." }, status: 409 }])) throw new Error(`the stale Reject: ${JSON.stringify(posts(calls, from))}`);
    await hasCard(page, id, "the red line on the handled card", { handled: true, err: "This review changed meanwhile. Here it is as it is now." });
  },
  // Review Focus 4 in the Drafts list (u-eve's draft): an edited line left empty sends nothing and says why; a line can't run past 1,000
  // characters; nine full lines of 1,000 中文 characters all go, and the review is published with them, the panel not scrolling sideways.
  async draftsLong(s) {
    const { page, calls } = s.admin, id = (await coachApi(token("u-eve"), "/coach/me")).json.reviews[0].id, box = p => `.coachpanel [data-k="ed-${id}-${p}"]`;
    let from = calls.length;
    await hasCard(page, id, "u-eve's draft", { handled: false });
    await page.fill(box("drill.title"), "   "); await page.click(`.coachpanel [data-k="act-${id}-approve"]`);
    await hasCard(page, id, "the empty line's red line", { err: "Each line needs 1 to 1,000 characters." }); await wait(300);
    if (posts(calls, from).length) throw new Error(`an empty line sent ${JSON.stringify(posts(calls, from))}`);
    const full = i => "浪".repeat(999) + i;
    await page.fill(box("progress"), "浪".repeat(1001));
    const cut = await page.$eval(box("progress"), e => [...e.value].length);
    if (cut !== 1000) throw new Error(`a line of 1,001 characters keeps ${cut}`);
    for (const [i, p] of PATHS.entries()) await page.fill(box(p), full(i));
    from = calls.length; await page.click(`.coachpanel [data-k="act-${id}-approve"]`);
    await dsaid(page, "Published."); await answered(calls, from, "the approval's answer");
    const sent = posts(calls, from), edits = Object.fromEntries(PATHS.map((p, i) => [p, full(i)]));
    if (sent.length !== 1 || sent[0].status !== 200 || !eq(sent[0].body, { action: "approve", edits })) throw new Error(`Approve sent ${JSON.stringify(sent.map(c => [c.status, Object.keys(c.body.edits || {})]))}`);
    const text = (await coachApi(token("u-eve"), `/coach/reviews/${id}`)).json.review.text;
    if (!PATHS.every((p, i) => at(text, p) === full(i))) throw new Error("the published review doesn't have the nine lines");
    await page.click(`.coachpanel [data-k="old-${id}"]`); await wait(300);
    const wide = await page.evaluate(() => { const b = document.querySelector(".coachpanel .co-body"); return b.scrollWidth - b.clientWidth; });
    if (wide > 0) throw new Error(`with the long lines open the panel scrolls ${wide} px sideways`);
  },
  // Settings: where the room and the coach run (GET /admin/where, asked once, with the session token); the credit month's spend and how
  // many of the last approved went without changes, as the backend counts them; Autopilot on and off; Pause, then Start again; Send a test
  // email, with Resend's answer. With the coach stopped (meta stopped) and a spend seeded, "Coach stopped: its key or model setting failed"
  // and Start again, which starts it; and "US$12.40 of US$78, 96 reviews".
  async draftsSettings(s) {
    const { page, calls } = await draftsPage(s), { creditMonth } = await import(path.join(ROOT, "chat", "src", "coach-rules.js"));
    const where = await fetch(CHAT() + "/admin/where", { headers: { Origin: ORIGIN(), Authorization: "Bearer " + token("u-bryan") } }), lines = where.status === 200 ? (await where.text()).trim().split("\n") : null;
    const whereLine = lines ? "Where it runs: " + lines.join("") : "Where it runs: couldn't ask. Close the panel and open it again in a minute.";
    await until(page, "the Where line", t => { const e = document.querySelector(".coachpanel .co-dr-where"); return !!e && e.textContent === t; }, whereLine);
    const wheres = calls.filter(c => c.path === "/admin/where"), kept = await page.evaluate(() => localStorage.getItem("waveslave-chat-token"));
    if (wheres.length !== 1 || wheres[0].method !== "GET" || !kept || wheres[0].auth !== "Bearer " + kept) throw new Error(`the page asked /admin/where ${JSON.stringify(wheres.map(c => ({ ...c, auth: c.auth === "Bearer " + kept ? "the token kept" : c.auth && "another" })))}`);
    const look = () => page.evaluate(() => { const q = s => { const e = document.querySelector(".coachpanel .co-dset " + s); return e ? e.textContent : null; };
      return { spend: q(".co-dr-spend"), unchanged: q(".co-dr-unch"), auto: q('[data-k="dauto"]'), pressed: (document.querySelector('.coachpanel [data-k="dauto"]') || { getAttribute: () => null }).getAttribute("aria-pressed"),
        pause: q('[data-k="dpause"]'), start: q('[data-k="dstart"]'), line: q(".co-dr-stop"), mail: q(".co-mail") }; });
    const st = (await draftsList()).settings, money = `US$${st.spend.usd.toFixed(2)} of US$${st.spend.stop}, ${st.spend.reviews} reviews`;
    let got = await look();
    const want = { spend: money, unchanged: `Approved without changes: ${st.unchanged.n} of the last ${st.unchanged.of}`, auto: "Autopilot: Off", pressed: "false", pause: "Pause the coach", start: null, line: null, mail: null };
    if (!eq(got, want)) throw new Error(`Settings show ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    const setting = async (k, body, what, test) => { const from = calls.length; await page.click(`.coachpanel [data-k="${k}"]`); await answered(calls, from, `${what}'s answer`);
      if (!eq(posts(calls, from), [{ path: "/admin/coach/settings", body, status: 200 }])) throw new Error(`${what} sent ${JSON.stringify(posts(calls, from))}`);
      await until(page, what, test); };
    await setting("dauto", { autopilot: true }, "Autopilot on", () => (document.querySelector('.coachpanel [data-k="dauto"]') || {}).textContent === "Autopilot: On");
    await setting("dauto", { autopilot: false }, "Autopilot off", () => (document.querySelector('.coachpanel [data-k="dauto"]') || {}).textContent === "Autopilot: Off");
    await setting("dpause", { paused: true }, "Pause", () => (document.querySelector(".coachpanel .co-dr-stop") || {}).textContent === "Paused: no new reviews and no AI calls.");
    got = await look();
    if (got.start !== "Start again" || got.pause !== null) throw new Error(`paused, Settings show ${JSON.stringify(got)}`);
    await setting("dstart", { paused: false }, "Start again after Pause", () => !!document.querySelector('.coachpanel [data-k="dpause"]') && !document.querySelector(".coachpanel .co-dr-stop"));
    const mails = ai.mails.length;
    await setting("dmail", { test_email: true }, "the test email", () => /^Resend answered 200: \{"id":"fake-mail-\d+"\}$/.test((document.querySelector(".coachpanel .co-mail") || {}).textContent || ""));
    if (ai.mails.length !== mails + 1 || ai.mails[mails].subject !== "WaveSlave Coach: test email") throw new Error(`the test email: ${JSON.stringify(ai.mails.slice(mails).map(m => m.subject))}`);
    if ((await draftsList()).settings.paused) throw new Error("Start again left the coach paused");
    const spend = JSON.stringify({ start: creditMonth(Date.now(), 16).start, usd: 12.4, reviews: 96 });
    const old = await coachMeta("stopped", "true", { spend });
    await recheck(page, calls);
    await until(page, "Coach stopped", () => (document.querySelector(".coachpanel .co-dr-stop") || {}).textContent === "Coach stopped: its key or model setting failed");
    got = await look();
    if (got.start !== "Start again" || got.pause !== null || got.spend !== "US$12.40 of US$78, 96 reviews") throw new Error(`stopped, Settings show ${JSON.stringify(got)}`);
    await setting("dstart", { start_again: true }, "Start again", () => !!document.querySelector('.coachpanel [data-k="dpause"]') && !document.querySelector(".coachpanel .co-dr-stop"));
    const after = (await draftsList()).settings;
    if (after.stopped || after.paused) throw new Error(`after Start again the coach is ${JSON.stringify({ stopped: after.stopped, paused: after.paused })} (meta stopped was ${old})`);
  },
};
const BAN_ASK = "Ban this account? This review and every open one of the account are rejected, nothing is given back, and the account is banned from the chat too.";
const FLAGGED = "Its key frames are deleted, and the account can't send another review until you clear it or ban it.";
const HEADS_EN = "On your bottom turn your back knee locks straight, which can hurt a knee.", PROGRESS_EN = "Your front knee stays bent longer than last time.";
const HEADS_ZH = "你回切時後膝打直，容易受傷。", PROGRESS_ZH = "比上次好：前膝彎得更久。";

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
