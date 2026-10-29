// The Dream Wave tab (docs/superpowers/specs/2026-10-29-dream-wave-design.md): people shape a 3D wave, ride it as a cartoon surfer styled
// like them, pick a scene and a camera, and share a story picture that points to waveslave.tw.
// One classic script, loaded with defer after the page's own scripts, like web/chat.js. It reads the page's LANG, WORLD and setView by bare
// name and gives the page window.DREAMWAVE = {dev, relang, show, hide}, which template.html calls from keepWorld() (developer mode came on
// or went off), setLang() (the language changed) and setView() (the tab opened or closed). It brings its own <style>.
// - Nothing 3D loads until the tab first opens: then three.js r149 (vendor/three.min.js) and the parts in dreamwave/, each a classic script
//   that adds one part to window.DW, load in order. build-site.sh gives this file a version in its address (?v=<checksum over it and its
//   parts>), and the parts are asked for with the same version, so a reload never pairs this loader with older parts.
// - It never throws into the page: each way in is wrapped. No element in the layer carries data-zh or data-ja (applyLang() rewrites
//   those); relang() redraws in the new language instead.
(() => { "use strict"; try {

// Who sees it: only developer mode (the W in the logo) until Bryan says "go live"; then PUBLIC goes to true (spec, "What Bryan decided").
const PUBLIC = false;
const on = () => PUBLIC || (typeof WORLD === "boolean" && WORLD);
const TEST = !!window.__dwTest;
// The parts, in the order they run (each may use the ones before it).
const PARTS = ["shell", "flow", "surfer", "view", "panel"];
const ME = document.currentScript && document.currentScript.src || "", VER = (ME.match(/[?&]v=(\w+)/) || [])[1] || "0";

// ---- Strings: every word the tab shows, in English and 中文 (Taiwan). The 中文 names are proposals Bryan checks after the build.
const L = (keys, en, zh, out) => keys.forEach((k, i) => { out.en[k] = en[i]; out.zh[k] = zh[i]; });
const STR = { en: {}, zh: {} };
const group = (g, ids, en, zh) => L(ids.map(id => g + "_" + id), en, zh, STR);
L(["tab", "styles", "shape", "surfer", "look", "camera", "snap", "share", "save", "reset", "close", "back", "play", "pause", "loading", "failed", "hold", "dragHint", "name", "caption", "custom"],
  ["Dream Wave", "Styles", "Shape", "Surfer", "Look", "Camera", "Snapshot", "Share", "Save", "Reset", "Close", "Back to Forecast", "Play", "Pause", "Loading…",
   "The Dream Wave can't start on this device.", "Press and hold the picture to save it", "Drag your surfer to your spot in the wave", "Your name or IG handle",
   "My dream wave: {h} m {style}", "Custom"],
  ["夢幻浪", "浪型", "形狀", "衝浪手", "場景", "鏡頭", "拍照", "分享", "儲存", "重設", "關閉", "回到預報", "播放", "暫停", "載入中…",
   "這台裝置無法開啟夢幻浪。", "長按圖片即可儲存", "拖曳衝浪手到浪上你想要的位置", "你的名字或 IG 帳號", "我的夢幻浪：{h} 公尺 {style}", "自訂"], STR);
group("style", ["aframe", "slab", "reef", "longwall", "mushy", "closeout"], ["A-frame", "Slab", "Reef barrel", "Long wall", "Mushy", "Closeout"], ["A字浪", "厚板浪", "礁岩管浪", "長牆浪", "軟浪", "關門浪"]);
group("scene", ["neon", "tropical", "eastcoast", "golden", "stormy"], ["Neon", "Tropical", "Taiwan east coast", "Golden hour", "Stormy"], ["霓虹", "熱帶", "台灣東海岸", "黃金時刻", "暴風雨"]);
group("cam", ["free", "nose", "head"], ["Free", "GoPro nose cam", "GoPro head cam"], ["自由視角", "GoPro 板頭", "GoPro 頭戴"]);
const SK = ["height", "lipThickness", "length", "bend", "shoulderTaper", "faceSteepness", "faceHollowness", "scoop", "troughAngle", "peelSpeed", "lipThrow"];
group("slider", SK, ["Size", "Lip thickness", "Length", "Bend (U from above)", "Wall slant", "Steepness", "Hollowness", "Scoop under barrel", "Trough (bottom curve)", "Peel speed", "Lip throw"],
  ["浪高", "浪唇厚度", "長度", "彎度（俯看 U 形）", "浪壁斜度", "陡度", "空心度", "管浪下方內凹", "浪底弧度", "崩浪速度", "浪唇拋距"]);
group("ends", SK, ["Small–Big", "Feathery–Heavy", "Short–Long", "Straight–Deep U", "Flat–Steep A", "Gentle–Overhang", "Fat bulge–Barrel", "None–Deep", "Long ramp–Short & tight", "Slow–Fast", "Close–Far out"],
  ["小–大", "輕薄–厚重", "短–長", "直–深 U", "平緩–陡峭 A 字", "平緩–倒懸", "肥厚鼓起–管浪", "無–深", "長斜坡–短而緊", "慢–快", "近–遠"]);
L(["unit_m", "unit_cm", "unit_side", "unit_ms", "unit_over"], ["m", "cm", "{n} m each side", "m/s", "overhang"], ["公尺", "公分", "每邊 {n} 公尺", "公尺/秒", "倒懸"], STR);
group("row", ["skin", "build", "hair", "hairColor", "outfit", "suit", "accent", "board", "boardColor", "graphic", "stance", "pose", "face", "extra"],
  ["Skin", "Build", "Hair", "Hair colour", "Outfit", "Main colour", "Accent", "Board", "Board colour", "Graphic", "Stance", "Pose", "Face", "Extras"],
  ["膚色", "體型", "髮型", "髮色", "服裝", "主色", "配色", "衝浪板", "板色", "圖案", "站姿", "姿勢", "表情", "配件"]);
group("build", ["slim", "broad"], ["Slim", "Broad"], ["纖瘦", "壯碩"]);
group("hair", ["spiky", "short", "long", "bun", "curly", "cap"], ["Spiky", "Short", "Long", "Bun", "Curly", "Cap"], ["刺蝟頭", "短髮", "長髮", "包包頭", "捲髮", "反戴帽"]);
group("outfit", ["full", "spring", "shorts", "vest", "bikini", "onepiece"], ["Full wetsuit", "Springsuit", "Boardshorts", "Rash vest", "Bikini", "One-piece"], ["全身防寒衣", "短袖防寒衣", "衝浪褲", "防曬衣", "比基尼", "連身泳裝"]);
group("board", ["short", "fish", "long", "soft"], ["Shortboard", "Fish", "Longboard", "Soft-top"], ["短板", "魚板", "長板", "軟板"]);
group("graphic", ["flames", "stripes", "checker", "solid"], ["Flames", "Stripes", "Checker", "Plain"], ["火焰", "條紋", "棋盤格", "素面"]);
group("stance", ["regular", "goofy"], ["Regular", "Goofy"], ["正腳", "反腳"]);
group("pose", ["crouch", "drag", "bottom", "tall", "claim", "shaka"], ["Tube crouch", "Hand drag", "Bottom turn", "Standing tall", "Horns up", "Shaka"], ["管浪蹲姿", "手拖浪壁", "底部轉向", "站直", "金屬手勢", "Shaka 手勢"]);
group("face", ["grin", "stoked", "focus", "scream"], ["Grin", "Stoked", "Focused", "Metal scream"], ["咧嘴笑", "超嗨", "專注", "金屬嘶吼"]);
group("extra", ["none", "shades", "headband", "helmet"], ["None", "Shades", "Headband", "Helmet"], ["無", "墨鏡", "頭帶", "頭盔"]);

const DW = window.DW = window.DW || {};
DW.STR = STR;
DW.lang = "en";
const relangNow = () => { DW.lang = typeof LANG === "string" && LANG === "zh" ? "zh" : "en"; };
relangNow();
// A label in the page's language (English for anything but 中文), falling back to English, then to the key; {h}, {style}, {n} filled in.
DW.t = (key, vars = {}, lang = DW.lang) => {
  const s = (STR[lang] && STR[lang][key]) ?? STR.en[key] ?? key;
  return String(s).replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m);
};

// ---- Look: the layer over the page, its message and the amber ✕. Panels in the site's dark colours in both themes.
const css = document.createElement("style");
css.textContent = `
.dwview{position:fixed;inset:0;z-index:100;background:#05010d;color:#e3f0f0;font:14px/1.3 "Public Sans",system-ui,sans-serif;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}
.dwview[hidden]{display:none}
.dwview .dw-stage{position:absolute;inset:0}
.dwview .dw-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.dwview .dw-msg{position:absolute;left:16px;right:16px;top:45%;text-align:center;font:400 24px/1.2 "VT323",monospace;color:#ffcf5c;text-shadow:0 0 6px rgba(255,140,0,.7)}
.dwview .dw-msg:empty{display:none}
.dwview .dw-time{position:absolute;z-index:3;left:calc(10px + env(safe-area-inset-left));right:calc(10px + env(safe-area-inset-right));bottom:calc(10px + env(safe-area-inset-bottom));
  display:flex;align-items:center;gap:8px;background:rgba(13,35,43,.92);border:1px solid #1d3a44;border-radius:12px;padding:4px 10px 4px 4px;max-width:560px;margin:0 auto}
.dwview .dw-bottom{position:absolute;z-index:3;left:calc(8px + env(safe-area-inset-left));right:calc(8px + env(safe-area-inset-right));bottom:calc(8px + env(safe-area-inset-bottom));
  display:flex;flex-direction:column;gap:6px;max-width:640px;margin:0 auto;pointer-events:none}
.dwview .dw-bottom>*{pointer-events:auto}
.dwview .dw-bottom .dw-time{position:static;width:auto;box-sizing:border-box}
.dwview .dw-sheet{max-height:min(55vh,55dvh);overflow:auto;overscroll-behavior:contain;touch-action:pan-y;background:#0d232b;border:1px solid #1d3a44;border-radius:14px;padding:10px 12px;box-sizing:border-box}
.dwview .dw-sheet[hidden],.dwview .dw-sheet>[hidden]{display:none}
.dwview .dw-bar{display:flex;gap:4px;background:#0d232b;border:1px solid #1d3a44;border-radius:14px;padding:4px}
.dwview .dw-tab{flex:1 1 0;min-width:0;min-height:44px;padding:0 2px;border:0;border-radius:10px;background:none;color:#8aa6ad;font:600 12px/1.1 "Public Sans",system-ui,sans-serif;cursor:pointer;touch-action:manipulation;overflow:hidden;text-overflow:ellipsis}
.dwview .dw-tab[aria-pressed="true"]{color:#ffb347;background:#07171d;text-shadow:0 0 6px rgba(255,140,0,.7)}
.dwview .dw-snapbtn{flex:1.5 1 0;color:#200300;font:400 18px/1 "Metal Mania",fantasy;background:linear-gradient(#fff7b0,#ffd400 28%,#ff8a00 55%,#ff3d00 78%,#b80000);box-shadow:0 0 10px rgba(255,60,0,.7)}
.dwview .dw-snapbtn[aria-pressed="true"]{color:#200300;background:linear-gradient(#fff7b0,#ffd400 28%,#ff8a00 55%,#ff3d00 78%,#b80000);outline:2px solid #ffcf5c}
.dwview .dw-chips{display:flex;flex-wrap:wrap;gap:6px}
.dwview .dw-chip{flex:1 1 auto;min-height:40px;padding:0 12px;border:1px solid #1d3a44;border-radius:99px;background:#07171d;color:#e3f0f0;font:600 13px/1 "Public Sans",system-ui,sans-serif;cursor:pointer;touch-action:manipulation}
.dwview .dw-chip[aria-pressed="true"]{border-color:#ffb347;color:#ffb347;box-shadow:0 0 8px rgba(255,140,0,.45)}
.dwview .dw-reset{flex:0 0 auto;color:#8aa6ad}
.dwview .dw-row{margin-top:8px}
.dwview .dw-row:first-child{margin-top:0}
.dwview .dw-lab{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px}
.dwview .dw-lab b{font:400 20px/1 "VT323",monospace;color:#ffcf5c;text-shadow:0 0 6px rgba(255,140,0,.7);white-space:nowrap}
.dwview .dw-row input{width:100%;height:28px;margin:0;accent-color:#ff8a00}
.dwview .dw-hint{margin:0 0 8px;color:#ffcf5c;font-size:13px}
.dwview .dw-mrow{margin-top:10px}
.dwview .dw-mname{font-size:12px;color:#8aa6ad;margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em}
.dwview .dw-maker .dw-chip{flex:0 1 auto;min-height:36px;font-size:12px}
.dwview .dw-swatches{display:flex;flex-wrap:wrap;gap:8px}
.dwview .dw-swatch{width:36px;height:36px;border-radius:50%;border:2px solid #1d3a44;cursor:pointer;touch-action:manipulation;padding:0}
.dwview .dw-swatch[aria-pressed="true"]{border-color:#ffb347;box-shadow:0 0 0 2px #07171d,0 0 10px rgba(255,140,0,.8)}
.dwview .dw-ends{display:flex;justify-content:space-between;font-size:11px;color:#8aa6ad}
.dwview .dw-play{width:40px;height:40px;border:0;border-radius:8px;background:transparent;color:#ffcf5c;font:600 16px/1 "Public Sans",system-ui,sans-serif;cursor:pointer;touch-action:manipulation}
.dwview .dw-scrub{flex:1;min-width:60px;height:32px;margin:0;accent-color:#ff8a00;background:transparent}
.dwview .dw-clock{font:400 20px/1 "VT323",monospace;color:#ffcf5c;text-shadow:0 0 6px rgba(255,140,0,.7);min-width:52px;text-align:right}
.dwview .dw-x{position:absolute;z-index:5;top:calc(10px + env(safe-area-inset-top));right:calc(10px + env(safe-area-inset-right));width:40px;height:40px;border-radius:10px;
  border:1px solid #ffb347;background:#0a0f12;color:#ffb347;font:600 20px/1 "Public Sans",system-ui,sans-serif;text-shadow:0 0 6px rgba(255,140,0,.8);box-shadow:0 0 8px rgba(255,140,0,.4);cursor:pointer;touch-action:manipulation}
`;
document.head.appendChild(css);

const layer = document.getElementById("viewDw");
const btn = document.querySelector('.tabs button[data-v="dw"]');
if (!layer || !btn) return;
const stage = document.createElement("div"); stage.className = "dw-stage";
const msg = document.createElement("div"); msg.className = "dw-msg"; msg.setAttribute("role", "status");
const x = document.createElement("button"); x.className = "dw-x"; x.type = "button"; x.textContent = "✕";
layer.append(stage, msg, x);
x.addEventListener("click", () => { try { setView("fc"); } catch (e) {} });
// Esc goes back to Forecast, but it is the chat room's own while that is open (as on the map).
document.addEventListener("keydown", e => { if (e.key === "Escape" && !layer.hidden && !document.documentElement.classList.contains("chat-open")) try { setView("fc"); } catch (err) {} });

// ---- Loading: three.js, then the parts, on the first open only.
let state = "idle", view = null, showing = false;   // idle → loading → ready | failed
const loaded = [];
const script = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.async = false;
  s.onload = () => { loaded.push(src); ok(); }; s.onerror = () => no(new Error("couldn't load " + src)); document.head.appendChild(s); });
