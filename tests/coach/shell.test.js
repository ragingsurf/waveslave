// Browser checks of the AI coach's page shell on a built page (build one with tests/map/tool.py): web/coach.js, served for the page's
// coach.js, and its hooks in template.html (the hidden Coach tab, the tab handler, the language, developer mode and spot hooks, and the
// Escape and pull-to-refresh guards), and the test clips tests/coach/clips.js makes.
// Usage: node tests/coach/shell.test.js <page.html>
// Prints ok / FAIL for each check, and exits 1 on any FAIL or page error.
// Only what the real backend can't give runs here (ruling R15): every page opens in its own fresh browser context, offline. Only the page,
// chat.js and coach.js load (page.tried lists the other web addresses it asked for), and a fake backend at https://chat.test answers
// /reports with none (page.asked lists every call to it). A phone 390x844, dpr 2, touch, reduced motion, the intro done, English, the
// Forecast view, on Donghe. Developer mode (World mode, its PIN in for this visit) is on unless a check says otherwise, which is how the
// coach shows until Bryan opens it to everyone; window.__coachPublic and window.__chatPublic stay out unless a check sets them. The
// chat is switched on the way the tests do it (window.__chatUrl and window.__chatContact), and window.__chatTest lets chat.js note each
// time its room is asked to open (CHAT._opened).
// Playwright wherever node finds it (npm install playwright), else the copy this container keeps.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), os = require("os"), path = require("path"), { pathToFileURL } = require("url");
const { makeClip } = require("./clips.js");

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: node tests/coach/shell.test.js <page.html>"); process.exit(2); }
const ROOT = path.join(__dirname, "..", ".."), PAGE = pathToFileURL(path.resolve(file)).href, HTML = fs.readFileSync(file, "utf8");
const CHAT_JS = fs.readFileSync(path.join(ROOT, "web", "chat.js"), "utf8"), COACH_JS = fs.readFileSync(path.join(ROOT, "web", "coach.js"), "utf8");
const LOCK = (HTML.match(/\bH="([0-9a-f]{64})"/) || [])[1]; // a site build opens on the passcode screen: start unlocked
const CHAT = "https://chat.test", CONTACT = { name: "Test Operator", email: "chat@example.com" };
const TAB = '.tabs button[data-v="coach"]';

const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const wait = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// What the page shows of the coach: the tab (there and shown, its text, which tab is picked), the panel (open, shown, html.coach-open),
// the view and the saved view.
const look = page => page.evaluate(sel => { const t = document.querySelector(sel), p = document.querySelector(".coachpanel"), html = document.documentElement;
  const vis = e => !!e && !e.hidden && !e.closest("[hidden]") && getComputedStyle(e).display !== "none" && !!e.getClientRects().length;
  let saved = null; try { saved = localStorage.getItem("waveslave-view"); } catch (e) {}
  return { tab: vis(t), text: t && t.textContent, picked: [...document.querySelectorAll(".tabs button")].filter(b => b.getAttribute("aria-selected") === "true").map(b => b.dataset.v),
    panel: vis(p), open: html.classList.contains("coach-open"), view: VIEW, saved, fc: !document.getElementById("viewFc").hidden, ws: !document.getElementById("viewWs").hidden }; }, TAB);
// One finger dragged straight down from a point on the screen by dy pixels, as in tests/chat/shell.test.js; lift = false leaves it down.
const dragDown = async (page, [x, y], dy, lift = true) => { const s = await page.context().newCDPSession(page);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) { await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy*i/12 }] }); await page.waitForTimeout(16); }
  if (lift) await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); return s; };
const ptr = page => page.evaluate(() => +getComputedStyle(document.querySelector(".ptr")).opacity);
// The coach's calls to the backend (anything under /coach), and the page's tries at the real one (Bryan's workers.dev Worker).
const coachCalls = page => page.asked.filter(a => a.startsWith("/coach"));
const backends = page => page.tried.filter(u => /workers\.dev/.test(u));

