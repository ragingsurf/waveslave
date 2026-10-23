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
//   token is token("u-bryan"); pick(page, clip) gives the coach's clip picker a clip from tests/coach/clips.js (makeClip).
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
  // signIn() signs a page in through the chat with the fake LINE (a new account, so through the sign-up sheet), and the Coach panel
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
