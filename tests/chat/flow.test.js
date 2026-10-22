// Browser checks of the Taiwan chat's whole signed-in flow (web/chat.js) against the real backend (chat/) and a fake LINE: sign in with LINE,
// sign up, post a message and a report, log a session and share it, unshare it, My sessions, Download my data, Sign out everywhere,
// Delete my account, and the home-screen app's pin path.
// Usage: node tests/chat/flow.test.js <page.html>   (a page built with tests/map/tool.py)
// Prints ok / FAIL for each step, and exits 1 on any FAIL or page error. The steps are one story, each building on the last, so after a FAIL
// the rest are skipped. It needs chat/'s node_modules (npm ci in chat/).
// - `wrangler dev` runs the Worker and the room with test secrets, ALLOWED_ORIGINS and APP_URL set to the page's origin, and
//   LINE_AUTH_URL and LINE_TOKEN_URL pointing at tests/chat/fake-line.mjs, which approves every sign-in at once for one LINE account.
//   `python3 -m http.server` serves the page with chat.js next to it, as the site does (both started by tests/chat/servers.js, as for
//   tests/chat/room.test.js).
// - Every page is a phone, 390x844, dpr 2, touch, reduced motion, English, Taiwan mode, the Forecast view, the intro done, in a fresh
//   context. The chat is switched on the way the tests do it (window.__chatUrl and window.__chatContact). Anything but the page, the
//   backend and the fake LINE is cut off.
// Playwright wherever node finds it (npm install playwright), else the copy this container keeps.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path");
const { SECRETS, wait, start } = require("./servers.js");

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: node tests/chat/flow.test.js <page.html>"); process.exit(2); }
const HTML = fs.readFileSync(file, "utf8");
const LOCK = (HTML.match(/\bH="([0-9a-f]{64})"/) || [])[1]; // a site build opens on the passcode screen: start unlocked
const CONTACT = { name: "Test Operator", email: "chat@example.com" };
const CHANNEL = SECRETS.LINE_CHANNEL_ID, LINE_SECRET = SECRETS.LINE_CHANNEL_SECRET;
// The spec's words for the sign-up sheet's tick and its line about what's public ("The room", First sign-in).
const CONSENT = "I'm 13 or older (under 18 with a parent's or guardian's OK), and I accept the house rules and the privacy note.";
const PUBLIC = "Your nickname, spot and time are public on reports and shared sessions.";
const NOTE = "Kept nosediving on takeoff", HELLO = "Hello from the flow test", LAST = "One more before I go";


// ---- The servers (tests/chat/servers.js), with the fake LINE.
let srv = null, line = null;
const ORIGIN = () => srv.origin, CHAT = () => srv.chat;
async function setUp() {
  const { startFakeLine } = await import(path.join(__dirname, "fake-line.mjs"));
  line = await startFakeLine({ channelId: CHANNEL, secret: LINE_SECRET });
  srv = await start({ file, name: "flow", line });
  await srv.startWrangler();
}
async function tearDown() { if (srv) await srv.tearDown(); if (line) await line.close(); }

// ---- Helpers on a page.
// Waits up to 15 s for fn(arg) in the page to come true, and says what it waited for when it doesn't.
const until = (page, what, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15e3 }).catch(async e => {
  const seen = await page.evaluate(() => { const q = c => document.querySelector(".chatroom " + c); return q(".cr-foot") && { note: q(".cr-note").textContent, status: q(".cr-status").textContent, box: q(".cr-in").value }; }).catch(() => null);
  throw new Error(`waited 15 s for ${what} (the room shows ${JSON.stringify(seen)}): ${e.message.split("\n")[0]}`); });
