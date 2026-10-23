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

// ---- Strings: every word the coach shows, in English and 中文 (Taiwan usage). Any other language gets the English. A month is its number
// less one (0 is January). Surfers read "key frames" (關鍵影格) and "frame by frame" (逐格), never a word for a still picture, and nothing
// says the coach watched their video; and no person is named: the one who checks drafts is "a person at WaveSlave", as in the chat's
// privacy note.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STR = {
  en: { tab: "Coach", title: "COACH", close: "Close", tabReady: "Coach: a review is ready",
    lead: "Your coach breaks your clip down frame by frame: what went well, one main fix and a drill.",
    signIn: "Sign in with LINE", example: "Example review · Top turn",
    wentWell: "What went well", mainFix: "The main fix", drill: "Your drill", happening: "What's happening: ", matters: "Why it matters: ",
    keyFrameAt: t => `Key frame at ${t}`,
    loading: "Loading…", failed: "Couldn't reach the coach.", retry: "Try again",
    left: (n, of, m) => `${n} of ${of} reviews left in ${MONTHS[m]}`,
    filmHead: "How to film",
    film: ["One wave, start to finish (about 10 to 30 seconds).", "Big in the frame.", "From the side.", "Phone sideways and steady.", "Good light.",
      "Normal speed: no slow motion or filters.", "Only film people who are happy to be filmed."],
    newReview: "New review",
    agreeHead: "Before your first review",
    agreeList: ["Your coach is an AI. A person checks its reviews at first.",
      "Only key frames are sent. Your video never leaves your phone.",
      "The key frames go to Anthropic (USA), the company that makes the AI. It doesn't train on them, and deletes them within 30 days, or keeps them for up to 2 years if its safety checks flag them. They also go to a person at WaveSlave while drafts are checked.",
      "WaveSlave deletes them 30 days after the review, though copies can stay in Cloudflare's backups for up to 30 more days.",
      "Other people may be in the background, but don't send a clip where someone else is close and clear unless they're happy with it.",
      "Surf within your limits. The coach's tips don't replace a lesson or a lifeguard."],
    adult: "I'm 18 or older, and the surfer in every clip I send is me.",
    agree: "I agree",
    adultOnly: "The coach is for surfers 18 and over, sending clips of themselves.",
    yours: "Your reviews",
    status: { reviewing: "Coach is reviewing", ready: "Ready", not_reviewed: "Not reviewed" },
    moves: { popup: "Pop-up", bottom_turn: "Bottom turn", top_turn: "Top turn", cutback: "Cutback", down_the_line: "Riding down the line", other: "Other" },
    date: (y, m, d) => `${d} ${MONTHS[m]}${y ? " " + y : ""}`,
    drafts: "Drafts" },
  zh: { tab: "教練", title: "教練", close: "關閉", tabReady: "教練：有講評可以看了",
    lead: "教練會逐格拆解你的影片：做得好的地方、一個主要修正，再加一個練習。",
    signIn: "使用LINE帳號登入", example: "教練講評範例 · 頂部轉向",
    wentWell: "做得好的地方", mainFix: "主要修正", drill: "你的練習", happening: "發生了什麼：", matters: "為什麼重要：",
    keyFrameAt: t => `${t} 的關鍵影格`,
    loading: "載入中…", failed: "連不上教練。", retry: "再試一次",
    left: (n, of, m) => `${m + 1}月還剩 ${n} 次講評（共 ${of} 次）`,
    filmHead: "拍攝建議",
    film: ["拍一道浪，從頭拍到尾（大約 10 到 30 秒）。", "衝浪的人在鏡頭裡要夠大。", "從側面拍。", "手機橫拿，拿穩。", "光線要充足。",
      "用一般速度拍，不要慢動作，也不要濾鏡。", "只拍願意被拍的人。"],
    newReview: "新增講評",
    agreeHead: "第一次講評之前",
    agreeList: ["教練是 AI，一開始會由真人檢查它的講評。",
      "只會傳送關鍵影格，你的影片不會離開你的手機。",
      "關鍵影格會送到開發這個 AI 的美國公司 Anthropic；Anthropic 不會用它們來訓練 AI，並在 30 天內刪除，若被它的安全檢查標記，最多保留 2 年。檢查草稿期間，WaveSlave 的一位工作人員也會看到它們。",
      "WaveSlave 會在講評後 30 天刪除它們，但 Cloudflare 的備份裡可能再保留最多 30 天。",
      "背景裡有其他人沒關係，但如果有別人離得近、拍得清楚，除非對方同意，否則不要傳送這段影片。",
      "在自己的能力範圍內衝浪。教練的建議不能取代衝浪課或救生員。"],
    adult: "我已滿 18 歲，而且我傳送的每段影片裡的衝浪者都是我本人。",
    agree: "我同意",
    adultOnly: "教練只提供給 18 歲以上、傳送自己影片的衝浪者使用。",
    yours: "你的講評",
    status: { reviewing: "教練講評中", ready: "已完成", not_reviewed: "未能講評" },
    moves: { popup: "起乘", bottom_turn: "底部轉向", top_turn: "頂部轉向", cutback: "回切", down_the_line: "沿浪壁滑行", other: "其他" },
    date: (y, m, d) => `${y ? y + "年" : ""}${m + 1}月${d}日`,
    drafts: "草稿" },
};
const lang = () => typeof LANG === "string" && LANG === "zh" ? "zh" : "en";
const S = key => STR[lang()][key];
// localStorage can be missing or throw (a private window, blocked storage), so each read and write is wrapped.
function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function save(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) {} }
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
.tabs button.co-dot::after{content:"";position:absolute;top:2px;right:4px;width:8px;height:8px;border-radius:50%;background:#ff3d7f;box-shadow:0 0 8px #ff3d7f}
.co-body h3,.co-body h4,.co-body p{margin:0}
.co-lead{margin-bottom:14px!important;font-size:16px}
.co-wait{color:var(--muted)}
.co-btn{display:block;width:100%;min-height:46px;margin:14px 0 0;padding:10px 16px;border:0;border-radius:10px;background:var(--led-amb);color:var(--panel);font-size:16px;font-weight:700;cursor:pointer}
.co-signin{display:flex;align-items:center;width:100%;height:46px;margin:0 0 18px;padding:0;border:0;border-radius:10px;background:#06C755;color:#fff;font-size:15px;font-weight:700;cursor:pointer}
.co-signin:hover{background:#05b34c}.co-signin:active{background:#048b3b}
.co-line-ico{flex:none;width:30px;height:30px;margin:0 8px 0 10px}
.co-line-sep{flex:none;align-self:stretch;width:1px;margin:8px 0;background:rgba(0,0,0,.12)}
.co-line-w{flex:1;padding:0 12px;text-align:center}
.co-example,.co-film,.co-agree{padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.co-example>h3{font-size:14px;font-weight:600;color:var(--muted)}
.co-part{margin-top:14px}
.co-part h4{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--led-amb)}
.co-part p{margin-top:6px}
.co-pt{font-size:16px;font-weight:700}
.co-kfs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:8px}
.co-kf{margin:0}
.co-kf img{display:block;width:100%;height:auto;aspect-ratio:1;border-radius:8px;background:var(--line)}
.co-kf figcaption{margin-top:3px;font-size:12px;line-height:1.3;color:var(--muted)}
.co-left{margin-bottom:12px!important;font-size:17px;font-weight:700}
.co-film summary{cursor:pointer;font-weight:700}
.co-film ul,.co-agree ul{margin:8px 0 0;padding-left:20px}
.co-film li,.co-agree li{margin:4px 0}
.co-agree{margin-top:14px}
.co-h{font-size:16px}
.co-tick{display:flex;gap:10px;align-items:flex-start;margin-top:12px;font-weight:600;cursor:pointer}
.co-tick input{flex:none;width:20px;height:20px;margin:1px 0 0}
.co-err{margin-top:10px!important;color:var(--bad);font-weight:600}
.co-yours{margin-top:22px!important}
.co-list{list-style:none;margin:8px 0 0;padding:0}
.co-list li{border-top:1px solid var(--line)}
.co-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;width:100%;padding:12px 2px;border:0;background:none;color:inherit;font:inherit;text-align:left}
button.co-row{cursor:pointer}
.co-mv{font-weight:700}
.co-date{color:var(--muted)}
.co-st{margin-left:auto;font-weight:600}
.co-st-ready{color:var(--good)}
.co-st-not_reviewed{color:var(--muted)}
.co-fresh{flex:none;width:8px;height:8px;border-radius:50%;background:#ff3d7f;box-shadow:0 0 8px #ff3d7f}
.co-drafts{margin-top:24px}
.co-drafts h3{outline:none}
`;

// What the shell keeps: whether it has started (the page is there, with its Coach tab), an open() asked for before that, the tab, the
// panel and its parts, whether it's open and what had the focus before.
const P = { started: false, early: false, open: false, opener: null, tab: null, el: null, title: null, x: null, body: null };
// Whether the coach shows for this visitor now: switched on (developer mode, or PUBLIC), on a Taiwan spot (html.tw, which boot() sets) and
// with the chat there (window.CHAT), whose LINE sign-in the coach uses.
const can = () => P.started && on() && document.documentElement.classList.contains("tw") && !!window.CHAT;

// The tab and the panel's words, in the page's language; the tab shows while the coach does, and the panel shuts when the coach goes.
// While it shows, the coach asks for what it doesn't know yet (sync), and a ?coach=drafts link waiting for it opens the panel.
function draw() {
  if (!P.started) return;
  const show = can();
  P.tab.hidden = !show; if (P.tab.textContent !== S("tab")) P.tab.textContent = S("tab");
  if (P.title.textContent !== S("title")) P.title.textContent = S("title"); P.x.setAttribute("aria-label", S("close"));
  if (!show) close();
  else { sync(); if (V.drafts && !P.open) open(); }
  drawDot(); render();
}
// Opens the panel over the Forecast view: from the map, the page goes back to Forecast first, as it does for the chat's room. Asked
// before start-up (chat.js can finish a sign-in for the coach while the page is still loading), it opens once the shell has started.
// The chat's room can be open over the panel (a sign-in for the coach that needs the surfer): the focus stays in the room then, and comes
// to the panel when it's asked again once the room has shut.
function open() {
  if (!P.started) { P.early = true; return; }
  if (!can()) return;
  if (VIEW !== "fc") setView("fc", true);
  if (!P.open) { P.open = true; P.opener = document.activeElement; P.el.hidden = false; document.documentElement.classList.add("coach-open"); }
  if (!document.documentElement.classList.contains("chat-open") && !P.el.contains(document.activeElement)) P.el.focus({ preventScroll: true });
  // What the panel shows: asked for once a sign-in has brought a new token, and again when the last answer is over a minute old.
  sync(); if (tokenNow() && ME.token === tokenNow() && !ME.asking && Date.now() - ME.at >= 60e3) ask();
  render();
}
// ✕ or Escape, or the coach going away: the focus goes back where it was, else to the tab while it shows.
function close() {
  if (!P.open) return;
  P.open = false; P.el.hidden = true; document.documentElement.classList.remove("coach-open");
  const back = P.opener; P.opener = null;
  const to = [back, P.tab].find(e => e && e !== document.body && e.isConnected && e.getClientRects().length);
  if (to) to.focus({ preventScroll: true });
}

// ---- The panel's content (AI coach spec, "The Coach tab"). Signed out: what the coach does, the example review and Sign in with LINE.
// Signed in: the reviews left this month, How to film, the coach agreement before the first review (then New review), their reviews, and
// for the admin, Drafts. The Coach tab shows a dot while a review is ready that this phone hasn't opened.
// The version of the coach agreement, as the backend has it (AGREE_VER in chat/src/coach-guide.js): a new one asks every surfer again.
const AGREE_VER = "c1";
// When the newest review this phone has opened was published (ms): a ready review published after it lights the tab's dot.
const SEEN = "waveslave-coach-seen";
const TW = 8 * 3600e3; // Taiwan is UTC+8 all year: the backend's months and days are Taiwan's
const STATUS = ["reviewing", "ready", "not_reviewed"]; // a review's status in the surfer's words, as GET /coach/me gives it

// The example the signed-out panel shows: Bryan's trial clip redone as a one-move review of his last turn, a top turn, which he OK'd with
// no changes (Bryan, Oct 23), in the reply's shape (chat/src/coach-guide.js). Its key frames are web/coach-example/1.jpg to 4.jpg: key
// frame 6 (what went well), then 7, 8 and 9 (the main fix), each with its time in the clip in ms.
const EXAMPLE_REVIEW = {
  en: {
    went_well: { frame: 6, title: "Low and ready going in",
      detail: "Going into the turn, both knees are bent and your head is up, looking ahead. The board is flat on the face under you. That's a good, balanced start." },
    main_fix: { frames: [7, 8, 9], title: "Stay over your front foot",
      what: "As you hit the top, your weight slides back onto the tail. Your front leg goes straight and you sit down over your back foot (key frame at 0:11.7). The board shoots out ahead of you and you fall off the back (key frames at 0:12.0 and 0:12.2).",
      why: "With your weight on the tail, the board runs away from under you and the turn ends in a fall. Keep your front knee bent and your chest over it, and the board stays under you and comes back down the wave with you." },
    drill: { title: "Front-knee turns on the sand",
      how: "Stand in your surf stance on the beach with your knees bent. Turn your head and shoulders as if you're at the top of the wave. As you turn, push your front knee forward, bring your chest over it and hold for three seconds. If you feel your weight in your back heel, reset and go again. Do 10 slow ones before you paddle out." },
    heads_up: { text: "", move: "" },
    progress: "",
  },
  zh: {
    went_well: { frame: 6, title: "壓低身體，準備好進轉向",
      detail: "進入轉向前，你兩個膝蓋都彎著，頭抬高、看著前方。板子平穩地貼在浪壁上，這個起步又穩又好。" },
    main_fix: { frames: [7, 8, 9], title: "重心留在前腳",
      what: "衝上浪頂時，你的重心往後滑到板尾。前腿打直，整個人坐到後腳上（0:11.7 的關鍵影格）。板子往前衝出去，你就往後摔下來（0:12.0 和 0:12.2 的關鍵影格）。",
      why: "重心在板尾，板子會從你腳下溜走，轉到一半就摔下來。前膝保持彎曲、胸口壓在前膝上方，板子就會留在你腳下，帶著你從浪頂滑回浪壁。" },
    drill: { title: "沙灘上練前膝轉向",
      how: "在沙灘上用衝浪站姿站好，膝蓋彎曲。轉頭、轉肩膀，想像自己正在浪頂。轉的同時把前膝往前推，胸口帶到前膝上方，停三秒。如果覺得重心跑到後腳跟，就重新站好再來一次。下水前慢慢做 10 次。" },
    heads_up: { text: "", move: "" },
    progress: "",
  },
};
const EXAMPLE_FRAMES = { 6: { src: "coach-example/1.jpg", ms: 11473 }, 7: { src: "coach-example/2.jpg", ms: 11723 }, 8: { src: "coach-example/3.jpg", ms: 11973 },
  9: { src: "coach-example/4.jpg", ms: 12223 } };

// The session token the chat keeps (CHAT.token), or null when signed out; and handing back a token the backend refused (401), which signs
// out quietly.
const tokenNow = () => { const t = window.CHAT && typeof window.CHAT.token === "function" ? window.CHAT.token() : null; return typeof t === "string" && t ? t : null; };
const refused = t => { if (window.CHAT && typeof window.CHAT.token === "function") window.CHAT.token(t); };
// One call to the backend with the session token, as a Bearer header and no cookies: GET, or POST with body as JSON. Resolves to {status,
// json}: status 0 when the network fails or after 15 s.
const BASE = BACKEND.replace(/\/+$/, "");
async function call(path, tok, body) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), 15e3) : 0;
  const headers = { Authorization: "Bearer " + tok }; if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const r = await fetch(BASE + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "omit",
      signal: ctl ? ctl.signal : undefined });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, json };
  } catch (e) { return { status: 0, json: null }; } finally { clearTimeout(timer); }
}

// What the panel knows of the surfer: GET /coach/me's answer (me) and the token it was asked with, when the last ask went, the number of
// the newest ask (an answer to an older one is dropped), the token being asked about, and whether the last ask failed.
const ME = { me: null, token: null, at: -Infinity, n: 0, asking: null, failed: false };
// What the surfer has done in the panel, kept when it's drawn again: How to film opened or shut by hand (null: as it comes), the 18+ tick,
// the agreement's lines, an I agree on its way, the control to give the focus to, and a ?coach=drafts link waiting to open at Drafts.
const V = { film: null, tick: false, adultErr: false, agreeErr: false, busy: false, focus: null, drafts: false };
// GET /coach/me's answer looks right: whole counts, a "YYYY-MM" month and a list of reviews.
const meOk = j => !!j && typeof j === "object" && Number.isInteger(j.left) && Number.isInteger(j.monthly) && typeof j.month === "string"
  && /^\d{4}-(0[1-9]|1[0-2])$/.test(j.month) && Array.isArray(j.reviews);

// GET /coach/me, while the coach shows for this visitor and they're signed in: what the panel shows and the tab's dot. It is asked once a
// page load for each token (sync), and again, at most once a minute, on coming back to the page or opening the panel. A refused token
// (401) goes back to the chat, and the panel shows Sign in with LINE.
async function ask() {
  const t = tokenNow();
  if (!can() || !t) return;
  const n = ++ME.n; ME.at = Date.now(); ME.asking = t;
  const r = await call("/coach/me", t);
  if (n !== ME.n) return;
  ME.asking = null;
  if (r.status === 401) { refused(t); ME.me = null; ME.token = null; ME.failed = false; }
  else if (r.status === 200 && meOk(r.json)) { ME.me = r.json; ME.token = t; ME.failed = false; }
  else { ME.failed = true; if (ME.token !== t) { ME.me = null; ME.token = t; } }
  drawDot(); render();
}
// Asks when the token kept isn't the one the panel last asked with: at start-up, when developer mode comes on, and after a sign-in.
// Signed out, the panel forgets what it knew, and an answer still on its way is dropped.
function sync() {
  const t = tokenNow();
  if (!t) { if (ME.token || ME.asking) { ME.n++; ME.me = null; ME.token = null; ME.asking = null; ME.failed = false; } return; }
  if (can() && t !== ME.token && t !== ME.asking) ask();
}

// The tab's dot: a ready review published after the newest one this phone has opened.
const seen = () => { const v = Number(load(SEEN)); return Number.isFinite(v) ? v : 0; };
const isNew = r => !!r && r.status === "ready" && Number.isFinite(r.published) && r.published > seen();
function drawDot() {
  if (!P.started) return;
  const t = tokenNow(), dot = can() && !!t && t === ME.token && !!ME.me && ME.me.reviews.some(isNew);
  P.tab.classList.toggle("co-dot", dot);
  if (dot) P.tab.setAttribute("aria-label", S("tabReady")); else P.tab.removeAttribute("aria-label");
}

// The panel's content, drawn again from what the coach knows each time something changes. Only while the panel is open, so the example's
// key frames load only when it shows. It keeps its place, and the focus stays on the same control where it can (each carries a data-k),
// else on the panel; a ?coach=drafts link scrolls to Drafts and puts the focus on it once GET /coach/me has answered (only the admin has
// it).
function render() {
  if (!P.started || !P.open) return;
  const had = P.body.contains(document.activeElement) ? document.activeElement : null, key = V.focus || (had && had.getAttribute("data-k")), at = P.body.scrollTop;
  V.focus = null;
  const t = tokenNow(), mine = !!t && ME.token === t;
  P.body.textContent = "";
  if (!t) { V.drafts = false; P.body.append(...signedOut()); }
  else if (mine && ME.me) P.body.append(...signedIn(ME.me));
  else if (mine && ME.failed) P.body.append(...failed());
  else P.body.append(el("p", { class: "co-wait" }, S("loading")));
  P.body.scrollTop = at;
  const to = key && P.body.querySelector(`[data-k="${key}"]`);
  if (to) { to.focus({ preventScroll: true }); reveal(to); } else if (had) P.el.focus({ preventScroll: true });
  if (V.drafts && mine && ME.me) {
    V.drafts = false; const h = P.body.querySelector(".co-drafts h3");
    if (h) { h.focus({ preventScroll: true }); reveal(h, true); }
  }
}
// Scrolls the panel's body (and nothing behind it) so e shows, or with top, so e is at the top.
function reveal(e, top) {
  const b = P.body.getBoundingClientRect(), r = e.getBoundingClientRect();
  if (top || r.top < b.top) P.body.scrollTop += r.top - b.top - 16;
  else if (r.bottom > b.bottom) P.body.scrollTop += r.bottom - b.bottom + 16;
}

// Signed out: what the coach does, Sign in with LINE (the chat's LINE sign-in, back to this panel), and the example.
function signedOut() {
  const b = el("button", { type: "button", class: "co-signin", "data-k": "signin" }, lineIcon(), el("i", { class: "co-line-sep", "aria-hidden": "true" }), el("span", { class: "co-line-w" }, S("signIn")));
  b.addEventListener("click", guard(() => { if (window.CHAT && typeof window.CHAT.signIn === "function") window.CHAT.signIn("coach"); }));
  return [el("p", { class: "co-lead" }, S("lead")), b,
    el("section", { class: "co-example", "aria-labelledby": "coachExample" }, el("h3", { id: "coachExample" }, S("example")),
      reviewParts(EXAMPLE_REVIEW[lang()], n => EXAMPLE_FRAMES[n] || null))];
}
// A review's parts, from text in the reply's shape (chat/src/coach-guide.js): what went well with its key frame, the main fix with its key
// frames, and the drill. frame(n) gives key frame n's {src, ms}, or null. Every word goes in as text.
function reviewParts(r, frame) {
  const shots = ns => el("div", { class: "co-kfs" }, ns.map(n => { const f = frame(n), at = f && S("keyFrameAt")(COACHM.fmtTime(f.ms));
    return f && el("figure", { class: "co-kf" }, el("img", { src: f.src, alt: "", width: "784", height: "784", decoding: "async" }), el("figcaption", null, at)); }));
  return [
    el("section", { class: "co-part" }, el("h4", null, S("wentWell")), shots([r.went_well.frame]), el("p", { class: "co-pt" }, r.went_well.title), el("p", null, r.went_well.detail)),
    el("section", { class: "co-part" }, el("h4", null, S("mainFix")), shots(r.main_fix.frames), el("p", { class: "co-pt" }, r.main_fix.title),
      el("p", null, el("b", null, S("happening")), r.main_fix.what), el("p", null, el("b", null, S("matters")), r.main_fix.why)),
    el("section", { class: "co-part" }, el("h4", null, S("drill")), el("p", { class: "co-pt" }, r.drill.title), el("p", null, r.drill.how)),
  ];
}
// LINE's own icon for its button, as the chat's: the white speech bubble with "LINE" in green (LINE's button guidelines).
function lineIcon() { const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), p = document.createElementNS(ns, "path"), t = document.createElementNS(ns, "text");
  svg.setAttribute("viewBox", "0 0 40 40"); svg.setAttribute("class", "co-line-ico"); svg.setAttribute("aria-hidden", "true");
  p.setAttribute("fill", "#fff"); p.setAttribute("d", "M20 6.5C11.4 6.5 4.5 12.2 4.5 19.2c0 6.3 5.5 11.5 13 12.5.5.1 1.2.3 1.4.8.2.4.1 1.1 0 1.5l-.2 1.3c-.1.4-.3 1.5 1.3.8s8.8-5.2 12-8.9c2.2-2.4 3.3-4.9 3.3-7.5 0-7-6.9-12.7-15.4-12.7z");
  t.setAttribute("x", "20"); t.setAttribute("y", "22.6"); t.setAttribute("text-anchor", "middle"); t.setAttribute("fill", "#06C755");
  t.setAttribute("font-size", "8.2"); t.setAttribute("font-weight", "800"); t.setAttribute("font-family", "Arial, Helvetica, sans-serif"); t.textContent = "LINE";
  svg.append(p, t); return svg; }

// Signed in: "2 of 2 reviews left in November" (the month is the backend's Taiwan month, whatever the phone's clock says), How to film,
// the agreement until it's agreed and then New review, their reviews newest first, and Drafts for the admin.
function signedIn(me) {
  const reviews = me.reviews.filter(r => !!r && typeof r === "object");
  const out = [el("p", { class: "co-left" }, S("left")(me.left, me.monthly, +me.month.slice(5) - 1)), film(reviews.length > 0), me.agreed === true ? newReview() : agreement()];
  if (reviews.length) out.push(el("h3", { class: "co-h co-yours" }, S("yours")), el("ul", { class: "co-list" }, reviews.map(row)));
  if (me.admin === true) out.push(el("section", { class: "co-drafts" }, el("h3", { class: "co-h", tabindex: "-1" }, S("drafts"))));
  return out;
}
// GET /coach/me failed (the network, or the backend having a break): say so, with Try again.
function failed() {
  const b = el("button", { type: "button", class: "co-btn", "data-k": "retry" }, S("retry"));
  b.addEventListener("click", guard(() => { ME.failed = false; ME.token = null; render(); ask(); }));
  return [el("p", { class: "co-err" }, S("failed")), b];
}
// How to film (the spec's list): open until there's a review, then folded to its one line. Opened or shut by hand, it stays so.
function film(folded) {
  const d = el("details", { class: "co-film" }, el("summary", { "data-k": "film" }, S("filmHead")), el("ul", null, S("film").map(t => el("li", null, t))));
  d.open = V.film === null ? !folded : V.film;
  d.addEventListener("toggle", guard(() => { V.film = d.open === !folded ? null : d.open; }));
  return d;
}
// New review, once the agreement is agreed. The flow it starts comes with the clip picker; for now it's the button in its place.
const newReview = () => el("button", { type: "button", class: "co-btn co-new", "data-k": "new" }, S("newReview"));
// The coach agreement, before the first review (the spec's points and the 18+ tick), agreed once for this version.
function agreement() {
  const tick = el("input", { type: "checkbox", "data-k": "adult" }), err = el("p", { class: "co-err", role: "alert" }, S("adultOnly")), fail = el("p", { class: "co-err", role: "alert" }, S("failed"));
  tick.checked = V.tick; err.hidden = !V.adultErr; fail.hidden = !V.agreeErr;
  tick.addEventListener("change", guard(() => { V.tick = tick.checked; if (V.tick) { V.adultErr = false; err.hidden = true; } }));
  const ok = el("button", { type: "button", class: "co-btn", "data-k": "agree" }, S("agree"));
  ok.addEventListener("click", guard(agree));
  return el("section", { class: "co-agree", "aria-labelledby": "coachAgree" }, el("h3", { class: "co-h", id: "coachAgree" }, S("agreeHead")),
    el("ul", null, S("agreeList").map(t => el("li", null, t))), el("label", { class: "co-tick" }, tick, el("span", null, S("adult"))), err, fail, ok);
}
// I agree: without the 18+ tick it says who the coach is for and sends nothing; with it, POST /coach/agree {ver, adult: true}, and New
// review takes the agreement's place.
async function agree() {
  if (V.busy) return;
  if (!V.tick) { V.adultErr = true; V.focus = "adult"; return render(); }
  const t = tokenNow(); if (!t) return render();
  V.busy = true; V.agreeErr = false;
  const r = await call("/coach/agree", t, { ver: AGREE_VER, adult: true });
  V.busy = false;
  if (r.status === 401) { refused(t); ME.me = null; ME.token = null; }
  else if (r.status === 200 && ME.me && ME.token === t) { ME.me.agreed = true; V.tick = false; V.focus = "new"; }
  else V.agreeErr = true;
  render();
}
// A review in the list: its move, the Taiwan day it was sent, and its status in the surfer's words. A ready one opens (and one this phone
// hasn't opened yet carries a dot, as the tab does).
function row(r) {
  const st = STATUS.includes(r.status) ? r.status : "reviewing", moves = S("moves");
  const kids = [el("span", { class: "co-mv" }, Object.prototype.hasOwnProperty.call(moves, r.move) ? moves[r.move] : moves.other), el("span", { class: "co-date" }, day(r.created)),
    el("span", { class: "co-st co-st-" + st }, S("status")[st])];
  if (st !== "ready") return el("li", null, el("div", { class: "co-row" }, kids));
  if (isNew(r)) kids.push(el("i", { class: "co-fresh", "aria-hidden": "true" }));
  const b = el("button", { type: "button", class: "co-row", "data-k": /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? "r-" + r.id : null }, kids);
  b.addEventListener("click", guard(() => openReview(r)));
  return el("li", null, b);
}
// A day as surfers read it, on Taiwan's calendar: "23 October" (the year too when it isn't this one), 10月23日.
function day(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + TW), y = d.getUTCFullYear();
  return S("date")(y === new Date(Date.now() + TW).getUTCFullYear() ? 0 : y, d.getUTCMonth(), d.getUTCDate());
}
// Opening a ready review: this phone has seen it now, so the dot goes (waveslave-coach-seen keeps the newest published time opened).
function openReview(r) {
  if (isNew(r)) save(SEEN, r.published);
  drawDot(); render();
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
  P.body = el("div", { class: "co-body" });
  P.el = el("div", { class: "coachpanel", role: "dialog", "aria-modal": "true", "aria-labelledby": "coachTitle", tabindex: "-1", hidden: "" },
    el("div", { class: "co-hd" }, P.title, P.x), P.body);
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
  // Coming back to the page asks GET /coach/me again, at most once a minute, as the chat asks for its reports.
  document.addEventListener("visibilitychange", guard(() => { if (document.visibilityState === "visible" && Date.now() - ME.at >= 60e3) ask(); }));
  P.started = true;
  // Bryan's email link, ?coach=drafts (ruling R18), comes out of the address at once, as the chat's ?chat does, and opens the panel at
  // Drafts once the coach is on: at once when it is, else once developer mode comes on (the PIN box first while World mode is locked,
  // as for a sign-in back from LINE; cancelled, the link is dropped).
  const drafts = new URLSearchParams(location.search).get("coach") === "drafts";
  if (drafts) { V.drafts = true; try { history.replaceState(null, "", location.pathname + "#" + CUR); } catch (e) { location.hash = CUR; } }
  window.COACH.spot(CUR); window.COACH.dev();
  if (drafts && !on() && typeof setWorld === "function") {
    if (typeof worldLocked === "function" && worldLocked() && typeof wsPin === "function") wsPin(guard(() => setWorld(true)), guard(() => { V.drafts = false; }));
    else setWorld(true);
  }
  if (P.early) { P.early = false; open(); }
}
if (typeof document === "object" && document) {
  if (document.readyState === "complete") guard(start)();
  else { document.addEventListener("DOMContentLoaded", guard(start), { once: true }); addEventListener("load", guard(start), { once: true }); }
}

} catch (err) { try { console.error("coach: start-up failed", err?.name ?? "error"); } catch (e) {} } })();