class Skip extends Error {}

const CHECKS = {
  // The test clips (tests/coach/clips.js), read the way the coach will read them: picked in an <input type="file"> and played from an
  // object URL. The white box is found at 10% and at 90% of the clip, where it should be: halfway down, its left edge at (w - box) x
  // that fraction. The rotate: 90 copy shows turned, 360x640, the box climbing from the bottom to the top.
  async makeClip(open, { blank, tmp }) {
    const plain = makeClip(tmp, { w: 640, h: 360, secs: 6 }), turned = makeClip(tmp, { w: 640, h: 360, secs: 6, rotate: 90 });
    const page = await blank(); await page.setContent('<input type="file" accept="video/*">');
    const find = async clip => { await page.setInputFiles("input", clip); return page.evaluate(async () => {
      const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(document.querySelector("input").files[0]);
      await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error(`the clip didn't open (error ${v.error && v.error.code})`)); });
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; const g = c.getContext("2d", { willReadFrequently: true }), at = [];
      for (const f of [0.1, 0.9]) {
        const drawn = new Promise(ok => { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => ok()); setTimeout(ok, 500); });
        v.currentTime = v.duration * f; await new Promise(ok => { v.onseeked = ok; }); await drawn;
        g.drawImage(v, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const k = 4 * (y * c.width + x); if (d[k] > 200 && d[k + 1] > 200 && d[k + 2] > 200) { sx += x; sy += y; n++; } }
        at.push(n ? { x: sx / n, y: sy / n, n } : null);
      }
      URL.revokeObjectURL(v.src); return { w: v.videoWidth, h: v.videoHeight, secs: v.duration, at }; }); };
    // The box is 45x40 on a 640x360 clip; its centre at fraction f is ((640 - 45) f + 22, 180), give or take a frame and VP9's edges.
    const centre = f => (640 - 45) * f + 22, near = (a, b) => Math.abs(a - b) <= 6;
    const a = await find(plain);
    if (a.w !== 640 || a.h !== 360 || Math.abs(a.secs - 6) > 0.05) throw new Error(`the clip is ${a.w}x${a.h}, ${a.secs} s, want 640x360, 6 s`);
    if (!a.at.every(Boolean) || !near(a.at[0].x, centre(0.1)) || !near(a.at[1].x, centre(0.9)) || !a.at.every(p => near(p.y, 180)))
      throw new Error(`the box is at ${JSON.stringify(a.at)}, want (${centre(0.1)}, 180) then (${centre(0.9)}, 180)`);
    const b = await find(turned);
    if (b.w !== 360 || b.h !== 640) throw new Error(`the rotate: 90 clip shows ${b.w}x${b.h}, want 360x640`);
    if (!b.at.every(Boolean) || !near(b.at[0].y, 639 - centre(0.1)) || !near(b.at[1].y, 639 - centre(0.9)) || !b.at.every(p => near(p.x, 180)))
      throw new Error(`in the rotate: 90 clip the box is at ${JSON.stringify(b.at)}, want (180, ${639 - centre(0.1)}) then (180, ${639 - centre(0.9)})`);
  },
  // Developer mode off: no Coach tab, COACH.open() does nothing, and nothing is asked of any backend, at load or on coming back to the page.
  // With the chat also off for everyone the page asks nothing at all; with the chat opened to everyone (window.__chatPublic, as it will be
  // before the coach goes live) the chat asks for its reports and the coach still asks nothing.
  async devOff(open) {
    for (const pub of [false, true]) {
      const page = await open({ world: false, pub }); await wait(300);
      await page.evaluate(() => { window.COACH.open(); document.dispatchEvent(new Event("visibilitychange")); }); await wait(300); const l = await look(page);
      if (l.tab || l.panel || l.open) throw new Error(`developer mode off${pub ? ", the chat public" : ""}: the tab is ${l.tab ? "there" : "hidden"} and COACH.open() ${l.panel || l.open ? "opened" : "didn't open"} the panel`);
      const want = pub ? ["/reports?spot=donghe"] : [];
      if (!eq(page.asked, want) || backends(page).length) throw new Error(`developer mode off${pub ? ", the chat public" : ""}: the page asked the backend for ${JSON.stringify(page.asked)} and tried ${backends(page).join(", ") || "no other"}`);
    }
  },
  // Developer mode on, on a Taiwan spot: the tab is there, after Forecast and Map, reading Coach, unpicked, with no data-zh or data-ja
  // (coach.js writes its words itself). In 中文 it reads 教練; in 日本語, which the coach doesn't carry, Coach. It asks the backend nothing.
  async devOn(open) {
    const page = await open({}); await wait(300); let l = await look(page);
    if (!l.tab || l.text !== "Coach" || l.picked.join() !== "fc") throw new Error(`in developer mode the tab is ${l.tab ? "there" : "hidden"}, reads ${JSON.stringify(l.text)}, picked ${l.picked}`);
    const order = await page.evaluate(() => [...document.querySelectorAll(".tabs button")].map(b => b.dataset.v));
    if (!eq(order, ["fc", "ws", "coach"])) throw new Error(`the tabs are ${order}, want fc, ws, coach`);
    const tagged = await page.evaluate(s => { const t = document.querySelector(s); return [...t.attributes].map(a => a.name).filter(n => /^data-(zh|ja)/.test(n)); }, TAB);
    if (tagged.length) throw new Error(`the tab carries ${tagged.join(", ")}`);
    for (const [lang, want] of [["zh", "教練"], ["ja", "Coach"], ["en", "Coach"]]) {
      await page.evaluate(l => setLang(l), lang); await settle(page); l = await look(page);
      if (l.text !== want || !l.tab) throw new Error(`in ${lang} the tab reads ${JSON.stringify(l.text)}${l.tab ? "" : " and is hidden"}, want ${want}`);
    }
    if (coachCalls(page).length) throw new Error(`the coach asked the backend for ${coachCalls(page).join(", ")}`);
  },
  // Leaving developer mode (the W) takes the tab away at once and shuts an open panel; coming back (PIN in) brings the tab back.
  async devToggle(open) {
    const page = await open({}); await wait(300);
    await page.tap(TAB); await settle(page);
    if (!(await look(page)).open) throw new Error("the tab didn't open the panel");
    await page.evaluate(() => setWorld(false)); await settle(page); let l = await look(page);
    if (l.tab || l.panel || l.open) throw new Error(`out of developer mode the tab is ${l.tab ? "there" : "hidden"} and the panel ${l.panel || l.open ? "open" : "shut"}`);
    await page.evaluate(() => { sessionStorage.setItem("waveslave-unlock", window.__lockHash); return setWorld(true); }); await settle(page); l = await look(page);
    if (!l.tab || l.panel) throw new Error(`back in developer mode the tab is ${l.tab ? "there" : "hidden"} and the panel ${l.panel ? "open" : "shut"}`);
  },
  // Away from Taiwan there's no tab: a Japan spot in World mode has none, Taiwan brings it back, Japan takes it away again.
  async notTaiwan(open) {
    const page = await open({ spot: "shonan" }); await wait(300);
    if ((await look(page)).tab) throw new Error(`on ${await page.evaluate(() => CUR)} there's a Coach tab`);
    await page.evaluate(() => switchCountry("tw")); await settle(page); await wait(300);
    if (!(await look(page)).tab) throw new Error(`back on ${await page.evaluate(() => CUR)} in Taiwan there's no Coach tab`);
    await page.evaluate(() => switchCountry("jp")); await settle(page); await wait(300);
    if ((await look(page)).tab) throw new Error(`on ${await page.evaluate(() => CUR)} there's a Coach tab`);
  },
  // The coach needs the chat (its sign-in is the chat's): with chat.js missing, or switched off with the backend address (window.__chatUrl
  // ""), there's no tab. With the address empty coach.js is off too: no window.COACH. The page draws either way.
  async noChat(open) {
    for (const [what, o] of [["chat.js missing", { chatJs: null }], ["the address empty", { url: "" }]]) {
      const page = await open(o); await wait(300); const l = await look(page);
      const s = await page.evaluate(() => ({ chat: !!window.CHAT, coach: !!window.COACH, h: document.getElementById("nowH1").textContent, days: document.querySelectorAll("#days .day").length }));
      if (l.tab || s.chat) throw new Error(`${what}: the tab is ${l.tab ? "there" : "hidden"}, window.CHAT ${s.chat ? "set" : "unset"}`);
      if (o.url === "" && s.coach) throw new Error("with the address empty window.COACH is set");
      if (s.h === "–" || !s.days) throw new Error(`${what}: the page didn't draw (${JSON.stringify(s)})`);
      if (page.asked.length || backends(page).length) throw new Error(`${what}: the page asked ${JSON.stringify(page.asked)} and tried ${backends(page).join(", ")}`);
    }
  },
  // With coach.js missing the page works as before: no tab, the tabs still switch the view, and the chat's button is there.
  async noCoachJs(open) {
    const page = await open({ coachJs: null }); await wait(300); let l = await look(page);
    if (l.tab || await page.evaluate(() => !!window.COACH)) throw new Error(`without coach.js the tab is ${l.tab ? "there" : "hidden"}`);
    if (!await page.evaluate(() => !!document.querySelector(".chatfab") && getComputedStyle(document.querySelector(".chatfab")).display !== "none")) throw new Error("without coach.js there's no CHAT button");
    await page.tap('.tabs button[data-v="ws"]'); await page.waitForFunction(() => VIEW === "ws" && !document.getElementById("viewWs").hidden); l = await look(page);
    if (l.picked.join() !== "ws" || l.saved !== "ws") throw new Error(`without coach.js the Map tab left ${JSON.stringify(l)}`);
  },
  // Tapping the tab opens the full-screen panel (over everything, z-index 110) and sets html.coach-open, and leaves the Forecast/Map pill,
  // the view and the saved view (waveslave-view) as they were. ✕ shuts it and gives the focus back to the tab.
  async opens(open) {
    const page = await open({}); await wait(300);
    const pill = () => page.evaluate(() => { const p = document.querySelector(".tabs .glide-pill"); return p && [p.style.transform, p.style.width]; });
    const before = await pill();
    await page.tap(TAB); await wait(400); await settle(page); const l = await look(page);
    if (!l.panel || !l.open) throw new Error(`the tab left the panel ${l.panel ? "shown" : "hidden"} and html.coach-open ${l.open ? "set" : "unset"}`);
    if (l.picked.join() !== "fc" || l.view !== "fc" || l.saved !== "fc" || !l.fc || !eq(await pill(), before)) throw new Error(`the tab moved the pill or the view: ${JSON.stringify({ ...l, pill: await pill(), before })}`);
    const box = await page.evaluate(() => { const p = document.querySelector(".coachpanel"), r = p.getBoundingClientRect(), cs = getComputedStyle(p);
      return { r: [r.left, r.top, r.width, r.height], z: cs.zIndex, pos: cs.position, role: p.getAttribute("role"), modal: p.getAttribute("aria-modal"), top: document.elementFromPoint(195, 600) && p.contains(document.elementFromPoint(195, 600)),
        title: (document.getElementById(p.getAttribute("aria-labelledby")) || {}).textContent }; });
    if (!eq(box.r, [0, 0, 390, 844]) || box.z !== "110" || box.pos !== "fixed" || !box.top) throw new Error(`the panel is ${JSON.stringify(box)}, want the whole 390x844 screen, fixed, z-index 110, on top`);
    if (box.role !== "dialog" || box.modal !== "true" || box.title !== "COACH") throw new Error(`the panel is ${JSON.stringify(box)}, want a modal dialog titled COACH`);
    await page.tap(".coachpanel .co-x"); await settle(page);
    const shut = await look(page), focus = await page.evaluate(s => document.activeElement === document.querySelector(s), TAB);
    if (shut.panel || shut.open || !shut.tab || shut.view !== "fc") throw new Error(`after ✕: ${JSON.stringify(shut)}`);
    if (!focus) throw new Error("after ✕ the focus isn't back on the tab");
  },
  // From the map (the saved view the Map), COACH.open() switches to Forecast first, as the chat's room does, and the panel opens over it.
  async fromMap(open) {
    const page = await open({ view: "ws" }); await page.waitForFunction(() => VIEW === "ws" && !document.getElementById("viewWs").hidden);
    await page.evaluate(() => window.COACH.open()); await settle(page); await wait(300); const l = await look(page);
    if (l.view !== "fc" || !l.fc || l.ws || l.picked.join() !== "fc") throw new Error(`from the map COACH.open() left ${JSON.stringify(l)}`);
    if (!l.panel || !l.open) throw new Error(`from the map the panel is ${l.panel ? "shown" : "hidden"} and html.coach-open ${l.open ? "set" : "unset"}`);
  },
  // With the panel open Escape shuts the panel, and only the panel: with the full-screen map behind it the map stays. template.html's own
  // guard: while html.coach-open is set Escape doesn't close the map (and does once it's gone).
  async escape(open) {
    const page = await open({}); await wait(300);
    await page.tap(TAB); await settle(page);
    await page.keyboard.press("Escape"); await settle(page); let l = await look(page);
    if (l.panel || l.open) throw new Error("Escape didn't shut the panel");
    await page.evaluate(() => window.COACH.open()); await settle(page);
    await page.evaluate(() => setView("ws", true)); await settle(page);
    await page.keyboard.press("Escape"); await settle(page); l = await look(page);
    if (l.panel || l.open || l.view !== "ws") throw new Error(`with the map behind the panel, Escape left the panel ${l.panel ? "open" : "shut"} and the view ${l.view}`);
    await page.evaluate(() => document.documentElement.classList.add("coach-open")); await page.keyboard.press("Escape"); await settle(page);
    if (await page.evaluate(() => VIEW) !== "ws") throw new Error("Escape closed the map while html.coach-open is set");
    await page.evaluate(() => document.documentElement.classList.remove("coach-open")); await page.keyboard.press("Escape"); await settle(page);
    if (await page.evaluate(() => VIEW) !== "fc") throw new Error("Escape doesn't close the map with the coach shut (the check itself is off)");
  },
  // With the panel open a pull from the top starts no refresh; shut, it does.
  async pullToRefresh(open) {
    const page = await open({}); await wait(300);
    await page.evaluate(() => scrollTo(0, 0)); await page.tap(TAB); await settle(page);
    let s = await dragDown(page, [200, 200], 60, false); await settle(page); const shut = await ptr(page);
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await settle(page);
    if (!(await look(page)).open) throw new Error("the pull shut the panel");
    await page.keyboard.press("Escape"); await settle(page); await wait(300);
    s = await dragDown(page, [200, 200], 60, false); await settle(page); const shown = await ptr(page);
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    if (shut !== 0) throw new Error(`a pull with the panel open shows the refresh sign (opacity ${shut})`);
    if (!(shown > 0)) throw new Error("a pull with the panel shut doesn't show the refresh sign (the check itself is off)");
  },
  // With the panel open the CHAT button does nothing: a tap where it is lands on the panel, and Tab keeps the focus inside the panel, so
  // the room is never asked to open. Shut, the button opens the room.
  async chatButton(open) {
    const page = await open({}); await wait(300);
    const fab = await page.locator(".chatfab").boundingBox(); if (!fab) throw new Error("there's no CHAT button to check with");
    await page.tap(TAB); await settle(page);
    await page.touchscreen.tap(fab.x + fab.width / 2, fab.y + fab.height / 2); await settle(page);
    for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); const inside = await page.evaluate(() => document.querySelector(".coachpanel").contains(document.activeElement));
      if (!inside) throw new Error(`Tab ${i + 1} took the focus out of the panel, to ${await page.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 80))}`); }
    await page.keyboard.press("Enter"); await settle(page); // the one button inside is ✕: Enter on it shuts the panel
    let s = await page.evaluate(() => ({ opened: window.CHAT._opened.length, room: document.documentElement.classList.contains("chat-open") }));
    if (s.opened || s.room) throw new Error(`with the panel open the CHAT button opened the room (${JSON.stringify(s)})`);
    if ((await look(page)).open) throw new Error("Enter on ✕ didn't shut the panel");
    await page.touchscreen.tap(fab.x + fab.width / 2, fab.y + fab.height / 2); await settle(page);
    s = await page.evaluate(() => ({ opened: window.CHAT._opened.length, room: document.documentElement.classList.contains("chat-open") }));
    if (s.opened !== 1 || !s.room) throw new Error(`with the panel shut the CHAT button didn't open the room (${JSON.stringify(s)}; the check itself is off)`);
  },
  // COACH.open() while the page is still loading, before coach.js has started (as when chat.js finishes a sign-in for the coach during its
  // own start-up, here from the end of the chat.js served), isn't dropped: the panel opens once coach.js starts.
  async earlyOpen(open) {
    const page = await open({ chatJs: CHAT_JS + "\n;window.COACH.open();\n" }); await wait(300); const l = await look(page);
    if (!l.panel || !l.open || l.view !== "fc") throw new Error(`COACH.open() before coach.js started left ${JSON.stringify(l)}`);
  },
  // The page's hooks never throw, whatever they're given, and a spot the page doesn't have leaves the tab as html.tw says.
  async hooksHold(open) {
    const page = await open({}); await wait(300);
    const errs = await page.evaluate(() => { const out = [];
      for (const [k, a] of [["spot", [undefined]], ["spot", [123]], ["spot", ["nowhere"]], ["relang", []], ["dev", []], ["open", []], ["open", []], ["spot", ["donghe"]]])
        try { window.COACH[k](...a); } catch (e) { out.push(`${k}(${a}) threw ${e}`); }
      return out; });
    if (errs.length) throw new Error(errs.join("; "));
  },
  // coach.js adds one global, window.COACH = {dev, relang, spot, open}, and nothing else; it has no HTML sinks and writes no data-zh or
  // data-ja, and no element of the coach carries them.
  async noGlobals(open) {
    const names = async page => { await settle(page); await wait(300); return page.evaluate(() => Object.getOwnPropertyNames(window)); };
    const on = await open({ test: false }), a = await names(on), b = new Set(await names(await open({ test: false, coachJs: "" }))), extra = a.filter(k => !b.has(k));
    if (!eq(extra, ["COACH"])) throw new Error(`coach.js adds ${JSON.stringify(extra)}, want only COACH`);
    const keys = await on.evaluate(() => Object.keys(window.COACH).sort());
    if (!eq(keys, ["dev", "open", "relang", "spot"])) throw new Error(`window.COACH has ${keys.join(", ")}`);
    const code = COACH_JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    const sinks = code.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|data-zh|data-ja/g);
    if (sinks) throw new Error(`coach.js uses ${[...new Set(sinks)].join(", ")}`);
    await on.tap(TAB); await settle(on);
    const tagged = await on.evaluate(() => [document.querySelector(".coachpanel"), ...document.querySelectorAll(".coachpanel *")].filter(e => [...e.attributes].some(a => /^data-(zh|ja)/.test(a.name))).length);
    if (tagged) throw new Error(`${tagged} coach elements carry data-zh or data-ja`);
  },
};

