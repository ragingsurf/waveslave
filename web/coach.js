// The AI surf coach on the page (docs/superpowers/specs/2026-10-22-ai-coach-design.md, "Front end: web/coach.js"). The surfer picks a
// clip, finds the move and taps themselves once; the phone cuts 12 close-up key frames and follows the surfer through them, and only those
// key frames are sent: the video never leaves the phone (Bryan, Oct 22).
// One classic script, loaded with defer before chat.js, with no dependencies. It reads the page's LANG, CUR, VIEW, WORLD and setView by
// bare name, as chat.js does, and gives the page only window.COACH = {dev, relang, spot, open}: template.html calls them from keepWorld()
// (developer mode came on or went off), setLang() (the language changed), boot() (a spot is shown) and the Coach tab. It brings its own
// <style> and its own English and 中文.
// - It never throws into the page: each way in is wrapped, and while the backend address is empty it does nothing at all, so the page
//   works exactly as it does without it. While the coach isn't on for this visitor it asks the backend nothing.
// - Everything from the network goes in through textContent or setAttribute, never as HTML, and no coach element carries data-zh or
//   data-ja (the page's applyLang() rewrites those as HTML); relang() writes the new language itself.
(function () { "use strict"; try {

// ---- Coach maths: plain functions with no page state, tested in Node (tests/coach/coachmath.test.js). A box is {x, y, side}: whole
// pixels, its top-left corner, in the video's displayed pixels (videoWidth x videoHeight as the browser reports them; never rotated).
const COACHM = (() => {
  // Where the 12 key frames fall, in seconds: every 0.25 s from 1.5 s before Here to 1.25 s after, the window moved to start at 0 or
  // later and end at least 0.05 s before the clip does. Worked in whole ms, the times sent with the frames, so they come out distinct and
  // exact: keyTimes(12, 13.023) is 10.223 … 12.973. A clip under 2.8 s (the panel takes 3 s and up) gets them packed closer.
  const keyTimes = (hereS, durS) => {
    const end = Math.floor(durS * 1000 - 50 + 1e-6), start = Math.max(0, Math.min(Math.round(hereS * 1000) - 1500, end - 2750));
    const step = start + 2750 <= end ? 250 : Math.max(1, Math.floor(end / 11));
    return Array.from({length: 12}, (_, i) => (start + i * step) / 1000);
  };
  // A box moved to lie inside a w x h frame, its side kept.
  const clampBox = (b, w, h) => { const side = Math.round(b.side);
    return {x: Math.max(0, Math.min(Math.round(b.x), w - side)), y: Math.max(0, Math.min(Math.round(b.y), h - side)), side}; };
  // The first box, round the surfer's tap: a third of the frame's short side (360 on a 1080 px frame, as in Bryan's clip test).
  const startBox = (tapX, tapY, w, h) => { const side = Math.round(Math.min(w, h) / 3);
    return clampBox({x: Math.round(tapX - side / 2), y: Math.round(tapY - side / 2), side}, w, h); };
  // + (dir > 0) or − (dir < 0): the side x 1.2 or / 1.2, kept between an eighth of the short side and all of it, about the same centre.
  const resize = (b, dir, w, h) => { const short = Math.min(w, h);
    const side = Math.max(Math.ceil(short / 8), Math.min(short, Math.round(dir > 0 ? b.side * 1.2 : b.side / 1.2)));
    return clampBox({x: Math.round(b.x + b.side / 2 - side / 2), y: Math.round(b.y + b.side / 2 - side / 2), side}, w, h); };
  // JPEG quality for a key frame's file: the first try (nextQuality()) is 0.85, then 0.1 lower each time the file is over 100 KB. null
  // once it fits, or after 0.25, the lowest tried.
  const nextQuality = (q, bytes) => q == null ? 0.85 : bytes <= 102_400 || q <= 0.25 ? null : Math.round((q - 0.1) * 100) / 100;
  // A grey frame for the tracker: the luminance (Rec. 601) of an RGBA buffer the page already drew at quarter size (getImageData's data),
  // w x h pixels, not resized here.
  const grey = (rgba, w, h) => { const n = w * h, px = new Float32Array(n);
    for (let i = 0, k = 0; i < n; i++, k += 4) px[i] = 0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2];
    return {w, h, px}; };

  // ---- Following the surfer: normalised cross-correlation on the grey frames, coarse to fine.
  // A grey frame at half size, each pixel the mean of the 2 x 2 under it.
  const half = g => { const w = g.w >> 1, h = g.h >> 1, W = g.w, s = g.px, px = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0, k = 2 * y * W; x < w; x++, k += 2) px[y * w + x] = (s[k] + s[k + 1] + s[k + W] + s[k + W + 1]) / 4;
    return {w, h, px}; };
  // Frame g's n x n patch at (x, y), less its mean (t), and its sum of squares (tt).
  const patch = (g, x, y, n) => { const t = new Float32Array(n * n); let m = 0, tt = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = g.px[(y + j) * g.w + x + i]; t[j * n + i] = v; m += v; }
    m /= n * n; for (let k = 0; k < n * n; k++) { t[k] -= m; tt += t[k] * t[k]; }
    return {t, tt}; };
  // How alike patch p (side n) and frame g's n x n window at (x, y) are: 1 the same up to brightness and contrast, 0 nothing alike. A flat
  // patch or window scores 0.
  const ncc = (g, x, y, p, n) => { const px = g.px, w = g.w, t = p.t; let s = 0, s1 = 0, s2 = 0;
    for (let j = 0, m = 0; j < n; j++) for (let i = 0, k = (y + j) * w + x; i < n; i++, k++, m++) { const v = px[k]; s += t[m] * v; s1 += v; s2 += v * v; }
    const vv = s2 - s1 * s1 / (n * n); return vv > 1e-3 * n * n && p.tt > 0 ? s / Math.sqrt(vv * p.tt) : 0; };
  // The best place for patch p in frame g at x0…x1, y0…y1, with its score.
  const best = (g, p, n, x0, x1, y0, y1) => { let b = {x: x0, y: y0, score: -2};
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const s = ncc(g, x, y, p, n); if (s > b.score) b = {x, y, score: s}; }
    return b; };

  // The surfer's box in each of the key frames, from the box tapped in frame `from`: greys are the key frames from grey(), at quarter size,
  // so the boxes (in displayed pixels) are divided by 4 here. From the tapped frame it goes frame by frame, forward and back: each frame
  // is searched within one box side each way of the last place for the last patch the surfer was found in. A score under 0.5 marks the
  // frame lost, and the box stays at the last place. Each box keeps the tapped side and stays inside 4 x the quarter frame; that can be up
  // to 2 px wider than the video (Math.round(videoWidth / 4) * 4), so the page clamps each box to the video too.
  const track = (greys, from, box) => {
    const g0 = greys[from], qs = Math.max(1, Math.min(g0.w, g0.h, Math.round(box.side / 4)));
    const qx = Math.max(0, Math.min(Math.round(box.x / 4), g0.w - qs)), qy = Math.max(0, Math.min(Math.round(box.y / 4), g0.h - qs));
    // Levels: each frame halved while the patch stays 12 px or more, so the whole window is searched on a small frame (a patch of 12 to
    // 23 px) and each finer level only looks 2 px round the place found above it. Quick enough for 12 frames on a phone.
    let L = 0; while (L < 4 && qs >> (L + 1) >= 12) L++;
    const usable = g => !!g && g.w === g0.w && g.h === g0.h && g.px && g.px.length >= g.w * g.h;
    const levels = greys.map(g => { if (!usable(g)) return null; const ls = [g]; for (let l = 1; l <= L; l++) ls.push(half(ls[l - 1])); return ls; });
    // Where the patch at (rx, ry) in frame a is in frame b. The 3 best places on the coarsest level (not next to each other) each go down
    // to full size, in case the best was a lookalike; the best there wins.
    const find = (a, rx, ry, b) => {
      const ps = [], win = [];
      for (let l = 0; l <= L; l++) { const n = qs >> l, r = Math.ceil(qs / (1 << l)), cx = rx >> l, cy = ry >> l;
        ps.push(patch(a[l], cx, cy, n));
        win.push([Math.max(0, cx - r), Math.min(b[l].w - n, cx + r), Math.max(0, cy - r), Math.min(b[l].h - n, cy + r)]); }
      const n = qs >> L, [x0, x1, y0, y1] = win[L], cw = x1 - x0 + 1, sc = new Float32Array(cw * (y1 - y0 + 1));
      for (let k = 0; k < sc.length; k++) sc[k] = ncc(b[L], x0 + k % cw, y0 + Math.floor(k / cw), ps[L], n);
      const order = Array.from(sc.keys()).sort((i, j) => sc[j] - sc[i]), tops = [];
      for (const k of order) { const x = x0 + k % cw, y = y0 + Math.floor(k / cw);
        if (tops.every(c => Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) > 2)) tops.push({x, y, score: sc[k]});
        if (tops.length === 3) break; }
      let out = null;
      for (let c of tops) {
        for (let l = L - 1; l >= 0; l--) { const [wx0, wx1, wy0, wy1] = win[l];
          c = best(b[l], ps[l], qs >> l, Math.max(wx0, 2 * c.x - 2), Math.min(wx1, 2 * c.x + 2), Math.max(wy0, 2 * c.y - 2), Math.min(wy1, 2 * c.y + 2)); }
        if (!out || c.score > out.score) out = c;
      }
      return out;
    };
    const out = greys.map(() => null);
    out[from] = {x: box.x, y: box.y, side: box.side, score: 1, lost: false};
    for (const dir of [1, -1]) {
      // The last frame the surfer was found in, and where in it (quarter pixels).
      let ref = from, rx = qx, ry = qy;
      for (let i = from + dir; i >= 0 && i < greys.length; i += dir) {
        const hit = levels[i] && levels[ref] ? find(levels[ref], rx, ry, levels[i]) : null, score = hit ? hit.score : 0, lost = score < 0.5;
        if (!lost) { ref = i; rx = hit.x; ry = hit.y; }
        const b = clampBox({x: box.x + 4 * (rx - qx), y: box.y + 4 * (ry - qy), side: box.side}, 4 * g0.w, 4 * g0.h);
        out[i] = {x: b.x, y: b.y, side: b.side, score, lost};
      }
    }
    return out;
  };

  // A time as surfers see it, m:ss.s: 7,500 ms is "0:07.5". Rounded to hundredths first, as the AI's m:ss.ss labels are (aiTime in
  // chat/src/coach-guide.js), then to tenths, so the page and the review agree: 10,247 ms is 0:10.25 to the AI and "0:10.3" here.
  const fmtTime = ms => { const t = Math.round(Math.round(Math.max(0, ms) / 10) / 10), s = t % 600;
    return Math.floor(t / 600) + ":" + String(Math.floor(s / 10)).padStart(2, "0") + "." + (s % 10); };

  return {keyTimes, startBox, resize, clampBox, nextQuality, grey, track, fmtTime};
})();
// ---- end coach maths

