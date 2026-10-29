// Browser checks of the Dream Wave tab on a built page (build one with tests/map/tool.py): web/dreamwave.js, its parts in web/dreamwave/
// and three.js in web/vendor/, served from this repo for the page's own addresses, and the tab's hooks in template.html.
// Usage: node tests/dreamwave/check.js <page.html> [check names…]
// Prints ok / FAIL for each check, and exits 1 on any FAIL or page error.
// Every page opens in its own fresh browser context, offline: only the page, chat.js (switched off) and the Dream Wave files load, and
// page.loads lists the Dream Wave addresses asked for, in order. A phone 390x844, dpr 2, touch, reduced motion off, the intro done,
// English, Taiwan mode and the Forecast view, unless a check says otherwise; developer mode (world: true) comes with its PIN in for the
// visit, as in tests/chat/shell.test.js. window.__dwTest lets dreamwave.js hand over what it loaded, the frames drawn and the view.
// Chromium runs WebGL in software (SwiftShader), so the 3D view draws headless.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path"), { pathToFileURL } = require("url");

const [file, ...only] = process.argv.slice(2);
if (!file) { console.error("usage: node tests/dreamwave/check.js <page.html> [check…]"); process.exit(2); }
const PAGE = pathToFileURL(path.resolve(file)).href, HTML = fs.readFileSync(file, "utf8"), WEB = path.join(__dirname, "..", "..", "web");
const LOCK = (HTML.match(/\bH="([0-9a-f]{64})"/) || [])[1];
const PARTS = ["shell", "flow"];
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const wait = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TYPES = { js: "text/javascript", png: "image/png" };

// What the page shows: the tab button (shown, its text), the layer (shown, covering the screen, on top) and Forecast.
const look = page => page.evaluate(() => { const b = document.querySelector('.tabs button[data-v="dw"]'), l = document.getElementById("viewDw"), fc = document.getElementById("viewFc");
  const vis = e => !!e && !e.hidden && getComputedStyle(e).display !== "none" && !e.closest("[hidden]"), r = l && l.getBoundingClientRect();
  const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  return { btn: vis(b), word: b && b.textContent, layer: vis(l), covers: !!r && r.left <= 0 && r.top <= 0 && r.right >= innerWidth && r.bottom >= innerHeight && !!top && l.contains(top),
    fc: vis(fc), msg: l ? (l.querySelector(".dw-msg") || {}).textContent || "" : "", scroll: getComputedStyle(document.documentElement).overflow,
    meta: document.querySelector('meta[name="viewport"]').content }; });
const openTab = async page => { await page.evaluate(() => document.querySelector('.tabs button[data-v="dw"]').click()); await page.waitForTimeout(400); await settle(page); };
const ready = page => page.waitForFunction(() => window.DREAMWAVE && window.DREAMWAVE._view, null, { timeout: 30000 });
const closeTab = page => page.evaluate(() => document.querySelector("#viewDw .dw-x").click());

