// The map maths block (MAPM) in template.html, loaded on its own: it is plain functions with no page state.
// Run: node --test tests/map/mapmath.test.js
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");

function load() {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "template.html"), "utf8");
  const a = src.indexOf("// ---- Map maths"), b = src.indexOf("// ---- end map maths");
  assert.ok(a >= 0 && b > a, "template.html has no Map maths block (// ---- Map maths ... // ---- end map maths)");
  return new Function(src.slice(a, b) + "\nreturn MAPM;")();
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