const texts = page => page.evaluate(() => [...document.querySelectorAll(".chatroom .cm-text")].map(p => p.textContent));
const roomLive = page => until(page, "the room to open and connect", () => document.documentElement.classList.contains("chat-open") && document.querySelector(".chatroom .cr-status").hidden);
const signedInBar = page => until(page, "the message box", () => { const i = document.querySelector(".chatroom .cr-in"); return !!i && !!i.getClientRects().length; });
const lineBar = page => until(page, "the LINE button", () => { const b = document.querySelector(".chatroom .cr-line"); return !!b && !!b.getClientRects().length && !document.querySelector(".chatroom .cr-in").getClientRects().length; });
const sheetTitle = page => page.evaluate(() => document.querySelector(".chatroom .cr-shade").hidden ? null : document.getElementById("chatSheetTitle").textContent);
// Sends a message from the box, 5 s after the last (the room's limit is one message per 5 s, and the steps run faster than that). Just
// after signing in the socket may still be starting again with the token, and the box keeps a text it couldn't send yet ("Chat is
// offline"), so it tries again for a few seconds.
let lastSay = 0;
const say = async (page, text) => {
  await wait(lastSay + 5500 - Date.now()); lastSay = Date.now();
  for (let i = 0; i < 20; i++) { await page.fill(".chatroom .cr-in", text); await page.press(".chatroom .cr-in", "Enter"); if (await page.inputValue(".chatroom .cr-in") === "") break; await wait(250); }
  await until(page, `"${text}" in the room`, t => [...document.querySelectorAll(".chatroom .cm-text")].some(p => p.textContent === t), text); };
async function mainMenu(page, item) {
  await page.click(".chatroom .cr-menu");
  await page.click(`.chatroom .cr-pop[role=menu] >> text=${item}`);
}
// Log in with LINE: the button, LINE (approved at once), and back to the page with the outcome in the fragment. Resolves to where the
// backend sent the browser back to, and what the address said once the page was ready.
async function lineLogin(page) {
  let back = null;
  const seen = r => { if (r.url().startsWith(CHAT() + "/auth/line/callback")) back = r.headers().location || null; };
  page.on("response", seen);
  try {
    await Promise.all([page.waitForURL(u => u.href.startsWith(ORIGIN()) && /chat/.test(back || ""), { timeout: 20e3, waitUntil: "load" }), page.click(".chatroom .cr-line")]);
    await roomLive(page);
    return { back, ready: await page.evaluate(() => window.__hrefAtReady), now: page.url() };
  } finally { page.off("response", seen); }
}

