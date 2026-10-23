// The coach's maths block (COACHM) in web/coach.js, loaded on its own: it is plain functions with no page state.
// Run: node --test tests/coach/coachmath.test.js
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

const FILE = path.join(__dirname, "..", "..", "web", "coach.js");
function load() {
  const src = fs.readFileSync(FILE, "utf8");
  const a = src.indexOf("// ---- Coach maths"), b = src.indexOf("// ---- end coach maths");
  assert.ok(a >= 0 && b > a, "web/coach.js has no Coach maths block (// ---- Coach maths ... // ---- end coach maths)");
  // Strict, as it runs inside coach.js.
  return new Function('"use strict";\n' + src.slice(a, b) + "\nreturn COACHM;")();
}
const M = load();
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const STEPS = [-1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25];

// mulberry32: the same noise on every run.
function rng(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Twelve key frames of a W x H clip as the page gets them for tracking: each drawn at quarter size (every quarter pixel the mean of the
// 4 x 4 displayed pixels under it), then through grey(). Every frame has its own noise (0-255 grey); a white square of side S sits over it
// with its top-left at at(i), or is gone where at(i) is null. W and H are multiples of 4.
function clip({W, H, S, at, n = 12, seed = 1}) {
  const r = rng(seed), w = W / 4, h = H / 4, out = [];
  for (let i = 0; i < n; i++) {
    const p = at(i), rgba = new Uint8ClampedArray(w * h * 4), sum = new Float64Array(w * h);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      sum[(y >> 2) * w + (x >> 2)] += p && x >= p.x && x < p.x + S && y >= p.y && y < p.y + S ? 255 : Math.floor(r() * 256);
    for (let k = 0; k < w * h; k++) { rgba[4 * k] = rgba[4 * k + 1] = rgba[4 * k + 2] = sum[k] / 16; rgba[4 * k + 3] = 255; }
    out.push(M.grey(rgba, w, h));
  }
  return out;
}
// Every frame's box is the tapped box moved as the square moved, to within 2 px, with the same side and a good score.
function followed(got, want, side) {
  assert.equal(got.length, want.length);
  got.forEach((b, i) => {
    assert.ok(Math.abs(b.x - want[i].x) <= 2 && Math.abs(b.y - want[i].y) <= 2, `frame ${i}: box at ${b.x},${b.y}, square's at ${want[i].x},${want[i].y}`);
    assert.ok(Number.isInteger(b.x) && Number.isInteger(b.y), `frame ${i}: box at ${b.x},${b.y} is not whole pixels`);
    assert.equal(b.side, side, `frame ${i}: side`);
    assert.ok(b.score >= 0.8, `frame ${i}: score ${b.score}`);
    assert.equal(b.lost, false, `frame ${i}: lost`);
  });
}

// A bare page: no document and none of the page's state, only console and window. coachUrl sets window.__chatUrl.
function runBare(coachUrl) {
  const logged = [], note = (...a) => logged.push(a);
  const page = { console: { error: note, warn: note, log: note, info: note } }; page.window = page; page.self = page; page.globalThis = page;
  if (coachUrl !== undefined) page.__chatUrl = coachUrl;
  const ctx = vm.createContext(page), before = Object.getOwnPropertyNames(ctx);
  vm.runInContext(fs.readFileSync(FILE, "utf8"), ctx, { filename: "coach.js" });
  return { ctx, logged, added: Object.getOwnPropertyNames(ctx).filter(k => !before.includes(k)).sort() };
}

test("coach.js runs on a page with no coach markup, logs nothing and adds only window.COACH, whose hooks do nothing there", () => {
  const { ctx, logged, added } = runBare();
  assert.deepEqual(added, ["COACH"]);
  assert.deepEqual(Object.keys(ctx.COACH).sort(), ["dev", "open", "relang", "spot"]);
  for (const k of ["dev", "relang", "spot", "open"]) assert.equal(ctx.COACH[k]("donghe"), undefined);
  assert.deepEqual(logged, []);
});

test("coach.js with the backend address empty adds nothing at all", () => {
  const { logged, added } = runBare("");
  assert.deepEqual(added, []);
  assert.deepEqual(logged, []);
});

test("COACHM has exactly the maths the page uses", () => {
  assert.deepEqual(Object.keys(M).sort(), ["clampBox", "fmtTime", "grey", "keyTimes", "nextQuality", "resize", "startBox", "track"]);
});

test("keyTimes: 12 key frames every 0.25 s from 1.5 s before Here to 1.25 s after", () => {
  assert.deepEqual(M.keyTimes(5, 20), [3.5, 3.75, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.25]);
});

test("keyTimes: moved to start at 0 near the clip's start", () => {
  assert.deepEqual(M.keyTimes(0.4, 20), [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75]);
  assert.deepEqual(M.keyTimes(0, 20), M.keyTimes(0.4, 20));
  assert.equal(M.keyTimes(1.5, 20)[0], 0);
});

test("keyTimes: moved to end 0.05 s before the clip's end", () => {
  assert.deepEqual(M.keyTimes(12, 13.023), [10.223, 10.473, 10.723, 10.973, 11.223, 11.473, 11.723, 11.973, 12.223, 12.473, 12.723, 12.973]);
  assert.deepEqual(M.keyTimes(30, 20), [17.2, 17.45, 17.7, 17.95, 18.2, 18.45, 18.7, 18.95, 19.2, 19.45, 19.7, 19.95]);
});

test("keyTimes: always 12 distinct times 0.25 s apart, inside the clip", () => {
  for (const [here, dur] of [[5, 20], [0.4, 20], [12, 13.023], [0, 3], [3, 3], [1.6, 3], [7.3333, 9.1], [119.99, 120], [60.123, 120]]) {
    const t = M.keyTimes(here, dur);
    assert.equal(t.length, 12, `${here}, ${dur}`);
    assert.equal(new Set(t).size, 12, `${here}, ${dur}: not distinct`);
    assert.ok(t[0] >= 0 && t[11] <= dur - 0.05 + 1e-9, `${here}, ${dur}: ${t[0]} … ${t[11]}`);
    t.forEach((s, i) => i && near(s - t[i - 1], 0.25, 1e-6));
    // Unmoved when there's room, to the ms: Here is the 7th key frame.
    if (here >= 1.5 && here + 1.25 <= dur - 0.05) t.forEach((s, i) => near(s, here + STEPS[i], 5e-4));
    assert.ok(t.every(s => Number.isInteger(Math.round(s * 1e6) / 1e3)), `${here}, ${dur}: not whole ms`);
  }
});

test("startBox: a third of the short side, centred on the tap", () => {
  assert.deepEqual(M.startBox(540, 960, 1080, 1920), {x: 360, y: 780, side: 360});
  assert.deepEqual(M.startBox(320, 180, 640, 360), {x: 260, y: 120, side: 120});
  assert.deepEqual(M.startBox(100.6, 50.2, 640, 360), {x: 41, y: 0, side: 120});
});

test("startBox: kept inside the frame near its edges", () => {
  assert.deepEqual(M.startBox(10, 10, 1080, 1920), {x: 0, y: 0, side: 360});
  assert.deepEqual(M.startBox(1075, 1915, 1080, 1920), {x: 720, y: 1560, side: 360});
  assert.deepEqual(M.startBox(-30, 400, 640, 360), {x: 0, y: 240, side: 120});
});

test("resize: x 1.2 bigger or smaller, about the same centre", () => {
  const b = M.startBox(540, 960, 1080, 1920);
  assert.deepEqual(M.resize(b, 1, 1080, 1920), {x: 324, y: 744, side: 432});
  assert.deepEqual(M.resize(b, -1, 1080, 1920), {x: 390, y: 810, side: 300});
  assert.deepEqual(b, {x: 360, y: 780, side: 360}, "the box passed in is left alone");
});

test("resize: stops at the short side and at an eighth of it", () => {
  let b = M.startBox(540, 960, 1080, 1920), sides = [];
  for (let i = 0; i < 20; i++) { b = M.resize(b, 1, 1080, 1920); sides.push(b.side); }
  assert.equal(b.side, 1080);
  assert.ok(sides.every(s => s <= 1080 && Number.isInteger(s)));
  assert.ok(b.x === 0 && b.y >= 0 && b.y + b.side <= 1920, `box at ${b.x},${b.y}`);
  assert.deepEqual(M.resize(b, 1, 1080, 1920), b);
  for (let i = 0; i < 40; i++) b = M.resize(b, -1, 1080, 1920);
  assert.equal(b.side, 135);
  assert.deepEqual(M.resize(b, -1, 1080, 1920), b);
  // An eighth that isn't whole: 766 / 8 is 95.75, so the smallest whole side is 96.
  b = M.startBox(683, 383, 1366, 766);
  for (let i = 0; i < 40; i++) b = M.resize(b, -1, 1366, 766);
  assert.equal(b.side, 96);
});

test("resize: a box grown at the edge stays inside", () => {
  let b = M.startBox(1075, 1915, 1080, 1920);
  b = M.resize(b, 1, 1080, 1920);
  assert.deepEqual(b, {x: 648, y: 1488, side: 432});
});

test("clampBox: moves a box that's outside back in, side kept", () => {
  assert.deepEqual(M.clampBox({x: -50, y: 2000, side: 360}, 1080, 1920), {x: 0, y: 1560, side: 360});
  assert.deepEqual(M.clampBox({x: 900, y: -1, side: 360}, 1080, 1920), {x: 720, y: 0, side: 360});
  assert.deepEqual(M.clampBox({x: 100, y: 200, side: 360}, 1080, 1920), {x: 100, y: 200, side: 360});
  assert.deepEqual(M.clampBox({x: 700, y: 300, side: 120}, 640, 360), {x: 520, y: 240, side: 120});
});

test("nextQuality: 0.1 lower while over 100 KB, down to 0.25", () => {
  assert.equal(M.nextQuality(), 0.85, "the first try");
  assert.equal(M.nextQuality(0.85, 150_000), 0.75);
  assert.equal(M.nextQuality(0.25, 150_000), null);
  assert.equal(M.nextQuality(0.85, 90_000), null);
  assert.equal(M.nextQuality(0.85, 102_400), null);
  assert.equal(M.nextQuality(0.85, 102_401), 0.75);
  const tries = [];
  for (let q = M.nextQuality(); q != null; q = M.nextQuality(q, 500_000)) tries.push(q);
  assert.deepEqual(tries, [0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25]);
});

test("grey: luminance of each pixel, no resizing", () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 128, 128, 128, 255]);
  const g = M.grey(rgba, 3, 2);
  assert.equal(g.w, 3); assert.equal(g.h, 2);
  assert.ok(g.px instanceof Float32Array);
  assert.equal(g.px.length, 6);
  [255, 0, 76.245, 149.685, 29.07, 128].forEach((v, i) => near(g.px[i], v, 1e-3));
});