const glOk = () => { try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"))); } catch (e) { return false; } };
function fail() { state = "failed"; msg.textContent = DW.t("failed"); }
function load() {
  state = "loading"; msg.textContent = DW.t("loading");
  if (!glOk()) return fail();
  // three.js first: the parts build three.js things as they load, so none runs without it.
  script("vendor/three.min.js?v=149").then(() => Promise.all(PARTS.map(p => script(`dreamwave/${p}.js?v=${VER}`))))
    .then(() => { try { start(); } catch (e) { if (TEST) console.error(e); fail(); } }, fail);
}
// The parts are in: build what exists so far.
function start() {
  if (!window.THREE || !DW.shell) return fail();
  view = DW.view.create(layer, DW.shell.fresh());
  DW.panel.mount(layer, view);
  msg.textContent = ""; state = "ready";
  if (showing) resume();
}
function pause() { view && view.pause(); }
function resume() { view && view.resume(); }

// ---- The page's hooks.
// The page locks behind the layer: no scroll and no zoom (as the map's full screen does), without asking for real full screen.
function lock(on) {
  document.documentElement.style.overflow = on ? "hidden" : "";
  const m = document.querySelector('meta[name="viewport"]');
  if (m) m.content = "width=device-width, initial-scale=1" + (on ? ", maximum-scale=1" : "");
}
function dev() {
  btn.hidden = !on();
  if (btn.hidden && showing) setView("fc");
}
function show() {
  showing = true; layer.hidden = false; lock(true);
  if (state === "idle") load(); else if (state === "ready") resume();
}
function hide() {
  if (!showing) return; showing = false; layer.hidden = true; lock(false);
  if (state === "ready") pause();
}
function relang() { relangNow(); x.setAttribute("aria-label", DW.t("back")); x.title = DW.t("back"); if (view) { view.relang(); DW.panel.relang(); } if (state === "loading") msg.textContent = DW.t("loading"); else if (state === "failed") msg.textContent = DW.t("failed"); }
const guard = f => (...a) => { try { return f(...a); } catch (e) { if (TEST) console.error(e); } };
window.DREAMWAVE = { dev: guard(dev), relang: guard(relang), show: guard(show), hide: guard(hide) };
if (TEST) Object.defineProperties(window.DREAMWAVE, { _loaded: { get: () => loaded.slice() }, _frames: { value: () => view && view.frames || 0 }, _view: { get: () => view } });
x.setAttribute("aria-label", DW.t("back")); x.title = DW.t("back");
dev();
// waveslave.tw/#dreamwave opens the tab when it is on.
if (location.hash === "#dreamwave" && on()) setView("dw");

} catch (e) { if (window.__dwTest) console.error(e); } })();
