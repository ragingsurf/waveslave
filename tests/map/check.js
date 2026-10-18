// Browser checks and phone screenshots of a built page (build one with tests/map/tool.py).
// Usage: node tests/map/check.js <page.html> <outdir> shots|checks [land]
//   shots   the six home views, each <outdir>/<name>.png, a picture of #wsBox (compare two with tool.py diff). Works on any build, main's included.
//           On a page whose hook can zoom, also zoomed all the way out in each layer (out-wind, out-waves, out-swell, out-rain) and a swell across 180° (dateline).
//   checks  prints ok / FAIL / skip for each check, and exits 1 on any FAIL or page error. Needs the page's test hook, window.__ws.
// Every page opens in its own fresh browser context, offline (only the page itself loads, no service worker): a phone 390x844 (844x390 with land),
// dpr 2, touch, reduced motion (so no streaks, and moves jump), the intro done, English, and the map open full screen on load.
// The time bar starts at the current hour, so take two runs you mean to compare (main and the branch) in one sitting, and look at the time printed after each shot.
// Playwright wherever node finds it (npm install playwright), else the copy this container keeps.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path"), { pathToFileURL } = require("url");

const [file, outdir, mode, orient] = process.argv.slice(2), land = orient === "land";
if (!file || !outdir || !["shots", "checks"].includes(mode) || (orient && !land)) { console.error("usage: node tests/map/check.js <page.html> <outdir> shots|checks [land]"); process.exit(2); }
const PAGE = pathToFileURL(path.resolve(file)).href;
// The page's Date.now() holds still at the moment the run starts. build() floors the hour with two Date.now() calls, and when they fall in different
// milliseconds (about once in 200 opens) the time bar starts an hour early, which would show up as a difference between two pictures.
const NOW = Date.now();

// Home views: name, spot, saved-view key, centre. Saved as {cx, cy, k: 1}, the way main and the branch both read it (California and Hawaii still negative).
const HOMES = [["tw", "donghe", "waveslave-mapview", 120.9, 23.75], ["jp", "ichinomiya", "waveslave-mapview", 135.6, 33.4], ["ca", "trestles", "waveslave-mapview-ca", -119.5, 35.3],
  ["hi", "pipeline", "waveslave-mapview-hi", -157.3, 20.6], ["au-e", "snapper", "waveslave-mapview-au-e", 152, -32.5], ["au-w", "margaret", "waveslave-mapview-au-w", 115.5, -32.5]];
const OLD_CA = { key: "waveslave-mapview-ca", view: { cx: -117.5, cy: 33.0, k: 2 } }; // saved before the map ran east, off California's home view and zoomed in
const home = name => { const [, spot, key, cx, cy] = HOMES.find(h => h[0] === name); return { spot, saved: { key, view: { cx, cy, k: 1 } } }; }; // open(home("tw"))
const MID = { key: "waveslave-mapview", view: { cx: 190, cy: 25, k: 1 } }; // Taiwan's map left in the middle of the Pacific, so zoomed out from there Hawaii is on screen
// Shots that need the hook's zoom: name, layer, saved view (none: zoomed all the way out from Donghe's first open).
const OUT = [...["wind", "waves", "swell", "rain"].map(l => ["out-" + l, l, null]), ["dateline", "swell", { key: "waveslave-mapview", view: { cx: 180, cy: 35, k: 0.3 } }]];
// Whether the page carries the Pacific grid: a page built without one has `pac: null` filled in (tool.py writes null, refresh.sh null and a newline).
const PAC = !/\bpac: null\s*\}/.test(fs.readFileSync(file, "utf8"));

