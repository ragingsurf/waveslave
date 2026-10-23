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
//   token is token("u-bryan"); pick(page, clip) gives the coach's clip picker a clip from tests/coach/clips.js (makeClip); coachTrip(page)
//   runs the coach's sign-in (CHAT.signIn("coach"), or the panel's Sign in with LINE) to LINE and back, and landed(page) waits for the
//   Coach panel with the room shut; coachApi(token, path, …) calls the backend as the page does, and sendReview(token) sends a review
//   through it.
// Playwright wherever node finds it (npm install playwright), else the copy this container keeps.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { spawnSync } = require("child_process");
const { SECRETS, wait, start } = require("../chat/servers.js");

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
// Its session token is token("u-bryan"). Doing it again changes nothing.
const ADMIN = String.raw`
import json, sqlite3, sys
d = json.load(sys.stdin); c = sqlite3.connect(d["db"])
with c:
    c.execute("INSERT OR IGNORE INTO users (id, sub_hash, nick, nick_key, role, tv, created, last_seen, nick_changed, consent_at, consent_ver) VALUES (?, ?, ?, ?, 'admin', 0, ?, ?, NULL, ?, 'v1')",
              (d["id"], d["sub"], d["nick"], d["key"], d["created"], d["now"], d["created"]))
    c.execute("INSERT OR IGNORE INTO subs (sub_hash, banned) VALUES (?, 0)", (d["sub"],))
    c.execute("INSERT INTO meta (key, value) VALUES ('admin_uid', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", (d["id"],))
c.close()
`;
async function makeAdmin() {
  await srv.stopWrangler();
  const now = Date.now(), run = spawnSync("python3", ["-I", "-c", ADMIN], { encoding: "utf8",
    input: JSON.stringify({ db: srv.roomDb(), id: "u-bryan", sub: "sub-bryan", nick: "Bryan", key: "key-bryan", created: now - 40 * DAY, now }) });
  if (run.status !== 0) throw new Error("making u-bryan the admin failed: " + run.stderr);
  await srv.startWrangler();
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
// Gives the coach's clip picker a clip (a path from makeClip), as the phone's own picker would. (The picker comes with New review.)
const pick = (page, clip) => page.setInputFiles('.coachpanel input[type="file"]', clip);
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
};

(async () => {
  let browser, bad = false, ctxs = [], errs = [];
  const s = {
    // A fresh context: the page, the backend, the fake LINE and the fake AI load, everything else is cut off. go: false leaves it on a
    // blank page (s.go(page) opens it there). pub: false leaves the chat and the coach to developer mode, which is off; unlocked: false
    // leaves the World PIN out of this visit, and pin: true puts a stand-in for its box (web/head.html's wsPin) that only notes it was
    // asked (window.__pinAsked = {done, cancel}), as tests/chat/shell.test.js does; store is put in localStorage on every load; at is the
    // address to open, by default /#<spot>.
    async open({ spot = "jinshan", go = true, pub = true, unlocked = true, pin = false, store = {}, at = null }) {
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
      const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e)));
      page.at = at || `/#${spot}`; page.pub = pub;
      if (go) await s.go(page);
      return page;
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
