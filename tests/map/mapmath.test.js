// The map maths block (MAPM) in template.html, loaded on its own: it is plain functions with no page state.
// Run: node --test tests/map/mapmath.test.js
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");

function load() {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "template.html"), "utf8");
  const a = src.indexOf("// ---- Map maths"), b = src.indexOf("// ---- end map maths");
  assert.ok(a >= 0 && b > a, "template.html has no Map maths block (// ---- Map maths ... // ---- end map maths)");
  return new Function(src.slice(a, b) + "\nreturn MAPM;")();
}
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} is not ${b}`);

// A grid the way grid.py writes it. Each step and point (row 0 south, column 0 west) is 4 bytes: wind kt, wind-from/2, wave height x10, wave-from/2;
// pressure, when given, goes in pb64 (hPa - 900) and pf64 ((hPa - 850) x 20, 2 bytes little-endian). A null value is no data (255, or 65535).
// wind(k, i, j) gives [kt, from], wave(k, i, j) gives [height, from] and pres(k, i, j) gives hPa, for step k, row i, column j.
function packGrid({lat0, dlat, nlat, lon0, dlon, nlon, nt = 1, dt = 3, wind = () => [10, 90], wave = () => [1, 90], pres = null}) {
  const b = (v, scale = 1, cap = 254) => v == null ? 255 : Math.max(0, Math.min(cap, Math.round(v*scale))), B = [], P = [], F = [];
  for (let k = 0; k < nt; k++) for (let i = 0; i < nlat; i++) for (let j = 0; j < nlon; j++) {
    const [kt, wf] = wind(k, i, j), [h, hf] = wave(k, i, j); B.push(b(kt), b(wf, .5, 180), b(h, 10), b(hf, .5, 180));
    if (pres) { const p = pres(k, i, j), f = p == null ? 65535 : Math.max(0, Math.min(65534, Math.round((p - 850)*20))); P.push(b(p == null ? null : p - 900)); F.push(f & 255, f >> 8); } }
  const b64 = a => Buffer.from(a).toString("base64");
  return {lat0, dlat, nlat, lon0, dlon, nlon, t0: "2026-10-17T00:00", dt, nt, b64: b64(B), pb64: b64(P), pf64: b64(F), rb64: "", sb64: ""};
}

test("E and W180", () => {
  const M = load();
  assert.equal(M.E(-118.5), 241.5);
  assert.equal(M.E(120), 120);
  assert.equal(M.E(-180), 180);
  assert.equal(M.W180(241.5), -118.5);
  assert.equal(M.W180(180), 180);
  assert.equal(M.W180(181), -179);
});

test("lonLabel", () => {
  const M = load();
  assert.equal(M.lonLabel(241.5), "118.50°W");
  assert.equal(M.lonLabel(121.31), "121.31°E");
  assert.equal(M.lonLabel(180), "180.00°E");
  assert.equal(M.lonLabel(181), "179.00°W");
});

test("mkGrid converts and reads", () => {
  const M = load(), ca = {lat0: 30, dlat: 1, nlat: 2, lon0: -128, dlon: 1, nlon: 2};
  // Four equal points: wind 10 kt from the east (so blowing west), waves 1.5 m from the east, 1012 hPa.
  const g = M.mkGrid("ca", packGrid({...ca, wave: () => [1.5, 90], pres: () => 1012}));
  assert.equal(g.box.l, 232);
  assert.deepEqual(g.box, {l: 232, r: 233, s: 30, n: 31});
  assert.equal(g.lon0, 232);
  assert.equal(g.hasP, true);
  g.at(g.t0);
  const w = g.val(232.5, 30.5, "wind");
  near(w.u, -10); near(w.v, 0);
  near(g.val(232.3, 30.8, "waves").h, 1.5);
  near(g.pres(232.3, 30.8).p, 1012);
  const d = g.dir(232.5, 30.5, "waves");
  near(d.x, 1); near(d.y, 0); near(d.h, 1.5);
  // Outside the box it is null: past each edge, and at the west longitude -127.5 (the box runs east, 232-233).
  for (const [lon, lat] of [[231.9, 30.5], [233.1, 30.5], [232.5, 29.9], [232.5, 31.1], [-127.5, 30.5]]) {
    assert.equal(g.val(lon, lat, "waves"), null, `val at ${lon}, ${lat}`);
    assert.equal(g.dir(lon, lat, "waves"), null, `dir at ${lon}, ${lat}`);
    assert.equal(g.pres(lon, lat), null, `pres at ${lon}, ${lat}`);
  }
  // A 255 point (no data) is skipped and the other three share its weight; right on it nothing is left, so null.
  const h = M.mkGrid("ca", packGrid({...ca, wave: (k, i, j) => [[[1, 2], [3, null]][i][j], 90], pres: (k, i, j) => i && j ? null : 1000}));
  h.at(h.t0);
  near(h.val(232.5, 30.5, "waves").h, 2);
  assert.equal(h.val(233, 31, "waves"), null);
  near(h.dir(232.5, 30.5, "waves").h, 2);
  assert.equal(h.dir(233, 31, "waves"), null);
  near(h.pres(232.5, 30.5).p, 1000);
  assert.equal(h.pres(233, 31), null);
  // No pressure in the grid: no pressure readings.
  const n = M.mkGrid("ca", packGrid(ca));
  n.at(n.t0);
  assert.equal(n.hasP, false);
  assert.equal(n.pres(232.5, 30.5), null);
});

test("at picks the nearest step", () => {
  const M = load(), g = M.mkGrid("pac", packGrid({lat0: 0, dlat: 5, nlat: 2, lon0: 100, dlon: 5, nlon: 2, nt: 3, dt: 6, wave: k => [k + 1, 90]}));
  assert.equal(g.t0, Date.UTC(2026, 9, 16, 16)); // 2026-10-17T00:00 in Taipei
  assert.equal(g.t0, M.pt("2026-10-17T00:00"));
  assert.equal(g.end, g.t0 + 2*6*36e5);
  assert.equal(g.k, 0); near(g.val(102, 2, "waves").h, 1); // before any at(), the first step
  g.at(g.t0 + 2*36e5); assert.equal(g.k, 0); near(g.val(102, 2, "waves").h, 1);
  g.at(g.t0 + 4*36e5); assert.equal(g.k, 1); near(g.val(102, 2, "waves").h, 2);
  g.at(g.end + 24*36e5); assert.equal(g.k, 2); near(g.val(102, 2, "waves").h, 3);
  g.at(g.t0 - 24*36e5); assert.equal(g.k, 0); near(g.val(102, 2, "waves").h, 1);
});

test("iso marks highs and lows on the grid's own east longitudes", () => {
  // A low in the middle of a 5 x 5 grid that starts at -128 (232 east).
  const M = load(), g = M.mkGrid("ca", packGrid({lat0: 30, dlat: 1, nlat: 5, lon0: -128, dlon: 1, nlon: 5, pres: (k, i, j) => 1000 + (i - 2)**2 + (j - 2)**2}));
  g.at(g.t0);
  const f = g.iso();
  assert.equal(f.HL.length, 1);
  assert.deepEqual([f.HL[0].lon, f.HL[0].lat, f.HL[0].v, f.HL[0].hi], [234, 32, 1000, false]);
  assert.equal(g.iso(0), f); // worked out once per step
  const s = g.segs(2);
  assert.equal(s, g.segs(2, f));
  assert.ok(s.lv.some(l => l.s.length > 0), "pressure lines around the low");
});

test("iso marks no highs or lows on Hong Kong's 0.125° grid", () => {
  // The same low on Hong Kong's spacing still gets its pressure lines, but no L: 2 points there are only a quarter of a degree.
  const M = load(), g = M.mkGrid("hk", packGrid({lat0: 21.5, dlat: 0.125, nlat: 5, lon0: 113.5, dlon: 0.125, nlon: 5, pres: (k, i, j) => 1000 + (i - 2)**2 + (j - 2)**2}));
  g.at(g.t0);
  assert.deepEqual(g.iso().HL, []);
  assert.ok(g.segs(2).lv.some(l => l.s.length > 0), "pressure lines around the low");
});

const fine = {box: {l: 0, r: 10, s: 0, n: 10}, dlon: 1, dlat: 1}, coarse = {box: {l: -20, r: 30, s: -20, n: 30}, dlon: 5, dlat: 5};

test("fade", () => {
  const M = load();
  assert.equal(M.fade(fine, 5, 5), 1);
  assert.equal(M.fade(fine, 9.5, 5), 0.25);
  assert.equal(M.fade(fine, 10, 5), 0);
  assert.equal(M.fade(fine, 11, 5), 0);
  assert.equal(M.fade(fine, 9.5, 9.5), 0.0625);
});

test("layered", () => {
  const M = load(), pick = g => g.v, F = {...fine, v: {h: 1}}, C = {...coarse, v: {h: 3}}, hole = {...fine, v: null};
  assert.deepEqual(M.layered([F, C], 5, 5, pick), {h: 1});
  assert.deepEqual(M.layered([F, C], 9.5, 5, pick), {h: 2.5});
  assert.deepEqual(M.layered([F, C], 12, 5, pick), {h: 3});
  assert.equal(M.layered([hole, C], 5, 5, pick), null);
  assert.deepEqual(M.layered([hole, C], 9.5, 5, pick), {h: 3});
  assert.deepEqual(M.layered([F], 9.5, 5, pick), {h: 1});
  // Every field fades, the walk can start further down the list, and nothing covers a point outside every grid.
  assert.deepEqual(M.layered([{...fine, v: {u: 1, v: -1}}, {...coarse, v: {u: 3, v: 1}}], 9.5, 5, pick), {u: 2.5, v: 0.5});
  assert.deepEqual(M.layered([F, C], 5, 5, pick, 1), {h: 3});
  assert.equal(M.layered([F, C], 40, 5, pick), null);
});

test("isoPick", () => {
  // The real grids' headers: lat0, dlat, nlat, lon0, dlon, nlon.
  const M = load(), real = {hi: [15, 1, 12, -162, 1, 11], ca: [30, 1, 13, -128, 1, 13], au: [-44, 2, 13, 110, 2, 24], id: [-16, 2, 8, 100, 2, 17], nz: [-50, 2, 10, 150, 2, 25], pi: [-24, 2, 8, 170, 2, 24], wp: [0, 3, 16, 100, 3, 21], pac: [-50, 5, 24, 100, 5, 31], ak: [54, 1, 9, -158, 2, 15], mi: [-2, 2, 9, 152, 2, 13], hk: [21.5, 0.125, 14, 113.5, 0.125, 11], pg: [-10, 2, 7, 136, 2, 11], vu: [-24, 2, 7, 164, 2, 6], bj: [21, 1, 15, -119, 1, 12], tw: [15, 1, 19, 115, 1, 26]};
  const grid = (n, pres = () => 1012) => { const [lat0, dlat, nlat, lon0, dlon, nlon] = real[n]; return M.mkGrid(n, packGrid({lat0, dlat, nlat, lon0, dlon, nlon, pres})); };
  const G = ["hk", "tw", "hi", "ca", "bj", "ak", "au", "id", "nz", "pi", "mi", "pg", "vu", "wp", "pac"].map(n => grid(n)), name = g => g ? g.name : null;
  assert.deepEqual(G.map(g => g.box), [{l: 113.5, r: 114.75, s: 21.5, n: 23.125}, {l: 115, r: 140, s: 15, n: 33}, {l: 198, r: 208, s: 15, n: 26}, {l: 232, r: 244, s: 30, n: 42}, {l: 241, r: 252, s: 21, n: 35}, {l: 202, r: 230, s: 54, n: 62}, {l: 110, r: 156, s: -44, n: -20}, {l: 100, r: 132, s: -16, n: -2}, {l: 150, r: 198, s: -50, n: -32}, {l: 170, r: 216, s: -24, n: -10}, {l: 152, r: 176, s: -2, n: 14}, {l: 136, r: 156, s: -10, n: 2}, {l: 164, r: 174, s: -24, n: -12}, {l: 100, r: 160, s: 0, n: 45}, {l: 100, r: 250, s: -50, n: 65}]);
  assert.equal(name(M.isoPick(G, 119, 123, 21.75, 25.75)), "tw"); // Taiwan, inside its own 1° grid
  assert.equal(name(M.isoPick(G, 128, 138, 17, 27)), "tw"); // a typhoon south of Okinawa
  assert.equal(name(M.isoPick(G, 125, 146, 15, 30)), "wp"); // out past 140°E toward a typhoon: the West Pacific grid
  assert.equal(name(M.isoPick(G, 95, 170, -5, 50)), "pac"); // wider than the West Pacific
  assert.equal(name(M.isoPick(G, 199, 207, 16, 25)), "hi");
  assert.equal(name(M.isoPick(G, 101.77, 130.23, -15.18, -2.21)), "id"); // Indonesia's home view on a phone, both ways up
  assert.equal(name(M.isoPick(G, 101.39, 130.61, -15.25, -2.25)), "id"); // and on a 20:9 phone held sideways
  assert.equal(name(M.isoPick(G, 103.66, 141.54, 5.18, 22.12)), "wp"); // the Philippines'
  // New Zealand's home view on a phone, both ways up, and on a 20:9 phone held sideways: its grid runs past 180° (lon0 150, 25 columns)
  assert.equal(name(M.isoPick(G, 151.08, 197.52, -49.3, -33.31)), "nz");
  assert.equal(name(M.isoPick(G, 150.45, 198.15, -49.3, -33.31)), "nz");
  // The South Pacific's two home views held sideways (west, then east), on a phone and a 20:9 phone: inside its grid, which runs past 180°.
  // Upright their width sets the zoom and their height runs past the grid, so the Pacific layer draws there.
  assert.equal(name(M.isoPick(G, 170.35, 195.35, -23.21, -12.22)), "pi");
  assert.equal(name(M.isoPick(G, 170.02, 195.68, -23.21, -12.22)), "pi");
  assert.equal(name(M.isoPick(G, 195.89, 214.25, -23.45, -15.45)), "pi");
  assert.equal(name(M.isoPick(G, 195.65, 214.49, -23.45, -15.45)), "pi");
  assert.equal(name(M.isoPick(G, 174.05, 191.65, -34.78, 0.95)), "pac");
  assert.equal(name(M.isoPick(G, 197.47, 212.67, -34.12, -3.44)), "pac");
  // Alaska's home view held sideways, on a phone and a 20:9 phone: inside its grid. Upright its width sets the zoom and the view runs from the
  // box's top, 65°N, down past the grid, so the Pacific layer draws there.
  assert.equal(name(M.isoPick(G, 202.6, 228.2, 55.16, 61.37)), "ak");
  assert.equal(name(M.isoPick(G, 202.25, 228.55, 55.16, 61.37)), "ak");
  assert.equal(name(M.isoPick(G, 203.4, 227.4, 32.48, 65)), "pac");
  // Micronesia's west home view (Guam and Saipan) upright, then sideways on a phone and a 20:9 phone: west of its grid's 152°E edge, inside
  // the West Pacific grid. Its east view (Pohnpei to Majuro) held sideways, on a phone and a 20:9 phone, lies inside its grid; upright its
  // width sets the zoom and its height runs past the grid, so the Pacific layer draws there.
  assert.equal(name(M.isoPick(G, 144.37, 146.07, 12.45, 16.02)), "wp");
  assert.equal(name(M.isoPick(G, 141.54, 148.9, 12.58, 15.88)), "wp");
  assert.equal(name(M.isoPick(G, 141.44, 149, 12.58, 15.88)), "wp");
  assert.equal(name(M.isoPick(G, 154.4, 175.08, 1.44, 10.93)), "mi");
  assert.equal(name(M.isoPick(G, 154.12, 175.36, 1.44, 10.93)), "mi");
  assert.equal(name(M.isoPick(G, 155.24, 174.24, -14.19, 25.86)), "pac");
  // Hong Kong's home view upright, then sideways on a phone and a 20:9 phone: inside its grid, the finest, which is tried first. Zoomed out
  // past the grid's half degree of slack, the West Pacific grid draws.
  assert.equal(name(M.isoPick(G, 113.8, 114.55, 21.57, 23.07)), "hk");
  assert.equal(name(M.isoPick(G, 113.59, 114.75, 22.07, 22.57)), "hk");
  assert.equal(name(M.isoPick(G, 113.57, 114.77, 22.07, 22.57)), "hk");
  assert.equal(name(M.isoPick(G, 112.9, 115.4, 21.2, 23.5)), "wp");
  // Hainan's home view upright, then sideways on a phone and a 20:9 phone: it has no grid of its own and lies south of Hong Kong's, so
  // the West Pacific grid draws.
  assert.equal(name(M.isoPick(G, 109.28, 110.58, 17.1, 19.77)), "wp");
  assert.equal(name(M.isoPick(G, 108.85, 111.01, 17.96, 18.91)), "wp");
  assert.equal(name(M.isoPick(G, 108.82, 111.04, 17.96, 18.91)), "wp");
  // Vietnam's first open (nothing saved, the home view fitted to the names) upright, then sideways on a phone and a 20:9 phone: it has no
  // grid of its own either. Sideways the view stops at the Pacific box's west edge, 100°E, which is also the West Pacific grid's.
  assert.equal(name(M.isoPick(G, 106.52, 110.14, 9.17, 16.79)), "wp");
  assert.equal(name(M.isoPick(G, 100, 119.99, 8.58, 17.57)), "wp");
  assert.equal(name(M.isoPick(G, 100, 120.53, 8.58, 17.57)), "wp");
  // Papua New Guinea's first opens: its north coast (Lido to Tupira) upright, then sideways on a phone and a 20:9 phone, then New Ireland
  // (Kavieng to Rubio) the same three ways, all inside its grid (10°S–2°N, 136–156°E); upright the north coast's width sets the zoom, and its
  // height reaches just past the grid's south edge, inside the half degree to spare.
  assert.equal(name(M.isoPick(G, 140.47, 146.07, -10.06, 2)), "pg");
  assert.equal(name(M.isoPick(G, 139.88, 146.82, -5.17, -1.97)), "pg");
  assert.equal(name(M.isoPick(G, 139.79, 146.91, -5.17, -1.97)), "pg");
  assert.equal(name(M.isoPick(G, 150.4, 152.52, -5.31, -0.71)), "pg");
  assert.equal(name(M.isoPick(G, 149.73, 153.19, -3.81, -2.21)), "pg");
  assert.equal(name(M.isoPick(G, 149.68, 153.24, -3.81, -2.21)), "pg");
  // Vanuatu's first opens: Efate (Devil's Point to Tapi Point) upright, then sideways on a phone and a 20:9 phone, then Tanna (Lenakel and
  // Port Resolution) the same three ways, all inside its grid (24–12°S, 164–174°E). Held sideways, Tanna's view reaches past 170°E, where
  // the South Pacific's grid starts, but its west edge lies more than the half degree to spare outside that grid, so Vanuatu's draws.
  assert.equal(name(M.isoPick(G, 168.06, 168.46, -18.19, -17.37)), "vu");
  assert.equal(name(M.isoPick(G, 167.75, 168.78, -18, -17.55)), "vu");
  assert.equal(name(M.isoPick(G, 167.74, 168.79, -18, -17.55)), "vu");
  assert.equal(name(M.isoPick(G, 169.14, 169.64, -20.04, -19.02)), "vu");
  assert.equal(name(M.isoPick(G, 168.7, 170.08, -19.83, -19.23)), "vu");
  assert.equal(name(M.isoPick(G, 168.68, 170.1, -19.83, -19.23)), "vu");
  // Baja's first opens: its Pacific coast (K-38 to Scorpion Bay) upright, inside its grid (21–35°N, 119–108°W) with its top in the half
  // degree to spare, then on a 360x800 phone, whose view reaches past it to 36°N, then sideways on a phone and a 20:9 phone, where its
  // height sets the zoom and the view runs west past the grid, so the Pacific layer draws; then the Cape (San Pedrito and Cerritos)
  // upright, sideways and on a 20:9 phone, all three stopped at the map's east edge, 110°W, inside the grid.
  assert.equal(name(M.isoPick(G, 241.9, 248.64, 22.75, 35.46)), "bj");
  assert.equal(name(M.isoPick(G, 241.68, 248.86, 22.13, 36)), "pac");
  assert.equal(name(M.isoPick(G, 225.84, 250, 24.32, 34.05)), "pac");
  assert.equal(name(M.isoPick(G, 226.68, 250, 24.47, 33.62)), "pac");
  assert.equal(name(M.isoPick(G, 248.4, 250, 21.75, 24.93)), "bj");
  assert.equal(name(M.isoPick(G, 247.64, 250, 22.85, 23.85)), "bj");
  assert.equal(name(M.isoPick(G, 247.58, 250, 22.85, 23.85)), "bj");
  assert.equal(M.isoPick(G.slice(0, 14), 95, 170, -5, 50), null); // no Pacific grid
  // Half a degree of slack past a box edge, and a grid without pressure is passed over.
  assert.equal(name(M.isoPick(G, 99.6, 123, 21.75, 25.75)), "wp");
  assert.equal(name(M.isoPick(G, 99.4, 123, 21.75, 25.75)), "pac");
  assert.equal(name(M.isoPick([grid("wp", null), G[14]], 119, 123, 21.75, 25.75)), "pac");
  assert.equal(M.isoPick([grid("wp", null), grid("pac", null)], 119, 123, 21.75, 25.75), null);
});

test("cut", () => {
  const M = load();
  // the coast boxes' edges, then each DETAIL box's
  assert.deepEqual(M.CUTX, [100, 163, 180, 232, 246, 250, ...M.DETAIL.flatMap(([l, r]) => [l, r])]);
  assert.deepEqual(M.CUTY, [-50, -5, 30, 43, 50, 65, ...M.DETAIL.flatMap(([, , s, n]) => [s, n])]);
  assert.equal(M.cut(163, 10, 163, 12), true);
  assert.equal(M.cut(163, 10, 163.01, 12), false);
  assert.equal(M.cut(120, -5, 121, -5), true);
  assert.equal(M.cut(120, 31, 121, 31), false);
  // Within 1e-6; and a segment running from one cut line to another lies on neither.
  assert.equal(M.cut(246 + 5e-7, 31, 246, 35), true);
  assert.equal(M.cut(163, 30, 170, 43), false);
});

test("clipOut", () => {
  const M = load(), area = o => Math.abs(o.slice(1).reduce((a, [x, y], i) => a + o[i][0]*y - x*o[i][1], 0))/2, B = [4, 6, 4, 6];
  // A ring round the box: the pieces west, east, south and north of it, each closed, filling all of the ring but the box.
  const P = M.clipOut([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], B);
  assert.equal(P.length, 4);
  for (const p of P) assert.deepEqual(p[0], p[p.length - 1]);
  near(P.reduce((a, p) => a + area(p), 0), 96);
  for (const p of P) for (const [x, y] of p) assert.ok(!(x > 4 && x < 6 && y > 4 && y < 6), `${x}, ${y} is inside the box`);
  // Inside the box nothing is left; wholly outside it, the ring comes back as it was.
  assert.deepEqual(M.clipOut([[4.5, 4.5], [5.5, 4.5], [5.5, 5.5], [4.5, 4.5]], B), []);
  assert.deepEqual(M.clipOut([[0, 0], [2, 0], [2, 2], [0, 0]], B), [[[0, 0], [2, 0], [2, 2], [0, 0]]]);
  // A ring reaching into the box from the west keeps its part west of it, which ends on the box's west edge exactly.
  const W = M.clipOut([[2, 4.5], [5, 4.5], [5, 5.5], [2, 5.5], [2, 4.5]], B);
  assert.equal(W.length, 1);
  near(area(W[0]), 2);
  assert.deepEqual(W[0].filter(([x]) => x === 4), [[4, 4.5], [4, 5.5]]);
  // One reaching across the box's south-west corner: a piece west of it and one south of it, meeting on its west edge.
  const C = M.clipOut([[3, 3], [5, 3], [5, 5], [3, 5], [3, 3]], B);
  assert.equal(C.length, 2);
  near(C.reduce((a, p) => a + area(p), 0), 3);
  // An open outline (Papua New Guinea's runs from the border at 5°S round to 5°S again) loses none of its points: it is cut as if a segment
  // from its last point back to its first closed it.
  assert.deepEqual(M.clipOut([[2, 4.5], [5, 4.5], [5, 5.5], [2, 5.5]], B), M.clipOut([[2, 4.5], [5, 4.5], [5, 5.5], [2, 5.5], [2, 4.5]], B));
});

test("coast edges along a cut line lie on it exactly", () => {
  // Every outline in template.html's COAST lines, longitudes east. A segment over 0.75° long that keeps within 0.1° of a cut line all the way is a
  // cut edge, so it has to lie on the line exactly (MAPM.cut), or the coast line draws it. Real coast and borders that close to one run shorter (0.52° at most).
  const M = load(), src = fs.readFileSync(path.join(__dirname, "..", "..", "template.html"), "utf8"), off = [];
  let n = 0;
  for (const l of src.split("\n")) {
    const m = /^  (?:const COAST = |COAST\.push\(\.\.\.)(\[.*\])\)?;$/.exec(l);
    if (!m) continue;
    n++;
    for (const o of JSON.parse(m[1])) for (let i = 1; i < o.length; i++) {
      const ax = M.E(o[i-1][0]), ay = o[i-1][1], bx = M.E(o[i][0]), by = o[i][1];
      const along = M.CUTX.some(x => Math.abs(ax - x) < .1 && Math.abs(bx - x) < .1) || M.CUTY.some(y => Math.abs(ay - y) < .1 && Math.abs(by - y) < .1);
      if (along && Math.hypot(bx - ax, by - ay) > .75 && !M.cut(ax, ay, bx, by)) off.push(`[${ax},${ay}] -> [${bx},${by}]`);
    }
  }
  assert.ok(n >= 5, `only ${n} COAST lines found`);
  assert.deepEqual(off, []);
});

test("DETAIL boxes: the coarse outlines give way to the 10 m land, meeting it on the boxes' edges", () => {
  // The page's own steps on template.html's COAST lines: longitudes east, then each outline reaching into a box cut to its pieces outside it,
  // then the 10 m push after the comment. No coarse vertex lies on a box's edge, so only cuts run along one; each box holds 10 m land, which
  // keeps inside one box, its points on an edge exactly on it (boxes may overlap, as New Ireland's two do); nothing coarse is left inside a
  // box; and every edge of a piece that the coast line draws (one that is no cut) runs along an edge of the outline it was cut from.
  const M = load(), src = fs.readFileSync(path.join(__dirname, "..", "..", "template.html"), "utf8").split("\n");
  const at = src.indexOf("  // Up close: Natural Earth 10 m land cut to the DETAIL boxes, simplified (tools/detail_coast.py).");
  assert.ok(at > 0, "no DETAIL push in template.html");
  const rings = L => L.flatMap(l => { const m = /^  (?:const COAST = |COAST\.push\(\.\.\.)(\[.*\])\)?;$/.exec(l); return m ? JSON.parse(m[1]) : []; });
  let coarse = rings(src.slice(0, at)).map(o => o.map(([x, y]) => [M.E(x), y]));
  const ten = rings(src.slice(at + 1, at + 2)), inBox = ([x, y], [l, r, s, n]) => x > l && x < r && y > s && y < n;
  const edge = ([x, y], [l, r, s, n]) => x === l || x === r || y === s || y === n;
  assert.ok(M.DETAIL.length >= 1 && ten.length >= 1);
  for (const B of M.DETAIL) {
    const [l, r, s, n] = B;
    assert.ok(l < r && s < n, B);
    for (const o of coarse) for (const [x, y] of o) assert.ok(Math.abs(x - l) > 1e-6 && Math.abs(x - r) > 1e-6 && Math.abs(y - s) > 1e-6 && Math.abs(y - n) > 1e-6, `${x}, ${y} is on ${B}`);
    assert.ok(coarse.some(o => o.some(p => inBox(p, B))), `nothing coarse reaches into ${B}`);
    assert.ok(ten.some(o => o.some(p => inBox(p, B))), `no 10 m land in ${B}`);
    const on = ([x, y], [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax)*dx + (y - ay)*dy)/(dx*dx + dy*dy || 1)));
      return Math.hypot(x - ax - t*dx, y - ay - t*dy) < 1e-9; };
    coarse = coarse.flatMap(o => {
      if (!(o.some(([x]) => x > l) && o.some(([x]) => x < r) && o.some(([, y]) => y > s) && o.some(([, y]) => y < n))) return [o];
      const P = M.clipOut(o, B);
      for (const p of P) for (let i = 1; i < p.length; i++) if (!M.cut(...p[i-1], ...p[i]))
        assert.ok(o.some((b, j) => j && on(p[i-1], o[j-1], b) && on(p[i], o[j-1], b)), `${p[i-1]} to ${p[i]}, cut from an outline by ${B}, is on none of its edges`);
      return P;
    });
    assert.deepEqual(coarse.filter(o => o.some(p => inBox(p, B))), []);
  }
  for (const o of ten) {
    assert.deepEqual(o[0], o[o.length - 1]);
    const B = M.DETAIL.find(B => o.some(p => inBox(p, B)) && o.every(p => inBox(p, B) || edge(p, B)));
    assert.ok(B, `${o[0]} is in no one box`);
    for (let i = 1; i < o.length; i++) {  // a segment along an edge is a cut, so the coast line leaves it out
      const [a, b] = [o[i-1], o[i]];
      if ((a[0] === b[0] && (a[0] === B[0] || a[0] === B[1])) || (a[1] === b[1] && (a[1] === B[2] || a[1] === B[3]))) assert.ok(M.cut(...a, ...b));
    }
  }
});

test("mkGrid null", () => {
  const M = load();
  assert.equal(M.mkGrid("pac", null), null);
});

test("my and iy", () => {
  const M = load();
  for (const lat of [-60, -50, -32.5, 0, 23.75, 45, 60]) near(M.iy(M.my(lat)), lat);
  assert.equal(M.my(0), 0);
  near(M.my(60), 75.4561, 1e-3);
  near(M.my(-60), -M.my(60));
});

test("cover", () => {
  const M = load();
  assert.deepEqual(M.PBOX, {l: 100, r: 250, s: -50, n: 65});
  const wp = {l: 100, r: 160, s: 0, n: 45};
  assert.deepEqual(M.OLDBOX, {tw: wp, jp: wp, kr: {l: 117.1, r: 138.4, s: 31.6, n: 39.6}, ph: {l: 103.66, r: 141.54, s: 5.18, n: 22.12}, id: {l: 101.77, r: 130.23, s: -15.18, n: -2.21}, ca: {l: 232, r: 244, s: 30, n: 42}, hi: {l: 198, r: 208, s: 15, n: 26}, au: {l: 110, r: 156, s: -44, n: -20}, nz: {l: 151.08, r: 197.52, s: -49.3, n: -33.31}, nw: {l: 231, r: 238, s: 42, n: 50}});
  // Upright the Pacific box fills the screen top to bottom, sideways side to side.
  near(M.cover(M.PBOX, 390, 844), 844/(M.my(65) - M.my(-50)));
  near(M.cover(M.PBOX, 390, 844), 5.852, 1e-3);
  near(M.cover(M.PBOX, 844, 390), 844/150);
  near(M.cover(M.OLDBOX.ca, 390, 844), 844/(M.my(42) - M.my(30)));
  // Korea's box opens a phone on Korea's home view (cy 35.7, 8 degrees of latitude) both ways up, to within a part in a thousand,
  // the Philippines' on theirs (cy 13.8, 17 degrees), Indonesia's on its own (cy -8.75, 13 degrees) and New Zealand's on its own (cy -41.8, 16 degrees).
  for (const [W, H] of [[390, 844], [844, 390]]) near(M.cover(M.OLDBOX.kr, W, H) / (H*Math.cos(35.7*Math.PI/180)/8), 1, 1e-3);
  for (const [W, H] of [[390, 844], [844, 390]]) near(M.cover(M.OLDBOX.ph, W, H) / (H*Math.cos(13.8*Math.PI/180)/17), 1, 1e-3);
  for (const [W, H] of [[390, 844], [844, 390]]) near(M.cover(M.OLDBOX.id, W, H) / (H*Math.cos(-8.75*Math.PI/180)/13), 1, 1e-3);
  for (const [W, H] of [[390, 844], [844, 390]]) near(M.cover(M.OLDBOX.nz, W, H) / (H*Math.cos(-41.8*Math.PI/180)/16), 1, 1e-3);
});

test("clampTo", () => {
  const M = load(), Y = M.iy((M.my(65) + M.my(-50))/2);
  // Zoomed all the way out upright, the box just fills the screen top to bottom: from Taiwan the view goes as far west as it can, on the box's middle row.
  const zmin = M.cover(M.PBOX, 390, 844), [ox, oy] = M.clampTo(M.PBOX, 390, 844, zmin, 120, 23.75);
  near(ox, 100 + 390/2/zmin); near(oy, Y);
  // Where the box is smaller than the screen, the view centres on it: here both ways, at 2 pixels a degree.
  const [cx, cy] = M.clampTo(M.PBOX, 390, 844, 2, 120, 23.75);
  near(cx, 175); near(cy, Y);
  // Zoomed in it keeps the view inside the box, the y axis in Mercator y: half the screen is 422/20 of it.
  const [ex, ey] = M.clampTo(M.PBOX, 390, 844, 20, 95, 0);
  near(ex, 100 + 390/2/20); near(ey, 0);
  const [nx, ny] = M.clampTo(M.PBOX, 390, 844, 20, 251, 64);
  near(nx, 250 - 390/2/20); near(ny, M.iy(M.my(65) - 844/2/20));
  assert.deepEqual(M.clampTo(M.PBOX, 390, 844, 20, 175, 23.75), [175, 23.75]);
});

test("flight", () => {
  const M = load();
  // A view is its centre (longitude, Mercator y) and its width in degrees: the home views of Taiwan, California and Japan on a phone held upright.
  const view = (lon, lat, span) => [lon, M.my(lat), 390/(844*Math.cos(lat*Math.PI/180)/span)], tw = view(120.9, 23.75, 4), ca = view(240.5, 35.3, 9), jp = view(135.6, 33.4, 13);
  for (const [a, b] of [[tw, ca], [ca, tw], [jp, tw], [tw, jp]]) {
    const f = M.flight(...a, ...b), trip = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // It starts and ends on the two views.
    f.at(0).forEach((v, i) => near(v, a[i], 1e-9)); f.at(1).forEach((v, i) => near(v, b[i], 1e-9));
    // The centre only ever moves on towards the end; at its widest the view takes in the whole trip; the start is in sight until the centre is
    // halfway, and the end from then on.
    let was = 0, widest = 0;
    for (let i = 0; i <= 1000; i++) { const [x, y, w] = f.at(i/1000), gone = Math.hypot(x - a[0], y - a[1]), left = Math.hypot(b[0] - x, b[1] - y);
      assert.ok(gone >= was - 1e-9, `the centre goes back at ${i/1000}`); was = gone; widest = Math.max(widest, w);
      assert.ok((gone <= trip/2 ? gone : left) <= w/2, `at ${i/1000} the ${gone <= trip/2 ? "start" : "end"} is out of sight`); }
    assert.ok(widest >= trip, `at its widest the view is ${widest}, short of the ${trip} trip`);
  }
  // A longer trip takes longer: Taiwan to California is longer than Taiwan to Japan.
  assert.ok(M.flight(...tw, ...ca).S > M.flight(...tw, ...jp).S);
  // No distance to go: a plain zoom about the centre.
  const z = M.flight(150, 20, 10, 150, 20, 40);
  assert.deepEqual(z.at(0.5), [150, 20, 20]);
  near(z.S, Math.log(4)/Math.SQRT2);
});