class Skip extends Error {}
const skip = why => { throw new Skip(why); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
// Two screen frames, so a move has been drawn; zoomOut zooms all the way out (the hook zooms about the centre) and waits for that.
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const zoomOut = async page => { await page.evaluate(() => window.__ws.zoom(1e-6)); await settle(page); };
// The view's west, east, south and north edges: ll of the screen's corners.
const edges = page => page.evaluate(() => { const { ll, view } = window.__ws, { W, H } = view(), [l, n] = ll(0, 0), [r, s] = ll(W, H); return { l, r, s, n }; });
// A click on the map at a point's px (pixels in #wsFx), the way a tap lands.
const tapAt = async (page, [x, y]) => { const b = await page.locator("#wsFx").boundingBox(); await page.mouse.click(b.x + x, b.y + y); };
// One finger dragged straight down from a point on the screen by dy pixels, in twelve moves a frame apart the way a phone sends them; lift = false leaves the finger down.
const dragDown = async (page, [x, y], dy, lift = true) => { const s = await page.context().newCDPSession(page);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) { await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy*i/12 }] }); await page.waitForTimeout(16); }
  if (lift) await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };

const CHECKS = {
  // A California view saved with a negative centre opens where it was left, upright and sideways: -117.5 at twice the home zoom is 242.5 at 2·z0
  // (with nothing saved, Trestles opens on the old California box, at 240.5 upright and 238 sideways).
  async savedViewConverted(open) {
    const page = await open({ spot: "trestles", saved: OLD_CA }), v = await page.evaluate(() => window.__ws.view());
    if (!near(v.cx, 242.5) || !near(v.z, 2*v.z0)) throw new Error(`view() is cx ${v.cx}, z ${v.z}, want cx 242.5, z ${2*v.z0} (2·z0)`);
  },
  // px and ll are inverses of each other, here east of 180 where California sits.
  async roundTrip(open) {
    const page = await open({ spot: "trestles", saved: OLD_CA }), [lon, lat] = await page.evaluate(() => { const { px, ll } = window.__ws; return ll(...px(241.5, 33.4)); });
    if (!near(lon, 241.5) || !near(lat, 33.4)) throw new Error(`ll(px(241.5, 33.4)) is ${lon}, ${lat}`);
  },
  // Every grid is made, finest first, with the Pacific layer last when the page carries it.
  async gridsLoaded(open) {
    const page = await open(home("tw")), got = JSON.stringify(await page.evaluate(() => window.__ws.grids()));
    const want = JSON.stringify(["hi", "ca", "au", "wp", ...(PAC ? ["pac"] : [])]);
    if (got !== want) throw new Error(`grids() is ${got}, want ${want}`);
  },
  // The Taiwan home view sits inside the West Pacific grid, so its pressure lines come from that grid; zoomed out they come from the Pacific layer (none without it).
  async isoSource(open) {
    const page = await open(home("tw")), src = await page.evaluate(() => window.__ws.iso());
    if (src !== "wp") throw new Error(`iso() is ${src}, want wp`);
    await zoomOut(page); const out = await page.evaluate(() => window.__ws.iso()), want = PAC ? "pac" : null;
    if (out !== want) throw new Error(`zoomed out, iso() is ${out}, want ${want}`);
  },
  // Either side of 180° the Pacific layer has wind, and about the same wind: no seam at the dateline.
  async datelineSeam(open) {
    if (!PAC) skip("the page has no Pacific grid");
    const page = await open(home("tw")), [a, b] = await page.evaluate(() => [window.__ws.val(179.5, 30, "wind"), window.__ws.val(180.5, 30, "wind")]);
    if (!a || !b) throw new Error(`val(179.5, 30, "wind") is ${JSON.stringify(a)} and val(180.5, 30, "wind") is ${JSON.stringify(b)}`);
    if (!(Math.abs(a.u - b.u) < 10 && Math.abs(a.v - b.v) < 10)) throw new Error(`the wind jumps across 180°: ${JSON.stringify(a)}, then ${JSON.stringify(b)}`);
  },
  // Zoomed all the way out, px and ll are still inverses either side of 180° and out at California.
  async roundTripDateline(open) {
    const page = await open(home("tw")); await zoomOut(page);
    const off = await page.evaluate(() => { const { px, ll } = window.__ws, out = [];
      for (const lon of [175, 180, 185, 241.5]) for (const lat of [-40, 0, 21, 35]) { const [a, b] = ll(...px(lon, lat)); if (!(Math.abs(a - lon) < 1e-6 && Math.abs(b - lat) < 1e-6)) out.push(`ll(px(${lon}, ${lat})) is ${a}, ${b}`); }
      return out; });
    if (off.length) throw new Error(off.join("; "));
  },
  // Zooming out stops once the Pacific box (100°E–110°W, 50°S–60°N) fills the screen, so no dark sea shows around it:
  // the view stays inside the box and spans all of it one way, its whole height upright and its whole width sideways.
  async zoomOutFillsScreen(open) {
    const page = await open(home("tw")); await zoomOut(page);
    const v = await page.evaluate(() => window.__ws.view()), e = await edges(page), span = `${e.l}..${e.r} by ${e.s}..${e.n}`;
    if (v.z !== v.zmin) throw new Error(`z is ${v.z}, want zmin ${v.zmin}`);
    if (!(e.l >= 100 - 1e-9 && e.r <= 250 + 1e-9 && e.s >= -50 - 1e-9 && e.n <= 60 + 1e-9)) throw new Error(`the view spans ${span}, past the box's 100..250 by -50..60`);
    if (!(land ? near(e.l, 100, 1e-6) && near(e.r, 250, 1e-6) : near(e.s, -50, 1e-6) && near(e.n, 60, 1e-6))) throw new Error(`the view spans ${span}, want the box's whole ${land ? "width, 100..250" : "height, -50..60"}`);
  },
  // With no saved view the map opens on the country's old map: inside Taiwan's West Pacific box and filling it one way; Australia at its home zoom or closer.
  async firstOpenOldBox(open) {
    let page = await open({ spot: "donghe" }); const e = await edges(page), b = await page.evaluate(() => MAPM.OLDBOX.tw), t = 0.05;
    if (!(e.l >= b.l - 1e-9 && e.r <= b.r + 1e-9 && e.s >= b.s - 1e-9 && e.n <= b.n + 1e-9)) throw new Error(`Donghe opens on ${e.l}..${e.r} by ${e.s}..${e.n}, not inside the West Pacific box`);
    if (!((near(e.l, b.l, t) && near(e.r, b.r, t)) || (near(e.s, b.s, t) && near(e.n, b.n, t)))) throw new Error(`Donghe opens on ${e.l}..${e.r} by ${e.s}..${e.n}, which meets the West Pacific box on neither axis`);
    page = await open({ spot: "margaret" });
    const a = await page.evaluate(() => { const v = window.__ws.view(); return { z: v.z, want: Math.max(MAPM.cover(MAPM.OLDBOX.au, v.W, v.H), v.z0) }; });
    if (a.z !== a.want) throw new Error(`Margaret River opens at z ${a.z}, want ${a.want}`);
  },
  // Changing country moves the one map to the new country's home view, with no reload.
  async noReloadCountry(open) {
    const page = await open(home("tw"));
    await page.evaluate(() => { window.__mark = 1; switchCountry("hi"); }); await page.waitForTimeout(500);
    const v = await page.evaluate(() => ({ mark: window.__mark, ...(window.__ws ? window.__ws.view() : {}) }));
    if (v.mark !== 1) throw new Error("the page reloaded (window.__mark is gone)");
    if (v.MC !== "hi") throw new Error(`view().MC is ${v.MC}, want hi`);
    if (!(Math.abs(v.cx - 202.7) < 0.01)) throw new Error(`view().cx is ${v.cx}, want 202.7 (Hawaii's home)`);
  },
  // A finger dragged down the open map pans it and never pulls the page down to reload, which flashed the Forecast page on the way;
  // on the Forecast page the same drag from the top still pulls the sign past the line.
  async noPullRefreshOnMap(open) {
    const page = await open(home("tw")), b = await page.locator("#wsFx").boundingBox(); await page.evaluate(() => { window.__mark = 1; });
    await dragDown(page, [b.x + b.width/2, b.y + b.height/4], b.height/2); await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({ mark: window.__mark, sign: document.querySelector(".ptr").textContent })).catch(e => ({ err: String(e) }));
    if (r.mark !== 1) throw new Error(`the drag reloaded the page (window.__mark is gone${r.sign ? ", the sign says " + r.sign : ""})`);
    await page.evaluate(() => setView("fc", true)); await settle(page);
    await dragDown(page, [b.x + b.width/2, 150], 216, false); await settle(page);
    const sign = await page.evaluate(() => document.querySelector(".ptr").textContent);
    if (sign !== "LET GO ▲") throw new Error(`on the Forecast page the drag leaves the sign saying ${sign}, want LET GO ▲`);
  },
  // With the map open, changing country keeps the view being left under its own key, as the reload between countries used to.
  async countryKeepsView(open) {
    const page = await open(home("tw")); await page.evaluate(() => window.__ws.zoom(0.5)); await settle(page);
    const v = await page.evaluate(() => window.__ws.view()); await page.evaluate(() => switchCountry("hi")); await settle(page);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("waveslave-mapview")));
    if (!kept || !near(kept.cx, v.cx) || !near(kept.cy, v.cy) || !near(kept.k, v.z/v.z0)) throw new Error(`waveslave-mapview holds ${JSON.stringify(kept)}, want cx ${v.cx}, cy ${v.cy}, k ${v.z/v.z0}`);
  },
  // Zoomed out on Taiwan's map, tapping Pipeline switches the page to it and opens its table, with no reload.
  async tapOtherCountrySpot(open) {
    const page = await open({ spot: "donghe", saved: MID }); await zoomOut(page);
    await tapAt(page, await page.evaluate(() => { window.__mark = 1; const s = ALL.spots.pipeline; return window.__ws.px(MAPM.E(s.lon), s.lat); })); await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ mark: window.__mark, cur: CUR, shut: document.getElementById("wsSheet").hidden }));
    if (r.mark !== 1) throw new Error("the page reloaded (window.__mark is gone)");
    if (r.cur !== "pipeline") throw new Error(`CUR is ${r.cur}, want pipeline`);
    if (r.shut) throw new Error("#wsSheet is hidden: Pipeline's table did not open");
  },
  // From the Taiwan home view the home button goes all the way out with Taiwan still on screen (the view a pinch out ends on), and a second tap
  // comes back (straight there, with reduced motion).
  async homeButton(open) {
    const page = await open(home("tw"));
    await page.click("#wsHome");
    const a = await page.evaluate(() => { const v = window.__ws.view(); return { ...v, want: MAPM.clampTo(MAPM.PBOX, v.W, v.H, v.zmin, 120.9, 23.75), at: window.__ws.px(120.9, 23.75) }; });
    if (a.z !== a.zmin || !near(a.cx, a.want[0], 1e-6) || !near(a.cy, a.want[1], 1e-6)) throw new Error(`after one tap the view is cx ${a.cx}, cy ${a.cy}, z ${a.z}, want cx ${a.want[0]}, cy ${a.want[1]}, zmin ${a.zmin}`);
    if (!(a.at[0] >= 0 && a.at[0] <= a.W && a.at[1] >= 0 && a.at[1] <= a.H)) throw new Error(`after one tap Taiwan is off screen, at ${a.at}`);
    await page.click("#wsHome"); const b = await page.evaluate(() => window.__ws.view());
    if (b.z !== b.z0 || !near(b.cx, 120.9, 1e-6)) throw new Error(`after two taps z is ${b.z} and cx ${b.cx}, want z0 ${b.z0} and 120.9`);
  },
  // A pin dropped east of 180° asks Open-Meteo for a longitude in -180..180: 200°E goes out as -160.
  async pinRequestWraps(open) {
    const page = await open({ spot: "donghe", saved: MID }); await zoomOut(page);
    let got; const asked = new Promise(r => { got = r; }), wait = setTimeout(() => got(null), 3000);
    await page.route("**/api.open-meteo.com/**", r => { got(r.request().url()); return r.abort(); });
    await tapAt(page, await page.evaluate(() => window.__ws.px(200, 40))); const url = await asked; clearTimeout(wait);
    if (!url) throw new Error("no request reached api.open-meteo.com");
    const q = new URL(url).searchParams.get("longitude"), lon = +q;
    if (!(lon >= -180 && lon <= 180 && Math.abs(lon + 160) < 0.5)) throw new Error(`the pin asked for longitude=${q}, want about -160`);
  },
};

