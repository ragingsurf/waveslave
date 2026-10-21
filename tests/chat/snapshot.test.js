// Browser checks of the Taiwan chat's conditions snapshot (web/chat.js snapshot(), handed to tests as CHAT._snap under window.__chatTest)
// on a built page (tests/map/tool.py), and of the log sheet's day and times on a phone set to another time zone (Review Focus 2).
// Usage: node tests/chat/snapshot.test.js <page.html>
// Prints ok / FAIL for each check, and exits 1 on any FAIL or page error.
// - Every page opens in its own browser context, offline, as in tests/chat/shell.test.js: only the page and chat.js load, and a fake
//   backend at https://chat.test answers /reports (no reports) and POST /me/sessions, and a fake socket answers hello (signed in as
//   "Tester", an empty room) and echoes a report back. A phone 390x844, English, Taiwan mode, the Forecast view, the intro done.
// - The page's clock stands still 15 minutes after the data's "updated" time, as on a page fresh from the hourly refresh, unless a check
//   sets it. rightNow also runs 55 minutes and 5 hours after it, when the latest buoy or station reading can be over 3 hours old: the
//   Right now card shows it whatever its age, and so must a report's snapshot, while a session's moment leaves it out (sessionCap).
// - Every snapshot is also put through the backend's own checks (chat/src/mod.js validSnap, validReport and validSession), so the room
//   would store it as it is.
// Playwright wherever node finds it (npm install playwright), else the copy this container keeps.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path"), { pathToFileURL } = require("url");

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: node tests/chat/snapshot.test.js <page.html>"); process.exit(2); }
const ROOT = path.join(__dirname, "..", ".."), PAGE = pathToFileURL(path.resolve(file)).href, HTML = fs.readFileSync(file, "utf8");
const CHAT_JS = fs.readFileSync(path.join(ROOT, "web", "chat.js"), "utf8");
const LOCK = (HTML.match(/\bH="([0-9a-f]{64})"/) || [])[1]; // a site build opens on the passcode screen: start unlocked
const UPDATED = (HTML.match(/const ALL = \{"updated":\s*"([^"]+)"/) || [])[1];
if (!UPDATED) { console.error("no ALL.updated in the page"); process.exit(2); }
const CHAT = "https://chat.test", CONTACT = { name: "Test Operator", email: "chat@example.com" };
const HOUR = 3600e3, DAY = 864e5, TZ = 8 * HOUR, FRESH = Date.parse(UPDATED) + 15 * 60e3, LATE = Date.parse(UPDATED) + 55 * 60e3, STALE = Date.parse(UPDATED) + 5 * HOUR;
const SPOTS = ["donghe", "jialeshui", "nanwan", "jinshan", "fulong", "wushi", "suao", "hualien"];

const wait = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
// The page's own roundings and compass (template.html boot(): r1, compass).
const r1 = v => (Math.round(v*10)/10).toFixed(1);
const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass = d => COMPASS[Math.round(((d%360)+360)%360/22.5)%16];
// A time on the Taipei clock, as the data writes it.
const taipei = ms => { const d = new Date(ms + TZ), p = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const tp = s => Date.UTC(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10), +s.slice(11,13), +s.slice(14,16)) - TZ;
const VALUES = ["hs", "tp", "dp", "shs", "stp", "sdp", "ws", "wd", "tide", "bhs", "btp", "bdp"];
let mod; // chat/src/mod.js, loaded once

// Every value has its _t, every _t is a Taipei clock time, and the backend's validSnap takes it all as it is.
function wellFormed(snap, what) {
  const bad = [];
  for (const k of Object.keys(snap)) {
    if (VALUES.includes(k)) { if (typeof snap[k + "_t"] !== "string") bad.push(`${k} has no ${k}_t`); }
    else if (k.endsWith("_t")) { if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(snap[k])) bad.push(`${k} is ${JSON.stringify(snap[k])}`); }
    else if (k !== "updated") bad.push(`${k} isn't a snapshot key`);
  }
  if (snap.updated !== UPDATED) bad.push(`updated is ${JSON.stringify(snap.updated)}, the page's ${UPDATED}`);
  if (!eq(mod.validSnap(snap), snap)) bad.push(`the backend's validSnap gives ${JSON.stringify(mod.validSnap(snap))}`);
  if (bad.length) throw new Error(`${what}: ${bad.join("; ")} in ${JSON.stringify(snap)}`);
}

