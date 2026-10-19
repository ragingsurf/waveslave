// Browser checks and phone screenshots of a built page (build one with tests/map/tool.py).
// Usage: node tests/map/check.js <page.html> <outdir> shots|checks [land]
//   shots   the eighteen home views, each <outdir>/<name>.png, a picture of #wsBox (compare two with tool.py diff). Works on any build, main's included.
//           On a page whose hook can zoom, also zoomed all the way out in each layer (out-wind, out-waves, out-swell, out-rain) and a swell across 180° (dateline).
//   checks  prints ok / FAIL / skip for each check, and exits 1 on any FAIL or page error. Needs the page's test hook, window.__ws.
// Every page opens in its own fresh browser context, offline (only the page itself loads, no service worker): a phone 390x844 (844x390 with land),
// dpr 2, touch, reduced motion (so no streaks, and moves jump), the intro done, unlocked, English, World mode (every country; world: false for
// Taiwan mode, the page's default) and the map open full screen on load.
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
  ["hi", "pipeline", "waveslave-mapview-hi", -157.3, 20.6], ["au-e", "snapper", "waveslave-mapview-au-e", 152, -32.5], ["au-w", "margaret", "waveslave-mapview-au-w", 115.5, -32.5],
  ["nw", "coxbay", "waveslave-mapview-nw", -124.7, 46.1], ["kr", "jukdo", "waveslave-mapview-kr", 127.75, 35.7], ["hk", "cheungsha", "waveslave-mapview-hk", 114.17, 22.32],
  ["hn", "dadonghai", "waveslave-mapview-hn", 109.93, 18.44],
  ["ph", "cloud9", "waveslave-mapview-ph", 122.6, 13.8], ["id", "uluwatu", "waveslave-mapview-id", 116, -8.75], ["nz", "raglan", "waveslave-mapview-nz", 174.3, -41.8],
  ["pi-w", "cloudbreak", "waveslave-mapview-pi-w", -177.15, -17.8], ["pi-e", "teahupoo", "waveslave-mapview-pi-e", -154.93, -19.5],
  ["ak", "cannonbeach", "waveslave-mapview-ak", -144.6, 58.4], ["mi-w", "umatac", "waveslave-mapview-mi-w", 145.22, 14.24], ["mi-e", "ppass", "waveslave-mapview-mi-e", 164.74, 6.21]];
