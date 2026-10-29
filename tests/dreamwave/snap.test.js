// The share picture's caption and layout (web/dreamwave/snap.js). Run: node --test tests/dreamwave/snap.test.js
const test = require("node:test"), assert = require("node:assert");
const { load } = require("./load.js");
const DW = load(["shell", "snap"], { strings: true }), { fresh, applyShape, fitLoop, STYLES } = DW.shell, { caption, LAYOUT } = DW.snap;
const styled = id => { const S = fresh(); for (const [k, v] of Object.entries(STYLES.find(s => s.id === id).v)) applyShape(S, k, v); fitLoop(S); return S; };

test("caption names the style", () => assert.equal(caption(styled("slab"), "en"), "My dream wave: 3.0 m Slab"));
test("caption says Custom", () => { const S = fresh(); applyShape(S, "height", 3.2); assert.equal(caption(S, "en"), "My dream wave: 3.2 m Custom"); });
test("caption in 中文", () => assert.equal(caption(fresh(), "zh"), "我的夢幻浪：2.6 公尺 A字浪"));
test("layout stays in the safe area", () => {
  assert.equal(LAYOUT.w, 1080); assert.equal(LAYOUT.h, 1920);
  const ys = [];
  (function walk(o) { for (const k in o) { const v = o[k]; if (v && typeof v === "object") walk(v); else if (/^y\d?$/.test(k)) ys.push([k, v]); } })(LAYOUT);
  assert.ok(ys.length >= 6, JSON.stringify(ys));
  for (const [k, y] of ys) assert.ok(y >= 280 && y <= 1640, `${k} = ${y}`);
});