// The Right now card for each Taiwan spot on a page whose clock stands at `time`, beside CHAT._snap(id, now): the buoy's height, period
// and direction and when it was read, the station's wind, its direction and time, and the tide, with the card's own rounding. Each
// disagreement goes in bad, headed with `when`.
async function cardAgrees(open, time, when, bad) {
  const page = await open({ time });
  for (const id of SPOTS) {
    const got = await page.evaluate(id => { switchSpot(id); const f = [...document.querySelectorAll("#nowFacts .fact")].map(x => [x.querySelector(".v").textContent, x.querySelector(".s").textContent]);
      return { h: document.getElementById("nowH1").textContent, sub: document.getElementById("nowSub").textContent, wind: f.find(x => / kt$/.test(x[0])) || null, tide: f.find(x => / cm$/.test(x[0])) || null,
        snap: window.CHAT._snap(id, Date.now()), now: Date.now() }; }, id);
    const s = got.snap, say = (what, card, snap) => { if (card !== snap) bad.push(`${when}, ${id} ${what}: the card ${JSON.stringify(card)}, the snapshot ${JSON.stringify(snap)}`); };
    if (!s) { bad.push(`${when}, ${id}: no snapshot`); continue; }
    wellFormed(s, `${when}, ${id}`);
    say("height", got.h, s.bhs == null ? "–" : `${r1(s.bhs)}m`);
    // The buoy line under the height reads "8.8 s · ENE ↑ · 19:00" since #93 (a narrow no-break space before the s).
    const per = /^([\d.]+)\u202Fs/.exec(got.sub), from = / · ([A-Z]{1,3}) ↑/.exec(got.sub), read = / · (\d\d:\d\d)$/.exec(got.sub);
    say("period", per ? per[1] : null, s.btp == null ? null : r1(s.btp));
    say("wave direction", from ? from[1] : null, s.bdp == null ? null : compass(s.bdp));
    say("buoy time", read ? read[1] : null, s.bhs_t ? s.bhs_t.slice(11, 16) : null);
    if (got.wind) { say("wind", got.wind[0], s.ws == null ? null : `${Math.round(s.ws)} kt`);
      const wf = / from (\w+) · /.exec(got.wind[1]), wt = /station (\d\d:\d\d)$/.exec(got.wind[1]);
      if (wf) say("wind direction", wf[1], compass(s.wd)); say("wind time", wt ? wt[1] : null, s.ws_t && s.ws_t.slice(11, 16)); }
    // With no station reading the card shows no wind, and the snapshot may take the model's for the hour instead.
    else if (s.ws != null && s.ws_t !== taipei(Math.floor(got.now / HOUR) * HOUR)) bad.push(`${when}, ${id}: the card has no wind, the snapshot ${s.ws} kt from ${s.ws_t}`);
    say("tide", got.tide ? got.tide[0] : null, s.tide == null ? null : `${Math.round(s.tide * 100)} cm`);
    say("tide time", s.tide_t, taipei(got.now));
    if (s.bhs == null || s.ws == null || s.tide == null) bad.push(`${when}, ${id}: the built page has a buoy, a station and a tide for now, but the snapshot is ${JSON.stringify(s)}`);
  }
  await page.context().close();
}

