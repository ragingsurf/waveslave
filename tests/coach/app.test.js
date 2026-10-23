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
//   runs the coach's sign-in (CHAT.signIn("coach")) to LINE and back, and landed(page) waits for the Coach panel with the room shut.
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
// The coach's sign-in (CHAT.signIn("coach"), which the Coach panel's Sign in with LINE calls), to LINE (approved at once, unless
// line.deny()) and back on the page's ?chat#c=… (or ?chat#e=… when ret says so). Resolves to where the backend sent the browser back to,
// once the page there has loaded.
async function coachTrip(page, ret = /\?chat#c=/) {
  let back = null; const seen = r => { if (r.url().startsWith(CHAT() + "/auth/line/callback")) back = r.headers().location || null; };
  page.on("response", seen);
  try { await Promise.all([page.waitForURL(u => u.href.startsWith(ORIGIN()) && ret.test(back || ""), { timeout: 20e3, waitUntil: "load" }), page.evaluate(() => { CHAT.signIn("coach"); })]); }
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
// Gives the coach's clip picker a clip (a path from makeClip), as the phone's own picker would. (The picker comes with New review.)
const pick = (page, clip) => page.setInputFiles('.coachpanel input[type="file"]', clip);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
  // The home-screen app finishing the coach's sign-in by itself (tests/chat/flow.test.js's autoPath, with then: "coach"). B starts it from
  // the Coach panel and is opened again (a reload, as after iOS closed the app), so its panel is shut; LINE finishes it in A, with no v, on
  // B's network (the same CF-Connecting-IP on A's return from LINE and on B's redeems). B signs itself in, the known account, with nothing
  // typed, only {v, auto: true} asked, and lands on the Coach panel with the room never built. A still shows the code.
  async coachAutoFinish(s) {
    const IP = { "cf-connecting-ip": "203.0.113.7" }, redeems = [];
    const b = await s.open({}); let start = null;
    await b.tap(TAB); await panelOpen(b);
    await b.route(`${CHAT()}/auth/line/start**`, r => { start = r.request().url(); return r.fulfill({ status: 204 }); });
    await b.route(`${CHAT()}/auth/redeem`, r => { if (r.request().method() === "POST") redeems.push(r.request().postDataJSON()); return r.continue({ headers: { ...r.request().headers(), ...IP } }); });
    await b.evaluate(() => { CHAT.signIn("coach"); });
    for (let i = 0; i < 50 && !start; i++) await wait(100);
    if (!start) throw new Error("CHAT.signIn(\"coach\") didn't start a sign-in");
    await b.reload({ waitUntil: "load" });
    await until(b, "the page again", () => { const f = document.querySelector(".chatfab"); return !!f && !!window.CHAT && !!window.COACH; });
    const before = await b.evaluate(() => ({ v: JSON.parse(localStorage.getItem("waveslave-chat-v") || "null"), coach: document.documentElement.classList.contains("coach-open"), room: !!document.querySelector(".chatroom") }));
    if (!before.v || before.v.then !== "coach" || before.coach || before.room) throw new Error(`opened again before LINE finished: ${JSON.stringify(before)}`);
    const a = await s.open({ go: false });
    await a.setExtraHTTPHeaders(IP); // on every request, the callback LINE redirects to included
    await a.goto(start, { waitUntil: "load" }); await a.waitForURL(u => u.href.startsWith(ORIGIN()), { waitUntil: "load" });
    await a.waitForSelector(".chatroom .cr-pin-code", { state: "attached" });
    await until(b, "the session token", () => !!localStorage.getItem("waveslave-chat-token"));
    await landed(b);
    const st = await signedInState(b);
    if (!st.token || st.v !== null || st.room || st.fab !== "none") throw new Error(`after finishing by itself: ${JSON.stringify(st)}`);
    if (!redeems.length || redeems.some(r => r.auto !== true || "pin" in r || "code" in r)) throw new Error(`B asked ${JSON.stringify(redeems.map(r => Object.keys(r).sort()))}`);
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
};

(async () => {
  let browser, bad = false, ctxs = [], errs = [];
  const s = {
    // A fresh context: the page, the backend, the fake LINE and the fake AI load, everything else is cut off. go: false leaves it on a
    // blank page.
    async open({ spot = "jinshan", go = true }) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: true });
      ctxs.push(ctx);
      await ctx.route("**/*", r => { const u = r.request().url(); return [ORIGIN(), CHAT(), line.url, ai.url].some(o => u.startsWith(o + "/")) ? r.continue() : r.abort(); });
      await ctx.addInitScript(([o, lock]) => {
        try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", "fc"); localStorage.setItem("waveslave-lang", "en"); localStorage.setItem("waveslave-world", "0");
          if (lock) sessionStorage.setItem("waveslave-unlock", lock); } catch (e) {}
        window.__chatUrl = o.url; window.__chatContact = o.contact; window.__chatPublic = true; window.__coachPublic = true; }, [{ url: CHAT(), contact: CONTACT }, LOCK]);
      const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e)));
      if (go) {
        await page.goto(`${ORIGIN()}/#${spot}`, { waitUntil: "load" });
        await page.waitForFunction(() => { const f = document.querySelector(".chatfab"); return !!f && getComputedStyle(f).display !== "none"; });
      }
      return page;
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
