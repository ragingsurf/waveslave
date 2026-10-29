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
const PARTS = ["shell", "flow", "surfer", "scenes", "view", "snap", "panel"];
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
const ready = page => page.waitForFunction(() => window.DREAMWAVE && window.DREAMWAVE._view, null, { timeout: 30000 })
  .catch(async e => { throw new Error(`the tab didn't start: "${await page.evaluate(() => (document.querySelector("#viewDw .dw-msg") || {}).textContent).catch(() => "?")}"`); });
// The picture's pixels (RGBA) in a size x size block centred at (fx, fy) of the canvas, read right after a render.
const pixels = (page, fx, fy, size) => page.evaluate(([fx, fy, n]) => { const v = window.DREAMWAVE._view, gl = v.renderer.getContext();
  v.renderer.render(v.scene, v.camera); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, out = new Uint8Array(n * n * 4);
  gl.readPixels(Math.round(w * fx - n / 2), Math.round(h * (1 - fy) - n / 2), n, n, gl.RGBA, gl.UNSIGNED_BYTE, out); return [...out]; }, [fx, fy, size]);
// Open a sheet from the bar; read the Shape sliders; move one by hand; the pressed style chip (null for none).
const sheet = async (page, s) => { await page.evaluate(s => { const b = document.querySelector(`#viewDw .dw-bar button[data-s="${s}"]`); if (b.getAttribute("aria-pressed") !== "true") b.click(); }, s); await wait(100); };
const sliders = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#viewDw .dw-sliders input")].map(i => [i.dataset.k, +i.value])));
const slide = (page, k, v) => page.evaluate(([k, v]) => { const i = document.querySelector(`#viewDw .dw-sliders input[data-k="${k}"]`); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }, [k, v]);
const pressed = page => page.evaluate(() => { const b = document.querySelector('#viewDw .dw-chip[data-id][aria-pressed="true"]'); return b ? b.dataset.id : null; });
// Hold the wave at t seconds; where the surfer's head is on the canvas (fx, fy as shares of it).
const still = (page, t) => page.evaluate(t => { const v = window.DREAMWAVE._view; v.play(false); v.setTime(t); v.render(); }, t);
const headAt = page => page.evaluate(() => { const v = window.DREAMWAVE._view, c = v.surfer.getObjectByName("head").getWorldPosition(new THREE.Vector3()).project(v.camera);
  return { fx: (c.x + 1) / 2, fy: (1 - c.y) / 2, on: Math.abs(c.x) < 1 && Math.abs(c.y) < 1 && c.z < 1 }; });