(async () => {
  fs.mkdirSync(outdir, { recursive: true });
  const browser = await chromium.launch(); let bad = false, ctxs = [], errs = [];
  // A fresh context for every page, so saved views and storage never carry over; the page itself is the only request let through.
  async function open({ spot, saved, hook = true }) {
    const ctx = await browser.newContext({ viewport: land ? { width: 844, height: 390 } : { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
    ctxs.push(ctx);
    await ctx.route("**/*", r => r.request().url().split("#")[0] === PAGE ? r.continue() : r.abort());
    await ctx.addInitScript(([saved, now]) => { Date.now = () => now; try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", "ws"); localStorage.setItem("waveslave-lang", "en");
      if (saved) localStorage.setItem(saved.key, JSON.stringify(saved.view)); } catch (e) {} }, [saved, NOW]);
    const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e)));
    await page.goto(PAGE + "#" + spot, { waitUntil: "load" });
    await page.waitForFunction(() => (document.getElementById("wsTime") || {}).textContent); // the map has drawn once
    await settle(page); // and its next-frame resize
    if (hook && !await page.evaluate(() => !!window.__ws)) throw new Error("the page has no test hook (window.__ws): build it from this branch's template");
    return page;
  }
  // A picture of #wsBox as <outdir>/<name>.png; it returns the time bar's hour, to see two runs sat on the same one.
  async function shot(page, name) {
    await page.locator("#wsBox").screenshot({ path: path.join(outdir, name + ".png"), animations: "disabled" });
    return await page.evaluate(() => document.getElementById("wsTime").textContent);
  }
  // Runs one check or shot and prints `ok <name>`, `skip <name> (why)` or `FAIL <name>: why`; a page error during it fails it.
  async function step(name, run) {
    let status = "ok", note = ""; errs = [];
    try { note = (await run()) || ""; } catch (e) { [status, note] = e instanceof Skip ? ["skip", e.message] : ["FAIL", e.message]; }
    if (errs.length) [status, note] = ["FAIL", "page error: " + errs.join("; ")];
    if (status === "FAIL") bad = true;
    console.log(status === "FAIL" ? `FAIL ${name}: ${note}` : `${status} ${name}${note ? ` (${note})` : ""}`);
    await Promise.all(ctxs.map(c => c.close())); ctxs = [];
  }
  try {
    if (mode === "shots") {
      for (const [name, spot, key, cx, cy] of HOMES) await step(name, async () => shot(await open({ spot, saved: { key, view: { cx, cy, k: 1 } }, hook: false }), name));
      for (const [name, layer, saved] of OUT) await step(name, async () => {
        const page = await open({ spot: "donghe", saved, hook: false });
        if (!await page.evaluate(() => !!(window.__ws && window.__ws.zoom))) skip("the page's hook can't zoom");
        if (!saved) await zoomOut(page);
        await page.click(`#wsLayers button[data-o="${layer}"]`); await settle(page);
        return await shot(page, name);
      });
    }
    else for (const [name, run] of Object.entries(CHECKS)) await step(name, () => run(open));
  } finally { await browser.close(); }
  process.exitCode = bad ? 1 : 0;
})();
