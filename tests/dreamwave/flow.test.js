// Power, the sampled wave surface and the flow tracers (web/dreamwave/flow.js), as the Neon Wave artifact has them.
// Run: node --test tests/dreamwave/flow.test.js
const test = require("node:test"), assert = require("node:assert");
const { load } = require("./load.js");
const DW = load(["shell", "flow"]), { fresh, applyShape, fitLoop, STYLES, J } = DW.shell;
const styled = s => { const S = fresh(); for (const [k, v] of Object.entries(s.v)) applyShape(S, k, v); fitLoop(S); return S; };

test("frame has the artifact's size", () => {
  const F = DW.frame.create(fresh(), 0.25);
  assert.equal(F.NX, 2 * Math.round(34 / 0.25) + 1); assert.equal(F.M, J.M); assert.equal(F.pos.length, F.NX * F.M * 3);
  assert.equal(F.idx.length, (F.NX - 1) * (F.M - 1) * 6); assert.equal(F.MID, (F.NX - 1) / 2);
});
test("power stays within 0..1", () => {
  const S = fresh(), F = DW.frame.create(S, 0.25); DW.frame.build(F, S, 6);
  for (const v of F.pw) assert.ok(v >= 0 && v <= 1, String(v));
  assert.ok(Math.max(...F.pw) > 0.3);
});
test("build fills every position", () => {
  for (const s of STYLES) { const S = styled(s), F = DW.frame.create(S, 0.25);
    for (let t = 0; t <= S.loopTime; t += 0.5) { const A = DW.frame.build(F, S, t); assert.ok(A && A.phase, "returns the time state");
      for (let n = 0; n < F.pos.length; n++) assert.ok(Number.isFinite(F.pos[n]), `${s.id} t=${t} pos[${n}]`); } }
});
test("both sides mirror", () => {
  const S = fresh(), F = DW.frame.create(S, 0.25); DW.frame.build(F, S, 6);
  const i = F.MID + 20, mi = F.NX - 1 - i, o = (i * F.M + 150) * 3, m = (mi * F.M + 150) * 3;
  assert.ok(Math.abs(F.pos[o] - S.peakX + (F.pos[m] - S.peakX)) < 1e-6); assert.equal(F.pos[o + 1], F.pos[m + 1]);
});
test("tracers keep finite positions", () => {
  const S = styled(STYLES.find(s => s.id === "slab")), F = DW.frame.create(S, 0.25), sys = DW.flow.create(200, 14);
  F.nrm = new Float32Array(F.pos.length); for (let n = 1; n < F.nrm.length; n += 3) F.nrm[n] = 1;
  let t = 4; DW.frame.build(F, S, t); let alive = 0;
  for (let k = 0; k < 300; k++) { if (k % 2 === 0) { t += 2 / 60; DW.frame.build(F, S, t); } DW.flow.step(sys, F, 1 / 60);
    for (const T of sys.tr) for (const v of T.hist) assert.ok(Number.isFinite(v)); }
  for (const T of sys.tr) if (T.alive) alive++;
  assert.ok(alive > 0, "some tracers alive");
});