// ---- The page shell: the Coach tab, its full-screen panel and the page's hooks.
// Where the backend runs: the chat's Worker, which serves the coach too. Tests set window.__chatUrl in its place, and an empty one switches
// the coach off with the chat. Only a string counts, as in chat.js, so an element that happens to be called __chatUrl can't.
const BACKEND = typeof window.__chatUrl === "string" ? window.__chatUrl : "https://waveslave-chat.waveslave050.workers.dev";
if (!/^https?:\/\/./i.test(BACKEND)) return;
// Who sees it (Bryan, Oct 22): only developer mode (the page's World mode, behind the PIN on the W in the logo) until Bryan says "go live";
// then PUBLIC goes to true, with or after chat.js's own. Tests set window.__coachPublic to see the coach as everyone will. While neither
// holds, the tab stays hidden and the coach asks the backend nothing; keepWorld() calls COACH.dev() each time the mode changes.
const PUBLIC = window.__coachPublic === true;
const on = () => PUBLIC || (typeof WORLD === "boolean" && WORLD);

// Runs f and keeps any error inside the coach: the page carries on whatever happens here, and an async f's failure never reaches it as an
// unhandled rejection. Only the error's name is logged.
const oops = err => { try { console.error("coach:", err?.name ?? "error"); } catch (e) {} };
const guard = f => (...a) => { try { const r = f(...a); if (r && typeof r.then === "function") r.then(null, oops); return r; } catch (err) { oops(err); } };

