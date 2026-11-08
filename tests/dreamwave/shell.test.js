// The wave model (web/dreamwave/shell.js): the Neon Wave artifact's WaveShell, its sliders and its six styles.
// Run: node --test tests/dreamwave/shell.test.js
const test = require("node:test"), assert = require("node:assert");
const { load } = require("./load.js");
const { timeState, stage, section, J, SLIDERS, STYLES, fresh, applyShape, fitLoop, styleOf } = load(["shell"]).shell;

const crest = sec => Math.max(...sec.slice(J.back, J.front).map(p => p[1]));
const styled = s => { const S = fresh(); for (const [k, v] of Object.entries(s.v)) applyShape(S, k, v); fitLoop(S); return S; };
test("crest has no bump ahead of the break", () => {   // the pinned model's largest rise is 0.00095 m (Closeout)
  for (const s of STYLES) { const S = styled(s);
    for (let t = 5; t <= S.loopTime - 1.2; t += 0.5) { const A = timeState(S, t); let prev = Infinity;
      for (let ax = Math.max(0, A.d); ax <= 34; ax += 0.2) {
        const c = crest(section(S, stage(S, S.peakX - ax, A), A.g));
        assert.ok(c <= prev + 0.002, `${s.id} t=${t} ax=${ax.toFixed(1)}`); prev = c; } } }
});
test("styles stay inside the slider ranges", () => { for (const s of STYLES) for (const c of SLIDERS) assert.ok(s.v[c.k] >= c.min && s.v[c.k] <= c.max, `${s.id}.${c.k}`); });
test("six styles in order, eleven sliders", () => {
  assert.deepEqual(STYLES.map(s => s.id), ["aframe", "slab", "reef", "longwall", "mushy", "closeout"]);
  assert.deepEqual(SLIDERS.map(c => c.k), ["height", "lipThickness", "length", "bend", "shoulderTaper", "faceSteepness", "faceHollowness", "scoop", "troughAngle", "peelSpeed", "lipThrow"]);
});
test("fitLoop follows length and peel speed", () => {
  const S = fresh(); assert.ok(Math.abs(fitLoop(S) - 9.05) < 0.01);
  applyShape(S, "peelSpeed", 10); assert.ok(Math.abs(fitLoop(S) - 7.04) < 0.01);
  applyShape(S, "peelSpeed", 1); assert.equal(fitLoop(S), 16);
});
test("applyShape keeps the barrel and walls in proportion", () => {
  const S = fresh(); applyShape(S, "height", 5.2); assert.ok(Math.abs(S.tubeSize - 4.6) < 1e-9);
  applyShape(S, "length", 20); assert.ok(Math.abs(S.wallLength + S.shoulderLength - 20) < 1e-9);
});
test("styleOf names a style only when every slider matches", () => {
  assert.equal(styleOf(fresh()), "aframe");
  const S = styled(STYLES.find(s => s.id === "slab")); assert.equal(styleOf(S), "slab");
  applyShape(S, "height", 3.3); assert.equal(styleOf(S), null);
});
test("fresh() is a deep copy", () => { const a = fresh(); a.whitewater.amount = 9; a.height = 9; const b = fresh(); assert.equal(b.whitewater.amount, 0.7); assert.equal(b.height, 2.6); assert.equal(b.length, 13.4); });