test("track: follows the surfer frame by frame from the tapped one, each way", () => {
  const W = 640, H = 360, S = 60, at = i => ({x: 41 + 24 * i, y: 151});
  const greys = clip({W, H, S, at, seed: 7});
  for (const from of [5, 0, 11]) {
    const p = at(from), box = M.startBox(p.x + S / 2, p.y + S / 2, W, H), got = M.track(greys, from, box);
    assert.deepEqual(got[from], {...box, score: 1, lost: false}, "the tapped frame keeps the tap's box");
    followed(got, greys.map((g, i) => ({x: box.x + 24 * (i - from), y: box.y})), box.side);
  }
});

test("track: a portrait phone clip, the surfer moving down", () => {
  const W = 1080, H = 1920, S = 180, at = i => ({x: 451, y: 601 + 24 * i});
  const greys = clip({W, H, S, at, seed: 11}), from = 3, p = at(from), box = M.startBox(p.x + S / 2, p.y + S / 2, W, H);
  assert.equal(box.side, 360);
  const t0 = performance.now(), got = M.track(greys, from, box), ms = performance.now() - t0;
  followed(got, greys.map((g, i) => ({x: box.x, y: box.y + 24 * (i - from)})), 360);
  // Quick enough for a phone: a full search of every place in the window takes seconds.
  assert.ok(ms < 1000, `track took ${ms.toFixed(0)} ms`);
});