const CHECKS = {
  // Taiwan mode, as everyone sees the site until Bryan says "go live": no Dream Wave button and no layer.
  async hiddenInTaiwanMode(open) {
    const page = await open({}), l = await look(page);
    if (l.btn || l.layer) throw new Error(`in Taiwan mode the button ${l.btn ? "shows" : "is hidden"} and the layer ${l.layer ? "shows" : "is hidden"}`);
  },
  // Developer mode: the third tab reads Dream Wave, and 夢幻浪 in 中文.
  async showsInDeveloperMode(open) {
    const page = await open({ world: true }); let l = await look(page);
    if (!l.btn || l.word !== "Dream Wave") throw new Error(`in developer mode the button ${l.btn ? "shows" : "is hidden"} and reads "${l.word}"`);
    const order = await page.evaluate(() => [...document.querySelectorAll(".tabs button")].map(b => b.dataset.v));
    if (!eq(order, ["fc", "ws", "dw"])) throw new Error(`the tabs are ${order}`);
    await page.evaluate(() => setLang("zh")); l = await look(page);
    if (l.word !== "夢幻浪") throw new Error(`in 中文 the button reads "${l.word}"`);
  },
  // Nothing 3D loads before the tab opens; then three.js and every part load once, in order.
  async noThreeBeforeOpening(open) {
    const page = await open({ world: true }); await wait(500);
    if (page.loads.length) throw new Error(`before opening the page asked for ${page.loads.join(", ")}`);
    await openTab(page); await ready(page);
    const want = ["vendor/three.min.js", ...PARTS.map(p => `dreamwave/${p}.js`)];
    const got = page.loads.map(u => u.replace(/^.*\/(vendor|dreamwave)\//, "$1/").split("?")[0]);
    if (!eq(got, want)) throw new Error(`loaded ${got.join(", ")}, want ${want.join(", ")}`);
    const order = await page.evaluate(() => window.DREAMWAVE._loaded.map(u => u.replace(/^.*\/(vendor|dreamwave)\//, "$1/").split("?")[0]));
    if (!eq(order, want)) throw new Error(`ran ${order.join(", ")}`);
    await closeTab(page); await openTab(page); await wait(300);
    if (page.loads.length !== want.length) throw new Error(`reopening loaded ${page.loads.length - want.length} more files`);
  },
  // Tap Dream Wave: the layer covers the screen, Forecast hides, the page can't scroll or zoom; ✕ goes back to Forecast, and so does Esc.
  async opensAndCloses(open) {
    const page = await open({ world: true });
    for (const how of ["x", "esc"]) {
      await openTab(page); let l = await look(page);
      if (!l.layer || !l.covers || l.fc) throw new Error(`open: the layer ${l.layer ? "shows" : "is hidden"}, ${l.covers ? "covers" : "doesn't cover"} the screen, Forecast ${l.fc ? "shows" : "is hidden"}`);
      if (l.scroll !== "hidden" || !/maximum-scale=1/.test(l.meta)) throw new Error(`open: the page scrolls (${l.scroll}) or zooms (${l.meta})`);
      if (how === "x") await closeTab(page); else await page.keyboard.press("Escape");
      await page.waitForTimeout(300); l = await look(page);
      if (l.layer || !l.fc) throw new Error(`after ${how}: the layer ${l.layer ? "shows" : "is hidden"}, Forecast ${l.fc ? "shows" : "is hidden"}`);
      if (l.scroll === "hidden" || /maximum-scale/.test(l.meta)) throw new Error(`after ${how}: the page is still locked (${l.scroll}, ${l.meta})`);
    }
  },
  // From the map, Dream Wave closes the map first; from the tab, Map opens the map.
  async mapAndTab(open) {
    const page = await open({ world: true, view: "ws" }); await wait(300);
    await openTab(page); let s = await page.evaluate(() => ({ ws: document.getElementById("viewWs").hidden, dw: document.getElementById("viewDw").hidden }));
    if (!s.ws || s.dw) throw new Error(`from the map: map hidden ${s.ws}, tab hidden ${s.dw}`);
    await page.evaluate(() => document.querySelector('.tabs button[data-v="ws"]').click()); await page.waitForTimeout(1500);
    s = await page.evaluate(() => ({ ws: document.getElementById("viewWs").hidden, dw: document.getElementById("viewDw").hidden, fc: document.getElementById("viewFc").hidden }));
    if (s.ws || !s.dw || !s.fc) throw new Error(`Map from the tab: map hidden ${s.ws}, tab hidden ${s.dw}, Forecast hidden ${s.fc}`);
  },
  // waveslave.tw/#dreamwave opens the tab in developer mode, and leaves Forecast showing in Taiwan mode.
  async linkOpensTab(open) {
    let page = await open({ world: true, hash: "dreamwave" }); await wait(400); let l = await look(page);
    if (!l.layer) throw new Error("in developer mode #dreamwave didn't open the tab");
    page = await open({ hash: "dreamwave" }); await wait(400); l = await look(page);
    if (l.layer || !l.fc) throw new Error("in Taiwan mode #dreamwave hid Forecast");
  },
  // Developer mode switched off with the tab open: Forecast shows and the button hides.
  async devOffLeavesTab(open) {
    const page = await open({ world: true }); await openTab(page);
    await page.evaluate(() => setWorld(false)); await wait(400); const l = await look(page);
    if (l.layer || !l.fc || l.btn) throw new Error(`after leaving developer mode: layer ${l.layer}, Forecast ${l.fc}, button ${l.btn}`);
    if (l.scroll === "hidden") throw new Error("the page is still locked");
  },
  // three.js fails to load: the tab says it can't start, ✕ still goes back, no page error.
  async loadFailureShowsMessage(open) {
    const page = await open({ world: true, abort: /vendor\/three/ }); await openTab(page); await page.waitForTimeout(500);
    let l = await look(page);
    if (l.msg !== "The Dream Wave can't start on this device.") throw new Error(`the tab says "${l.msg}"`);
    await closeTab(page); await page.waitForTimeout(200); l = await look(page);
    if (l.layer || !l.fc) throw new Error("✕ didn't go back to Forecast");
  },
  // dreamwave.js missing: the page shows Forecast as before, with no page error.
  async forecastUnchanged(open) {
    const page = await open({ world: true, abort: /dreamwave\.js/ }); await wait(300); const l = await look(page);
    if (!l.fc || l.layer) throw new Error("without dreamwave.js Forecast doesn't show");
    const n = await page.evaluate(() => document.querySelectorAll("#viewFc .day, #viewFc section").length);
    if (!n) throw new Error("Forecast is empty");
  },
};

class Skip extends Error {}
(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  let bad = false, ctxs = [], errs = [];
  async function open({ hash = "donghe", world = false, lang = "en", view = "fc", store = {}, abort = null, vw = 390, vh = 844, dpr = 2, touch = true, ua = null, reduce = false, init = null }) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, hasTouch: touch, reducedMotion: reduce ? "reduce" : "no-preference", serviceWorkers: "block", ...(ua ? { userAgent: ua } : {}), acceptDownloads: true });
    ctxs.push(ctx); const loads = [];
    await ctx.route("**/*", r => { const u = r.request().url(), bare = u.split(/[?#]/)[0];
      if (bare === PAGE) return r.continue();
      if (!u.startsWith("file:")) return r.abort();
      if (abort && abort.test(bare)) return r.abort();
      const m = bare.match(/\/(chat\.js|dreamwave\.js|dreamwave\/[\w-]+\.js|vendor\/[\w.-]+\.js)$/);
      if (!m) return r.abort();
      if (m[1] !== "chat.js" && m[1] !== "dreamwave.js") loads.push(u);
      return r.fulfill({ contentType: TYPES.js, body: fs.readFileSync(path.join(WEB, m[1])) }); });
    await ctx.addInitScript(([o, lock]) => {
      try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", o.view); localStorage.setItem("waveslave-lang", o.lang); localStorage.setItem("waveslave-world", o.world ? "1" : "0");
        for (const k in o.store) localStorage.setItem(k, o.store[k]); if (lock) sessionStorage.setItem("waveslave-unlock", lock); } catch (e) {}
      window.__chatUrl = ""; window.__dwTest = true; }, [{ view, world, store, lang }, LOCK]);
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e)));
    await page.goto(PAGE + "#" + hash, { waitUntil: "load" }); await settle(page);
    page.loads = loads; return page;
  }
  async function step(name, run) {
    let status = "ok", note = ""; errs = [];
    try { await run(); } catch (e) { [status, note] = e instanceof Skip ? ["skip", e.message] : ["FAIL", e.message]; }
    if (errs.length) [status, note] = ["FAIL", "page error: " + errs.join("; ") + (note ? " / " + note : "")];
    if (status === "FAIL") bad = true;
    console.log(status === "FAIL" ? `FAIL ${name}: ${note}` : `${status} ${name}${note ? ` (${note})` : ""}`);
    await Promise.all(ctxs.map(c => c.close())); ctxs = [];
  }
  try { for (const [name, run] of Object.entries(CHECKS)) if (!only.length || only.includes(name)) await step(name, () => run(open)); }
  finally { await browser.close(); }
  process.exitCode = bad ? 1 : 0;
})();