const STEPS = {
  // The signed-out bar is one LINE button in LINE's style: its green #06C755, its icon (the white bubble with LINE in green) and its words
  // in each language: Log in with LINE, 使用LINE帳號登入, LINEでログイン.
  async lineButton(s) {
    s.main = await s.open({ spot: "wushi" }); const page = s.main;
    s.wushi = await page.evaluate(() => ALL.spots.wushi.zh.name); // the cards name a spot in English and 中文: "Wushi 烏石港"
    await page.click(".chatfab"); await roomLive(page); await lineBar(page);
    const look = () => page.evaluate(() => { const b = document.querySelector(".chatroom .cr-line"), ico = b.querySelector("svg.cr-line-ico");
      return { bg: getComputedStyle(b).backgroundColor, fg: getComputedStyle(b).color, ico: !!ico && ico.querySelector("text").textContent, fill: ico && ico.querySelector("text").getAttribute("fill"),
        bubble: ico && ico.querySelector("path").getAttribute("fill"), word: b.querySelector(".cr-line-w").textContent }; });
    const want = { en: "Log in with LINE", zh: "使用LINE帳號登入", ja: "LINEでログイン" };
    await page.mouse.move(195, 300); // off the button (the CHAT button's tap left the pointer over it), so it shows its resting green
    for (const l of ["en", "zh", "ja"]) {
      await page.evaluate(l => setLang(l), l); const got = await look();
      if (got.bg !== "rgb(6, 199, 85)" || got.fg !== "rgb(255, 255, 255)" || got.ico !== "LINE" || got.fill !== "#06C755" || got.bubble !== "#fff" || got.word !== want[l])
        throw new Error(`in ${l} the LINE button is ${JSON.stringify(got)}`);
    }
    await page.evaluate(() => setLang("en"));
  },
  // LINE says no (the person tapped Cancel): back on the page the fragment is gone and the room says "Couldn't sign in with LINE, try again".
  async loginCancelled(s) {
    const page = s.main; line.deny();
    const r = await lineLogin(page);
    if (!/#e=access_denied$/.test(r.back || "")) throw new Error(`the backend sent the browser back to ${r.back}`);
    if (r.ready !== `${ORIGIN()}/#wushi` || r.now !== `${ORIGIN()}/#wushi`) throw new Error(`the address read ${r.ready} once the page was ready, and ${r.now} now`);
    const note = await page.textContent(".chatroom .cr-note");
    if (note !== "Couldn't sign in with LINE, try again") throw new Error(`the room says ${JSON.stringify(note)}`);
    if (await page.evaluate(() => localStorage.getItem("waveslave-chat-token"))) throw new Error("a cancelled sign-in left a token");
  },
  // Log in with LINE, come back: the code and pin are gone from the address before the page is even ready, the page is back on the spot
  // it left from (wushi, not the page's own default), and a new person gets the sign-up sheet: the nickname box holds the LINE name, the
  // tick says what the spec says, Join waits for the tick, and joining enters the room signed in.
  async signUp(s) {
    const page = s.main, r = await lineLogin(page);
    if (!/\?chat#c=[A-Za-z0-9_-]{22}&p=\d{6}$/.test(r.back || "")) throw new Error(`the backend sent the browser back to ${r.back}`);
    if (r.ready !== `${ORIGIN()}/#wushi` || r.now !== `${ORIGIN()}/#wushi` || await page.evaluate(() => CUR) !== "wushi") throw new Error(`the address read ${r.ready} once the page was ready, and ${r.now} now`);
    await page.waitForSelector('.chatroom .cr-sheet [data-k="nick"]');
    const sheet = await page.evaluate(() => { const b = document.querySelector(".chatroom .cr-sheet");
      return { title: document.getElementById("chatSheetTitle").textContent, nick: b.querySelector('[data-k="nick"]').value, tick: b.querySelector('[data-k="consent"]').checked,
        label: b.querySelector('[data-k="consent"]').closest("label").textContent, text: b.textContent, join: b.querySelector('[data-k="join"]').disabled }; });
    if (sheet.title !== "Welcome to the Taiwan chat" || sheet.nick !== line.name || sheet.tick || sheet.label.trim() !== CONSENT || !sheet.text.includes(PUBLIC) || !sheet.join)
      throw new Error(`the sign-up sheet is ${JSON.stringify(sheet)}`);
    await page.check('.chatroom .cr-sheet [data-k="consent"]');
    if (await page.isDisabled('.chatroom .cr-sheet [data-k="join"]')) throw new Error("ticked, Join is still off");
    await page.click('.chatroom .cr-sheet [data-k="join"]');
    await signedInBar(page);
    const after = await page.evaluate(() => ({ sheet: !document.querySelector(".chatroom .cr-shade").hidden, token: !!localStorage.getItem("waveslave-chat-token"), v: localStorage.getItem("waveslave-chat-v") }));
    if (after.sheet || !after.token || after.v !== null) throw new Error(`after Join: ${JSON.stringify(after)}`);
  },
  // A message goes in; a report goes in the room as a card and on the spot's strip at once, with no new /reports question.
  async messageAndReport(s) {
    const page = s.main; await say(page, HELLO);
    const nick = await page.evaluate(t => [...document.querySelectorAll(".chatroom article")].find(a => a.querySelector(".cm-text")?.textContent === t).querySelector(".cm-nick").textContent, HELLO);
    if (nick !== line.name) throw new Error(`the message shows as ${nick}`);
    const asked = []; const count = r => { if (r.url().startsWith(CHAT() + "/reports")) asked.push(r.url()); }; page.on("request", count);
    await page.click(".chatroom .cr-rep");
    await page.waitForSelector('.chatroom .cr-sheet [data-k="post"]');
    if (await page.getAttribute('.chatroom .cr-sheet [data-k="spot:wushi"]', "aria-pressed") !== "true") throw new Error("the report sheet isn't preset to the spot shown");
    if (!(await page.isDisabled('.chatroom .cr-sheet [data-k="post"]'))) throw new Error("Post is on before size, conditions and crowd are picked");
    for (const k of ["size:chest", "cond:clean", "crowd:few"]) await page.click(`.chatroom .cr-sheet [data-k="${k}"]`);
    await page.click('.chatroom .cr-sheet [data-k="post"]');
    await page.waitForFunction(() => [...document.querySelectorAll(".chatroom .cm-card .cm-big")].some(b => b.textContent === "Chest high · Clean · Few people"), null, { timeout: 15e3 });
    await page.waitForFunction(() => document.querySelector(".chatroom .cr-shade").hidden);
    const card = await page.evaluate(() => { const b = [...document.querySelectorAll(".chatroom .cm-card")].find(c => c.querySelector(".cm-big").textContent === "Chest high · Clean · Few people");
      return { cap: b.querySelector(".cm-cap").textContent, sub: b.querySelector(".cm-sub")?.textContent || null }; });
    if (card.cap !== `Surf report · Wushi ${s.wushi}` || !/^Forecast said /.test(card.sub || "")) throw new Error(`the report card reads ${JSON.stringify(card)}`);
    const chips = await page.evaluate(() => [...document.querySelectorAll("#nowReports .rp-chip")].map(c => c.textContent));
    if (!chips.length || !/^Chest · Clean/.test(chips[0]) || !/Few people · just now$/.test(chips[0])) throw new Error(`the strip shows ${JSON.stringify(chips)}`);
    page.off("request", count);
    if (asked.length) throw new Error(`the page asked ${asked.join(", ")} to show it`);
  },
  // A session logged with "Share to chat for tips" on posts a session card: the spot and time, the stars, the note, the conditions and
  // the board. Unshared from My sessions, the card goes and the log stays.
  async logAndShare(s) {
    const page = s.main;
    await page.click(".chatroom .cr-diary");
    await page.waitForSelector('.chatroom .cr-sheet [data-k="save"]');
    if (await page.getAttribute('.chatroom .cr-sheet [data-k="day:0"]', "aria-pressed") !== "true") throw new Error("the log sheet doesn't start on Today");
    if (await page.isChecked('.chatroom .cr-sheet [data-k="share"]')) throw new Error("Share to chat for tips is on to start with");
    await page.click('.chatroom .cr-sheet [data-k="stars:4"]'); await page.click('.chatroom .cr-sheet [data-k="board:minimal"]');
    await page.fill('.chatroom .cr-sheet [data-k="note"]', NOTE); await page.check('.chatroom .cr-sheet [data-k="share"]');
    await page.click('.chatroom .cr-sheet [data-k="save"]');
    await page.waitForFunction(n => [...document.querySelectorAll(".chatroom .cm-card .cm-big")].some(b => b.textContent.includes(n)), `“${NOTE}”`, { timeout: 15e3 });
    await page.waitForFunction(() => document.querySelector(".chatroom .cr-shade").hidden);
    const card = await page.evaluate(n => { const c = [...document.querySelectorAll(".chatroom .cm-card")].find(c => c.querySelector(".cm-big").textContent.includes(n));
      return { id: c.closest("article").dataset.id, cap: c.querySelector(".cm-cap").textContent, big: c.querySelector(".cm-big").textContent, sub: c.querySelector(".cm-sub").textContent }; }, NOTE);
    if (!new RegExp(`^Session log · Wushi ${s.wushi} · Today \\d\\d:\\d\\d–\\d\\d:\\d\\d$`).test(card.cap) || card.big !== `★★★★☆ “${NOTE}”` || !/^Conditions then: .+ · Mini-mal$/.test(card.sub))
      throw new Error(`the session card reads ${JSON.stringify(card)}`);
    s.card = card.id;
    await mainMenu(page, "My sessions");
    await page.waitForSelector(".chatroom .cr-sheet .cr-log");
    const rows = await page.evaluate(() => [...document.querySelectorAll(".chatroom .cr-sheet .cr-log")].map(r => r.textContent));
    if (rows.length !== 1 || !rows[0].includes(NOTE) || !rows[0].includes("Wushi") || !rows[0].includes("★★★★☆") || !/Conditions then: /.test(rows[0])) throw new Error(`My sessions lists ${JSON.stringify(rows)}`);
    await page.click('.chatroom .cr-sheet .cr-log [data-k="unshare"]');
    await page.waitForFunction(id => !document.querySelector(`.chatroom article[data-id="${id}"]`), s.card, { timeout: 15e3 });
    await page.waitForSelector('.chatroom .cr-sheet .cr-log [data-k="share"]');
  },
  // My sessions still lists the log, private now; Download my data gives a JSON file with it, the message and the report.
  async mySessionsAndExport(s) {
    const page = s.main;
    await page.keyboard.press("Escape"); await page.waitForFunction(() => document.querySelector(".chatroom .cr-shade").hidden);
    await mainMenu(page, "My sessions");
    await page.waitForSelector('.chatroom .cr-sheet .cr-log [data-k="share"]');
    const rows = await page.evaluate(() => [...document.querySelectorAll(".chatroom .cr-sheet .cr-log")].map(r => r.textContent));
    if (rows.length !== 1 || !rows[0].includes(NOTE)) throw new Error(`My sessions lists ${JSON.stringify(rows)}`);
    await page.keyboard.press("Escape");
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15e3 }), mainMenu(page, "Download my data")]);
    const data = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    if (!/\.json$/.test(dl.suggestedFilename())) throw new Error(`the file is called ${dl.suggestedFilename()}`);
    if (data.nick !== line.name || data.sessions.length !== 1 || data.sessions[0].note !== NOTE || data.sessions[0].shared !== false || !data.sessions[0].cond
      || !data.messages.some(m => m.body.text === HELLO) || data.reports.length !== 1) throw new Error(`the download holds ${JSON.stringify(data).slice(0, 400)}`);
  },
  // Sign out everywhere (two taps) shows the LINE button again, and the token is gone.
  async signOutEverywhere(s) {
    const page = s.main;
    await page.click(".chatroom .cr-menu"); const item = page.locator(".chatroom .cr-pop[role=menu] >> text=Sign out everywhere");
    await item.click(); await item.click();
    await lineBar(page);
    if (await page.evaluate(() => localStorage.getItem("waveslave-chat-token"))) throw new Error("the token is still kept");
  },
  // Signed in again (a known account: no sign-up sheet), with a reader watching in a second context: Delete my account takes their
  // messages off the reader's screen, and their own page shows the LINE button.
  async deleteAccount(s) {
    const page = s.main; await lineLogin(page); await signedInBar(page);
    if (await sheetTitle(page)) throw new Error(`signing in again opened ${await sheetTitle(page)}`);
    await say(page, LAST);
    const reader = await s.open({}); await reader.click(".chatfab"); await roomLive(reader);
    await until(reader, "the reader to see the last message", t => [...document.querySelectorAll(".chatroom .cm-text")].some(p => p.textContent === t), LAST);
    if (!(await texts(reader)).includes(HELLO)) throw new Error("the reader doesn't see the first message");
    await mainMenu(page, "Delete my account");
    await page.waitForSelector('.chatroom .cr-sheet [data-k="delete-account"]');
    await page.click('.chatroom .cr-sheet [data-k="delete-account"]');
    await lineBar(page);
    await until(reader, "their messages to go from the reader's screen", t => !t.some(x => [...document.querySelectorAll(".chatroom .cm-text")].some(p => p.textContent === x)), [HELLO, LAST]);
    if (await page.evaluate(() => localStorage.getItem("waveslave-chat-token"))) throw new Error("the token is still kept");
    await reader.context().close(); await page.context().close();
  },
  // The home-screen app's way (spec "Login", step 5). B, the app, starts the sign-in, and LINE opens elsewhere: its page stays, with a code
  // box while its v waits. The sign-in finishes in A, a browser with no v (as if its localStorage were cleared before the return): A shows
  // only "Go back to the WaveSlave app and enter this code" with the pin, and signs nobody in. B enters the pin and is signed in (a new
  // person again, since the account was deleted: through the sign-up sheet).
  async pinPath(s) {
    const b = await s.open({}); let start = null;
    await b.click(".chatfab"); await roomLive(b);
    await b.route(`${CHAT()}/auth/line/start**`, r => { start = r.request().url(); return r.fulfill({ status: 204 }); });
    await b.click(".chatroom .cr-line");
    for (let i = 0; i < 50 && !start; i++) await wait(100);
    if (!start) throw new Error("the LINE button didn't start a sign-in");
    await b.waitForSelector(".chatroom .cr-pinbox input", { state: "visible" });
    const a = await s.open({ go: false });
    await a.goto(start, { waitUntil: "load" }); await a.waitForURL(u => u.href.startsWith(ORIGIN()), { waitUntil: "load" });
    await a.waitForSelector(".chatroom .cr-pin-code");
    const shown = await a.evaluate(() => ({ title: document.getElementById("chatSheetTitle").textContent, text: document.querySelector(".chatroom .cr-sheet-b").textContent,
      pin: document.querySelector(".chatroom .cr-pin-code").textContent, inputs: document.querySelectorAll(".chatroom .cr-sheet input").length,
      token: localStorage.getItem("waveslave-chat-token"), href: location.href }));
    if (!/^\d{6}$/.test(shown.pin) || !shown.text.startsWith("Signed in with LINE. Go back to the WaveSlave app and enter this code:") || shown.inputs || shown.token || /#[cp]=/.test(shown.href))
      throw new Error(`the browser without v shows ${JSON.stringify(shown)}`);
    // A wrong code tapped in twice uses one of the three tries, not two: Sign in is off while the first is checked (each redeem held
    // here for 300 ms, so the second tap comes while it's on its way).
    const redeems = []; await b.route(`${CHAT()}/auth/redeem`, async r => { if (r.request().method() === "POST") { redeems.push(r.request().postDataJSON()); await wait(300); } return r.continue(); });
    await b.fill(".chatroom .cr-pinbox input", shown.pin === "000000" ? "111111" : "000000"); await b.dblclick(".chatroom .cr-pinbox button");
    await b.waitForFunction(() => document.querySelector(".chatroom .cr-pinbox .cr-err").textContent === "That code isn't right. Check it and try again."
      && !document.querySelector(".chatroom .cr-pinbox button").disabled, null, { timeout: 10e3 }).catch(() => { throw new Error("a wrong code doesn't say so"); });
    if (redeems.length !== 1) throw new Error(`a double tap on Sign in sent ${redeems.length} redeems`);
    await b.unroute(`${CHAT()}/auth/redeem`);
    await b.fill(".chatroom .cr-pinbox input", shown.pin); await b.click(".chatroom .cr-pinbox button");
    await b.waitForSelector('.chatroom .cr-sheet [data-k="nick"]');
    if (await b.inputValue('.chatroom .cr-sheet [data-k="nick"]') !== line.name) throw new Error("the sign-up sheet isn't prefilled");
    await b.check('.chatroom .cr-sheet [data-k="consent"]'); await b.click('.chatroom .cr-sheet [data-k="join"]');
    await signedInBar(b);
    if (!(await b.evaluate(() => !!localStorage.getItem("waveslave-chat-token") && !localStorage.getItem("waveslave-chat-v")))) throw new Error("B isn't signed in, or still holds v");
    if (await b.isVisible(".chatroom .cr-pinbox")) throw new Error("the code box still shows");
    if (await a.evaluate(() => localStorage.getItem("waveslave-chat-token"))) throw new Error("A got signed in too");
  },
};