const CHECKS = {
  // "Now", for each Taiwan spot, agrees with the Right now card as it reads (cardAgrees): on a page fresh from the refresh (15 minutes
  // after it), at 55 minutes (the next refresh not in yet, when a buoy 2 or more hours behind is over 3 hours old) and at 5 hours (a page
  // left open, every reading over 3 hours old).
  async rightNow(open) {
    const bad = [];
    for (const [when, time] of [["at +15 min", FRESH], ["at +55 min", LATE], ["at +5 h", STALE]]) await cardAgrees(open, time, when, bad);
    if (bad.length) throw new Error(bad.join("; "));
  },
  // A session's moment keeps the 3-hour limit on measured readings: 5 hours after the refresh, ten minutes ago has no buoy and no
  // station wind (the model's wind for that hour, if any), where now has the card's buoy and station.
  async sessionCap(open) {
    const page = await open({ time: STALE }), bad = [], ms = STALE - 10 * 60e3, hour = taipei(Math.floor(ms / HOUR) * HOUR);
    for (const id of SPOTS) {
      const got = await page.evaluate(([id, ms]) => ({ then: window.CHAT._snap(id, ms), now: window.CHAT._snap(id, Date.now()) }), [id, ms]), t = got.then;
      if (!t) { bad.push(`${id}: no snapshot ten minutes ago`); continue; }
      wellFormed(t, id);
      if (t.bhs != null || t.btp != null || t.bdp != null) bad.push(`${id}: ten minutes ago has the buoy's ${t.bhs} m from ${t.bhs_t}, over 3 hours before`);
      if (t.ws != null && t.ws_t !== hour) bad.push(`${id}: ten minutes ago has the wind from ${t.ws_t}, not the model's for ${hour}`);
      if (!got.now || got.now.bhs == null || got.now.ws == null || got.now.ws_t === hour) bad.push(`${id}: now is ${JSON.stringify(got.now)}, want the card's buoy and station`);
    }
    if (bad.length) throw new Error(bad.join("; "));
  },
  // Two days ago is in the past days' data (hist): the model's wave row for that hour from hist.wave, the buoy and the station from
  // hist.buoy and hist.station (their latest reading at or before that time, under 3 hours old), and the tide at that minute.
  async twoDaysAgo(open) {
    const page = await open({}), bad = [];
    for (const id of SPOTS) {
      const ms = FRESH - 2 * DAY + 20 * 60e3, got = await page.evaluate(([id, ms]) => ({ snap: window.CHAT._snap(id, ms), hist: ALL.spots[id].hist, hourly: ALL.spots[id].hourly.map(r => r[0]) }), [id, ms]);
      const s = got.snap, hour = taipei(Math.floor(ms / HOUR) * HOUR);
      if (!s) { bad.push(`${id}: no snapshot`); continue; }
      wellFormed(s, id);
      const w = got.hist.wave.find(r => r[0] === hour);
      if (!w || s.hs_t !== hour || s.hs !== w[1] || Math.abs(s.tp - w[2] * 1.3) > 1e-9 || s.dp !== w[3] || got.hourly.includes(s.hs_t)) bad.push(`${id}: the waves are ${s.hs} m @ ${s.tp} s at ${s.hs_t}, hist.wave's ${hour} row ${JSON.stringify(w)}`);
      const latest = rows => rows.filter(r => r[0].endsWith(":00") && r[1] != null && tp(r[0]) <= ms && tp(r[0]) > ms - 3 * HOUR).sort((a, b) => tp(b[0]) - tp(a[0]))[0];
      const b = latest(got.hist.buoy), st = latest(got.hist.station);
      if (!b || s.bhs_t !== b[0] || s.bhs !== b[1] || Math.abs(s.btp - b[2] * 1.3) > 1e-9 || s.bdp !== b[3]) bad.push(`${id}: the buoy is ${s.bhs} m at ${s.bhs_t}, hist.buoy's ${JSON.stringify(b)}`);
      if (!st || s.ws_t !== st[0] || s.ws !== st[1] || s.wd !== st[2]) bad.push(`${id}: the wind is ${s.ws} kt at ${s.ws_t}, hist.station's ${JSON.stringify(st)}`);
      if (s.tide == null || s.tide_t !== taipei(ms)) bad.push(`${id}: the tide is ${s.tide} at ${s.tide_t}, want one at ${taipei(ms)}`);
    }
    if (bad.length) throw new Error(bad.join("; "));
  },
  // An hour the page has no data for (40 days either way), and a spot that isn't one of the chat's, give null.
  async noData(open) {
    const page = await open({});
    const got = await page.evaluate(() => { const other = Object.keys(ALL.spots).find(id => ALL.spots[id].country && ALL.spots[id].country !== "tw");
      return { later: window.CHAT._snap("jinshan", Date.now() + 40 * 864e5), earlier: window.CHAT._snap("wushi", Date.now() - 40 * 864e5), other: window.CHAT._snap(other, Date.now()),
        bogus: window.CHAT._snap("constructor", Date.now()), nan: window.CHAT._snap("jinshan", NaN) }; });
    if (!Object.values(got).every(v => v === null)) throw new Error(`with no data: ${JSON.stringify(got)}`);
  },
  // Review Focus 2: a phone in Los Angeles at 18:30 on Oct 20, which is 09:30 on Oct 21 in Taipei. The log sheet's Today is Oct 21,
  // the times typed are Taipei's, and the conditions are for the Taipei hour; a report's snapshot is too.
  async timeZone(open) {
    const at = Date.UTC(2026, 9, 21, 1, 30), posted = [], frames = [];
    const page = await open({ zone: "America/Los_Angeles", time: at, signedIn: true, posted, frames });
    const local = await page.evaluate(() => [new Date().getDate(), new Date().getHours()]);
    if (!eq(local, [20, 18])) throw new Error(`the browser's clock reads day ${local[0]}, hour ${local[1]}: the time zone didn't take`);
    const now = await page.evaluate(() => window.CHAT._snap("jinshan", Date.now()));
    if (!now || now.hs_t !== "2026-10-21T09:00" || now.tide_t !== "2026-10-21T09:30" || now.bhs_t !== "2026-10-21T09:00") throw new Error(`now's snapshot is for ${now && [now.hs_t, now.tide_t, now.bhs_t]}`);
    await page.click(".chatfab"); await page.waitForSelector(".chatroom .cr-diary", { state: "visible" });
    // The log sheet: Today is Taipei's date, 08:00 to 09:00 are Taipei times.
    await page.click(".chatroom .cr-diary");
    await page.waitForSelector('.chatroom .cr-sheet [data-k="day:0"]');
    const today = await page.textContent('.chatroom .cr-sheet [data-k="day:0"]');
    if (!/^Today\b/.test(today) || !today.includes("10/21")) throw new Error(`the sheet's Today reads ${JSON.stringify(today)}, want Oct 21 (Taipei's date)`);
    await page.click('.chatroom .cr-sheet [data-k="spot:jinshan"]');
    await page.fill('.chatroom .cr-sheet [data-k="start"]', "08:00"); await page.fill('.chatroom .cr-sheet [data-k="end"]', "09:00");
    await page.click('.chatroom .cr-sheet [data-k="stars:4"]'); await page.click('.chatroom .cr-sheet [data-k="board:minimal"]');
    await page.fill('.chatroom .cr-sheet [data-k="note"]', "Kept nosediving on takeoff");
    const auto = await page.textContent(".chatroom .cr-sheet .cr-auto");
    if (!/Added automatically/.test(auto)) throw new Error(`the sheet's conditions read ${JSON.stringify(auto)}`);
    await page.click('.chatroom .cr-sheet [data-k="save"]');
    for (let i = 0; i < 50 && !posted.length; i++) await wait(100);
    if (posted.length !== 1) throw new Error(`the sheet posted ${posted.length} logs`);
    const log = posted[0], start = Date.UTC(2026, 9, 21, 0, 0);
    if (log.spot !== "jinshan" || log.start !== start || log.end !== start + HOUR || log.stars !== 4 || log.board !== "minimal" || log.note !== "Kept nosediving on takeoff" || log.share !== false)
      throw new Error(`the log went as ${JSON.stringify(log)}, want jinshan from ${start} (08:00 Taipei) for an hour`);
    if (!log.cond || log.cond.hs_t !== "2026-10-21T08:00" || log.cond.bhs_t !== "2026-10-21T08:00" || log.cond.tide_t !== "2026-10-21T08:30") throw new Error(`the log's conditions are for ${JSON.stringify(log.cond)}`);
    wellFormed(log.cond, "the log's conditions");
    if (!mod.validSession(log, at)) throw new Error(`the backend's validSession refuses ${JSON.stringify(log)}`);
    await page.waitForFunction(() => document.querySelector(".chatroom .cr-shade").hidden);
    // A report: its snapshot is now's, on the Taipei clock, and the backend takes the frame.
    await page.click(".chatroom .cr-rep");
    await page.click('.chatroom .cr-sheet [data-k="spot:jinshan"]');
    for (const k of ["size:chest", "cond:clean", "crowd:few"]) await page.click(`.chatroom .cr-sheet [data-k="${k}"]`);
    await page.click('.chatroom .cr-sheet [data-k="post"]');
    for (let i = 0; i < 50 && !frames.length; i++) await wait(100);
    const f = frames[0];
    if (!f || !mod.validReport(f) || f.spot !== "jinshan" || f.size !== "chest" || f.cond !== "clean" || f.crowd !== "few" || !eq(f.snap, now)) throw new Error(`the report went as ${JSON.stringify(f)}`);
    await page.waitForFunction(() => document.querySelector(".chatroom .cr-shade").hidden);
  },
};