// ---- Strings: every word the coach shows, in English and 中文 (Taiwan usage). Any other language gets the English.
const STR = {
  en: { tab: "Coach", title: "COACH", close: "Close" },
  zh: { tab: "教練", title: "教練", close: "關閉" },
};
const S = key => (typeof LANG === "string" && LANG === "zh" ? STR.zh : STR.en)[key];
// A new element: attributes go in with setAttribute, children as nodes or as text (append makes a text node of a string), never as HTML.
function el(tag, attrs, ...kids) { const e = document.createElement(tag);
  for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  for (const c of kids.flat(Infinity)) if (c != null) e.append(c);
  return e; }

// The panel covers the whole screen above everything, the full-screen map (z-index 100) and the CHAT button included, like the chat's room.
const CSS = `
html.coach-open,html.coach-open body{overflow:hidden}
.coachpanel{position:fixed;inset:0;z-index:110;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:15px/1.45 var(--body);overscroll-behavior:contain;outline:none;-webkit-text-size-adjust:100%}
.coachpanel[hidden],.coachpanel [hidden]{display:none!important}
.coachpanel button{font-family:var(--body);-webkit-tap-highlight-color:transparent}
.co-hd,.co-body{width:100%;max-width:760px;margin-inline:auto;box-sizing:border-box}
.co-hd{flex:none;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) 12px calc(16px + env(safe-area-inset-left));border-bottom:1px solid var(--line)}
.co-title{margin:0;flex:1;min-width:0;font:400 31px/1 VT323,var(--mono);letter-spacing:.07em;color:var(--led-amb);text-shadow:0 0 calc(10px*var(--led-glow)) rgba(255,170,40,.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.co-x{flex:none;width:36px;height:36px;padding:0;display:grid;place-items:center;border-radius:50%;border:1.5px solid var(--led-amb);background:none;color:var(--led-amb);font-size:16px;font-weight:700;line-height:1;cursor:pointer}
.co-body{flex:1;min-height:0;overflow-y:auto;padding:16px calc(16px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))}
`;