(async () => {
  let browser, bad = false, ctxs = [], errs = [];
  const s = {
    // A fresh context: the page, the backend and the fake LINE load, everything else is cut off. go: false leaves it on a blank page.
    async open({ spot = "jinshan", go = true }) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: true });
      ctxs.push(ctx);
      await ctx.route("**/*", r => { const u = r.request().url(); return [ORIGIN(), CHAT(), line.url].some(o => u.startsWith(o + "/")) ? r.continue() : r.abort(); });
      await ctx.addInitScript(([o, lock]) => {
        try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", "fc"); localStorage.setItem("waveslave-lang", "en"); localStorage.setItem("waveslave-world", "0");
          if (lock) sessionStorage.setItem("waveslave-unlock", lock); } catch (e) {}
        window.__chatUrl = o.url; window.__chatContact = o.contact;
        // What the address says once the page is ready: chat.js (deferred) has run by then.
        document.addEventListener("DOMContentLoaded", () => { window.__hrefAtReady = location.href; }, { once: true }); }, [{ url: CHAT(), contact: CONTACT }, LOCK]);
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
    await step("fakeLine", async () => { if (line.problems.length) throw new Error(`the fake LINE refused: ${line.problems.join("; ")}`); });
  } catch (e) { bad = true; console.log(`FAIL setup: ${e.message}`); }
  finally { if (browser) await browser.close(); await tearDown(); }
  process.exitCode = bad ? 1 : 0;
})();