// The surfer's mesh count; tap a maker choice and wait a frame.
const meshes = page => page.evaluate(() => { let n = 0; window.DREAMWAVE._view.surfer.traverse(o => { if (o.isMesh) n++; }); return n; });
const pick = async (page, k, v) => { await page.evaluate(([k, v]) => document.querySelector(`#viewDw .dw-maker button[data-k="${k}"][data-v="${v}"]`).click(), [k, v]); await settle(page); };
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
    await page.evaluate(() => document.querySelector('#viewDw .dw-chip[data-id="slab"]').click());
    const seen = await page.evaluate(() => new Promise(r => { const out = [], t0 = performance.now(), i = document.querySelector('#viewDw .dw-sliders input[data-k="height"]');
      (function look() { out.push(+i.value); if (performance.now() - t0 < 650) requestAnimationFrame(look); else r(out); })(); }));
    if (!seen.some(h => h > 2.6 + 1e-6 && h < 3 - 1e-6)) throw new Error(`no glide: Size read ${seen.join(", ")} during the first 650 ms`);
    await page.waitForFunction(() => window.DREAMWAVE._view.S.height === 3, null, { timeout: 5000 }).catch(() => {});
    const s = await sliders(page), want = { height: 3, lipThrow: 4, faceSteepness: 105, peelSpeed: 5 };
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
    await sheet(page, "styles"); await page.evaluate(() => document.querySelector("#viewDw .dw-reset").click());
    await page.waitForFunction(() => window.DREAMWAVE._view.S.height === 2.6, null, { timeout: 5000 }).catch(() => {});
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
    await sheet(page, "styles"); const chips = await page.evaluate(() => [...document.querySelectorAll("#viewDw .dw-chip[data-id], #viewDw .dw-reset")].map(b => b.textContent).join(" "));
    if (chips !== "A字浪 厚板浪 礁岩管浪 長牆浪 軟浪 關門浪 重設") throw new Error(chips);
  },
  // The surfer shows: the pixels around their head change when they are hidden.
  async surferShows(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await still(page, 6);
    const h = await headAt(page); if (!h.on) throw new Error("the head is off screen: " + JSON.stringify(h));
    const a = await pixels(page, h.fx, h.fy, 16); await page.evaluate(() => { window.DREAMWAVE._view.surfer.visible = false; });
    const b = await pixels(page, h.fx, h.fy, 16); await page.evaluate(() => { window.DREAMWAVE._view.surfer.visible = true; });
    let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    if (d < 40) throw new Error(`hiding the surfer changed the pixels at the head by at most ${d}`);
  },
  // On the left side the surfer moves along with the curl: their x falls as t goes from 5 to 7 s.
  async ridesWithTheCurl(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    const x = await page.evaluate(() => { const v = window.DREAMWAVE._view; v.play(false); v.setSpot({ side: "left", u: 0.35, h: 0.2 }); const out = [];
      for (const t of [5, 6, 7]) { v.setTime(t); v.render(); out.push(v.surfer.position.x); } return out; });
    if (!(x[0] > x[1] && x[1] > x[2])) throw new Error(`x at 5, 6, 7 s: ${x.map(v => v.toFixed(2))}`);
  },
  // A drag from the surfer toward the opening (away from the peak) moves them out: u goes up; the camera stays put.
  async dragMovesTheSpot(open) {
    const page = await open({ world: true, touch: false }); await openTab(page); await ready(page); await still(page, 6);
    const s = await page.evaluate(() => { const v = window.DREAMWAVE._view, r = v.canvas.getBoundingClientRect(), p = v.surfer.position.clone();
      const at = q => { const c = q.clone().project(v.camera); return [r.left + (c.x + 1) / 2 * r.width, r.top + (1 - c.y) / 2 * r.height]; };
      const mid = v.surfer.getObjectByName("head").getWorldPosition(p.clone()).lerp(p, 0.5);
      return { from: at(mid), to: at(mid.clone().add({ x: -2.5, y: 0, z: 0 })), u: v.spot().u, az: v.orbit.az }; });
    await page.mouse.move(...s.from); await page.mouse.down(); for (let i = 1; i <= 10; i++) await page.mouse.move(s.from[0] + (s.to[0] - s.from[0]) * i / 10, s.from[1] + (s.to[1] - s.from[1]) * i / 10);
    await page.mouse.up(); await wait(100);
    const e = await page.evaluate(() => ({ u: window.DREAMWAVE._view.spot().u, az: window.DREAMWAVE._view.orbit.az, saved: JSON.parse(localStorage.getItem("waveslave-dreamwave")).spot }));
    if (!(e.u > s.u + 0.1)) throw new Error(`u went from ${s.u} to ${e.u}`);
    if (e.az !== s.az) throw new Error("the drag also orbited the camera");
    if (!e.saved || Math.abs(e.saved.u - e.u) > 1e-9) throw new Error(`saved spot ${JSON.stringify(e.saved)}`);
  },
  // A drag anywhere else still orbits the camera and leaves the spot alone.
  async dragElsewhereOrbits(open) {
    const page = await open({ world: true, touch: false }); await openTab(page); await ready(page); await still(page, 6);
    const a = await page.evaluate(() => ({ u: window.DREAMWAVE._view.spot().u, az: window.DREAMWAVE._view.orbit.az }));
    await page.mouse.move(200, 120); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(200 + 10 * i, 120); await page.mouse.up();
    const b = await page.evaluate(() => ({ u: window.DREAMWAVE._view.spot().u, az: window.DREAMWAVE._view.orbit.az }));
    if (b.u !== a.u || b.az === a.az) throw new Error(`${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  },
  // The spot is remembered across a reload.
  async spotRemembered(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    await page.evaluate(() => window.DREAMWAVE._view.setSpot({ side: "right", u: 1.2, h: 0.4 }));
    await page.reload({ waitUntil: "load" }); await settle(page); await openTab(page); await ready(page);
    const s = await page.evaluate(() => window.DREAMWAVE._view.spot());
    if (!eq(s, { side: "right", u: 1.2, h: 0.4 })) throw new Error(JSON.stringify(s));
  },
  // Picking curly hair rebuilds the surfer (the mesh count changes) and saves hair: "curly".
  async makerChangesSurfer(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await sheet(page, "surfer");
    const a = await meshes(page); await pick(page, "hair", "curly"); const b = await meshes(page);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("waveslave-dreamwave")).surfer);
    if (a === b) throw new Error(`curly hair left ${a} meshes`);
    if (saved.hair !== "curly") throw new Error(`saved ${JSON.stringify(saved)}`);
    if (await page.evaluate(() => document.querySelector('#viewDw .dw-chip[data-k="hair"][data-v="curly"]').getAttribute("aria-pressed")) !== "true") throw new Error("the Curly chip isn't pressed");
  },
  // A reload keeps the surfer.
  async makerRemembers(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await sheet(page, "surfer");
    await pick(page, "skin", "#4a2c18"); await pick(page, "board", "long");
    await page.reload({ waitUntil: "load" }); await settle(page); await openTab(page); await ready(page);
    const o = await page.evaluate(() => window.DREAMWAVE._view.surferOptions());
    if (o.skin !== "#4a2c18" || o.board !== "long") throw new Error(JSON.stringify(o));
  },
  // A saved surfer from an older build: a hair no longer offered falls back to spiky, the rest stays.
  async makerIgnoresUnknownSaved(open) {
    const page = await open({ world: true, store: { "waveslave-dreamwave": JSON.stringify({ surfer: { hair: "mohawk", skin: "#8d5a35" } }) } }); await openTab(page); await ready(page);
    const o = await page.evaluate(() => window.DREAMWAVE._view.surferOptions());
    if (o.hair !== "spiky" || o.skin !== "#8d5a35") throw new Error(JSON.stringify(o));
  },
  // The maker in 中文.
  async makerInChinese(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await page.evaluate(() => setLang("zh")); await sheet(page, "surfer");
    const s = await page.evaluate(() => ({ hint: document.querySelector("#viewDw .dw-hint").textContent, rows: [...document.querySelectorAll("#viewDw .dw-mname")].map(e => e.textContent).join(" "),
      hair: document.querySelector('#viewDw .dw-chip[data-k="hair"][data-v="curly"]').textContent }));
    if (s.hint !== "拖曳衝浪手到浪上你想要的位置" || s.rows !== "膚色 體型 髮型 髮色 服裝 主色 配色 衝浪板 板色 圖案 站姿 姿勢 表情 配件" || s.hair !== "捲髮") throw new Error(JSON.stringify(s));
  },
  // Twenty changes leave the renderer's geometries and textures within 5 of where they started.
  async rebuildKeepsMemorySteady(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await sheet(page, "surfer"); await wait(300);
    const mem = () => page.evaluate(() => { const m = window.DREAMWAVE._view.renderer.info.memory; return [m.geometries, m.textures]; });
    const a = await mem(), picks = [["hair", "curly"], ["hair", "long"], ["board", "fish"], ["graphic", "checker"], ["outfit", "bikini"], ["extra", "shades"], ["pose", "shaka"], ["face", "scream"], ["board", "soft"], ["graphic", "stripes"]];
    for (const p of picks.concat(picks.map(([k]) => [k, k === "hair" ? "spiky" : null]).filter(p => p[1]), picks.slice(0, 9))) { await pick(page, ...p); await wait(30); }
    const b = await mem();
    if (Math.abs(b[0] - a[0]) > 5 || Math.abs(b[1] - a[1]) > 5) throw new Error(`geometries ${a[0]} → ${b[0]}, textures ${a[1]} → ${b[1]}`);
  },
  // The GoPro nose cam keeps the surfer's head in the middle 60% of the picture as the wave peels.
  async noseCamSeesSurfer(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    await sheet(page, "camera"); await page.evaluate(() => document.querySelector('#viewDw .dw-chip[data-cam="nose"]').click()); await sheet(page, "camera");
    for (const t of [5, 6, 7]) { await still(page, t); const h = await headAt(page);
      if (!(h.fx > 0.2 && h.fx < 0.8 && h.fy > 0.2 && h.fy < 0.8)) throw new Error(`at ${t} s the head is at ${h.fx.toFixed(2)}, ${h.fy.toFixed(2)}`); }
  },
  // The head cam looks out the way the surfer travels, on both sides of the peak.
  async headCamLooksOut(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    for (const side of ["left", "right"]) {
      const d = await page.evaluate(side => { const v = window.DREAMWAVE._view; v.setCamera("head"); v.setSpot({ side, u: 0.5, h: 0.2 }); v.play(false); v.setTime(6); v.render();
        const f = v.camera.getWorldDirection(new THREE.Vector3()); return { cam: f.x, dir: v.riding.dir[0], fov: v.camera.fov, down: f.y }; }, side);
      if (Math.sign(d.cam) !== Math.sign(d.dir) || d.fov !== 100 || !(d.down < 0)) throw new Error(`${side}: ${JSON.stringify(d)}`);
    }
  },
  // The camera picked is remembered.
  async cameraRemembered(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page); await sheet(page, "camera");
    await page.evaluate(() => document.querySelector('#viewDw .dw-chip[data-cam="head"]').click());
    await page.reload({ waitUntil: "load" }); await settle(page); await openTab(page); await ready(page);
    const c = await page.evaluate(() => ({ mode: window.DREAMWAVE._view.camMode, pressed: document.querySelector('#viewDw .dw-chip[data-cam="head"]').getAttribute("aria-pressed") }));
    if (c.mode !== "head" || c.pressed !== "true") throw new Error(JSON.stringify(c));
  },
  // The snapshot is 1080 x 1920, from the current camera.
  async snapshotIs1080x1920(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    const s = await page.evaluate(() => { const v = window.DREAMWAVE._view, c = v.snapshot(1080, 1920), w = v.canvas.width, h = v.canvas.height; return { w: c.width, h: c.height, back: [w, h], aspect: v.camera.aspect }; });
    if (s.w !== 1080 || s.h !== 1920) throw new Error(`the shot is ${s.w}x${s.h}`);
    const after = await page.evaluate(() => [window.DREAMWAVE._view.canvas.width, window.DREAMWAVE._view.canvas.height]);
    if (!eq(after, s.back) || Math.abs(s.aspect - 390 / 844) > 0.01) throw new Error(`the view didn't go back: ${after}, aspect ${s.aspect}`);
  },
  // The composed picture carries the wordmark, the link and the caption, and leaves the story's top 280 and bottom 280 rows as the shot.
  async snapshotHasBranding(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    const r = await page.evaluate(async () => { const v = window.DREAMWAVE._view, shot = v.snapshot(1080, 1920), pic = await DW.snap.compose(shot, { caption: DW.snap.caption(v.S), name: "@surfer" });
      const a = shot.getContext("2d").getImageData(0, 0, 1080, 1920).data, b = pic.getContext("2d").getImageData(0, 0, 1080, 1920).data;
      const diff = (x0, y0, x1, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * 1080 + x) * 4; if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; } return n; };
      return { w: pic.width, h: pic.height, mark: diff(64, 340, 560, 450), link: diff(72, 470, 400, 520), cap: diff(100, 1430, 980, 1520), name: diff(380, 1560, 700, 1615), top: diff(0, 0, 1080, 280), bottom: diff(0, 1641, 1080, 1920) }; });
    if (r.w !== 1080 || r.h !== 1920) throw new Error(`the picture is ${r.w}x${r.h}`);
    for (const k of ["mark", "link", "cap", "name"]) if (r[k] < 200) throw new Error(`nothing drawn for the ${k}: ${JSON.stringify(r)}`);
    if (r.top || r.bottom) throw new Error(`drawn outside the safe area: ${JSON.stringify(r)}`);
  },
  // Tapping Snapshot pauses the wave (the picture is the moment they saw) and shows the preview; closing it plays on.
  async snapshotPausesTheWave(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    if (!await page.evaluate(() => window.DREAMWAVE._view.playing())) throw new Error("not playing at first");
    await sheet(page, "snap"); await page.waitForFunction(() => document.querySelector("#viewDw .dw-preview img, #viewDw .dw-preview canvas"), null, { timeout: 10000 });
    const a = await page.evaluate(() => ({ p: window.DREAMWAVE._view.playing(), t: window.DREAMWAVE._view.time() })); await wait(300);
    if (a.p || await page.evaluate(() => window.DREAMWAVE._view.time()) !== a.t) throw new Error("the wave kept playing behind the snapshot");
    await sheet(page, "snap"); await page.evaluate(() => document.querySelector('#viewDw .dw-bar button[data-s="snap"]').click()); await wait(200);
    if (!await page.evaluate(() => window.DREAMWAVE._view.playing())) throw new Error("closing the snapshot didn't play on");
  },
  // Share hands the phone's share menu one PNG and the link.
  async shareSendsPng(open) {
    const page = await open({ world: true, init: () => { window.__shared = []; Object.defineProperty(navigator, "canShare", { value: d => !!(d && d.files) });
      Object.defineProperty(navigator, "share", { value: async d => { window.__shared.push({ files: d.files.map(f => [f.name, f.type, f.size]), text: d.text }); } }); } });
    await openTab(page); await ready(page); await sheet(page, "snap"); await page.waitForSelector("#viewDw .dw-share");
    await page.evaluate(() => document.querySelector("#viewDw .dw-share").click()); await page.waitForFunction(() => window.__shared.length, null, { timeout: 10000 });
    const s = await page.evaluate(() => window.__shared[0]);
    if (s.files.length !== 1 || s.files[0][0] !== "dream-wave.png" || s.files[0][1] !== "image/png" || !(s.files[0][2] > 1000) || s.text !== "https://waveslave.tw/#dreamwave") throw new Error(JSON.stringify(s));
  },
  // No file sharing: a download named dream-wave.png. A cancelled share: no error, the sheet stays. An iPhone: the full-size picture with the hint.
  async shareFallsBackToSave(open) {
    let page = await open({ world: true, init: () => { Object.defineProperty(navigator, "canShare", { value: undefined }); } });
    await openTab(page); await ready(page); await sheet(page, "snap"); await page.waitForSelector("#viewDw .dw-share");
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.evaluate(() => document.querySelector("#viewDw .dw-share").click())]);
    if (dl.suggestedFilename() !== "dream-wave.png") throw new Error(`downloaded ${dl.suggestedFilename()}`);
    await page.context().close();   // one WebGL page at a time: SwiftShader runs out of contexts with several open
    page = await open({ world: true, init: () => { Object.defineProperty(navigator, "canShare", { value: () => true });
      Object.defineProperty(navigator, "share", { value: async () => { throw new DOMException("cancelled", "AbortError"); } }); } });
    await openTab(page); await ready(page); await sheet(page, "snap"); await page.waitForSelector("#viewDw .dw-share");
    await page.evaluate(() => document.querySelector("#viewDw .dw-share").click()); await wait(800);
    const s = await page.evaluate(() => ({ open: !document.querySelector("#viewDw .dw-sheet").hidden, err: document.querySelector("#viewDw .dw-snaperr") && document.querySelector("#viewDw .dw-snaperr").textContent }));
    if (!s.open || s.err) throw new Error(`after a cancelled share: ${JSON.stringify(s)}`);
    await page.context().close();
    page = await open({ world: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      init: () => { Object.defineProperty(navigator, "canShare", { value: undefined }); } });
    await openTab(page); await ready(page); await sheet(page, "snap"); await page.waitForSelector("#viewDw .dw-save");
    await page.evaluate(() => document.querySelector("#viewDw .dw-save").click()); await wait(800);
    const h = await page.evaluate(() => { const i = document.querySelector("#viewDw .dw-hold img"), p = document.querySelector("#viewDw .dw-hold p"); return { src: i && i.src.slice(0, 22), w: i && i.naturalWidth, hint: p && p.textContent }; });
    if (h.src !== "data:image/png;base64," || h.w !== 1080 || h.hint !== "Press and hold the picture to save it") throw new Error(JSON.stringify(h));
  },
  // Every scene draws with no page error, the top of the picture in the scene's sky colour (Neon: its dark background).
  async everySceneDraws(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    const tops = { neon: "#05010d", tropical: "#2f8fe0", eastcoast: "#6d8fae", golden: "#3a2a6a", stormy: "#3b4248" };
    for (const s in tops) {
      await page.evaluate(s => { const v = window.DREAMWAVE._view; v.setScene(s); v.play(false); v.setTime(6); }, s);
      const px = await pixels(page, 0.5, 0.01, 2), want = [1, 3, 5].map(i => parseInt(tops[s].slice(i, i + 2), 16));
      if (want.some((w, i) => Math.abs(px[i] - w) > 40)) throw new Error(`${s}: the top of the picture is ${px.slice(0, 3)}, want about ${want}`);
    }
  },
  // Neon shows the power colours and the flow, with the wireframe surfer; the realistic scenes hide the flow and show the toon surfer.
  async neonShowsFlowRealHidesIt(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    const look = s => page.evaluate(s => { const v = window.DREAMWAVE._view; v.setScene(s); let mesh = 0, lines = 0;
      v.surfer.traverse(o => { if (o.isLineSegments) lines++; else if (o.isMesh) mesh++; });
      return { flow: v.neon.trails.visible, grid: v.neon.grid.visible, mesh, lines, look: v.look }; }, s);
    const n = await look("neon"); if (!n.flow || !n.grid || n.mesh || !n.lines) throw new Error(`neon: ${JSON.stringify(n)}`);
    for (const s of ["tropical", "eastcoast", "golden", "stormy"]) { const r = await look(s); if (r.flow || r.grid || !r.mesh) throw new Error(`${s}: ${JSON.stringify(r)}`); }
  },
  // Spray in the realistic scenes, rain in Stormy; a phone gets half the particles of a computer.
  async phoneHalvesParticles(open) {
    const count = async (vw, vh, touch) => { const page = await open({ world: true, vw, vh, touch }); await openTab(page); await ready(page);
      const c = await page.evaluate(() => { const v = window.DREAMWAVE._view; v.setScene("stormy"); return v.particles(); }); await page.context().close(); return c; };
    const phone = await count(390, 844, true), big = await count(1280, 800, false);
    if (!(phone.spray > 0 && phone.rain > 0) || phone.spray * 2 !== big.spray || phone.rain * 2 !== big.rain) throw new Error(`phone ${JSON.stringify(phone)}, computer ${JSON.stringify(big)}`);
  },
  // The scene picked in the Look sheet is remembered; a first visit opens on Taiwan east coast (Bryan, Oct 29).
  async sceneRemembered(open) {
    const page = await open({ world: true }); await openTab(page); await ready(page);
    if (await page.evaluate(() => window.DREAMWAVE._view.sceneId) !== "eastcoast") throw new Error(`a first visit opens on ${await page.evaluate(() => window.DREAMWAVE._view.sceneId)}`);
    await sheet(page, "look"); await page.evaluate(() => document.querySelector('#viewDw .dw-scene[data-scene="golden"]').click());
    await page.reload({ waitUntil: "load" }); await settle(page); await openTab(page); await ready(page);
    const s = await page.evaluate(() => ({ id: window.DREAMWAVE._view.sceneId, pressed: document.querySelector('#viewDw .dw-scene[data-scene="golden"]').getAttribute("aria-pressed") }));
    if (s.id !== "golden" || s.pressed !== "true") throw new Error(JSON.stringify(s));
  },
  // ---- Phones (plan Task 13): iPhone 390 x 844 at 3x and Android 412 x 915 at 2.625x, with touch.
  // Nothing scrolls sideways, every bar button is at least 40 x 40, an open sheet leaves the top 45% of the wave showing, the three tabs fit.
  async fitsThePhone(open) {
    for (const d of PHONES) {
      const page = await open({ world: true, ...d });
      const tabs = await page.evaluate(() => { const bar = document.querySelector(".tabs"), r = bar.getBoundingClientRect();
        return [...bar.querySelectorAll("button[data-v]")].filter(b => !b.hidden).map(b => { const q = b.getBoundingClientRect(); return { v: b.dataset.v, in: q.left >= r.left - 1 && q.right <= r.right + 1, clip: b.scrollWidth > b.clientWidth + 1 }; }); });
      if (tabs.length !== 3 || tabs.some(t => !t.in || t.clip)) throw new Error(`${d.name}: tabs ${JSON.stringify(tabs)}`);
      await openTab(page); await ready(page);
      const side = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (side > 0) throw new Error(`${d.name}: scrolls sideways by ${side}px`);
      const small = await page.evaluate(() => [...document.querySelectorAll("#viewDw .dw-bar button, #viewDw .dw-x, #viewDw .dw-play")].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.s || b.className, Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 40 || x[2] < 40));
      if (small.length) throw new Error(`${d.name}: small buttons ${JSON.stringify(small)}`);
      for (const s of ["styles", "shape", "surfer", "look", "camera", "snap"]) {
        await sheet(page, s); await wait(200);
        const top = await page.evaluate(() => document.querySelector("#viewDw .dw-bottom").getBoundingClientRect().top / innerHeight);
        if (top < 0.45) throw new Error(`${d.name}: the ${s} sheet starts at ${(top * 100).toFixed(0)}% of the screen`);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (wide > 0) throw new Error(`${d.name}: the ${s} sheet scrolls sideways`);
      }
      await page.context().close();
    }
  },
  // Two fingers pinch the free camera in, not the page; one finger on the surfer moves them.
  async pinchAndDragWork(open) {
    for (const d of PHONES) {
      const page = await open({ world: true, ...d }); await openTab(page); await ready(page); await still(page, 6);
      const cdp = await page.context().newCDPSession(page), T = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
      const r0 = await page.evaluate(() => window.DREAMWAVE._view.orbit.r), cx = d.vw / 2, cy = d.vh * 0.35;
      await T("touchStart", [[cx - 40, cy], [cx + 40, cy]]);
      for (let i = 1; i <= 8; i++) await T("touchMove", [[cx - 40 - 12 * i, cy], [cx + 40 + 12 * i, cy]]);
      await T("touchEnd", []); await wait(100);
      const z = await page.evaluate(() => ({ r: window.DREAMWAVE._view.orbit.r, scale: visualViewport.scale }));
      if (!(z.r < r0 * 0.8)) throw new Error(`${d.name}: pinch out left the camera at ${z.r} (was ${r0})`);
      if (Math.abs(z.scale - 1) > 1e-3) throw new Error(`${d.name}: the page zoomed to ${z.scale}`);
      await still(page, 6);
      const s = await page.evaluate(() => { const v = window.DREAMWAVE._view, r = v.canvas.getBoundingClientRect(), p = v.surfer.position.clone();
        const at = q => { const c = q.clone().project(v.camera); return [r.left + (c.x + 1) / 2 * r.width, r.top + (1 - c.y) / 2 * r.height]; };
        const mid = v.surfer.getObjectByName("head").getWorldPosition(p.clone()).lerp(p, 0.5);
        return { from: at(mid), to: at(mid.clone().add({ x: -2.5, y: 0, z: 0 })), u: v.spot().u }; });
      await T("touchStart", [s.from]);
      for (let i = 1; i <= 10; i++) await T("touchMove", [[s.from[0] + (s.to[0] - s.from[0]) * i / 10, s.from[1] + (s.to[1] - s.from[1]) * i / 10]]);
      await T("touchEnd", []); await wait(100);
      const u = await page.evaluate(() => window.DREAMWAVE._view.spot().u);
      if (!(u > s.u + 0.1)) throw new Error(`${d.name}: a finger drag moved u from ${s.u} to ${u}`);
      await page.context().close();
    }
  },
  // The story picture is 1080 x 1920 on a phone too, whatever the screen's size and pixel ratio.
  async snapshotOnPhone(open) {
    for (const d of PHONES) {
      const page = await open({ world: true, ...d }); await openTab(page); await ready(page); await sheet(page, "snap");
      await page.waitForFunction(() => document.querySelector("#viewDw .dw-preview canvas"), null, { timeout: 15000 });
      const c = await page.evaluate(() => { const c = document.querySelector("#viewDw .dw-preview canvas"), v = window.DREAMWAVE._view; return { w: c.width, h: c.height, back: [v.canvas.width, v.canvas.height], css: [v.canvas.clientWidth, v.canvas.clientHeight] }; });
      if (c.w !== 1080 || c.h !== 1920) throw new Error(`${d.name}: the picture is ${c.w}x${c.h}`);
      await page.context().close();
    }
  },
};
const PHONES = [{ name: "iPhone", vw: 390, vh: 844, dpr: 3, touch: true }, { name: "Android", vw: 412, vh: 915, dpr: 2.625, touch: true }];

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