(async () => {
  mod = await import(pathToFileURL(path.join(ROOT, "chat", "src", "mod.js")).href);
  const browser = await chromium.launch(); let bad = false, ctxs = [], errs = [];
  // A fresh context for every page. zone: the browser's time zone; time: the page's clock (it stands still); signedIn: a token is kept,
  // and the fake socket signs it in as "Tester"; posted and frames collect the logs POSTed and the report frames sent.
  async function open({ spot = "jinshan", zone = undefined, time = FRESH, signedIn = false, posted = [], frames = [] }) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block", timezoneId: zone });
    ctxs.push(ctx);
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, DELETE" };
    await ctx.route("**/*", r => { const q = r.request(), u = q.url();
      if (u.split(/[?#]/)[0] === PAGE) return r.continue();
      if (u.startsWith("file:") && u.split(/[?#]/)[0].endsWith("/chat.js")) return r.fulfill({ contentType: "text/javascript", body: CHAT_JS });
      if (u.startsWith(CHAT + "/")) {
        if (q.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
        const p = new URL(u).pathname;
        if (p === "/reports") return r.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify({ reports: [], online: 1, last_id: 0 }) });
        if (p === "/me/sessions" && q.method() === "POST") { posted.push(JSON.parse(q.postData())); return r.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify({ id: posted.length }) }); }
        return r.fulfill({ status: 404, contentType: "application/json", headers: cors, body: "{}" });
      }
      return r.abort(); });
    await ctx.addInitScript(([o, lock]) => {
      try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", "fc"); localStorage.setItem("waveslave-lang", "en"); localStorage.setItem("waveslave-world", "0");
        if (o.signedIn) localStorage.setItem("waveslave-chat-token", "test-token"); if (lock) sessionStorage.setItem("waveslave-unlock", lock); } catch (e) {}
      window.__chatUrl = o.url; window.__chatContact = o.contact; window.__chatTest = true; }, [{ url: CHAT, contact: CONTACT, signedIn }, LOCK]);
    const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e)));
    await page.clock.setFixedTime(time);
    await page.routeWebSocket(/\/ws$/, ws => ws.onMessage(m => { const f = JSON.parse(m);
      if (f.type === "hello") { if (f.token) ws.send(JSON.stringify({ type: "me", nick: "Tester", role: "user" })); ws.send(JSON.stringify({ type: "history", messages: [] })); }
      if (f.type === "report") { frames.push(f); ws.send(JSON.stringify({ type: "msg", msg: { id: frames.length, ts: time, nick: "Tester", role: null, kind: "report", spot: f.spot,
        body: { size: f.size, cond: f.cond, crowd: f.crowd, snap: f.snap || {} }, reply_to: null, likes: 0 } })); } }));
    await page.goto(PAGE + "#" + spot, { waitUntil: "load" }); await settle(page);
    return page;
  }
  async function step(name, run) {
    let status = "ok", note = ""; errs = [];
    try { await run(); } catch (e) { status = "FAIL"; note = e.message; }
    if (errs.length) [status, note] = ["FAIL", "page error: " + errs.join("; ")];
    if (status === "FAIL") bad = true;
    console.log(status === "FAIL" ? `FAIL ${name}: ${note}` : `ok ${name}`);
    await Promise.all(ctxs.map(c => c.close())); ctxs = [];
  }
  try { for (const [name, run] of Object.entries(CHECKS)) await step(name, () => run(open)); }
  finally { await browser.close(); }
  process.exitCode = bad ? 1 : 0;
})();