(async () => {
  const browser = await chromium.launch(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coach-shell-")); let bad = false, ctxs = [], errs = [];
  // A fresh context for every page. The page, chat.js (chatJs) and coach.js (coachJs) load from here, null leaving one out; the fake
  // backend answers what backend(url) gives back (null: the network fails); everything else is cut off. page.asked lists the backend calls.
  //   world: developer mode (World mode, the PIN in); pub: window.__chatPublic; coachPub: window.__coachPublic; url: window.__chatUrl;
  //   view: the saved view; test: window.__chatTest.
  async function open({ spot = "donghe", world = true, pub = false, coachPub = false, url = CHAT, view = "fc", test = true, store = {}, chatJs = CHAT_JS, coachJs = COACH_JS,
    backend = () => ({ body: { reports: [], online: 0, last_id: 0 } }) }) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
    ctxs.push(ctx); const asked = [], tried = [];
    await ctx.route("**/*", r => { const u = r.request().url(), bare = u.split(/[?#]/)[0];
      if (bare === PAGE) return r.continue();
      if (u.startsWith("file:") && bare.endsWith("/chat.js")) return chatJs == null ? r.abort() : r.fulfill({ contentType: "text/javascript", body: chatJs });
      if (u.startsWith("file:") && bare.endsWith("/coach.js")) return coachJs == null ? r.abort() : r.fulfill({ contentType: "text/javascript", body: coachJs });
      if (u.startsWith(CHAT + "/")) { const q = new URL(u); asked.push(q.pathname + q.search); const a = backend(q);
        return a ? r.fulfill({ status: a.status || 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(a.body) }) : r.abort(); }
      if (u.startsWith("https:") || u.startsWith("http:") || u.startsWith("wss:")) tried.push(u);
      return r.abort(); });
    await ctx.addInitScript(([o, lock]) => {
      try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", o.view); localStorage.setItem("waveslave-lang", "en"); localStorage.setItem("waveslave-world", o.world ? "1" : "0");
        for (const k in o.store) localStorage.setItem(k, o.store[k]); if (lock) sessionStorage.setItem("waveslave-unlock", lock); } catch (e) {}
      window.__chatUrl = o.url; window.__chatContact = o.contact; if (o.test) window.__chatTest = true; if (o.pub) window.__chatPublic = true; if (o.coachPub) window.__coachPublic = true; },
      [{ view, world, store, url, contact: CONTACT, test, pub, coachPub }, LOCK]);
    const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e)));
    await page.goto(PAGE + "#" + spot, { waitUntil: "load" }); await settle(page);
    page.asked = asked; page.tried = tried; return page;
  }
  // Runs one check and prints `ok <name>` or `FAIL <name>: why`; a page error during it fails it.
  async function step(name, run) {
    let status = "ok", note = ""; errs = [];
    try { await run(); } catch (e) { [status, note] = e instanceof Skip ? ["skip", e.message] : ["FAIL", e.message]; }
    if (errs.length) [status, note] = ["FAIL", "page error: " + errs.join("; ")];
    if (status === "FAIL") bad = true;
    console.log(status === "FAIL" ? `FAIL ${name}: ${note}` : `${status} ${name}${note ? ` (${note})` : ""}`);
    await Promise.all(ctxs.map(c => c.close())); ctxs = [];
  }
  // A blank page in a fresh context, for the checks that don't need the site.
  const blank = async () => { const ctx = await browser.newContext(); ctxs.push(ctx); const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e))); return page; };
  try { for (const [name, run] of Object.entries(CHECKS)) await step(name, () => run(open, { blank, tmp })); }
  finally { await browser.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  process.exitCode = bad ? 1 : 0;
})();
