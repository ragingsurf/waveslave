// Loads web/dreamwave/*.js parts into a fake window for node:test, the way the page runs them (classic scripts that add to window.DW).
// load(["shell", "flow"]) → DW. With three: true, three.js r149 from web/vendor/ is loaded too and handed to the parts as THREE, with a
// document stub whose canvases have a no-op 2D context (the surfer draws its board deck and logo on canvases).
const fs = require("fs"), path = require("path");
const WEB = path.join(__dirname, "..", "..", "web");
function stubDocument() {
  const ctx = new Proxy({}, { get: (t, k) => k in t ? t[k] : (k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => (t[k] = v, true) });
  return { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }), createElementNS: () => ({ style: {} }) };
}
let THREE = null;
function three() {
  if (THREE) return THREE;
  const w = { document: stubDocument() }, src = fs.readFileSync(path.join(WEB, "vendor", "three.min.js"), "utf8");
  new Function("self", "globalThis", "window", "document", "exports", "module", "define", src)(w, w, w, w.document, undefined, undefined, undefined);
  global.document = global.document || w.document; THREE = w.THREE; return THREE;
}
// With strings: true, web/dreamwave.js runs first on a stub page (no tab in it, so it stops after the strings), giving the real DW.t.
function load(parts, opts = {}) {
  const window = { DW: { t: k => k, lang: "en" } }, T = opts.three ? three() : undefined;
  if (opts.strings) { delete window.DW.t; const doc = { currentScript: null, createElement: () => ({ style: {} }), head: { appendChild() {} }, getElementById: () => null, querySelector: () => null };
    new Function("window", "document", "location", fs.readFileSync(path.join(WEB, "dreamwave.js"), "utf8"))(window, doc, { hash: "" }); }
  for (const p of parts) new Function("window", "THREE", "document", fs.readFileSync(path.join(WEB, "dreamwave", p + ".js"), "utf8"))(window, T, opts.three ? global.document : undefined);
  return window.DW;
}
module.exports = { load, three };
