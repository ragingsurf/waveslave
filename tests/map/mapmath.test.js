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
  const M = load(), real = {hi: [15, 1, 12, -162, 1, 11], ca: [30, 1, 13, -128, 1, 13], au: [-44, 2, 13, 110, 2, 24], wp: [0, 3, 16, 100, 3, 21], pac: [-50, 5, 23, 100, 5, 31]};
  const grid = (n, pres = () => 1012) => { const [lat0, dlat, nlat, lon0, dlon, nlon] = real[n]; return M.mkGrid(n, packGrid({lat0, dlat, nlat, lon0, dlon, nlon, pres})); };
  const G = ["hi", "ca", "au", "wp", "pac"].map(n => grid(n)), name = g => g ? g.name : null;
  assert.deepEqual(G.map(g => g.box), [{l: 198, r: 208, s: 15, n: 26}, {l: 232, r: 244, s: 30, n: 42}, {l: 110, r: 156, s: -44, n: -20}, {l: 100, r: 160, s: 0, n: 45}, {l: 100, r: 250, s: -50, n: 60}]);
  assert.equal(name(M.isoPick(G, 119, 123, 21.75, 25.75)), "wp"); // Taiwan
  assert.equal(name(M.isoPick(G, 95, 170, -5, 50)), "pac"); // wider than the West Pacific
  assert.equal(name(M.isoPick(G, 199, 207, 16, 25)), "hi");
  assert.equal(M.isoPick(G.slice(0, 4), 95, 170, -5, 50), null); // no Pacific grid
  // Half a degree of slack past a box edge, and a grid without pressure is passed over.
  assert.equal(name(M.isoPick(G, 99.6, 123, 21.75, 25.75)), "wp");
  assert.equal(name(M.isoPick(G, 99.4, 123, 21.75, 25.75)), "pac");
  assert.equal(name(M.isoPick([grid("wp", null), G[4]], 119, 123, 21.75, 25.75)), "pac");
  assert.equal(M.isoPick([grid("wp", null), grid("pac", null)], 119, 123, 21.75, 25.75), null);
});

test("cut", () => {
  const M = load();
  assert.deepEqual(M.CUTX, [100, 163, 180, 232, 246, 250]);
  assert.deepEqual(M.CUTY, [-50, -5, 30, 43, 50, 60]);
  assert.equal(M.cut(163, 10, 163, 12), true);
  assert.equal(M.cut(163, 10, 163.01, 12), false);
  assert.equal(M.cut(120, -5, 121, -5), true);
  assert.equal(M.cut(120, 31, 121, 31), false);
  // Within 1e-6; and a segment running from one cut line to another lies on neither.
  assert.equal(M.cut(246 + 5e-7, 31, 246, 35), true);
  assert.equal(M.cut(163, 30, 170, 43), false);
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
  assert.deepEqual(M.PBOX, {l: 100, r: 250, s: -50, n: 60});
  const wp = {l: 100, r: 160, s: 0, n: 45};
  assert.deepEqual(M.OLDBOX, {tw: wp, jp: wp, kr: {l: 117.1, r: 138.4, s: 31.6, n: 39.6}, ca: {l: 232, r: 244, s: 30, n: 42}, hi: {l: 198, r: 208, s: 15, n: 26}, au: {l: 110, r: 156, s: -44, n: -20}, nw: {l: 231, r: 238, s: 42, n: 50}});
  // Upright the Pacific box fills the screen top to bottom, sideways side to side.
  near(M.cover(M.PBOX, 390, 844), 844/(M.my(60) - M.my(-50)));
  near(M.cover(M.PBOX, 390, 844), 6.328, 1e-3);
  near(M.cover(M.PBOX, 844, 390), 844/150);
  near(M.cover(M.OLDBOX.ca, 390, 844), 844/(M.my(42) - M.my(30)));
  // Korea's box opens a phone on Korea's home view (cy 35.7, 8 degrees of latitude) both ways up, to within a part in a thousand.
  for (const [W, H] of [[390, 844], [844, 390]]) near(M.cover(M.OLDBOX.kr, W, H) / (H*Math.cos(35.7*Math.PI/180)/8), 1, 1e-3);
});

test("clampTo", () => {
  const M = load(), Y = M.iy((M.my(60) + M.my(-50))/2);
  // Zoomed all the way out upright, the box just fills the screen top to bottom: from Taiwan the view goes as far west as it can, on the box's middle row.
  const zmin = M.cover(M.PBOX, 390, 844), [ox, oy] = M.clampTo(M.PBOX, 390, 844, zmin, 120, 23.75);
  near(ox, 100 + 390/2/zmin); near(oy, Y);
  // Where the box is smaller than the screen, the view centres on it: here both ways, at 2 pixels a degree.
  const [cx, cy] = M.clampTo(M.PBOX, 390, 844, 2, 120, 23.75);
  near(cx, 175); near(cy, Y);
  // Zoomed in it keeps the view inside the box, the y axis in Mercator y: half the screen is 422/20 of it.
  const [ex, ey] = M.clampTo(M.PBOX, 390, 844, 20, 95, 0);
  near(ex, 100 + 390/2/20); near(ey, 0);
  const [nx, ny] = M.clampTo(M.PBOX, 390, 844, 20, 251, 59);
  near(nx, 250 - 390/2/20); near(ny, M.iy(M.my(60) - 844/2/20));
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
