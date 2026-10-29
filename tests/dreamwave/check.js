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
const PARTS = ["shell", "flow", "view"];
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
// The picture's pixels (RGBA) in a size x size block centred at (fx, fy) of the canvas, read right after a render.
const pixels = (page, fx, fy, size) => page.evaluate(([fx, fy, n]) => { const v = window.DREAMWAVE._view, gl = v.renderer.getContext();
  v.renderer.render(v.scene, v.camera); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, out = new Uint8Array(n * n * 4);
  gl.readPixels(Math.round(w * fx - n / 2), Math.round(h * (1 - fy) - n / 2), n, n, gl.RGBA, gl.UNSIGNED_BYTE, out); return [...out]; }, [fx, fy, size]);
// Open a sheet from the bar; read the Shape sliders; move one by hand; the pressed style chip (null for none).
const sheet = async (page, s) => { await page.evaluate(s => { const b = document.querySelector(`#viewDw .dw-bar button[data-s="${s}"]`); if (b.getAttribute("aria-pressed") !== "true") b.click(); }, s); await wait(100); };
const sliders = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#viewDw .dw-sliders input")].map(i => [i.dataset.k, +i.value])));
const slide = (page, k, v) => page.evaluate(([k, v]) => { const i = document.querySelector(`#viewDw .dw-sliders input[data-k="${k}"]`); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }, [k, v]);
const pressed = page => page.evaluate(() => { const b = document.querySelector('#viewDw .dw-chip[aria-pressed="true"]'); return b ? b.dataset.id : null; });
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
  // The wave draws: the middle of the picture is not one flat colour.
  async drawsTheWave(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await wait(300);
    const px = await pixels(page, 0.5, 0.5, 20);
    const first = px.slice(0, 3), same = px.every((v, i) => v === first[i % 4] || i % 4 === 3);
    if (same) throw new Error(`the middle of the picture is all ${first}`);
  },
  // The loop stops when the tab is hidden (✕, or developer mode switched off) and starts again on reopening.
  async pausesWhenHidden(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    const f = () => page.evaluate(() => window.DREAMWAVE._frames());
    const rises = async (why) => { const a = await f(); await page.waitForFunction(a => window.DREAMWAVE._frames() > a + 2, a, { timeout: 8000 }).catch(() => { throw new Error(why); }); };
    const holds = async (why) => { await wait(150); const a = await f(); await wait(600); if (await f() !== a) throw new Error(why); };
    await rises("not drawing while open");
    await closeTab(page); await holds("still drawing after ✕");
    await openTab(page); await rises("not drawing after reopening");
    await page.evaluate(() => setWorld(false)); await holds("still drawing after developer mode went off");
  },
  // Open and close five times: one canvas, and the same number of geometries after the 2nd and the 5th opening.
  async reopenKeepsOneRenderer(open) {
    const page = await open({ world: true }); const counts = [];
    for (let i = 1; i <= 5; i++) { await openTab(page); await ready(page); await wait(200);
      counts.push(await page.evaluate(() => ({ c: document.querySelectorAll("#viewDw canvas").length, g: window.DREAMWAVE._view.renderer.info.memory.geometries })));
      await closeTab(page); await wait(100); }
    if (counts.some(c => c.c !== 1)) throw new Error(`canvases ${counts.map(c => c.c)}`);
    if (counts[1].g !== counts[4].g) throw new Error(`geometries ${counts.map(c => c.g)}`);
  },
  // Pause holds the time; play moves it.
  async playPause(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await wait(200);
    await page.evaluate(() => document.querySelector("#viewDw .dw-play").click()); const a = await page.evaluate(() => window.DREAMWAVE._view.time()); await wait(400);
    if (await page.evaluate(() => window.DREAMWAVE._view.time()) !== a) throw new Error("paused, the time moved");
    await page.evaluate(() => document.querySelector("#viewDw .dw-play").click()); await wait(400);
    if (!(await page.evaluate(() => window.DREAMWAVE._view.time()) !== a)) throw new Error("playing, the time held");
  },
  // Tap Slab: every slider glides there; after 900 ms they read Size 3.0, Lip throw 4.0, Steepness 105, Peel 5.0, and Slab is pressed.
  async styleGlides(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await sheet(page, "styles");
    await page.evaluate(() => document.querySelector('#viewDw .dw-chip[data-id="slab"]').click()); await wait(120);
    const mid = await sliders(page);
    if (mid.height === 3 || mid.height === 2.6) throw new Error(`no glide: Size is ${mid.height} 120 ms in`);
    await wait(900); const s = await sliders(page), want = { height: 3, lipThrow: 4, faceSteepness: 105, peelSpeed: 5 };
    for (const k in want) if (Math.abs(s[k] - want[k]) > 1e-6) throw new Error(`after the glide ${k} reads ${s[k]}, want ${want[k]}`);
    if (await pressed(page) !== "slab") throw new Error(`the pressed chip is ${await pressed(page)}`);
  },
  // Moving a slider by hand turns the style chip off.
  async handMoveTurnsStyleOff(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await sheet(page, "shape");
    if (await pressed(page) !== "aframe") throw new Error(`at first ${await pressed(page)} is pressed`);
    await slide(page, "height", 3.3);
    if (await pressed(page) !== null) throw new Error(`after a hand move ${await pressed(page)} is pressed`);
    if (await page.evaluate(() => window.DREAMWAVE._view.S.height) !== 3.3) throw new Error("the slider didn't move the wave");
  },
  // Reset goes back to the A-frame.
  async resetGoesToAFrame(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await sheet(page, "shape"); await slide(page, "height", 5);
    await sheet(page, "styles"); await page.evaluate(() => document.querySelector("#viewDw .dw-reset").click()); await wait(900);
    if (await pressed(page) !== "aframe" || (await sliders(page)).height !== 2.6) throw new Error(`after Reset: ${await pressed(page)}, Size ${(await sliders(page)).height}`);
  },
  // The wave is remembered: Size 4.2 survives a reload.
  async remembersTheWave(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await sheet(page, "shape"); await slide(page, "height", 4.2);
    await page.reload({ waitUntil: "load" }); await settle(page); await openTab(page); await ready(page);
    const h = await page.evaluate(() => window.DREAMWAVE._view.S.height);
    if (h !== 4.2) throw new Error(`after a reload Size is ${h}`);
  },
  // What the phone kept is broken ("{oops"), or localStorage throws: the tab opens on the A-frame with no page error.
  async brokenStorageUsesDefaults(open) {
    for (const o of [{ store: { "waveslave-dreamwave": "{oops" } }, { init: () => { const g = Storage.prototype.getItem, s = Storage.prototype.setItem;
        Storage.prototype.getItem = function (k) { if (k === "waveslave-dreamwave") throw new Error("denied"); return g.call(this, k); };
        Storage.prototype.setItem = function (k, v) { if (k === "waveslave-dreamwave") throw new Error("denied"); return s.call(this, k, v); }; } }]) {
      const page = await open({ world: true, ...o }); await openTab(page); await ready(page);
      const s = await page.evaluate(() => ({ h: window.DREAMWAVE._view.S.height, bar: document.querySelectorAll("#viewDw .dw-bar button").length }));
      if (s.h !== 2.6 || s.bar !== 6) throw new Error(`${JSON.stringify(o.store || "throwing")}: Size ${s.h}, ${s.bar} bar buttons`);
    }
  },
  // Saved from an older build: unknown keys and values no longer offered are dropped, the rest kept.
  async oldSavedStateFillsGaps(open) {
    const page = await open({ world: true, store: { "waveslave-dreamwave": JSON.stringify({ shape: { height: 4.2, wobble: 3, lipThrow: "far" } }) } }); await openTab(page); await ready(page);
    const s = await page.evaluate(() => { const S = window.DREAMWAVE._view.S; return { h: S.height, lt: S.lipThrow, w: "wobble" in S }; });
    if (s.h !== 4.2 || s.lt !== 2.1 || s.w) throw new Error(JSON.stringify(s));
  },
  // In 中文 the bar reads 浪型 形狀 衝浪手 場景 鏡頭 拍照.
  async panelsInChinese(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await page.evaluate(() => setLang("zh")); await wait(100);
    const words = await page.evaluate(() => [...document.querySelectorAll("#viewDw .dw-bar button")].map(b => b.textContent));
    if (words.join(" ") !== "浪型 形狀 衝浪手 場景 鏡頭 拍照") throw new Error(words.join(" "));
    await sheet(page, "styles"); const chips = await page.evaluate(() => [...document.querySelectorAll("#viewDw .dw-chip")].map(b => b.textContent).join(" "));
    if (chips !== "A字浪 厚板浪 礁岩管浪 長牆浪 軟浪 關門浪 重設") throw new Error(chips);
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