test("track: marks the frames where the surfer is gone lost, keeping the last place", () => {
  const W = 640, H = 360, S = 60, from = 5, pos = i => ({x: 41 + 24 * i, y: 151}), at = i => i === 0 || i >= 10 ? null : pos(i);
  const greys = clip({W, H, S, at, seed: 3}), p = pos(from), box = M.startBox(p.x + S / 2, p.y + S / 2, W, H);
  const got = M.track(greys, from, box), want = greys.map((g, i) => ({x: box.x + 24 * (i - from), y: box.y}));
  followed(got.slice(1, 10), want.slice(1, 10), box.side);
  for (const [i, last] of [[0, 1], [10, 9], [11, 9]]) {
    assert.equal(got[i].lost, true, `frame ${i} is lost`);
    assert.ok(got[i].score < 0.5, `frame ${i}: score ${got[i].score}`);
    assert.deepEqual({x: got[i].x, y: got[i].y, side: got[i].side}, {x: got[last].x, y: got[last].y, side: got[last].side}, `frame ${i} keeps frame ${last}'s place`);
  }
});

test("track: a surfer running out of the frame leaves every box inside it", () => {
  // The tap's box starts against the top edge; the square leaves the right edge after frame 9.
  const W = 640, H = 360, S = 60, at = i => ({x: 400 + 24 * i, y: 20 + 12 * i});
  const greys = clip({W, H, S, at, seed: 5}), p = at(0), box = M.startBox(p.x + S / 2, p.y + S / 2, W, H);
  assert.deepEqual(box, {x: 370, y: 0, side: 120});
  const got = M.track(greys, 0, box);
  assert.equal(got.length, 12);
  got.forEach((b, i) => assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.side <= W && b.y + b.side <= H && b.side === 120, `frame ${i}: ${JSON.stringify(b)}`));
  followed(got.slice(0, 7), got.slice(0, 7).map((b, i) => ({x: 370 + 24 * i, y: 12 * i})), 120);
  assert.ok(got[10].lost && got[11].lost, "gone from the frame");
});

test("fmtTime: m:ss.s, rounded through hundredths as the coach's labels are", () => {
  assert.equal(M.fmtTime(7_500), "0:07.5");
  assert.equal(M.fmtTime(11_973), "0:12.0");
  assert.equal(M.fmtTime(10_247), "0:10.3");
  assert.equal(M.fmtTime(0), "0:00.0");
  assert.equal(M.fmtTime(65_000), "1:05.0");
  assert.equal(M.fmtTime(59_960), "1:00.0");
  assert.equal(M.fmtTime(119_950), "2:00.0");
  assert.equal(M.fmtTime(83_240), "1:23.2");
});
