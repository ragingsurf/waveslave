// The cartoon surfer (web/dreamwave/surfer.js): every option builds, regular stance mirrors goofy, and the flame W sits only on suits.
// three.js r149 from web/vendor/ runs in Node, with a stub document whose canvases draw nothing.
// Run: node --test tests/dreamwave/surfer.test.js
const test = require("node:test"), assert = require("node:assert");
const { load, three } = require("./load.js");
const THREE = three(), DW = load(["shell", "flow", "surfer"], { three: true }), { OPTIONS, DEFAULT, make } = DW.surfer;

const meshes = g => { let n = 0; g.traverse(o => { if (o.isMesh) n++; }); return n; };
const finite = g => { let ok = true; g.updateMatrixWorld(true); g.traverse(o => { const p = o.geometry && o.geometry.attributes.position; if (p) for (const v of p.array) if (!Number.isFinite(v)) ok = false; }); return ok; };
const named = (g, n) => g.getObjectByName(n);

test("every option builds", () => {
  for (const k of Object.keys(OPTIONS)) for (const v of OPTIONS[k]) {
    const g = make({ ...DEFAULT, [k]: v });
    assert.ok(meshes(g) > 20, `${k}=${v}: ${meshes(g)} meshes`); assert.ok(finite(g), `${k}=${v} has NaN`);
  }
});
test("the default is the lineup's spiky surfer, regular", () => {
  assert.deepEqual(DEFAULT, { skin: "#c98d5f", build: "broad", hair: "spiky", hairColor: "#2b1a10", outfit: "full", suit: "#17171c", accent: "#ff4a12",
    board: "short", boardColor: "#f6f3ea", graphic: "flames", stance: "regular", pose: "crouch", face: "grin", extra: "none" });
  for (const k in DEFAULT) assert.ok(OPTIONS[k].includes(DEFAULT[k]), k);
});
test("regular mirrors goofy", () => {
  const z = st => { const g = make({ ...DEFAULT, stance: st }); g.updateMatrixWorld(true); return named(g, "handFront").getWorldPosition(new THREE.Vector3()).z; };
  const a = z("regular"), b = z("goofy");
  assert.ok(Math.abs(a) > 0.05 && Math.abs(a + b) < 1e-6, `regular ${a}, goofy ${b}`);
  const g = make({ ...DEFAULT, stance: "regular" }); let neg = false; g.traverse(o => { if (o.scale.x < 0 || o.scale.y < 0 || o.scale.z < 0) neg = true; });
  assert.ok(!neg, "no negative scale");
});
test("named parts", () => { const g = make(DEFAULT); for (const n of ["head", "handFront", "board", "chestLogo"]) assert.ok(named(g, n), n); });
test("logo only on suits", () => {
  for (const o of OPTIONS.outfit) assert.equal(!!named(make({ ...DEFAULT, outfit: o }), "chestLogo"), ["full", "spring", "vest", "onepiece"].includes(o), o);
});

// ---- Riding the barrel: where the surfer sits on the face.
const { J, fresh, applyShape, fitLoop, STYLES, timeState } = DW.shell, { spotOnFace, clampSpot, place } = DW.surfer;
test("spotOnFace finds the height", () => {
  const sec = Array.from({ length: J.M }, () => [5, 5]);
  for (let j = J.face; j <= J.front; j++) { const s = (j - J.face) / (J.front - J.face); sec[j] = [2 * s, 2 - 2 * s]; }
  const a = spotOnFace(sec, J, 1); assert.ok(Math.abs(a.z - 1) < 1e-9 && Math.abs(a.slope - Math.PI / 4) < 1e-9, JSON.stringify(a));
  assert.equal(spotOnFace(sec, J, 3), null);
});
test("spotStaysOnFaceAtExtremes", () => {
  const waves = STYLES.map(s => [s.id, s.v]).concat([["extreme", { ...STYLES[0].v, height: 6, lipThrow: 6, faceSteepness: 115, faceHollowness: -1, length: 5, peelSpeed: 10 }]]).concat(
    // shapes the final review found where the surfer vanished: Slab and Reef barrel at Size 1, Long wall and Mushy with the heaviest lip
    [["slab", { height: 1 }], ["reef", { height: 1 }], ["longwall", { lipThickness: 0.8 }], ["mushy", { lipThickness: 0.8 }]].map(([id, o]) => [id + "+", { ...STYLES.find(s => s.id === id).v, ...o }]));
  for (const [id, v] of waves) { const S = fresh(); for (const k in v) applyShape(S, k, v[k]); fitLoop(S);
    for (let t = 0; t <= S.loopTime + 1e-9; t += 0.1) { const A = timeState(S, t);
      for (const u of [0.15, 0.35, 1, 1.6]) for (const h of [0.08, 0.2, 0.6]) for (const side of ["left", "right"]) {
        const p = place(S, A, { side, u, h });
        assert.ok(p, `${id} t=${t.toFixed(1)} u=${u} h=${h} ${side}: null`);
        for (const n of [p.x, p.y, p.z, p.dir[0], p.dir[1], p.tilt]) assert.ok(Number.isFinite(n), `${id} t=${t.toFixed(1)} u=${u} h=${h} ${side}: ${JSON.stringify(p)}`);
        assert.ok(side === "left" ? p.x < S.peakX && p.dir[0] < 0 : p.x > S.peakX && p.dir[0] > 0, `${id} ${side} goes the wrong way`);
        assert.ok(p.tilt >= 0 && p.tilt <= 0.55);
      } } }
});
test("clampSpot keeps the surfer in the barrel and wall", () => {
  assert.deepEqual(clampSpot({ side: "right", u: 9, h: -1 }), { side: "right", u: 1.6, h: 0.08 });
  assert.deepEqual(clampSpot({ side: "left", u: 0, h: 1 }), { side: "left", u: 0.15, h: 0.6 });
  assert.deepEqual(clampSpot({ side: "up", u: "far", h: NaN }), { side: "left", u: 0.35, h: 0.2 });
  assert.deepEqual(clampSpot(null), { side: "left", u: 0.35, h: 0.2 });
  assert.deepEqual(clampSpot({ side: "right", u: 0.5, h: 0.3 }), { side: "right", u: 0.5, h: 0.3 });
});
test("place rides with the curl", () => {
  const S = fresh(), at = t => place(S, timeState(S, t), { side: "left", u: 0.35, h: 0.2 }).x;
  assert.ok(at(7) < at(5) - 1, `x at 5 s ${at(5)}, at 7 s ${at(7)}`);
});

test("wire surfer has only lines", () => {
  const g = make(DEFAULT, "wire"); let mesh = 0, lines = 0;
  g.traverse(o => { if (o.isLineSegments) lines++; else if (o.isMesh) mesh++; });
  assert.equal(mesh, 0); assert.ok(lines > 20, `${lines} line parts`);
  assert.ok(named(g, "head") && named(g, "handFront") && named(g, "board"), "named parts kept");
  let additive = true; g.traverse(o => { if (o.isLineSegments && o.material.blending !== THREE.AdditiveBlending) additive = false; }); assert.ok(additive);
});