// What the shell keeps: whether it has started (the page is there, with its Coach tab), an open() asked for before that, the tab, the
// panel and its parts, whether it's open and what had the focus before.
const P = { started: false, early: false, open: false, opener: null, tab: null, el: null, title: null, x: null };
// Whether the coach shows for this visitor now: switched on (developer mode, or PUBLIC), on a Taiwan spot (html.tw, which boot() sets) and
// with the chat there (window.CHAT), whose LINE sign-in the coach uses.
const can = () => P.started && on() && document.documentElement.classList.contains("tw") && !!window.CHAT;

// The tab and the panel's words, in the page's language; the tab shows while the coach does, and the panel shuts when the coach goes.
function draw() {
  if (!P.started) return;
  const show = can();
  P.tab.hidden = !show; if (P.tab.textContent !== S("tab")) P.tab.textContent = S("tab");
  if (P.title.textContent !== S("title")) P.title.textContent = S("title"); P.x.setAttribute("aria-label", S("close"));
  if (!show) close();
}
// Opens the panel over the Forecast view: from the map, the page goes back to Forecast first, as it does for the chat's room. Asked
// before start-up (chat.js can finish a sign-in for the coach while the page is still loading), it opens once the shell has started.
function open() {
  if (!P.started) { P.early = true; return; }
  if (!can()) return;
  if (VIEW !== "fc") setView("fc", true);
  if (P.open) return;
  P.open = true; P.opener = document.activeElement; P.el.hidden = false; document.documentElement.classList.add("coach-open");
  P.el.focus({ preventScroll: true });
}
// ✕ or Escape, or the coach going away: the focus goes back where it was, else to the tab while it shows.
function close() {
  if (!P.open) return;
  P.open = false; P.el.hidden = true; document.documentElement.classList.remove("coach-open");
  const back = P.opener; P.opener = null;
  const to = [back, P.tab].find(e => e && e !== document.body && e.isConnected && e.getClientRects().length);
  if (to) to.focus({ preventScroll: true });
}

// ---- The page's hooks (template.html). The coach is for the whole of Taiwan, so a spot only matters for html.tw, which boot() sets
// just before it calls spot().
window.COACH = {
  dev: guard(() => draw()),
  relang: guard(() => draw()),
  spot: guard(() => draw()),
  open: guard(() => open()),
};

// ---- Start-up, once the page is parsed (DOMContentLoaded): by then chat.js, loaded after this, has run, so window.CHAT is there if
// the chat is. boot() ran before this script loaded, so the shell draws for the spot already up. Without the page's state or its Coach
// tab (another page, or a template from before the coach) it stays off.
function start() {
  if (P.started) return;
  const tab = document.querySelector('.tabs button[data-v="coach"]');
  if (!tab || !document.body || typeof LANG !== "string" || typeof CUR !== "string" || typeof VIEW !== "string" || typeof setView !== "function") return;
  P.tab = tab;
  P.title = el("h2", { class: "co-title", id: "coachTitle" });
  P.x = el("button", { type: "button", class: "co-x" }, "✕");
  P.x.addEventListener("click", guard(() => close()));
  P.el = el("div", { class: "coachpanel", role: "dialog", "aria-modal": "true", "aria-labelledby": "coachTitle", tabindex: "-1", hidden: "" },
    el("div", { class: "co-hd" }, P.title, P.x), el("div", { class: "co-body" }));
  document.head.append(el("style", null, CSS));
  document.body.append(P.el);
  // Escape shuts the panel and nothing else (not the map behind it); Tab stays inside it. The chat's room has Escape while it's open.
  addEventListener("keydown", guard(e => {
    if (!P.open || document.documentElement.classList.contains("chat-open")) return;
    if (e.key === "Escape" && !e.isComposing) { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const all = [...P.el.querySelectorAll("button, input, a[href], textarea, select")].filter(x => !x.disabled && x.getClientRects().length);
    if (!all.length) { e.preventDefault(); P.el.focus(); return; }
    const i = all.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); all[all.length - 1].focus(); } else if (!e.shiftKey && (i === -1 || i === all.length - 1)) { e.preventDefault(); all[0].focus(); }
  }), true);
  P.started = true;
  window.COACH.spot(CUR); window.COACH.dev();
  if (P.early) { P.early = false; open(); }
}
if (typeof document === "object" && document) {
  if (document.readyState === "complete") guard(start)();
  else { document.addEventListener("DOMContentLoaded", guard(start), { once: true }); addEventListener("load", guard(start), { once: true }); }
}

} catch (err) { try { console.error("coach: start-up failed", err?.name ?? "error"); } catch (e) {} } })();