const OLD_CA = { key: "waveslave-mapview-ca", view: { cx: -117.5, cy: 33.0, k: 2 } }; // saved before the map ran east, off California's home view and zoomed in
const home = name => { const [, spot, key, cx, cy] = HOMES.find(h => h[0] === name); return { spot, saved: { key, view: { cx, cy, k: 1 } } }; }; // open(home("tw"))
const MID = { key: "waveslave-mapview", view: { cx: 190, cy: 25, k: 1 } }; // Taiwan's map left in the middle of the Pacific, so zoomed out from there Hawaii is on screen
// Shots that need the hook's zoom: name, layer, saved view (none: zoomed all the way out from Donghe's first open).
const OUT = [...["wind", "waves", "swell", "rain"].map(l => ["out-" + l, l, null]), ["dateline", "swell", { key: "waveslave-mapview", view: { cx: 180, cy: 35, k: 0.3 } }]];
// Whether the page carries the Pacific grid: a page built without one has `pac: null` filled in (tool.py writes null, refresh.sh null and a newline).
const PAC = !/\bpac: null\s*\}/.test(fs.readFileSync(file, "utf8"));
// Whether it carries the Pacific Northwest grid (a grid is a JSON object, unlike the nw: {l: ...} boxes in the page's code).
const NWG = /\bnw: \{"/.test(fs.readFileSync(file, "utf8"));
// And Indonesia's (none in a build from before Indonesia, or before its first grid fetch), and New Zealand's, the South Pacific's, Alaska's, Micronesia's and Hong Kong's likewise.
const IDG = /\bid: \{"/.test(fs.readFileSync(file, "utf8"));
const NZG = /\bnz: \{"/.test(fs.readFileSync(file, "utf8"));
const PIG = /\bpi: \{"/.test(fs.readFileSync(file, "utf8"));
const AKG = /\bak: \{"/.test(fs.readFileSync(file, "utf8"));
const MIG = /\bmi: \{"/.test(fs.readFileSync(file, "utf8"));
const HKG = /\bhk: \{"/.test(fs.readFileSync(file, "utf8"));
// A site build (web/head.html on top) opens on the passcode screen; each fresh context starts unlocked with the page's own code hash.
const LOCK = (fs.readFileSync(file, "utf8").match(/\bH="([0-9a-f]{64})"/) || [])[1];

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

// One country's first open and home view (see the korea check): c and its first spot.
async function homeBox(open, c, spot) {
  const page = await open({ spot });
  if (!await page.evaluate(id => !!ALL.spots[id], spot)) skip(`the page has no ${spot}`);
  const e = await edges(page), b = await page.evaluate(c => MAPM.OLDBOX[c], c), t = 0.05;
  if (!(e.l >= b.l - 1e-9 && e.r <= b.r + 1e-9 && e.s >= b.s - 1e-9 && e.n <= b.n + 1e-9)) throw new Error(`${spot} opens on ${e.l}..${e.r} by ${e.s}..${e.n}, not inside ${c}'s box`);
  if (!((near(e.l, b.l, t) && near(e.r, b.r, t)) || (near(e.s, b.s, t) && near(e.n, b.n, t)))) throw new Error(`${spot} opens on ${e.l}..${e.r} by ${e.s}..${e.n}, which meets ${c}'s box on neither axis`);
  const hid = () => page.evaluate(c => { const rect = e => e.getBoundingClientRect(), fx = rect(document.getElementById("wsFx"));
    const over = [...document.querySelectorAll("#wsLayers button, #wsCtry button, #viewWs .zoom button, #wsPlay, #wsTime, #wsTl")].filter(b => b.offsetParent).map(rect);
    return countrySpots(c).filter(id => { const s = ALL.spots[id], [x, y] = window.__ws.px(MAPM.E(s.lon), s.lat), X = fx.left + x, Y = fx.top + y;
      return x < 0 || y < 0 || x > fx.width || y > fx.height || over.some(r => X > r.left - 6 && X < r.right + 6 && Y > r.top - 6 && Y < r.bottom + 6); }); }, c);
  let out = await hid(); if (out.length) throw new Error(`on ${c}'s first open ${out.join(", ")} is off the map or under a button`);
  await page.click('#wsCtry button[data-c="jp"]'); await settle(page);
  await page.click(`#wsCtry button[data-c="${c}"]`); await settle(page);
  const n = await page.evaluate(() => ({ c: spotCountry(CUR), ...window.__ws.view(), h: window.__ws.home() }));
  if (n.c !== c || n.MC !== c || !near(n.cx, n.h.cx, 1e-6) || !near(n.cy, n.h.cy, 1e-6) || n.z !== n.z0) throw new Error(`after the map's Japan then ${c} buttons the page is on ${n.c}, view() MC ${n.MC}, centre ${n.cx}, ${n.cy}, z ${n.z}; want ${c}, ${c}, the home view's ${n.h.cx}, ${n.h.cy}, z0 ${n.z0}`);
  out = await hid(); if (out.length) throw new Error(`on ${c}'s home view ${out.join(", ")} is off the map or under a button`);
}

// A country that never had a map of its own, so has no box to open on (Alaska, Hong Kong, Hainan): c, its first spot and its home view A. With
// nothing saved, the spot opens on the home view with every spot of the country on the map and clear of the buttons and the time bar.
// Upright the home view's width sets the zoom the fit for the names starts from (home().z1), sideways its height. From Japan's, the map's
// country button brings it back there. It gives back the first open's edges.
async function ownHome(open, c, spot, A) {
  const page = await open({ spot });
  if (!await page.evaluate(id => !!ALL.spots[id], spot)) skip(`the page has no ${spot}`);
  const v = await page.evaluate(() => ({ ...window.__ws.view(), h: window.__ws.home() })), byW = v.W/A.wide, byH = v.H*Math.cos(A.cy*Math.PI/180)/A.span, e = await edges(page);
  if (land ? !(byH < byW) : !(byW < byH)) throw new Error(`on a ${v.W}x${v.H} screen ${c}'s ${land ? "height" : "width"} isn't the tighter fit (${byW} by width, ${byH} by height)`);
  if (v.MC !== c || !near(v.cx, v.h.cx, 1e-6) || !near(v.cy, v.h.cy, 1e-6) || !near(v.h.z1, Math.min(byW, byH), 1e-9) || v.z !== v.z0) throw new Error(`${spot} opens on ${v.MC} at ${v.cx}, ${v.cy}, z ${v.z} (z0 ${v.z0}, z1 ${v.h.z1}); want ${c} on the home view's ${v.h.cx}, ${v.h.cy}, z1 ${Math.min(byW, byH)}`);
  const hid = () => page.evaluate(c => { const rect = e => e.getBoundingClientRect(), fx = rect(document.getElementById("wsFx"));
    const over = [...document.querySelectorAll("#wsLayers button, #wsCtry button, #viewWs .zoom button, #wsPlay, #wsTime, #wsTl")].filter(b => b.offsetParent).map(rect);
    return countrySpots(c).filter(id => { const s = ALL.spots[id], [x, y] = window.__ws.px(MAPM.E(s.lon), s.lat), X = fx.left + x, Y = fx.top + y;
      return x < 0 || y < 0 || x > fx.width || y > fx.height || over.some(r => X > r.left - 6 && X < r.right + 6 && Y > r.top - 6 && Y < r.bottom + 6); }); }, c);
  let out = await hid(); if (out.length) throw new Error(`on ${c}'s first open ${out.join(", ")} is off the map or under a button`);
  await page.click('#wsCtry button[data-c="jp"]'); await settle(page);
  await page.click(`#wsCtry button[data-c="${c}"]`); await settle(page);
  const n = await page.evaluate(() => ({ c: spotCountry(CUR), ...window.__ws.view(), h: window.__ws.home() }));
  if (n.c !== c || n.MC !== c || !near(n.cx, n.h.cx, 1e-6) || !near(n.cy, n.h.cy, 1e-6) || n.z !== n.z0) throw new Error(`after the map's Japan then ${c} buttons the page is on ${n.c}, view() MC ${n.MC}, centre ${n.cx}, ${n.cy}, z ${n.z}; want ${c}, ${c}, the home view's ${n.h.cx}, ${n.h.cy}, z0 ${n.z0}`);
  out = await hid(); if (out.length) throw new Error(`on ${c}'s home view ${out.join(", ")} is off the map or under a button`);
  return e;
}

// A country with two parts, west and east of the longitude at, where the current spot picks the part (the South Pacific, Micronesia): each
// part's first spot, another spot in it (mate) and its home view. With nothing saved, a spot opens on its part's home view with every spot
// of the part on the map and clear of the buttons and the time bar; upright the part's width sets the zoom the fit for the names starts
// from (home().z1), sideways its height. Another spot in the same part leaves the map where it is. A spot in the other part moves the map
// to that part's home view and keeps the view left under its own part's key, where the next open finds it, and from Japan's the map's
// country button brings back the part of the spot last open.
async function twoParts(open, c, at, PARTS) {
  for (const [part, other] of [["w", "e"], ["e", "w"]]) {
    const P = PARTS[part], O = PARTS[other], page = await open({ spot: P.spot });
    if (!await page.evaluate(id => !!ALL.spots[id], P.spot)) skip(`the page has no ${P.spot}`);
    const v = await page.evaluate(() => ({ ...window.__ws.view(), h: window.__ws.home() })), byW = v.W/P.wide, byH = v.H*Math.cos(P.cy*Math.PI/180)/P.span;
    if (land ? !(byH < byW) : !(byW < byH)) throw new Error(`on a ${v.W}x${v.H} screen the ${part} part's ${land ? "height" : "width"} isn't the tighter fit (${byW} by width, ${byH} by height)`);
    if (v.MC !== c || !near(v.cx, v.h.cx, 1e-6) || !near(v.cy, v.h.cy, 1e-6) || !near(v.h.z1, Math.min(byW, byH), 1e-9) || v.z !== v.z0)
      throw new Error(`${P.spot} opens on ${v.MC} at ${v.cx}, ${v.cy}, z ${v.z} (z0 ${v.z0}, z1 ${v.h.z1}); want ${c} on the home view's ${v.h.cx}, ${v.h.cy}, z1 ${Math.min(byW, byH)}`);
    const out = await page.evaluate(([c, at, east]) => { const rect = e => e.getBoundingClientRect(), fx = rect(document.getElementById("wsFx"));
      const over = [...document.querySelectorAll("#wsLayers button, #wsCtry button, #viewWs .zoom button, #wsPlay, #wsTime, #wsTl")].filter(b => b.offsetParent).map(rect);
      return countrySpots(c).filter(id => (MAPM.E(ALL.spots[id].lon) >= at) === east).filter(id => { const s = ALL.spots[id], [x, y] = window.__ws.px(MAPM.E(s.lon), s.lat), X = fx.left + x, Y = fx.top + y;
        return x < 0 || y < 0 || x > fx.width || y > fx.height || over.some(r => X > r.left - 6 && X < r.right + 6 && Y > r.top - 6 && Y < r.bottom + 6); }); }, [c, at, part === "e"]);
    if (out.length) throw new Error(`on the ${part} part's home view ${out.join(", ")} is off the map or under a button`);
    await page.evaluate(() => window.__ws.zoom(2)); await settle(page); const left = await page.evaluate(() => ({ ...window.__ws.view(), h: window.__ws.home() }));
    await page.evaluate(id => switchSpot(id), P.mate); await settle(page);
    const s = await page.evaluate(() => ({ cur: CUR, ...window.__ws.view() }));
    if (s.cur !== P.mate || s.MC !== c || !near(s.cx, left.cx) || !near(s.cy, left.cy) || !near(s.z, left.z)) throw new Error(`after ${P.mate}, in the same part, the page is on ${s.cur} and the map moved from ${left.cx}, ${left.cy}, z ${left.z} to ${s.MC} at ${s.cx}, ${s.cy}, z ${s.z}`);
    await page.evaluate(id => switchSpot(id), O.spot); await settle(page);
    const m = await page.evaluate(k => ({ ...window.__ws.view(), h: window.__ws.home(), kept: JSON.parse(localStorage.getItem(k)) }), `waveslave-mapview-${c}-${part}`);
    if (m.MC !== c || !near(m.cx, m.h.cx, 1e-6) || !near(m.cy, m.h.cy, 1e-6) || m.z !== m.z0 || near(m.h.cx, left.h.cx, 0.01)) throw new Error(`after ${O.spot} the map is ${m.MC} at ${m.cx}, ${m.cy}, z ${m.z}; want ${c} on the ${other} part's home view, ${m.h.cx}, ${m.h.cy}, z0 ${m.z0}`);
    if (!m.kept || !near(m.kept.cx, left.cx) || !near(m.kept.cy, left.cy) || !near(m.kept.k, left.z/left.h.z1, 1e-9)) throw new Error(`waveslave-mapview-${c}-${part} holds ${JSON.stringify(m.kept)}, want cx ${left.cx}, cy ${left.cy}, k ${left.z/left.h.z1}`);
    const b = await (await open({ spot: P.spot, saved: { key: `waveslave-mapview-${c}-${part}`, view: m.kept } })).evaluate(() => window.__ws.view());
    if (!near(b.cx, left.cx, 1e-6) || !near(b.cy, left.cy, 1e-6) || !near(b.z, left.z, 1e-9)) throw new Error(`${P.spot} opened with that view kept is at ${b.cx}, ${b.cy}, z ${b.z}; want ${left.cx}, ${left.cy}, z ${left.z}`);
    await page.click('#wsCtry button[data-c="jp"]'); await settle(page);
    await page.click(`#wsCtry button[data-c="${c}"]`); await settle(page);
    const n = await page.evaluate(() => ({ cur: CUR, ...window.__ws.view(), h: window.__ws.home() }));
    if (n.cur !== O.spot || n.MC !== c || !near(n.cx, m.h.cx, 1e-6) || !near(n.cy, m.h.cy, 1e-6) || n.z !== n.z0) throw new Error(`after the map's Japan then ${c} buttons the page is on ${n.cur}, view() MC ${n.MC}, centre ${n.cx}, ${n.cy}, z ${n.z}; want ${O.spot}, ${c}, the ${other} part's home view ${m.h.cx}, ${m.h.cy}, z0 ${n.z0}`);
  }
}

const CHECKS = {
  // A California view saved with a negative centre opens where it was left, upright and sideways: -117.5 at twice the home zoom is 242.5 at
  // 2·z1, the home zoom before the fit for the names, which saved views go by (with nothing saved, Trestles opens on the old California box,
  // at 240.5 upright and 238 sideways).
  async savedViewConverted(open) {
    const page = await open({ spot: "trestles", saved: OLD_CA }), v = await page.evaluate(() => ({ ...window.__ws.view(), h: window.__ws.home() }));
    if (!near(v.cx, 242.5) || !near(v.z, 2*v.h.z1)) throw new Error(`view() is cx ${v.cx}, z ${v.z}, want cx 242.5, z ${2*v.h.z1} (2·z1)`);
  },
  // px and ll are inverses of each other, here east of 180 where California sits.
  async roundTrip(open) {
    const page = await open({ spot: "trestles", saved: OLD_CA }), [lon, lat] = await page.evaluate(() => { const { px, ll } = window.__ws; return ll(...px(241.5, 33.4)); });
    if (!near(lon, 241.5) || !near(lat, 33.4)) throw new Error(`ll(px(241.5, 33.4)) is ${lon}, ${lat}`);
  },
  // Every grid is made, finest first, with the Pacific layer last when the page carries it.
  async gridsLoaded(open) {
    const page = await open(home("tw")), got = JSON.stringify(await page.evaluate(() => window.__ws.grids()));
    const want = JSON.stringify([...(HKG ? ["hk"] : []), ...(NWG ? ["nw"] : []), "hi", "ca", ...(AKG ? ["ak"] : []), "au", ...(IDG ? ["id"] : []), ...(NZG ? ["nz"] : []), ...(PIG ? ["pi"] : []), ...(MIG ? ["mi"] : []), "wp", ...(PAC ? ["pac"] : [])]);
    if (got !== want) throw new Error(`grids() is ${got}, want ${want}`);
  },
  // The Taiwan home view sits inside the West Pacific grid, so its pressure lines come from that grid; zoomed out they come from the Pacific layer (none without it).
  async isoSource(open) {
    const page = await open(home("tw")), src = await page.evaluate(() => window.__ws.iso());
    if (src !== "wp") throw new Error(`iso() is ${src}, want wp`);
    await zoomOut(page); const out = await page.evaluate(() => window.__ws.iso()), want = PAC ? "pac" : null;
    if (out !== want) throw new Error(`zoomed out, iso() is ${out}, want ${want}`);
  },
  // Indonesia's home view, both ways up, sits inside its own grid (16–2°S, 100–132°E), so its pressure lines come from that grid,
  // or from the Pacific layer when the page has no Indonesia grid.
  async indonesiaIso(open) {
    const page = await open(home("id"));
    if (!await page.evaluate(() => !!ALL.spots.uluwatu)) skip("the page has no Indonesian spots");
    const src = await page.evaluate(() => window.__ws.iso()), want = IDG ? "id" : PAC ? "pac" : null;
    if (src !== want) throw new Error(`iso() is ${src}, want ${want}`);
  },
  // Hong Kong's home view, both ways up, sits inside its own grid (21.5–23.125°N, 113.5–114.75°E), the finest, so its pressure lines come
  // from that grid, or from the West Pacific grid when the page has no Hong Kong grid.
  async hongKongIso(open) {
    const page = await open(home("hk"));
    if (!await page.evaluate(() => !!ALL.spots.cheungsha)) skip("the page has no Hong Kong spots");
    const src = await page.evaluate(() => window.__ws.iso()), want = HKG ? "hk" : "wp";
    if (src !== want) throw new Error(`iso() is ${src}, want ${want}`);
  },
  // Hainan has no grid of its own: its home view, both ways up, lies inside the West Pacific grid (0–45°N, 100–160°E) and south of Hong
  // Kong's, so its pressure lines come from the West Pacific grid.
  async hainanIso(open) {
    const page = await open(home("hn"));
    if (!await page.evaluate(() => !!ALL.spots.dadonghai)) skip("the page has no Hainan spots");
    const src = await page.evaluate(() => window.__ws.iso());
    if (src !== "wp") throw new Error(`iso() is ${src}, want wp`);
  },
  // New Zealand's likewise, inside its own grid (50–32°S, 150°E–162°W), which runs past 180°.
  async newZealandIso(open) {
    const page = await open(home("nz"));
    if (!await page.evaluate(() => !!ALL.spots.raglan)) skip("the page has no New Zealand spots");
    const src = await page.evaluate(() => window.__ws.iso()), want = NZG ? "nz" : PAC ? "pac" : null;
    if (src !== want) throw new Error(`iso() is ${src}, want ${want}`);
  },
  // The South Pacific's two home views held sideways sit inside its grid (24–10°S, 170°E–144°W); upright their width sets the zoom, so their
  // height runs past it and the pressure lines come from the Pacific layer.
  async southPacificIso(open) {
    for (const name of ["pi-w", "pi-e"]) {
      const page = await open(home(name));
      if (!await page.evaluate(() => !!ALL.spots.cloudbreak)) skip("the page has no South Pacific spots");
      const src = await page.evaluate(() => window.__ws.iso()), want = PIG && land ? "pi" : PAC ? "pac" : null;
      if (src !== want) throw new Error(`on ${name}'s home view iso() is ${src}, want ${want}`);
    }
  },
  // Alaska's home view held sideways sits inside its grid (54–62°N, 158–130°W); upright its width sets the zoom and the view runs from the
  // Pacific box's top, 65°N, down past the grid, so the pressure lines come from the Pacific layer.
  async alaskaIso(open) {
    const page = await open(home("ak"));
    if (!await page.evaluate(() => !!ALL.spots.cannonbeach)) skip("the page has no Alaska spots");
    const src = await page.evaluate(() => window.__ws.iso()), want = AKG && land ? "ak" : PAC ? "pac" : null;
    if (src !== want) throw new Error(`on Alaska's home view iso() is ${src}, want ${want}`);
  },
  // Micronesia's west home view (Guam and Saipan) lies inside the West Pacific grid both ways up, so its pressure lines come from that grid.
  // The east one (Pohnpei to Majuro) held sideways sits inside Micronesia's own grid (2°S–14°N, 152–176°E); upright its width sets the zoom,
  // so its height runs past it and the pressure lines come from the Pacific layer.
  async micronesiaIso(open) {
    for (const [name, want] of [["mi-w", "wp"], ["mi-e", MIG && land ? "mi" : PAC ? "pac" : null]]) {
      const page = await open(home(name));
      if (!await page.evaluate(() => !!ALL.spots.umatac)) skip("the page has no Micronesia spots");
      const src = await page.evaluate(() => window.__ws.iso());
      if (src !== want) throw new Error(`on ${name}'s home view iso() is ${src}, want ${want}`);
    }
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
  // Zooming out stops once the Pacific box (100°E–110°W, 50°S–65°N) fills the screen, so no dark sea shows around it:
  // the view stays inside the box and spans all of it one way, its whole height upright and its whole width sideways.
  async zoomOutFillsScreen(open) {
    const page = await open(home("tw")); await zoomOut(page);
    const v = await page.evaluate(() => window.__ws.view()), e = await edges(page), span = `${e.l}..${e.r} by ${e.s}..${e.n}`;
    if (v.z !== v.zmin) throw new Error(`z is ${v.z}, want zmin ${v.zmin}`);
    if (!(e.l >= 100 - 1e-9 && e.r <= 250 + 1e-9 && e.s >= -50 - 1e-9 && e.n <= 65 + 1e-9)) throw new Error(`the view spans ${span}, past the box's 100..250 by -50..65`);
    if (!(land ? near(e.l, 100, 1e-6) && near(e.r, 250, 1e-6) : near(e.s, -50, 1e-6) && near(e.n, 65, 1e-6))) throw new Error(`the view spans ${span}, want the box's whole ${land ? "width, 100..250" : "height, -50..65"}`);
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
  // And none of the country's dots sits under a button there: the old map slides sideways inside its box until they clear the buttons
  // (upright, Ocean Beach, Hanalei, Bells Beach and St Clair would sit under the country buttons). Australia opens on each of its parts.
  // The slide never takes a dot off the map: each dot on the old map before it (centred on the home view's centre, kept inside the box) is
  // still on it after, on smaller phones too (360x800 upright; 640x360, 667x375 and 736x414 sideways). There the slide can stop short, at
  // the box's edge, at a dot by the map's edge or with dots by buttons on both sides, so its dots are only checked to stay on the map.
  async firstOpenClear(open) {
    for (const size of land ? [null, { width: 640, height: 360 }, { width: 667, height: 375 }, { width: 736, height: 414 }] : [null, { width: 360, height: 800 }])
      for (const [name, spot, , hx, hy] of HOMES) {
        const page = await open({ spot, size }), at = size ? ` on a ${size.width}x${size.height} screen` : "";
        const c = await page.evaluate(s => ALL.spots[s] && MAPM.OLDBOX[spotCountry(s)] ? spotCountry(s) : "", spot);
        if (!c) continue;  // a country that never had an old map, or a build from before that country
        const e = await edges(page), b = await page.evaluate(c => MAPM.OLDBOX[c], c);
        if (!(e.l >= b.l - 1e-9 && e.r <= b.r + 1e-9 && e.s >= b.s - 1e-9 && e.n <= b.n + 1e-9)) throw new Error(`${spot} opens${at} on ${e.l}..${e.r} by ${e.s}..${e.n}, not inside ${c}'s box`);
        const gone = await page.evaluate(([c, hx, hy]) => { const v = window.__ws.view(), [ux, uy] = MAPM.clampTo(MAPM.OLDBOX[c], v.W, v.H, v.z, MAPM.E(hx), hy), on = ([x, y]) => x >= 0 && y >= 0 && x <= v.W && y <= v.H;
          return countrySpots(c).filter(id => { const s = ALL.spots[id], lon = MAPM.E(s.lon);
            return on([v.W/2 + (lon - ux)*v.z, v.H/2 - (MAPM.my(s.lat) - MAPM.my(uy))*v.z]) && !on(window.__ws.px(lon, s.lat)); }); }, [c, hx, hy]);
        if (gone.length) throw new Error(`on ${name}'s first open${at} the slide took ${gone.join(", ")} off the map`);
        if (size || near(e.l, b.l, 1e-6) && near(e.r, b.r, 1e-6)) continue;  // a smaller phone (above), or as wide as its box with no room to slide (sideways, Australia's Snapper and Byron stay by the zoom buttons)
        const out = await page.evaluate(c => { const rect = e => e.getBoundingClientRect(), fx = rect(document.getElementById("wsFx"));
          const over = [...document.querySelectorAll("#wsLayers button, #wsCtry button, #viewWs .zoom button")].filter(b => b.offsetParent).map(rect);
          return countrySpots(c).filter(id => { const s = ALL.spots[id], [x, y] = window.__ws.px(MAPM.E(s.lon), s.lat), X = fx.left + x, Y = fx.top + y;
            return x >= 0 && y >= 0 && x <= fx.width && y <= fx.height && over.some(r => X > r.left - 6 && X < r.right + 6 && Y > r.top - 6 && Y < r.bottom + 6); }); }, c);
        if (out.length) throw new Error(`on ${name}'s first open ${out.join(", ")} sits under a button`);
      }
  },
  // Pacific NW: with nothing saved, Cox Bay opens on its old box; California then opens on its home view with the Pacific NW view kept
  // under its own key, and the map's own Pacific NW button brings it back to the Pacific NW home view.
  async pacificNorthwest(open) {
    const page = await open({ spot: "coxbay" });
    if (!await page.evaluate(() => !!ALL.spots.coxbay)) skip("the page has no Pacific NW spots");
    const e = await edges(page), b = await page.evaluate(() => MAPM.OLDBOX.nw), t = 0.05;
    if (!(e.l >= b.l - 1e-9 && e.r <= b.r + 1e-9 && e.s >= b.s - 1e-9 && e.n <= b.n + 1e-9)) throw new Error(`Cox Bay opens on ${e.l}..${e.r} by ${e.s}..${e.n}, not inside the Pacific NW box`);
    if (!((near(e.l, b.l, t) && near(e.r, b.r, t)) || (near(e.s, b.s, t) && near(e.n, b.n, t)))) throw new Error(`Cox Bay opens on ${e.l}..${e.r} by ${e.s}..${e.n}, which meets the Pacific NW box on neither axis`);
    const v = await page.evaluate(() => ({ ...window.__ws.view(), h: window.__ws.home() })); await page.evaluate(() => switchCountry("ca")); await settle(page);
    const c = await page.evaluate(() => ({ ...window.__ws.view(), h: window.__ws.home(), kept: JSON.parse(localStorage.getItem("waveslave-mapview-nw")) }));
    if (c.MC !== "ca" || !near(c.cx, c.h.cx, 1e-6) || !near(c.cy, c.h.cy, 1e-6) || c.z !== c.z0) throw new Error(`after switching to California view() is MC ${c.MC}, centre ${c.cx}, ${c.cy}, z ${c.z}, want ca on the home view's ${c.h.cx}, ${c.h.cy}, z0 ${c.z0}`);
    if (!c.kept || !near(c.kept.cx, v.cx) || !near(c.kept.cy, v.cy) || !near(c.kept.k, v.z/v.h.z1)) throw new Error(`waveslave-mapview-nw holds ${JSON.stringify(c.kept)}, want cx ${v.cx}, cy ${v.cy}, k ${v.z/v.h.z1}`);
    await page.click('#wsCtry button[data-c="nw"]'); await settle(page);
    const n = await page.evaluate(() => ({ c: spotCountry(CUR), ...window.__ws.view(), h: window.__ws.home() }));
    if (n.c !== "nw" || n.MC !== "nw" || !near(n.cx, n.h.cx, 1e-6) || !near(n.cy, n.h.cy, 1e-6) || n.z !== n.z0) throw new Error(`after the map's Pacific NW button the page is on ${n.c}, view() MC ${n.MC}, centre ${n.cx}, ${n.cy}, z ${n.z}; want nw, nw, the home view's ${n.h.cx}, ${n.h.cy}, z0 ${n.z0}`);
  },
  // Korea, the Philippines, Indonesia and New Zealand: with nothing saved, the first spot opens inside the country's box with every spot of the country on the map and
  // clear of the buttons and the time bar (on a phone its box is its home view); the map's country button brings it back to that home from Japan's.
  async korea(open) { await homeBox(open, "kr", "jukdo"); },
  async philippines(open) { await homeBox(open, "ph", "cloud9"); },
  async indonesia(open) { await homeBox(open, "id", "uluwatu"); },
  async newZealand(open) { await homeBox(open, "nz", "raglan"); },
  // Alaska never had a map of its own (see ownHome); upright its view stays inside the Pacific box, under its top, 65°N.
  async alaska(open) {
    const e = await ownHome(open, "ak", "cannonbeach", { cx: 215.4, cy: 58.4, span: 6.2, wide: 24 });
    if (e.n > 65 + 1e-6) throw new Error(`Alaska's home view reaches ${e.n}°N at its top, past the box's top, 65°N`);
  },
  // Nor did Hong Kong, or Hainan.
  async hongKong(open) { await ownHome(open, "hk", "cheungsha", { cx: 114.17, cy: 22.32, span: 0.5, wide: 0.75 }); },
  async hainan(open) { await ownHome(open, "hn", "dadonghai", { cx: 109.93, cy: 18.44, span: 0.95, wide: 1.3 }); },
  // The South Pacific has two parts, west (Fiji to the Samoas) and east (Rarotonga and Tahiti), and so has Micronesia, west (Guam and Saipan)
  // and east (Pohnpei to Majuro); see twoParts.
  async southPacific(open) {
    await twoParts(open, "pi", 195, { w: { spot: "cloudbreak", mate: "amouli", cx: 182.85, cy: -17.8, span: 11, wide: 17.6 }, e: { spot: "teahupoo", mate: "papara", cx: 205.07, cy: -19.5, span: 8, wide: 15.2 } });
  },
  async micronesia(open) {
    await twoParts(open, "mi", 152, { w: { spot: "umatac", mate: "tankbeach", cx: 145.22, cy: 14.24, span: 3.3, wide: 1.7 }, e: { spot: "ppass", mate: "majuro", cx: 164.74, cy: 6.21, span: 9.5, wide: 19 } });
  },
  // On the Forecast page the tide line says "Model tide" at a South Pacific spot that takes the tide model (Salani), and not at one that takes
  // NOAA's tides (Cloudbreak).
  async modelTide(open) {
    for (const [spot, want] of [["salani", true], ["cloudbreak", false]]) {
      const page = await open({ spot });
      if (!await page.evaluate(id => !!ALL.spots[id], spot)) skip(`the page has no ${spot}`);
      await page.evaluate(() => setView("fc", true)); await settle(page);
      const t = await page.evaluate(() => document.getElementById("nowFacts").textContent);
      if (!/\d cm/.test(t)) skip(`${spot} has no tide now`);
      if (t.includes("Model tide") !== want) throw new Error(`${spot}'s Right now line reads "${t}", want ${want ? "" : "no "}"Model tide"`);
    }
  },
  // On every home view, a tag drawn for another country's spot keeps clear of the buttons over the map: at the screen's edge, one with nowhere
  // clear to go is left out (Sydney's, in the corner of New Zealand's home view held sideways).
  async foreignTagsClear(open) {
    for (const [name, spot] of HOMES) {
      const page = await open(home(name));
      if (!await page.evaluate(() => !!window.__ws.tags)) skip("the page's hook has no tags");
      if (!await page.evaluate(s => !!ALL.spots[s], spot)) continue;  // a build from before that country
      const bad = await page.evaluate(() => { const rect = e => e.getBoundingClientRect(), fx = rect(document.getElementById("wsFx")), MC = window.__ws.view().MC;
        const over = [...document.querySelectorAll("#wsLayers button, #wsCtry button, #viewWs .zoom button")].filter(b => b.offsetParent).map(rect);
        return window.__ws.tags().filter(([x, y, w, h, id]) => spotCountry(id) !== MC && over.some(r => fx.left + x < r.right && fx.left + x + w > r.left && fx.top + y < r.bottom && fx.top + y + h > r.top)).map(t => t[4]); });
      if (bad.length) throw new Error(`on ${name}'s home view the tags of ${bad.join(", ")} sit under a button`);
    }
  },
  // Changing country moves the one map to the new country's home view, with no reload.
  async noReloadCountry(open) {
    const page = await open(home("tw"));
    await page.evaluate(() => { window.__mark = 1; switchCountry("hi"); }); await page.waitForTimeout(500);
    const v = await page.evaluate(() => ({ mark: window.__mark, ...(window.__ws ? { ...window.__ws.view(), h: window.__ws.home() } : {}) }));
    if (v.mark !== 1) throw new Error("the page reloaded (window.__mark is gone)");
    if (v.MC !== "hi") throw new Error(`view().MC is ${v.MC}, want hi`);
    if (!near(v.cx, v.h.cx, 1e-6) || !near(v.cy, v.h.cy, 1e-6) || v.z !== v.z0) throw new Error(`view() is at ${v.cx}, ${v.cy}, z ${v.z}, want Hawaii's home view, ${v.h.cx}, ${v.h.cy}, z0 ${v.z0}`);
  },
  // The map has a button for every country in the switch above the spot picker, in the same order, the current one pressed: the country's
  // outline with no words, its name read out and shown on hover, and no other button on the map draws that outline again.
  // Tapping one moves the page to that country without leaving the map or reloading, closes the forecast card left open in the old one,
  // and the map goes to its home view (straight there, with reduced motion); tapping the pressed one when zoomed out brings the map back there.
  async mapCountryButtons(open) {
    const page = await open(home("tw")); await page.evaluate(() => { window.__mark = 1; });
    const pressed = () => page.evaluate(() => [...document.querySelectorAll('#wsCtry button[aria-pressed="true"]')].map(b => b.dataset.c).join());
    const r = await page.evaluate(() => ({ want: [...document.querySelectorAll("#ctry button")].map(b => b.dataset.c).join(), got: [...document.querySelectorAll("#wsCtry button")].map(b => b.dataset.c).join(),
      unlike: [...document.querySelectorAll("#wsCtry button")].filter(b => { const p = b.querySelector("svg path"), name = document.querySelector(`#ctry button[data-c="${b.dataset.c}"]`).textContent;
        return !p || !p.getAttribute("d") || p.getAttribute("d") !== HOME_ICONS[b.dataset.c] || b.textContent.trim() || b.getAttribute("aria-label") !== name || b.title !== name; }).map(b => b.dataset.c).join(", "),
      twice: Object.keys(HOME_ICONS).filter(c => [...document.querySelectorAll("#viewWs svg path")].filter(p => p.getAttribute("d") === HOME_ICONS[c]).length > 1).join(", ") }));
    if (r.got !== r.want) throw new Error(`the map's country buttons are ${r.got || "missing"}, want ${r.want}`);
    if (r.unlike) throw new Error(`not the country's outline, named for it and with no words: ${r.unlike}`);
    if (r.twice) throw new Error(`the map draws these outlines more than once: ${r.twice}`);
    if (await pressed() !== "tw") throw new Error(`the pressed country button is ${await pressed() || "none"}, want tw`);
    await tapAt(page, await page.evaluate(() => { const s = ALL.spots.donghe; return window.__ws.px(MAPM.E(s.lon), s.lat); }));
    if (await page.evaluate(() => document.getElementById("wsSheet").hidden)) throw new Error("tapping Donghe did not open its forecast card");
    await page.click('#wsCtry button[data-c="hi"]'); await settle(page);
    const v = await page.evaluate(() => ({ mark: window.__mark, c: spotCountry(CUR), view: VIEW, fs: document.getElementById("viewWs").classList.contains("fs"), shut: document.getElementById("wsSheet").hidden, ...window.__ws.view(), h: window.__ws.home() }));
    if (v.mark !== 1) throw new Error("the page reloaded (window.__mark is gone)");
    if (v.c !== "hi" || v.view !== "ws" || !v.fs) throw new Error(`after tapping Hawaii the page is on ${v.c}, view ${v.view}, full screen ${v.fs}; want hi, ws, true`);
    if (!v.shut) throw new Error("after tapping Hawaii, Donghe's forecast card is still open");
    if (v.MC !== "hi" || !near(v.cx, v.h.cx, 1e-6) || !near(v.cy, v.h.cy, 1e-6) || v.z !== v.z0) throw new Error(`after tapping Hawaii the map is ${v.MC} at ${v.cx}, ${v.cy}, z ${v.z}; want hi on the home view's ${v.h.cx}, ${v.h.cy}, z0 ${v.z0}`);
    if (await pressed() !== "hi") throw new Error(`after tapping Hawaii the pressed country button is ${await pressed() || "none"}, want hi`);
    await zoomOut(page); await page.click('#wsCtry button[data-c="hi"]'); await settle(page);
    const b = await page.evaluate(() => ({ ...window.__ws.view(), h: window.__ws.home() }));
    if (b.z !== b.z0 || !near(b.cx, b.h.cx, 1e-6) || !near(b.cy, b.h.cy, 1e-6)) throw new Error(`tapping Hawaii again when zoomed out leaves z ${b.z} at ${b.cx}, ${b.cy}, want z0 ${b.z0} at the home view's ${b.h.cx}, ${b.h.cy}`);
  },
  // No strip runs across the top any more: the buttons sit straight on the map, a finger in the gap between them drags the map, and in English,
  // Chinese and Japanese every button is on screen and none covers another, the countries down the left, the zoom buttons down the right or the time bar.
  async topBarSeeThrough(open) {
    const page = await open(home("tw"));
    for (const l of ["en", "zh", "ja"]) {
      await page.evaluate(l => setLang(l), l); await settle(page);
      const r = await page.evaluate(() => { const bar = document.getElementById("wsLayers"), s = getComputedStyle(bar), rect = b => b.getBoundingClientRect();
        const parts = sel => [...document.querySelectorAll(sel)].filter(b => b.offsetParent).map(b => [b.dataset.o || b.dataset.p || b.dataset.c || b.id, rect(b)]);
        const boxes = parts("#wsLayers button, #wsCtry button, #viewWs .zoom button"), time = parts("#wsPlay, #wsTime, #wsTl");
        const hits = []; boxes.forEach(([a, p], i) => [...boxes.slice(i + 1), ...time].forEach(([b, q]) => { if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) hits.push(`${a} covers ${b}`); }));
        const off = [...boxes, ...time].filter(([, p]) => p.left < 0 || p.top < 0 || p.right > innerWidth || p.bottom > innerHeight).map(([a]) => a);
        // The gap between Rain and Pressure, halfway down Rain.
        const rain = rect(bar.querySelector('[data-o="rain"]')), pres = rect(bar.querySelector("[data-p]")), at = document.elementFromPoint((rain.right + pres.left)/2, (rain.top + rain.bottom)/2);
        return { bg: s.backgroundColor, border: parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none", gap: pres.left - rain.right, at: at ? at.id || at.tagName : null, hits, off }; });
      if (r.bg !== "rgba(0, 0, 0, 0)" || r.border) throw new Error(`in ${l} the top bar still has a strip behind its buttons (background ${r.bg}, border ${r.border})`);
      if (r.gap > 8 && r.at !== "wsFx") throw new Error(`in ${l} a finger between Rain and Pressure lands on ${r.at}, not the map`);
      if (r.hits.length) throw new Error(`in ${l}: ${r.hits.join("; ")}`);
      if (r.off.length) throw new Error(`in ${l} ${r.off.join(", ")} sits off the screen`);
    }
  },
  // The countries stand in a column down the left side, in the switch's order from just under the top buttons, each under the last with the
  // map between them (a finger there drags it), and only when the column has no room left for the next does it start another column, at the
  // top just right of the last; in English, Chinese and Japanese each is named in the page's language. With a spot's forecast card open, a
  // finger on any of them still lands on it, as it does on the map's tools down the right; sideways that holds on a short screen too (a small
  // phone in Safari, whose bar takes some of the height), where the countries take three columns five deep.
  async countryColumn(open) {
    const page = await open(home("tw"));
    for (const l of ["en", "zh", "ja"]) {
      await page.evaluate(l => setLang(l), l); await settle(page);
      const r = await page.evaluate(() => { const rect = e => e.getBoundingClientRect(), box = document.getElementById("wsCtry"), s = getComputedStyle(box), bs = [...box.querySelectorAll("button")], cs = bs.map(rect);
        const gap = cs.length > 1 ? document.elementFromPoint((cs[0].left + cs[0].right)/2, (cs[0].bottom + cs[1].top)/2) : null;
        return { n: cs.length, left: cs.map(c => c.left), right: cs.map(c => c.right), top: cs.map(c => c.top), bottom: cs.map(c => c.bottom), room: rect(box).bottom,
          rowGap: parseFloat(s.rowGap), colGap: parseFloat(s.columnGap), bar: rect(document.getElementById("wsLayers")).bottom, gap: gap ? gap.id || gap.tagName : null,
          names: bs.map(b => b.getAttribute("aria-label") + "|" + b.title).join(), want: bs.map(b => { const n = document.querySelector(`#ctry button[data-c="${b.dataset.c}"]`).textContent; return n + "|" + n; }).join() }; });
      if (r.n < 2) throw new Error(`in ${l} the map has ${r.n} country buttons`);
      if (r.left[0] > 16) throw new Error(`in ${l} the country buttons start at x ${Math.round(r.left[0])}, want within 16px of the left edge`);
      if (r.top[0] < r.bar) throw new Error(`in ${l} the first country button starts at y ${r.top[0]}, above the top buttons' bottom at ${r.bar}`);
      // colR is the right edge of the column so far.
      for (let i = 1, colR = r.right[0]; i < r.n; i++) {
        const at = `in ${l} country button ${i + 1} (x ${Math.round(r.left[i])}, y ${Math.round(r.top[i])})`;
        if (Math.abs(r.left[i] - r.left[i - 1]) <= 0.5) {
          if (r.top[i] < r.bottom[i - 1] + 2) throw new Error(`${at} is not under the one before it (bottom ${r.bottom[i - 1]})`);
          colR = Math.max(colR, r.right[i]); continue;
        }
        if (Math.abs(r.left[i] - (colR + r.colGap)) > 1 || Math.abs(r.top[i] - r.top[0]) > 0.5) throw new Error(`${at} is neither under the one before it nor at the top of a new column just right of its column (right edge ${colR})`);
        if (r.bottom[i - 1] + r.rowGap + r.bottom[i] - r.top[i] <= r.room - 0.5) throw new Error(`${at} starts a new column though the one before it (bottom ${Math.round(r.bottom[i - 1])}) had room under it down to ${Math.round(r.room)}`);
        colR = r.right[i];
      }
      if (r.gap !== "wsFx") throw new Error(`in ${l} a finger between the first two country buttons lands on ${r.gap}, not the map`);
      if (r.names !== r.want) throw new Error(`in ${l} the country buttons are named ${r.names}, want ${r.want}`);
    }
    const cardOpen = async (page, where) => {
      await tapAt(page, await page.evaluate(() => { const s = ALL.spots.donghe; return window.__ws.px(MAPM.E(s.lon), s.lat); }));
      if (await page.evaluate(() => document.getElementById("wsSheet").hidden)) throw new Error(`${where}tapping Donghe did not open its forecast card`);
      const hidden = await page.evaluate(() => [...document.querySelectorAll("#wsCtry button, #viewWs .zoom button")].filter(b => { const r = b.getBoundingClientRect(), at = document.elementFromPoint((r.left + r.right)/2, (r.top + r.bottom)/2);
        return !at || at.closest("button") !== b; }).map(b => b.dataset.c || b.id));
      if (hidden.length) throw new Error(`${where}with Donghe's forecast card open, a finger on ${hidden.join(", ")} lands on something else`);
    };
    await cardOpen(page, "");
    if (land) await cardOpen(await open({ ...home("tw"), size: { width: 667, height: 320 } }), "on a 667x320 screen, ");
  },
  // Every button's words and outlines read over anything the map draws behind them. With the map under the buttons painted white (a pressure
  // line or a bright patch at its worst), each top button's own background behind its word still gives the word 4.5:1 contrast (WCAG AA)
  // with every pixel, and each country button's background behind its outline gives the outline 3:1.
  async buttonsReadable(open) {
    const page = await open(home("tw"));
    // The words and outlines, each with the colour it is drawn in and the box it fills.
    const marks = await page.evaluate(() => [...document.querySelectorAll("#wsLayers button, #wsCtry button")].filter(b => b.offsetParent).map(b => {
      const svg = b.querySelector("svg"), r = svg ? svg.getBoundingClientRect() : (() => { const g = document.createRange(); g.selectNodeContents(b); return g.getBoundingClientRect(); })();
      return { name: b.dataset.o || b.dataset.p || b.dataset.c, icon: !!svg, color: getComputedStyle(b).color, box: { x: r.left, y: r.top, width: r.width, height: r.height } }; }));
    await page.evaluate(() => { const w = document.createElement("div"); w.style.cssText = "position:absolute;inset:0;z-index:4;background:#fff"; document.getElementById("viewWs").appendChild(w);
      const s = document.createElement("style"); s.textContent = "#wsLayers button,#wsCtry button{color:transparent!important;text-shadow:none!important}"; document.head.appendChild(s); });
    await settle(page);
    const bad = [];
    for (const m of marks) {
      // A picture of what is behind the word or outline, with it taken away, and the contrast its colour makes with the worst pixel there.
      const png = await page.screenshot({ clip: m.box, animations: "disabled" });
      const worst = await page.evaluate(async ([b64, color]) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4, L = (r, g, b) => 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
        const fg = L(...color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)), d = g.getImageData(0, 0, c.width, c.height).data; let worst = 21;
        for (let i = 0; i < d.length; i += 4) { const y = L(d[i], d[i+1], d[i+2]); worst = Math.min(worst, (Math.max(fg, y) + 0.05) / (Math.min(fg, y) + 0.05)); }
        return worst; }, [png.toString("base64"), m.color]);
      const need = m.icon ? 3 : 4.5; if (worst < need) bad.push(`${m.name} ${worst.toFixed(2)}:1 (want ${need}:1)`);
    }
    if (bad.length) throw new Error(`over a white map: ${bad.join(", ")}`);
  },
  // Back on the Forecast page the page is no wider than the phone, so it only scrolls up and down: in English, Chinese and Japanese nothing
  // in the page column reaches past the column, and the country buttons fit, or scroll inside their own row, instead of pushing it wider.
  async forecastFitsWidth(open) {
    const page = await open(home("tw")); await page.evaluate(() => setView("fc", true)); await settle(page);
    for (const l of ["en", "zh", "ja"]) {
      await page.click(`#lang button[data-l="${l}"]`); await settle(page);
      const r = await page.evaluate(() => { const d = document.documentElement, w = document.querySelector(".wrap"), edge = w.getBoundingClientRect().right - parseFloat(getComputedStyle(w).paddingRight);
        return { sw: d.scrollWidth, cw: d.clientWidth, wide: [...w.children].map(e => [e.id || e.className || e.tagName, e.getBoundingClientRect().right]).filter(([, x]) => x > edge + 0.5).map(([e, x]) => `${e} ends at ${x}px, past the column's ${edge}px`) }; });
      if (r.wide.length) throw new Error(`in ${l}, ${r.wide.join("; ")}`);
      if (r.sw > r.cw) throw new Error(`in ${l} the page is ${r.sw}px wide on a ${r.cw}px screen`);
    }
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
    const v = await page.evaluate(() => ({ ...window.__ws.view(), h: window.__ws.home() })); await page.evaluate(() => switchCountry("hi")); await settle(page);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("waveslave-mapview")));
    if (!kept || !near(kept.cx, v.cx) || !near(kept.cy, v.cy) || !near(kept.k, v.z/v.h.z1)) throw new Error(`waveslave-mapview holds ${JSON.stringify(kept)}, want cx ${v.cx}, cy ${v.cy}, k ${v.z/v.h.z1}`);
  },
  // Opened from Forecast, the map shows the country picked there zoomed in, on its home view, however far out and wherever it was left,
  // with no forecast card left open over it: Taiwan in Taiwan mode, then (World mode) Hawaii picked on Forecast. A page that loads on the map
  // never opens on a view another country left under the key Taiwan and Japan share (here Japan's, zoomed in on Hasaki): Donghe is on screen.
  async openOnCountry(open) {
    const page = await open({ spot: "donghe", world: false, saved: { key: "waveslave-mapview", view: { cx: 140.85, cy: 36.0, k: 3, c: "jp" } } });
    const at = () => page.evaluate(() => { const v = window.__ws.view(), h = window.__ws.home(), s = ALL.spots[CUR], p = window.__ws.px(MAPM.E(s.lon), s.lat);
      return { ...v, h, cur: CUR, cc: spotCountry(CUR), card: !document.getElementById("wsSheet").hidden, on: p[0] >= 0 && p[0] <= v.W && p[1] >= 0 && p[1] <= v.H }; });
    let a = await at(); if (a.MC !== "tw" || !a.on) throw new Error(`with Japan's view kept under waveslave-mapview, the map opened on Donghe at cx ${a.cx}, cy ${a.cy} (MC ${a.MC}), Donghe ${a.on ? "on" : "off"} screen`);
    // To Forecast with ✕ (picking a country there with pick), then back with the Map tab: the map is on the picked country's home view.
    const reopen = async (label, pick) => { await page.click("#wsFs"); await settle(page); if (pick) { await page.evaluate(pick); await settle(page); }
      await page.click('.tabs button[data-v="ws"]'); await page.waitForFunction(() => !document.getElementById("viewWs").hidden && document.getElementById("viewFc").hidden); await settle(page);
      a = await at(); if (a.MC !== a.cc || !near(a.cx, a.h.cx, 1e-6) || !near(a.cy, a.h.cy, 1e-6) || a.z !== a.h.z || !a.on || a.card)
        throw new Error(`opened from Forecast on ${label} (${a.cur}), the map is on ${a.MC} at cx ${a.cx}, cy ${a.cy}, z ${a.z}${a.card ? " with a forecast card open" : ""}, want its home view cx ${a.h.cx}, cy ${a.h.cy}, z ${a.h.z}`); };
    await zoomOut(page); await reopen("Taiwan, left zoomed all the way out");
    const tag = await page.evaluate(() => window.__ws.tags().find(t => t[4] === "jinshan")); await tapAt(page, [tag[0] + tag[2]/2, tag[1] + tag[3]/2]); await settle(page);
    if (!(await at()).card) throw new Error("a tap on Jinshan's tag opened no forecast card"); await reopen("Taiwan, Jinshan's card left open");
    await reopen("Hawaii, picked on Forecast", () => { setWorld(true); switchCountry("hi"); });
    await zoomOut(page); await reopen("Hawaii, left zoomed all the way out");
  },
  // Taiwan mode, the page's default: no country row and no country buttons over the map, and zoomed out no other country's spot to tap (a
  // tap where Pipeline is drops a pin instead). World mode (setWorld, the tap on the W) brings them back and is kept; switching it off from
  // Hawaii brings the page and the map back to Taiwan. Then on Forecast the W itself switches it on and off, with nothing under the row moving.
  async taiwanMode(open) {
    const page = await open({ spot: "donghe", saved: MID, world: false });
    const shown = () => page.evaluate(() => ({ world: WORLD, cls: document.documentElement.classList.contains("world"), kept: localStorage.getItem("waveslave-world"),
      row: getComputedStyle(document.getElementById("ctry")).visibility !== "hidden", picker: document.getElementById("picker").getBoundingClientRect().top - document.querySelector(".tabs").getBoundingClientRect().bottom, scroll: scrollY, btns: [...document.querySelectorAll("#wsCtry button")].filter(b => b.offsetParent).length,
      want: document.querySelectorAll("#ctry button").length, cur: CUR, cc: spotCountry(CUR), MC: window.__ws.view().MC }));
    let a = await shown();
    if (a.world || a.cls) throw new Error("the page opened in World mode, want Taiwan mode");
    if (a.row || a.btns) throw new Error(`in Taiwan mode the country row ${a.row ? "shows" : "is hidden"} and ${a.btns} country buttons show over the map, want neither`);
    await zoomOut(page);
    await tapAt(page, await page.evaluate(() => { const s = ALL.spots.pipeline; return window.__ws.px(MAPM.E(s.lon), s.lat); })); await settle(page);
    a = await shown(); if (a.cur !== "donghe" || a.world) throw new Error(`a tap where Pipeline is moved the page to ${a.cur}${a.world ? " in World mode" : ""}, want it to stay on donghe`);
    await page.evaluate(() => setWorld(true)); await settle(page); a = await shown();
    if (!a.world || !a.cls || a.kept !== "1") throw new Error(`after setWorld(true) WORLD is ${a.world}, the class ${a.cls}, waveslave-world ${a.kept}`);
    if (!a.row || a.btns !== a.want) throw new Error(`in World mode the country row ${a.row ? "shows" : "is hidden"} and ${a.btns} country buttons show over the map, want ${a.want}`);
    await page.evaluate(() => switchCountry("hi")); await settle(page);
    await page.evaluate(() => setWorld(false)); await settle(page); a = await shown();
    if (a.world || a.cls || a.kept !== "0" || a.row || a.btns) throw new Error(`after setWorld(false) WORLD is ${a.world}, the class ${a.cls}, waveslave-world ${a.kept}, the row ${a.row}, ${a.btns} buttons`);
    if (a.cc !== "tw" || a.MC !== "tw") throw new Error(`after setWorld(false) from Hawaii the page is on ${a.cur} and the map on ${a.MC}, want Taiwan`);
    // And the real switch: back on Forecast, a tap on the W in the logo turns World mode on, and another turns it off. The countries come and
    // go in a place kept for them, so the spot picker and the forecast under it never move.
    await page.click("#wsFs"); await settle(page); const at = (await shown()).picker;
    for (const want of [true, false]) { await page.click("header .brand .w"); await settle(page); a = await shown();
      if (a.world !== want || a.row !== want) throw new Error(`a tap on the W left WORLD ${a.world} and the country row ${a.row ? "showing" : "hidden"}, want ${want ? "World mode" : "Taiwan mode"}`);
      if (a.picker !== at) throw new Error(`a tap on the W moved the spot picker from ${at} to ${a.picker} under the tabs (scrollY ${a.scroll})`); }
  },
  // A link to another country's spot opens it in World mode, kept for next time; in Taiwan mode the last spot open in another country is
  // passed over for the last Taiwan one.
  async worldLink(open) {
    let page = await open({ spot: "pipeline", world: false });
    let r = await page.evaluate(() => ({ world: WORLD, cur: CUR, kept: localStorage.getItem("waveslave-world") }));
    if (!r.world || r.cur !== "pipeline" || r.kept !== "1") throw new Error(`the link to Pipeline opened ${r.cur} with WORLD ${r.world}, waveslave-world ${r.kept}; want pipeline in World mode, kept`);
    page = await open({ spot: "", world: false, store: { "waveslave-spot": "pipeline", "waveslave-spot-tw": "nanwan" } });
    r = await page.evaluate(() => ({ world: WORLD, cur: CUR }));
    if (r.world || r.cur !== "nanwan") throw new Error(`with Pipeline last open in Taiwan mode the page opened ${r.cur}${r.world ? " in World mode" : ""}, want nanwan in Taiwan mode`);
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
  // The lit country does what the home button did: from Taiwan's old home view one tap goes all the way out with Taiwan still on screen
  // (the view a pinch out ends on), and a second tap comes to Taiwan's home view (straight there, with reduced motion).
  async litCountryHome(open) {
    const page = await open(home("tw"));
    await page.click('#wsCtry button[aria-pressed="true"]');
    const a = await page.evaluate(() => { const v = window.__ws.view(); return { ...v, want: MAPM.clampTo(MAPM.PBOX, v.W, v.H, v.zmin, 120.9, 23.75), at: window.__ws.px(120.9, 23.75) }; });
    if (a.z !== a.zmin || !near(a.cx, a.want[0], 1e-6) || !near(a.cy, a.want[1], 1e-6)) throw new Error(`after one tap the view is cx ${a.cx}, cy ${a.cy}, z ${a.z}, want cx ${a.want[0]}, cy ${a.want[1]}, zmin ${a.zmin}`);
    if (!(a.at[0] >= 0 && a.at[0] <= a.W && a.at[1] >= 0 && a.at[1] <= a.H)) throw new Error(`after one tap Taiwan is off screen, at ${a.at}`);
    await page.click('#wsCtry button[aria-pressed="true"]'); const b = await page.evaluate(() => ({ ...window.__ws.view(), h: window.__ws.home() }));
    if (b.z !== b.z0 || !near(b.cx, b.h.cx, 1e-6) || !near(b.cy, b.h.cy, 1e-6)) throw new Error(`after two taps the view is z ${b.z} at ${b.cx}, ${b.cy}, want z0 ${b.z0} at the home view's ${b.h.cx}, ${b.h.cy}`);
  },
  // Each country's button brings a home view with all of the country's names in the clear, in English, Chinese and Japanese, on the phone
  // and (upright runs) on a 1280x800 computer screen too: every one of its spots (in Australia, the South Pacific and Micronesia: those in the part it's on, each part in turn)
  // has its dot and its tag on the map with room around them, 16px or more inside the screen, under the top buttons and over the time bar,
  // and 8px or more from the buttons down the sides. The home view is never closer than the country's home zoom was (home().z1), and only
  // as far out as it needs: still at that zoom, or with the names spanning half of the clear map or more one way. Taiwan's towns never put
  // a dot on a tag, and show at no other country's home view (Japan's reaches down past Taiwan).
  async namesFit(open) {
    const M = 16, MB = 8, fails = [];
    for (const size of land ? [null] : [null, { width: 1280, height: 800 }]) {
      const page = await open({ spot: "pipeline", size }), cs = await page.evaluate(() => [...document.querySelectorAll("#wsCtry button")].map(b => b.dataset.c));
      for (const l of ["en", "zh", "ja"]) {
        await page.evaluate(l => setLang(l), l); await settle(page);
        for (const c of [...cs, "margaret", "noosa", "cloudbreak", "teahupoo", "umatac", "ppass"]) {
          // A country from another one's button, so its own flies to its home view; the two parts of Australia, the South Pacific and
          // Micronesia by picking a spot in each.
          if (cs.includes(c)) for (const b of [c === cs[0] ? cs[1] : cs[0], c]) { await page.click(`#wsCtry button[data-c="${b}"]`); await settle(page); }
          else { await page.evaluate(id => switchSpot(id), c); await settle(page); }
          const r = await page.evaluate(([M, MB]) => { const cv = document.getElementById("wsFx").getBoundingClientRect(), v = window.__ws.view(), h = window.__ws.home(), tags = window.__ws.tags();
            const box = e => { const q = e.getBoundingClientRect(); return [q.left - cv.left, q.top - cv.top, q.right - cv.left, q.bottom - cv.top]; };
            const vis = sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).map(box), btn = vis("#wsCtry button, #viewWs .zoom button");
            const top = Math.max(0, ...vis("#wsLayers button").map(b => b[3])), bot = Math.min(v.H, ...vis("#wsPlay, #wsTime, #wsTl").map(b => b[1]));
            const part = WS.part(CUR), ids = countrySpots(v.MC).filter(id => WS.part(id) === part);
            const bad = [], U = [Infinity, Infinity, -Infinity, -Infinity];
            const e = 0.5, clear = (b, what) => { U[0] = Math.min(U[0], b[0]); U[1] = Math.min(U[1], b[1]); U[2] = Math.max(U[2], b[2]); U[3] = Math.max(U[3], b[3]);
              if (b[0] < M - e || b[2] > v.W - M + e || b[1] < top + M - e || b[3] > bot - M + e) bad.push(`${what} at ${b.map(Math.round)} is off the clear map or nearer its edge than ${M}px (${M}..${v.W - M} by ${Math.round(top) + M}..${Math.round(bot) - M})`);
              else if (btn.some(q => b[0] < q[2] + MB - e && b[2] > q[0] - MB + e && b[1] < q[3] + MB - e && b[3] > q[1] - MB + e)) bad.push(`${what} at ${b.map(Math.round)} is under a button or nearer one than ${MB}px`); };
            for (const id of ids) { const s = ALL.spots[id], [x, y] = window.__ws.px(MAPM.E(s.lon), s.lat), t = tags.find(b => b[4] === id);
              clear([x - 6, y - 6, x + 6, y + 6], `${id}'s dot`);
              if (t) clear([t[0], t[1], t[0] + t[2], t[1] + t[3]], `${id}'s tag`); else bad.push(`${id} has no tag`); }
            for (const [x, y, en] of window.__ws.towns()) if (v.MC !== "tw") bad.push(`${en}'s town dot shows at the home view`);
              else if (tags.some(t => x > t[0] - 3 && x < t[0] + t[2] + 3 && y > t[1] - 3 && y < t[1] + t[3] + 3)) bad.push(`${en}'s town dot sits on a tag`);
            if (v.z !== v.z0) bad.push(`the view is at z ${v.z}, not the home zoom ${v.z0}`);
            if (v.z0 > h.z1*(1 + 1e-9)) bad.push(`the home zoom ${v.z0} is closer than the country's ${h.z1}`);
            const fw = (U[2] - U[0])/(v.W - 2*M), fh = (U[3] - U[1])/(bot - top - 2*M);
            if (v.z0 < h.z1*(1 - 1e-9) && Math.max(fw, fh) < 0.5) bad.push(`zoomed out to ${v.z0.toFixed(1)} from ${h.z1.toFixed(1)}, the names span only ${Math.round(fw*100)}% by ${Math.round(fh*100)}% of the clear map`);
            return { c: v.MC, part: part ? " " + part : "", bad }; }, [M, MB]);
          if (r.bad.length) fails.push(`${size ? size.width + "x" + size.height + " " : ""}${l} ${r.c}${r.part}: ${r.bad.join("; ")}`);
        }
      }
    }
    if (fails.length) throw new Error(fails.join(" | "));
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
  async function open({ spot, saved, hook = true, size, world = true, store = null }) {
    const ctx = await browser.newContext({ viewport: size || (land ? { width: 844, height: 390 } : { width: 390, height: 844 }), deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
    ctxs.push(ctx);
    await ctx.route("**/*", r => r.request().url().split("#")[0] === PAGE ? r.continue() : r.abort());
    await ctx.addInitScript(([saved, now, lock, world, store]) => { Date.now = () => now; try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", "ws"); localStorage.setItem("waveslave-lang", "en");
      if (world) localStorage.setItem("waveslave-world", "1"); for (const k in store || {}) localStorage.setItem(k, store[k]);
      if (lock) sessionStorage.setItem("waveslave-unlock", lock); if (saved) localStorage.setItem(saved.key, JSON.stringify(saved.view)); } catch (e) {} }, [saved, NOW, LOCK, world, store]);
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
      for (const [name, spot, key, cx, cy] of HOMES) await step(name, async () => {
        const page = await open({ spot, saved: { key, view: { cx, cy, k: 1 } }, hook: false });
        if (!await page.evaluate(s => !!ALL.spots[s], spot)) skip(`the page has no ${spot}`);  // a build from before that country
        return await shot(page, name);
      });
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
