// Browser checks and phone screenshots of a built page (build one with tests/map/tool.py).
// Usage: node tests/map/check.js <page.html> <outdir> shots|checks [land]
//   shots   the six home views, each <outdir>/<name>.png, a picture of #wsBox (compare two with tool.py diff). Works on any build, main's included.
//   checks  prints ok / FAIL / skip for each check, and exits 1 on any FAIL or page error. Needs the page's test hook, window.__ws.
// Every page opens in its own fresh browser context, offline (only the page itself loads, no service worker): a phone 390x844 (844x390 with land),
// dpr 2, touch, reduced motion (so no streaks, and moves jump), the intro done, English, and the map open full screen on load.
// The time bar starts at the current hour, so take two runs you mean to compare (main and the branch) in one sitting, and look at the time printed after each shot.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
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
const OLD_CA = { key: "waveslave-mapview-ca", view: { cx: -119.5, cy: 35.3, k: 1 } }; // saved before the map ran east
const home = name => { const [, spot, key, cx, cy] = HOMES.find(h => h[0] === name); return { spot, saved: { key, view: { cx, cy, k: 1 } } }; }; // open(home("tw"))
// Whether the page carries the Pacific grid: a page built without one has `pac: null` filled in (tool.py writes null, refresh.sh null and a newline).
const PAC = !/\bpac: null\s*\}/.test(fs.readFileSync(file, "utf8"));

class Skip extends Error {}
const skip = why => { throw new Skip(why); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

const CHECKS = {
  // A California view saved with a negative centre opens on the California coast (the home view fits inside the grid, so nothing moves it).
  async savedViewConverted(open) {
    if (land) skip("portrait only: sideways, the screen is wider than the California grid and the view centres on it");
    const page = await open({ spot: "trestles", saved: OLD_CA }), v = await page.evaluate(() => window.__ws.view());
    if (!near(v.cx, 240.5)) throw new Error(`view().cx is ${v.cx}, want 240.5`);
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
  // The Taiwan home view sits inside the West Pacific grid, so its pressure lines come from that grid.
  async isoSource(open) {
    const page = await open(home("tw")), src = await page.evaluate(() => window.__ws.iso());
    if (src !== "wp") throw new Error(`iso() is ${src}, want wp`);
  },
  // Either side of 180° the Pacific layer has wind, and about the same wind: no seam at the dateline.
  async datelineSeam(open) {
    if (!PAC) skip("the page has no Pacific grid");
    const page = await open(home("tw")), [a, b] = await page.evaluate(() => [window.__ws.val(179.5, 30, "wind"), window.__ws.val(180.5, 30, "wind")]);
    if (!a || !b) throw new Error(`val(179.5, 30, "wind") is ${JSON.stringify(a)} and val(180.5, 30, "wind") is ${JSON.stringify(b)}`);
    if (!(Math.abs(a.u - b.u) < 10 && Math.abs(a.v - b.v) < 10)) throw new Error(`the wind jumps across 180°: ${JSON.stringify(a)}, then ${JSON.stringify(b)}`);
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
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); // and its next-frame resize
    if (hook && !await page.evaluate(() => !!window.__ws)) throw new Error("the page has no test hook (window.__ws): build it from this branch's template");
    return page;
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
    if (mode === "shots") for (const [name, spot, key, cx, cy] of HOMES) await step(name, async () => {
      const page = await open({ spot, saved: { key, view: { cx, cy, k: 1 } }, hook: false });
      await page.locator("#wsBox").screenshot({ path: path.join(outdir, name + ".png"), animations: "disabled" });
      return await page.evaluate(() => document.getElementById("wsTime").textContent); // the time bar's hour, to see two runs sat on the same one
    });
    else for (const [name, run] of Object.entries(CHECKS)) await step(name, () => run(open));
  } finally { await browser.close(); }
  process.exitCode = bad ? 1 : 0;
})();
