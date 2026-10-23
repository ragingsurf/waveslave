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
    drafts: "Drafts",
    // New review (AI coach spec, "New review").
    back: "‹ Back", choose: "Choose a clip", privacy: "Only key frames are sent. Your video never leaves your phone.",
    sameClip: "Choose the same clip again to pick up where you left off.",
    nothingOpens: "Nothing opens? ", openBrowser: "Open in your browser",
    getting: "Getting your clip ready… this can take a minute.",
    cantOpen: "This phone can't open that clip. Try another, or open waveslave.tw in your phone's own browser.",
    length: "Pick a clip between 3 seconds and 2 minutes. Slow-motion clips count at their slowed length.",
    whichMove: "Which move?", otherMove: "Which move is it?", levelHead: "Your level", boardHead: "Your board", stanceHead: "Your stance",
    levels: { first_waves: "First waves", green_waves: "Riding green waves", starting_turns: "Starting to turn", turning_well: "Turning well" },
    boards: { shortboard: "Shortboard", midlength: "Mid-length", longboard: "Longboard", foamie: "Foamie" },
    stances: { regular: "Regular", goofy: "Goofy", unsure: "Not sure" },
    change: "Change", noteHead: "Anything else?", noteHint: "Optional, up to 200 characters",
    next: "Next", missing: "Pick an answer for each question.",
    findHead: "Find the move", slideTo: m => `Slide to ${m} and tap Here.`,
    slideMoves: { popup: "your pop-up", bottom_turn: "your bottom turn", top_turn: "your top turn", cutback: "your cutback", down_the_line: "where you ride down the line", other: "your move" },
    slider: "Where the move is in the clip", here: "Here",
    tapHead: "Tap yourself", tapLine: "Tap yourself in the frame. Pinch to zoom if you're small.",
    cutting: "Cutting your key frames…",
    checkHead: "Is this you in each key frame?", checkLine: "Tap a key frame to fix it.",
    lostMark: "Tap to check", lostLine: "We lost you here. Tap yourself.", fixLine: "Tap yourself in this frame.",
    notIn: "Not in this one", allFrames: "Back to all key frames", bigger: "Bigger boxes", smaller: "Smaller boxes",
    need8: "We need you in at least 8 key frames. Try a clip filmed closer.",
    send: "Send to your coach", sending: "Sending…", sent: "Sent. Your feedback comes within a day.", sendFailed: "Couldn't send. Tap to try again.",
    resumeHead: "Pick up where you left off?", resumeFrames: "Your key frames are ready.", pickUp: "Pick up", startOver: "Start over" },
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
    drafts: "草稿",
    back: "‹ 返回", choose: "選擇影片", privacy: "只會傳送關鍵影格，你的影片不會離開你的手機。",
    sameClip: "請再選一次同一段影片，從上次中斷的地方繼續。",
    nothingOpens: "點了沒反應嗎？", openBrowser: "改用手機的瀏覽器開啟",
    getting: "正在準備你的影片…可能需要一分鐘。",
    cantOpen: "這支手機無法開啟這段影片。請換一段，或用手機內建的瀏覽器開啟 waveslave.tw。",
    length: "請選 3 秒到 2 分鐘的影片。慢動作影片以放慢後的長度計算。",
    whichMove: "哪個動作？", otherMove: "是什麼動作？", levelHead: "你的程度", boardHead: "你的板子", stanceHead: "你的站姿",
    levels: { first_waves: "剛開始（白浪）", green_waves: "能滑綠浪", starting_turns: "開始學轉向", turning_well: "轉向很熟練" },
    boards: { shortboard: "短板", midlength: "中長板", longboard: "長板", foamie: "軟板" },
    stances: { regular: "正腳（左腳在前）", goofy: "反腳（右腳在前）", unsure: "不確定" },
    change: "修改", noteHead: "還有什麼想說的嗎？", noteHint: "選填，最多 200 字",
    next: "下一步", missing: "每個問題都要選一個答案。",
    findHead: "找到動作", slideTo: m => `拖動滑桿到${m}，再按「這裡」。`,
    slideMoves: { popup: "你的起乘", bottom_turn: "你的底部轉向", top_turn: "你的頂部轉向", cutback: "你的回切", down_the_line: "你沿浪壁滑行的地方", other: "你的動作" },
    slider: "動作在影片裡的位置", here: "這裡",
    tapHead: "點一下你自己", tapLine: "在畫面中點一下你自己。人太小的話，可以用兩指放大。",
    cutting: "正在擷取關鍵影格…",
    checkHead: "每個關鍵影格裡都是你嗎？", checkLine: "點一下關鍵影格就能修正。",
    lostMark: "點這裡確認", lostLine: "這格找不到你，請點一下你自己。", fixLine: "在這格裡點一下你自己。",
    notIn: "這格沒有我", allFrames: "回到全部關鍵影格", bigger: "框放大", smaller: "框縮小",
    need8: "至少要有 8 個關鍵影格拍到你。試試拍得近一點的影片。",
    send: "傳送給教練", sending: "傳送中…", sent: "已送出。一天內會收到講評。", sendFailed: "無法傳送，點一下再試一次。",
    resumeHead: "要從上次中斷的地方繼續嗎？", resumeFrames: "你的關鍵影格已經準備好了。", pickUp: "繼續", startOver: "重新開始" },
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
.co-back{display:inline-block;margin:0 0 10px;padding:6px 0;border:0;background:none;color:var(--led-amb);font-size:15px;font-weight:700;cursor:pointer}
.co-fh{margin-bottom:6px!important;font-size:19px;outline:none}
.co-flow>p{margin-top:8px}
.co-flow .co-film{margin:10px 0 0}
.co-note{margin:10px 0 0!important;color:var(--muted)}
.co-ok{margin:0 0 12px!important;color:var(--good);font-weight:700}
.co-q{margin-top:16px}
.co-q h4{margin-bottom:6px;font-size:15px}
.co-chips{display:flex;flex-wrap:wrap;gap:8px}
.co-chip{min-height:40px;padding:8px 14px;border:1.5px solid var(--line);border-radius:20px;background:var(--panel);color:var(--ink);font-size:15px;cursor:pointer}
.co-chip[aria-pressed="true"]{border-color:var(--led-amb);background:var(--led-amb);color:var(--panel);font-weight:700}
.co-line{display:block;width:100%;box-sizing:border-box;min-height:42px;margin-top:8px;padding:8px 10px;border:1.5px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);font:16px var(--body)}
.co-sum{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.co-link{padding:4px 0;border:0;background:none;color:var(--led-amb);font-size:15px;font-weight:700;text-decoration:underline;cursor:pointer}
.co-btn:disabled{opacity:.45;cursor:default}
.co-btn2{background:none;border:1.5px solid var(--led-amb);color:var(--led-amb)}
.co-hold{position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none}
.co-hold video{width:2px;height:2px}
.co-player{margin-top:12px;border-radius:10px;overflow:hidden;background:#000}
.co-player video{display:block;width:100%;height:auto;max-height:42vh;object-fit:contain}
.co-slider{display:block;width:100%;margin:14px 0 0}
.co-frame{position:relative;margin:12px auto 0;max-width:100%;overflow:hidden;border-radius:10px;background:#000;touch-action:none;user-select:none;-webkit-user-select:none;cursor:crosshair}
.co-zoom{position:absolute;inset:0;transform-origin:0 0}
.co-zoom video,.co-zoom img{display:block;width:100%;height:100%;object-fit:fill;pointer-events:none}
.co-box{position:absolute;box-sizing:border-box;border:2px solid #ffd400;box-shadow:0 0 0 1px rgba(0,0,0,.7);pointer-events:none}
.co-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:12px}
.co-tile{position:relative;display:block;width:100%;padding:0;border:2px solid transparent;border-radius:9px;background:var(--line);color:inherit;font:inherit;cursor:pointer;overflow:hidden}
.co-tile img{display:block;width:100%;height:auto;aspect-ratio:1}
.co-tile .co-t{position:absolute;left:4px;bottom:3px;padding:0 4px;border-radius:4px;background:rgba(0,0,0,.6);color:#fff;font-size:12px}
.co-tile .co-mark{position:absolute;inset:auto 0 0;padding:14px 4px 4px;background:linear-gradient(transparent,rgba(0,0,0,.8));color:#fff;font-size:12px;font-weight:700;text-align:center}
.co-tile.co-lost{border-color:#ffd400}
.co-tile.co-out img{opacity:.35}
.co-size{display:flex;justify-content:center;gap:14px;margin-top:12px}
.co-size button{width:46px;height:46px;border-radius:50%;border:1.5px solid var(--led-amb);background:none;color:var(--led-amb);font-size:24px;font-weight:700;line-height:1;cursor:pointer}
.co-size button:disabled{opacity:.45;cursor:default}
.co-prog{display:block;width:100%;height:10px;margin-top:14px;accent-color:var(--led-amb)}
.co-resume{margin-top:14px;padding:12px 14px;border:1px solid var(--led-amb);border-radius:12px;background:var(--panel)}
.co-resume p{margin-top:6px}
.co-choose{position:relative;text-align:center;box-sizing:border-box}
.co-choose:focus-within{outline:2px solid var(--ink);outline-offset:2px}
.co-big{display:block;width:100%;height:auto;margin-top:12px;border-radius:10px}
.co-file{position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;overflow:hidden}
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
// ✕ or Escape, or the coach going away: the focus goes back where it was, else to the tab while it shows. A ?coach=drafts link still
// waiting for GET /coach/me is dropped, so drawing the page again (a new language, a spot) doesn't open the panel again.
function close() {
  if (!P.open) return;
  P.open = false; P.el.hidden = true; document.documentElement.classList.remove("coach-open"); V.drafts = false; V.sent = false;
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
// the agreement's lines, an I agree on its way, the control to give the focus to, a ?coach=drafts link waiting to open at Drafts, whether
// to show the top of the panel (a new screen of New review) and whether a review was just sent ("Sent.", until the panel shuts).
const V = { film: null, tick: false, adultErr: false, agreeErr: false, busy: false, focus: null, drafts: false, top: false, sent: false };
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

// The tab's dot: a ready review published after the newest one this phone has opened. seenHere keeps it for this page load too, for when
// localStorage won't.
let seenHere = 0;
const seen = () => { const v = Number(load(SEEN)); return Math.max(Number.isFinite(v) ? v : 0, seenHere); };
const isNew = r => !!r && r.status === "ready" && Number.isFinite(r.published) && r.published > seen();
function drawDot() {
  if (!P.started) return;
  const t = tokenNow(), dot = can() && !!t && t === ME.token && !!ME.me && ME.me.reviews.some(isNew);
  P.tab.classList.toggle("co-dot", dot);
  if (dot) P.tab.setAttribute("aria-label", S("tabReady")); else P.tab.removeAttribute("aria-label");
}

// The panel's content, drawn again from what the coach knows each time something changes. Only while the panel is open, so the example's
// key frames load only when it shows. It keeps its place (or goes to the top for a new screen of New review), and the focus stays on the
// same control where it can (each carries a data-k), else on the panel. Signed in, a New review on its way shows in the panel's place,
// and the first time the panel shows signed in it reads the draft a reload may have left (loadDraft). A ?coach=drafts link scrolls to
// Drafts and puts the focus on it once GET /coach/me has answered (only the admin has it); once it has answered or failed, the link is
// done with.
function render() {
  if (!P.started || !P.open) return;
  const had = P.body.contains(document.activeElement) ? document.activeElement : null, key = V.focus || (had && had.getAttribute("data-k")), at = P.body.scrollTop;
  V.focus = null;
  const t = tokenNow(), mine = !!t && ME.token === t;
  P.body.textContent = "";
  if (!t) { V.drafts = false; P.body.append(...signedOut()); }
  else if (mine && ME.me) {
    if (!F.loaded) { F.loaded = true; guard(loadDraft)(); }
    P.body.append(...(F.show && ME.me.agreed === true ? flow(ME.me) : signedIn(ME.me)).filter(Boolean));
  }
  else if (mine && ME.failed) P.body.append(...failed());
  else P.body.append(el("p", { class: "co-wait" }, S("loading")));
  P.body.scrollTop = V.top ? 0 : at; V.top = false;
  const to = key && P.body.querySelector(`[data-k="${key}"]`);
  if (to) { to.focus({ preventScroll: true }); reveal(to); } else if (had) P.el.focus({ preventScroll: true });
  if (V.drafts && mine && (ME.me || ME.failed)) {
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

// Signed in: "Sent. Your feedback comes within a day." just after sending, "2 of 2 reviews left in November" (the month is the backend's
// Taiwan month, whatever the phone's clock says), How to film, the agreement until it's agreed and then New review (or, with a review
// left halfway, Pick up where you left off?), their reviews newest first, and Drafts for the admin.
function signedIn(me) {
  const reviews = me.reviews.filter(r => !!r && typeof r === "object");
  const out = [V.sent ? el("p", { class: "co-ok", role: "status", tabindex: "-1", "data-k": "sent" }, S("sent")) : null,
    el("p", { class: "co-left" }, S("left")(me.left, me.monthly, +me.month.slice(5) - 1)), film(reviews.length > 0),
    me.agreed === true ? (F.draft ? resumeOffer() : newReview()) : agreement()];
  if (reviews.length) out.push(el("h3", { class: "co-h co-yours" }, S("yours")), el("ul", { class: "co-list" }, reviews.map(r => row(r, +me.month.slice(0, 4)))));
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
// New review, once the agreement is agreed: it starts the flow below (startNew).
function newReview() { const b = el("button", { type: "button", class: "co-btn co-new", "data-k": "new" }, S("newReview")); b.addEventListener("click", guard(startNew)); return b; }
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
// A review in the list: its move, the Taiwan day it was sent (year: this year by the server), and its status in the surfer's words. A ready
// one opens (and one this phone hasn't opened yet carries a dot, as the tab does).
function row(r, year) {
  const st = STATUS.includes(r.status) ? r.status : "reviewing", moves = S("moves");
  const kids = [el("span", { class: "co-mv" }, Object.prototype.hasOwnProperty.call(moves, r.move) ? moves[r.move] : moves.other), el("span", { class: "co-date" }, day(r.created, year)),
    el("span", { class: "co-st co-st-" + st }, S("status")[st])];
  if (st !== "ready") return el("li", null, el("div", { class: "co-row" }, kids));
  if (isNew(r)) kids.push(el("i", { class: "co-fresh", "aria-hidden": "true" }));
  const b = el("button", { type: "button", class: "co-row", "data-k": /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? "r-" + r.id : null }, kids);
  b.addEventListener("click", guard(() => openReview(r)));
  return el("li", null, b);
}
// A day as surfers read it, on Taiwan's calendar: "23 October" (the year too when it isn't `year`, this year by the server's month, not
// the phone's clock), 10月23日.
function day(ms, year) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + TW), y = d.getUTCFullYear();
  return S("date")(y === year ? 0 : y, d.getUTCMonth(), d.getUTCDate());
}
// Opening a ready review: this phone has seen it now, so the dot goes (waveslave-coach-seen keeps the newest published time opened).
function openReview(r) {
  if (isNew(r)) { seenHere = r.published; save(SEEN, r.published); }
  drawDot(); render();
}

// ---- New review (AI coach spec, "New review", steps 1-6): pick a clip, the questions, find the move with the slider and Here, tap
// yourself, the check screen with the 12 close-ups, and sending. The clip is read here and never leaves the phone: only the close-ups the
// surfer saw on the check screen are sent, as 784 x 784 JPEGs. Each screen is drawn by render() from F, as the rest of the panel is.
// The surfer's answers as the backend takes them (MOVES, LEVELS, BOARDS and STANCES in chat/src/coach-guide.js).
const MOVES = ["popup", "bottom_turn", "top_turn", "cutback", "down_the_line", "other"], LEVELS = ["first_waves", "green_waves", "starting_turns", "turning_well"];
const BOARDS = ["shortboard", "midlength", "longboard", "foamie"], STANCES = ["regular", "goofy", "unsure"];
const NOTE_MAX = 200, OTHER_MAX = 60; // characters in "Anything else?" and in the line naming an "other" move, counted as the backend does
const KEPT_MIN = 8; // the surfer must be in at least 8 of the 12 key frames
const CLIP_MIN = 3, CLIP_MAX = 120; // a clip's length, in seconds
const SIDE = 784; // every close-up is 784 x 784: a multiple of the 28 px tile the AI counts its cost in

// The review being made. What a reload must not lose is kept in IndexedDB as it goes (saveDraft): the answers, how far it got, Here (s),
// the tap and the box side (displayed pixels), the 12 key frames {n, ms, box, lost, blob} once cut, the review's id once started and the
// key frames the server has (sent). The rest lives only in this page: whether the draft was read (loaded) and whether there is one, whether
// the flow shows (else the panel's main view, which offers to pick it up), the screen, whether the clip has to be chosen again (resumed),
// the clip (the file input, its <video> and object URL, whether its length and size are known, its first tap, its length and size, the
// slider's place), and the screen's state: a clip that wouldn't do (err), unanswered questions, the profile opened for changing, the key
// frame opened on the check screen and its zoom, a seek on its way, work on its way and its progress bar, and a send that failed. run
// goes up whenever the work on its way is to stop (a new clip, Start over, a new cut or send).
const noAnswers = p => ({ move: null, move_other: "", note: "", level: p && LEVELS.includes(p.level) ? p.level : null,
  board: p && BOARDS.includes(p.board) ? p.board : null, stance: p && STANCES.includes(p.stance) ? p.stance : null });
const F = { loaded: false, draft: false, show: false, screen: null, resumed: false, answers: noAnswers(null), profiled: false, here: null, tap: null, side: null,
  frames: [], id: null, sent: [], input: null, video: null, url: null, ready: false, unlocked: false, dur: 0, vw: 0, vh: 0, pos: 0,
  err: null, missing: false, editProfile: false, open: null, zoom: null, seeking: false, seekN: 0, busy: false, progress: [0, 1], bar: null, fail: false, run: 0 };
// The first max characters of s, counted as the backend counts them (code points, so an emoji is one, and 中文 has the room English has).
const upTo = (s, max) => [...String(s)].slice(0, max).join("");
const answered = a => MOVES.includes(a.move) && (a.move !== "other" || a.move_other.trim() !== "") && LEVELS.includes(a.level) && BOARDS.includes(a.board) && STANCES.includes(a.stance);
const keptFrames = () => F.frames.filter(f => f.box && !f.lost);
const hasClip = () => !!F.video && F.ready;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A key frame: its number (1-12), its time in the clip (ms), the surfer's box (null: "Not in this one"), whether the tracker lost them,
// and its close-up's JPEG with a blob URL for showing it.
function newFrame(n, ms, box, lost, blob) { const f = { n, ms, box, lost, blob: null, src: null }; setBlob(f, blob); return f; }
function setBlob(f, blob) { revoke(f); f.blob = blob; try { f.src = URL.createObjectURL(blob); } catch (e) { f.src = null; } }
function revoke(f) { if (f.src) try { URL.revokeObjectURL(f.src); } catch (e) {} f.src = null; }

// ---- Storage: the draft in IndexedDB (database waveslave-coach, store draft, key "current"), kept until it's sent or Start over clears
// it: saved as each answer is given and when the key frames are cut (and when they change, or the server has one more). Every step is in
// try/catch: where IndexedDB is missing or throws (a private window), the review can still be sent, only not picked up after a reload.
// Writes go one after another, in order.
let dbOpen = null, dbQueue = Promise.resolve();
function idb(mode, op, ...args) {
  if (!dbOpen) dbOpen = new Promise((ok, no) => { const q = indexedDB.open("waveslave-coach", 1);
    q.onupgradeneeded = () => { try { q.result.createObjectStore("draft"); } catch (e) { no(e); } };
    q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); q.onblocked = () => no(new Error("blocked")); });
  return dbOpen.then(d => new Promise((ok, no) => { let out;
    const tx = d.transaction("draft", mode), q = tx.objectStore("draft")[op](...args);
    q.onsuccess = () => { out = q.result; }; tx.oncomplete = () => ok(out); tx.onerror = tx.onabort = () => no(tx.error || new Error("idb")); }));
}
const queued = f => (dbQueue = dbQueue.then(f).catch(() => {}));
function saveDraft() {
  F.draft = true;
  const step = F.frames.length === 12 ? "check" : F.screen === "find" || F.screen === "tap" ? F.screen : F.screen === "cut" ? "tap" : "questions";
  const rec = { answers: { ...F.answers }, step, here: F.here, tap: F.tap && { x: F.tap.x, y: F.tap.y }, side: F.side,
    frames: F.frames.map(f => ({ n: f.n, ms: f.ms, box: f.box && [f.box.x, f.box.y, f.box.side], lost: f.lost, blob: f.blob })), id: F.id, sent: [...F.sent] };
  queued(() => idb("readwrite", "put", rec, "current"));
}
function dropDraft() { F.draft = false; queued(() => idb("readwrite", "delete", "current")); }
// The draft a reload left, read once a page load when the panel first shows signed in. Anything that doesn't look right is left out; with
// the key frames all there it picks up at the check screen, else the clip is chosen again. Nothing changes if a review has started
// meanwhile.
async function loadDraft() {
  let r = null; await queued(() => idb("readonly", "get", "current").then(v => { r = v; }));
  const a = r && typeof r === "object" && r.answers && typeof r.answers === "object" ? r.answers : null;
  if (!a || F.draft || F.show) return;
  const pick = (v, list) => list.includes(v) ? v : null, str = (v, max) => typeof v === "string" ? upTo(v, max) : "";
  const isBox = b => Array.isArray(b) && b.length === 3 && b.every(Number.isInteger) && b[0] >= 0 && b[1] >= 0 && b[2] >= 1;
  F.answers = { move: pick(a.move, MOVES), move_other: str(a.move_other, OTHER_MAX), note: str(a.note, NOTE_MAX), level: pick(a.level, LEVELS), board: pick(a.board, BOARDS), stance: pick(a.stance, STANCES) };
  F.here = Number.isFinite(r.here) && r.here >= 0 ? r.here : null; F.pos = F.here || 0;
  F.tap = r.tap && Number.isFinite(r.tap.x) && Number.isFinite(r.tap.y) ? { x: r.tap.x, y: r.tap.y } : null;
  F.side = Number.isInteger(r.side) && r.side > 0 ? r.side : null;
  const fs = Array.isArray(r.frames) ? r.frames : [];
  const good = (f, i) => !!f && f.n === i + 1 && Number.isInteger(f.ms) && f.ms >= 0 && f.blob instanceof Blob && (f.box === null || isBox(f.box));
  if (r.step === "check" && fs.length === 12 && fs.every(good) && F.side) F.frames = fs.map(f => newFrame(f.n, f.ms, f.box && { x: f.box[0], y: f.box[1], side: f.box[2] }, f.lost === true, f.blob));
  F.id = F.frames.length && typeof r.id === "string" && /^[A-Za-z0-9_-]{22}$/.test(r.id) ? r.id : null;
  F.sent = F.id && Array.isArray(r.sent) ? r.sent.filter(n => Number.isInteger(n) && n >= 1 && n <= 12) : [];
  F.draft = true; F.resumed = true; F.screen = F.frames.length ? "check" : "pick";
  render();
}

// ---- Starting, leaving and picking up.
// New review: a fresh review, the level, board and stance from last time (GET /coach/me's profile) when there are some.
function startNew() {
  resetFlow(); const p = ME.me && ME.me.profile;
  F.answers = noAnswers(p); F.profiled = !!F.answers.level && !!F.answers.board && !!F.answers.stance;
  F.show = true; F.screen = "pick"; V.sent = false; go();
}
// Everything of the review let go: the clip, the key frames' blob URLs, and the work on its way.
function resetFlow() {
  F.run++; dropClip(); for (const f of F.frames) revoke(f);
  Object.assign(F, { draft: false, show: false, screen: null, resumed: false, answers: noAnswers(null), profiled: false, here: null, tap: null, side: null, frames: [],
    id: null, sent: [], err: null, missing: false, editProfile: false, open: null, zoom: null, seeking: false, busy: false, fail: false });
}
// A new screen: drawn from the top, with the focus on its heading.
function go() { F.zoom = null; V.top = true; V.focus = F.show ? "fh" : F.draft ? "pickup" : "new"; render(); }
// ‹ Back: from Find the move to the questions, from Tap yourself to Find the move, else out to the panel's main view, which offers to pick
// the review up (the clip stays while the page does). With nothing answered yet there's nothing to pick up.
function back() {
  if (F.busy) return;
  if (F.screen === "find") F.screen = "questions"; else if (F.screen === "tap") F.screen = "find";
  else { F.show = false; F.open = null; if (!F.draft) resetFlow(); }
  go();
}
// Pick up where you left off?: back to the screen it was on; once the page has reloaded, the clip is chosen again first (and then straight
// to Find the move), unless the key frames were cut. Start over clears it and starts afresh.
function pickUp() { if (!F.video && F.screen !== "check") { F.screen = "pick"; F.resumed = true; } F.show = true; go(); }
function startOver() { dropDraft(); startNew(); }
function resumeOffer() {
  const mv = F.answers.move && S("moves")[F.answers.move];
  return el("section", { class: "co-resume", "aria-labelledby": "coachResume" }, el("h3", { class: "co-h", id: "coachResume" }, S("resumeHead")),
    mv ? el("p", null, mv) : null, F.frames.length ? el("p", null, S("resumeFrames")) : null,
    button("pickup", S("pickUp"), pickUp), button("over", S("startOver"), startOver, "co-btn co-btn2"));
}
function button(k, text, f, cls = "co-btn", label = null) {
  const b = el("button", { type: "button", class: cls, "data-k": k, "aria-label": label }, text); b.addEventListener("click", guard(f)); return b; }
const heading = t => el("h3", { class: "co-h co-fh", tabindex: "-1", "data-k": "fh" }, t);
const note = (t, alert) => el("p", alert ? { class: "co-err", role: "alert" } : { class: "co-note", role: "status" }, t);
function progress() { const b = el("progress", { class: "co-prog", max: String(F.progress[1]), value: String(F.progress[0]) }); F.bar = b; return b; }
function stepOn() { F.progress[0]++; if (F.bar) F.bar.value = F.progress[0]; }

// The flow's screen, in the panel's place. The clip stays in the page while a screen doesn't show it, in a holder out of sight, so it
// keeps loading; on the questions screen and Find the move, the first tap readies it (unlock).
function flow(me) {
  const s = F.screen, screens = { pick: pickScreen, questions: questionsScreen, find: findScreen, tap: tapScreen, cut: workScreen, send: workScreen, check: checkScreen };
  const sec = el("section", { class: "co-flow" }, s === "cut" || s === "send" ? null : button("back", S("back"), back, "co-back"), (screens[s] || pickScreen)(me));
  if (s === "questions" || s === "find") sec.addEventListener("click", guard(unlock), true);
  if (F.video && !sec.contains(F.video)) sec.append(el("div", { class: "co-hold", "aria-hidden": "true" }, F.video));
  return [sec];
}

// ---- Step 1, the picker: "Choose a clip" opens the phone's own picker (<input type="file" accept="video/*">), with the privacy line under
// it, and the clip goes into a <video muted playsinline> from an object URL. The input stays the same element as the panel is drawn
// again, so a clip picked meanwhile still comes. iOS hands the clip over after its own "Preparing…" and reads it only once it has been
// played from a tap: the first tap on the next screen calls play() then pause() (unlock). Until the clip's length and size are known, the
// screens say "Getting your clip ready… this can take a minute."; it must be 3 s to 2 minutes long.
function pickScreen(me) {
  const out = [heading(S("newReview")), film(me.reviews.some(r => !!r && typeof r === "object"))];
  if (F.resumed) out.push(el("p", { class: "co-note" }, S("sameClip")));
  if (!F.input) { F.input = el("input", { type: "file", accept: "video/*", class: "co-file", "data-k": "file" });
    F.input.addEventListener("change", guard(() => { const file = F.input.files && F.input.files[0]; F.input.value = ""; if (file) takeClip(file); })); }
  out.push(el("label", { class: "co-btn co-choose" }, S("choose"), F.input), el("p", { class: "co-note co-privacy" }, S("privacy")));
  // In LINE on Android the picker may not open: a line under it offers the page in the phone's own browser (ruling R19), where the surfer
  // signs in with LINE again.
  const href = lineAndroid() ? outside() : null;
  if (href) out.push(el("p", { class: "co-note co-outside" }, S("nothingOpens"), el("a", { href }, S("openBrowser"))));
  if (F.err) out.push(note(S(F.err), true));
  return out;
}
const lineAndroid = () => { const ua = String((navigator && navigator.userAgent) || ""); return /\bLine\/\d/i.test(ua) && /\bAndroid\b/i.test(ua); };
// This page's address with openExternalBrowser=1, which LINE opens in the phone's own browser.
function outside() { try { const u = new URL(location.href); u.searchParams.set("openExternalBrowser", "1"); return u.href; } catch (e) { return null; } }
function takeClip(file) {
  F.run++; F.busy = false; F.seeking = false; dropClip();
  const v = el("video", { muted: "", playsinline: "", preload: "auto" }); v.muted = true; v.playsInline = true;
  v.addEventListener("loadedmetadata", guard(() => { if (F.video === v) clipReady(); }));
  v.addEventListener("error", guard(() => { if (F.video === v) clipFailed("cantOpen"); }));
  F.video = v; F.url = URL.createObjectURL(file); F.unlocked = false; F.err = null; F.missing = false; F.pos = F.here || 0;
  v.src = F.url;
  F.screen = F.resumed && answered(F.answers) ? "find" : "questions"; go();
}
function clipReady() {
  const v = F.video, d = v.duration, w = v.videoWidth, h = v.videoHeight;
  if (!(w > 0 && h > 0)) return clipFailed("cantOpen");
  if (!(d >= CLIP_MIN && d <= CLIP_MAX)) return clipFailed("length");
  F.ready = true; F.dur = d; F.vw = w; F.vh = h; F.pos = Math.min(F.pos, d);
  if (F.screen === "find") v.currentTime = F.pos;
  render();
}
// The clip won't do: back to the picker saying why (the answers stay). With the key frames cut, the check screen goes on without it.
function clipFailed(why) {
  F.run++; F.busy = false; F.seeking = false; dropClip(); F.open = null;
  if (F.frames.length === 12) F.screen = "check"; else { F.err = why; F.screen = "pick"; }
  go();
}
function dropClip() {
  const v = F.video; F.video = null; F.ready = false; F.zoom = null;
  if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {} v.remove(); }
  if (F.url) { try { URL.revokeObjectURL(F.url); } catch (e) {} F.url = null; }
}
function unlock() {
  const v = F.video; if (!v || F.unlocked) return; F.unlocked = true;
  try { const p = v.play(); if (p && typeof p.catch === "function") p.catch(() => {}); v.pause(); } catch (e) {}
}

// ---- Step 2, the questions: the move (an "other" one named in a short line); the level, board and stance the first time, then from last
// time (GET /coach/me's profile) behind Change; and one optional line. Each answer is kept as it's given.
function questionsScreen() {
  const a = F.answers, out = [heading(S("newReview"))];
  if (!F.ready) out.push(note(S("getting")));
  const q = (key, title, list, names) => el("div", { class: "co-q" }, el("h4", { id: "coQ-" + key }, title),
    el("div", { class: "co-chips", role: "group", "aria-labelledby": "coQ-" + key }, list.map(v => {
      const b = el("button", { type: "button", class: "co-chip", "data-k": key + "-" + v, "aria-pressed": a[key] === v ? "true" : "false" }, names[v]);
      b.addEventListener("click", guard(() => { a[key] = v; F.missing = false; saveDraft(); render(); })); return b; })));
  out.push(q("move", S("whichMove"), MOVES, S("moves")));
  if (a.move === "other") out.push(line("move_other", OTHER_MAX, { "aria-label": S("otherMove"), placeholder: S("otherMove") }));
  if (F.profiled && !F.editProfile) out.push(el("div", { class: "co-q co-sum" }, el("span", null, [S("levels")[a.level], S("boards")[a.board], S("stances")[a.stance]].join(" · ")),
    button("profile", S("change"), () => { F.editProfile = true; V.focus = "level-" + a.level; render(); }, "co-link")));
  else out.push(q("level", S("levelHead"), LEVELS, S("levels")), q("board", S("boardHead"), BOARDS, S("boards")), q("stance", S("stanceHead"), STANCES, S("stances")));
  out.push(el("div", { class: "co-q" }, el("h4", null, el("label", { for: "coNote" }, S("noteHead"))), line("note", NOTE_MAX, { id: "coNote", placeholder: S("noteHint") })));
  if (F.missing) out.push(note(S("missing"), true));
  out.push(button("next", S("next"), () => { if (!answered(F.answers)) { F.missing = true; return render(); }
    F.screen = "find"; saveDraft(); if (hasClip()) F.video.currentTime = F.pos; go(); }));
  return out;
}
// A one-line answer, cut to max characters as the backend counts them (a textarea's maxlength counts UTF-16 units, which would cut an
// emoji short), but not while an input method is still composing.
function line(key, max, attrs) {
  const i = el("input", { type: "text", class: "co-line", "data-k": key, autocomplete: "off", enterkeyhint: "done", ...attrs });
  i.value = F.answers[key];
  const take = () => { if ([...i.value].length > max) i.value = upTo(i.value, max); if (F.answers[key] !== i.value) { F.answers[key] = i.value; saveDraft(); } };
  i.addEventListener("input", guard(e => { if (!e.isComposing) take(); }));
  i.addEventListener("compositionend", guard(take)); i.addEventListener("change", guard(take));
  return i;
}

// ---- Step 3, Find the move: the clip in a small player with a slider, "Slide to your cutback and tap Here."
function findScreen() {
  const a = F.answers, out = [heading(S("findHead")), el("p", null, S("slideTo")(S("slideMoves")[a.move] || S("slideMoves").other))];
  if (!F.ready) out.push(note(S("getting")));
  const r = el("input", { type: "range", class: "co-slider", "data-k": "slider", min: "0", max: String(F.ready ? F.dur : 1), step: "0.01", "aria-label": S("slider") });
  r.value = String(F.pos); r.disabled = !F.ready;
  r.addEventListener("input", guard(() => { F.pos = Number(r.value); if (hasClip()) F.video.currentTime = F.pos; }));
  const h = button("here", S("here"), () => { if (!hasClip()) return; F.here = F.pos; F.screen = "tap"; saveDraft(); showAt(F.here); go(); }); h.disabled = !F.ready;
  out.push(el("div", { class: "co-player" }, F.video), r, h);
  return out;
}
// Seeks the clip to t for a screen that shows it there, and draws again once it's there; taps wait for it.
function showAt(t) {
  const v = F.video, n = ++F.seekN;
  if (!v || (!v.seeking && Math.abs(v.currentTime - t) < 1e-3)) { F.seeking = false; return; }
  F.seeking = true;
  seekTo(v, t).then(guard(() => { if (n === F.seekN && F.video === v) { F.seeking = false; render(); } }), guard(() => { if (n === F.seekN && F.video === v) clipFailed("cantOpen"); }));
}

// ---- Step 4, Tap yourself: the frame at Here, full size, "Tap yourself". The box is a third of the frame's short side round the tap, and
// cutting starts.
const tapScreen = () => [heading(S("tapHead")), el("p", null, S("tapLine")), frameView(null, (x, y) => {
  if (F.seeking || F.busy) return;
  F.tap = { x: Math.round(x), y: Math.round(y) }; F.side = Math.round(Math.min(F.vw, F.vh) / 3); saveDraft(); guard(cutAll)(); })];
// A frame of the clip as it stands, full size in a box of its own shape (60% of the screen's height at most), with the surfer's box on it
// when there is one. Two fingers pinch it to zoom (up to 4 x) and one finger then moves it about; a tap (a touch or click that hardly
// moves) gives onTap where it landed, in the video's displayed pixels. The zoom stays while the same frame shows.
function frameView(box, onTap) {
  const vw = F.vw, vh = F.vh, inner = el("div", { class: "co-zoom" }, F.video), wrap = el("div", { class: "co-frame", "data-ready": F.seeking || F.busy ? null : "1" }, inner);
  wrap.style.width = `min(100%, ${(60 * vw / vh).toFixed(3)}vh)`; wrap.style.aspectRatio = `${vw} / ${vh}`;
  if (box) inner.append(el("div", { class: "co-box", style: `left:${100 * box.x / vw}%;top:${100 * box.y / vh}%;width:${100 * box.side / vw}%;height:${100 * box.side / vh}%` }));
  const z = F.zoom || (F.zoom = { s: 1, x: 0, y: 0 }), pts = new Map();
  let moved = false, base = null;
  const show = () => { inner.style.transform = `translate(${z.x}px,${z.y}px) scale(${z.s})`; };
  // Where a gesture (re)starts: the fingers' midpoint and spread, in the frame's own pixels, and the zoom then.
  const begin = () => { const r = wrap.getBoundingClientRect(), p = [...pts.values()], two = p.length > 1;
    base = { mx: (two ? (p[0].x + p[1].x) / 2 : p[0].x) - r.left, my: (two ? (p[0].y + p[1].y) / 2 : p[0].y) - r.top, d: two ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0,
      s: z.s, zx: z.x, zy: z.y }; };
  wrap.addEventListener("pointerdown", guard(e => { if (e.pointerType === "mouse" && e.button !== 0) return;
    try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }); moved = pts.size > 1; begin(); }));
  wrap.addEventListener("pointermove", guard(e => { const p = pts.get(e.pointerId); if (!p) return;
    p.x = e.clientX; p.y = e.clientY; if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) moved = true;
    const r = wrap.getBoundingClientRect(), all = [...pts.values()];
    if (all.length > 1) { // the point of the frame under the fingers stays under them
      const mx = (all[0].x + all[1].x) / 2 - r.left, my = (all[0].y + all[1].y) / 2 - r.top, d = Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y);
      z.s = Math.min(4, Math.max(1, base.s * d / (base.d || 1)));
      z.x = mx - (base.mx - base.zx) / base.s * z.s; z.y = my - (base.my - base.zy) / base.s * z.s; }
    else if (moved && z.s > 1) { z.x = base.zx + p.x - r.left - base.mx; z.y = base.zy + p.y - r.top - base.my; }
    else return;
    z.x = Math.min(0, Math.max(r.width * (1 - z.s), z.x)); z.y = Math.min(0, Math.max(r.height * (1 - z.s), z.y)); show(); }));
  const up = e => { const one = pts.size === 1; if (!pts.delete(e.pointerId)) return;
    if (pts.size) return begin();
    if (e.type !== "pointerup" || !one || moved) return;
    const r = inner.getBoundingClientRect();
    if (r.width && r.height) onTap(Math.min(vw, Math.max(0, (e.clientX - r.left) / r.width * vw)), Math.min(vh, Math.max(0, (e.clientY - r.top) / r.height * vh))); };
  wrap.addEventListener("pointerup", guard(up)); wrap.addEventListener("pointercancel", guard(up));
  show(); return wrap;
}

// ---- Cutting the key frames. For each of the 12 times round Here (COACHM.keyTimes) the clip is sought there, and
//   1. the tracker's frame is the whole frame drawn at a quarter of its size (Math.round(vw / 4) x Math.round(vh / 4)) into one small canvas
//      kept for that, read back (getImageData) and made grey (COACHM.grey); COACHM.track then follows the surfer through them from the
//      frame nearest Here, where they tapped, and each box it gives is moved inside the video (it can be up to 2 px over);
//   2. then, at each time again, the close-up: only the box, drawn straight from the video into one 784 x 784 canvas kept for that
//      (drawImage(video, sx, sy, sw, sh, 0, 0, 784, 784)) and made a JPEG at quality 0.85, then lower until it's at most 100 KB
//      (COACHM.nextQuality); the canvas is cleared after.
// A whole frame is never drawn into a canvas at its own size (iOS caps canvas memory), so no canvas is bigger than 784 x 784 or a quarter
// of the frame. Canvas JPEGs carry no location data.
const CV = { grey: null, crop: null };
// Seeks the clip to t (s) and resolves once the frame there can be drawn: after seeked, the frame callback (registered before the seek)
// for at most 0.5 s, else after one more animation frame. On iOS seeked can come before the new frame is drawn, and the frame callback
// never comes when the frame didn't change. A clip that fails, or doesn't seek within 20 s while the page shows, rejects.
function seekTo(v, t) {
  return new Promise((ok, no) => {
    let seeked = false, framed = false, done = false, id = null, wait = 0, stuck = 0;
    const end = bad => { if (done) return; done = true; clearTimeout(wait); clearTimeout(stuck); v.removeEventListener("seeked", onSeeked); v.removeEventListener("error", onError);
      if (id !== null && !framed) try { v.cancelVideoFrameCallback(id); } catch (e) {}
      if (bad) no(new Error("seek")); else ok(); };
    const drawn = () => requestAnimationFrame(() => end(false));
    const onSeeked = () => { seeked = true; clearTimeout(stuck); if (framed) end(false); else if (id === null) drawn(); else wait = setTimeout(drawn, 500); };
    const onError = () => end(true);
    const check = () => { if (document.visibilityState === "hidden") stuck = setTimeout(check, 20e3); else onError(); };
    stuck = setTimeout(check, 20e3);
    if (typeof v.requestVideoFrameCallback === "function") id = v.requestVideoFrameCallback(() => { framed = true; if (seeked) end(false); });
    v.addEventListener("seeked", onSeeked); v.addEventListener("error", onError);
    v.currentTime = t;
  });
}
function greyOf(v) {
  const w = Math.max(1, Math.round(F.vw / 4)), h = Math.max(1, Math.round(F.vh / 4)), c = CV.grey || (CV.grey = document.createElement("canvas"));
  if (c.width !== w) c.width = w; if (c.height !== h) c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(v, 0, 0, w, h); const px = g.getImageData(0, 0, w, h).data; g.clearRect(0, 0, w, h);
  return COACHM.grey(px, w, h);
}
async function cropOf(v, b) {
  const c = CV.crop || (CV.crop = document.createElement("canvas"));
  if (c.width !== SIDE) c.width = SIDE; if (c.height !== SIDE) c.height = SIDE;
  const g = c.getContext("2d"); let blob = null;
  try {
    g.drawImage(v, b.x, b.y, b.side, b.side, 0, 0, SIDE, SIDE);
    for (let q = COACHM.nextQuality(); q !== null;) { blob = await new Promise(r => c.toBlob(r, "image/jpeg", q)); q = blob ? COACHM.nextQuality(q, blob.size) : null; }
  } finally { g.clearRect(0, 0, SIDE, SIDE); }
  if (!blob) throw new Error("jpeg");
  return blob;
}
// After the tap: the tracker's frames, the tracker, then the close-ups. The check screen opens at the first frame the tracker lost.
async function cutAll() {
  const v = F.video, run = ++F.run, vw = F.vw, vh = F.vh, times = COACHM.keyTimes(F.here, F.dur);
  let from = 0; times.forEach((t, i) => { if (Math.abs(t - F.here) < Math.abs(times[from] - F.here)) from = i; });
  F.screen = "cut"; F.busy = true; F.progress = [0, 24]; F.open = null; go();
  const frames = [];
  try {
    const greys = [];
    for (const t of times) { await seekTo(v, t); if (run !== F.run) return; greys.push(greyOf(v)); stepOn(); }
    const boxes = COACHM.track(greys, from, COACHM.startBox(F.tap.x, F.tap.y, vw, vh));
    greys.length = 0;
    for (let i = 0; i < 12; i++) {
      await seekTo(v, times[i]); if (run !== F.run) return;
      const box = COACHM.clampBox(boxes[i], vw, vh), blob = await cropOf(v, box); if (run !== F.run) return;
      frames.push(newFrame(i + 1, Math.round(times[i] * 1000), box, !!boxes[i].lost, blob)); stepOn();
    }
  } catch (e) { if (run === F.run) clipFailed("cantOpen"); return; } finally { if (run !== F.run) frames.forEach(revoke); }
  for (const f of F.frames) revoke(f);
  F.frames = frames; F.id = null; F.sent = []; F.busy = false; F.fail = false; F.screen = "check"; saveDraft(); nextLost(); go();
}
// + / −: every box 1.2 x bigger or smaller about its centre (COACHM.resize), and the close-ups cut again.
async function resizeAll(dir) {
  const vw = F.vw, vh = F.vh, side = COACHM.resize({ x: 0, y: 0, side: F.side }, dir, vw, vh).side, v = F.video;
  if (F.busy || !hasClip() || side === F.side) return;
  const run = ++F.run, boxes = F.frames.map(f => f.box && COACHM.resize(f.box, dir, vw, vh)), blobs = [];
  F.screen = "cut"; F.busy = true; F.progress = [0, boxes.filter(Boolean).length]; F.open = null; go();
  try { for (let i = 0; i < 12; i++) { if (!boxes[i]) continue; await seekTo(v, F.frames[i].ms / 1000); if (run !== F.run) return; blobs[i] = await cropOf(v, boxes[i]); if (run !== F.run) return; stepOn(); } }
  catch (e) { if (run === F.run) clipFailed("cantOpen"); return; }
  F.frames.forEach((f, i) => { if (boxes[i]) { f.box = boxes[i]; setBlob(f, blobs[i]); } });
  F.side = side; changed(); F.busy = false; F.screen = "check"; go();
}
// The key frames changed: a review started with the old boxes is started again at the next send.
function changed() { F.id = null; F.sent = []; F.fail = false; saveDraft(); }
// The progress of cutting or sending.
const workScreen = () => [heading(S(F.screen === "cut" ? "cutting" : "sending")), progress(), F.screen === "cut" && F.video ? el("div", { class: "co-player" }, F.video) : null];

// ---- Step 5, the check screen: all 12 close-ups, "Is this you in each key frame?". Tapping one opens its frame, where tapping yourself
// moves its box there (a box of the side the others have), or "Not in this one" leaves it out; a frame the tracker lost is opened first,
// asking for a tap, and isn't sent until it's had one. + / − change every box. Send stays off below 8 key frames. Picked up after a
// reload, the clip isn't there: the close-ups still show and can be left out, and Send works.
function checkScreen() {
  if (F.open !== null && F.frames[F.open]) return openFrame(F.open);
  const n = keptFrames().length, clip = hasClip(), out = [heading(S("checkHead"))];
  if (clip) out.push(el("p", null, S("checkLine")));
  out.push(el("div", { class: "co-grid" }, F.frames.map((f, i) => {
    const t = COACHM.fmtTime(f.ms), mark = f.lost ? S("lostMark") : f.box ? null : S("notIn");
    const b = el("button", { type: "button", class: "co-tile" + (f.lost ? " co-lost" : f.box ? "" : " co-out"), "data-k": "kf-" + f.n, "aria-label": S("keyFrameAt")(t) + (mark ? " · " + mark : "") },
      el("img", { src: f.src, alt: "", width: String(SIDE), height: String(SIDE) }), el("span", { class: "co-t", "aria-hidden": "true" }, t), mark ? el("span", { class: "co-mark", "aria-hidden": "true" }, mark) : null);
    b.addEventListener("click", guard(() => openAt(i))); return b; })));
  if (clip) { const fits = dir => COACHM.resize({ x: 0, y: 0, side: F.side }, dir, F.vw, F.vh).side !== F.side;
    const minus = button("smaller", "−", () => resizeAll(-1), "", S("smaller")), plus = button("bigger", "+", () => resizeAll(1), "", S("bigger"));
    minus.disabled = !fits(-1); plus.disabled = !fits(1); out.push(el("div", { class: "co-size" }, minus, plus)); }
  if (n < KEPT_MIN) out.push(note(S("need8"), true));
  if (F.fail) out.push(button("retry", S("sendFailed"), send, "co-btn co-retry"));
  else { const b = button("send", S("send"), send); b.disabled = n < KEPT_MIN; out.push(b); }
  return out;
}
// Key frame i opened: its frame at its time with its box, or without the clip its close-up.
function openFrame(i) {
  const f = F.frames[i], clip = hasClip(), out = [heading(S("keyFrameAt")(COACHM.fmtTime(f.ms)))];
  if (clip) out.push(el("p", null, S(f.lost ? "lostLine" : "fixLine")), frameView(f.box, (x, y) => guard(fix)(i, x, y)));
  else out.push(el("img", { class: "co-big", src: f.src, alt: "", width: String(SIDE), height: String(SIDE) }));
  if (f.box) out.push(button("notin", S("notIn"), () => leaveOut(i), "co-btn co-btn2"));
  out.push(button("all", S("allFrames"), () => { F.open = null; go(); }, "co-btn co-btn2"));
  return out;
}
function openAt(i) { if (F.busy) return; F.open = i; if (hasClip()) showAt(F.frames[i].ms / 1000); go(); }
// After a frame the tracker lost is dealt with, the next one it lost opens; else back to all of them.
function nextLost() { const i = F.frames.findIndex(f => f.lost); F.open = null; if (i >= 0) { F.open = i; if (hasClip()) showAt(F.frames[i].ms / 1000); } }
async function fix(i, x, y) {
  if (F.busy || F.seeking || !hasClip()) return;
  const f = F.frames[i], v = F.video, run = F.run, wasLost = f.lost;
  const box = COACHM.clampBox({ x: Math.round(x - F.side / 2), y: Math.round(y - F.side / 2), side: F.side }, F.vw, F.vh);
  F.busy = true; let blob;
  try { blob = await cropOf(v, box); } catch (e) { if (run === F.run) clipFailed("cantOpen"); return; }
  if (run !== F.run) return;
  f.box = box; f.lost = false; setBlob(f, blob); F.busy = false; changed();
  if (wasLost) nextLost(); else F.open = null;
  go();
}
function leaveOut(i) { const f = F.frames[i], wasLost = f.lost; f.box = null; f.lost = false; changed(); if (wasLost) nextLost(); else F.open = null; go(); }

// ---- Step 6, sending (AI coach spec, "Sending"): POST /coach/reviews with the answers, the language and each kept key frame's number,
// time and box, for the review's id; then each key frame the server hasn't got, one at a time, as base64 text; then
// POST /coach/reviews/{id}/send. A review already started is asked about first (GET /coach/reviews/{id}): its have says which key frames
// are there, and one no longer uploading went through already. bad_frame, too_big, not_uploading and missing_frames go round once more by
// themselves; a review the server no longer has (not_found: any 404) is started again once without asking, as when another tab of the
// same account started one (ruling R12). Anything else, or the same again, ends on "Couldn't send. Tap to try again.", with the draft
// still kept. A refused token (401) goes back to the chat, as everywhere in the coach.
const AGAIN = new Set(["bad_frame", "too_big", "not_uploading", "missing_frames"]);
async function send() {
  const t = tokenNow(), kept = keptFrames();
  if (F.busy || !t || kept.length < KEPT_MIN || !answered(F.answers)) return;
  const run = ++F.run; F.busy = true; F.fail = false; F.screen = "send"; F.open = null; F.progress = [0, kept.length + 2]; go();
  let r = { status: 0, code: null };
  for (let restarts = 0, again = 0; ;) {
    try { r = await sendRound(t, kept, run); } catch (e) { r = { status: 0, code: null }; }
    if (run !== F.run) return;
    if (r.ok) break;
    if (r.code === "not_found" && restarts < 1) { restarts++; F.id = null; F.sent = []; saveDraft(); continue; }
    if (AGAIN.has(r.code) && again < 1) { again++; continue; }
    break;
  }
  F.busy = false;
  if (r.ok) { dropDraft(); resetFlow(); V.sent = true; if (ME.me && Number.isInteger(r.left)) ME.me.left = r.left; V.top = true; V.focus = "sent"; render(); return ask(); }
  F.screen = "check"; F.fail = true;
  if (r.status === 401) { refused(t); ME.me = null; ME.token = null; }
  go();
}
async function sendRound(t, kept, run) {
  F.progress[0] = 0; if (F.bar) F.bar.value = 0;
  if (F.id) {
    const g = await coachReq("GET", `/coach/reviews/${F.id}`, t);
    if (run !== F.run || g.status !== 200 || !g.json) return g;
    if (g.json.status !== "uploading") return { ok: true, left: null };
    const have = Array.isArray(g.json.have) ? g.json.have : [];
    F.sent = kept.map(f => f.n).filter(n => have.includes(n));
  } else {
    const a = F.answers, body = { lang: lang(), move: a.move, move_other: a.move === "other" ? a.move_other.trim() : "", level: a.level, board: a.board, stance: a.stance,
      note: upTo(a.note.trim(), NOTE_MAX), frames: kept.map(f => ({ n: f.n, ms: f.ms, box: [f.box.x, f.box.y, f.box.side] })) };
    const s = await coachReq("POST", "/coach/reviews", t, JSON.stringify(body), "application/json");
    if (run !== F.run || s.status !== 200) return s;
    if (!s.json || typeof s.json.id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(s.json.id)) return { status: s.status, code: null };
    F.id = s.json.id; F.sent = []; saveDraft();
  }
  stepOn();
  for (const f of kept) {
    if (!F.sent.includes(f.n)) {
      const b64 = await base64(f.blob); if (run !== F.run) return {};
      const r = await coachReq("POST", `/coach/reviews/${F.id}/frames/${f.n}`, t, b64, "text/plain");
      if (run !== F.run || r.status !== 200) return r;
      F.sent.push(f.n); saveDraft();
    }
    stepOn();
  }
  const d = await coachReq("POST", `/coach/reviews/${F.id}/send`, t, "{}", "application/json");
  if (run !== F.run || d.status !== 200) return d;
  return { ok: true, left: d.json && d.json.left };
}
const base64 = blob => new Promise((ok, no) => { const r = new FileReader();
  r.onload = () => { const s = String(r.result); ok(s.slice(s.indexOf(",") + 1)); }; r.onerror = () => no(r.error || new Error("read")); r.readAsDataURL(blob); });
// One request of the send, with its own fetch rather than call(): a 60 s timeout, for a weak beach connection, and 3 tries when the network
// fails or the backend answers 5xx (but money, a rest that trying again won't end). The session token goes as a Bearer header, with no
// cookies. Resolves to {status, json, code}: status 0 when the network failed, code the backend's error code, and any 404 not_found (the
// Worker's own 404 too). Nothing goes while the coach is off for this visitor.
async function coachReq(method, path, tok, body, type) {
  let r = { status: 0, json: null, code: null };
  for (let i = 0; i < 3 && can(); i++) {
    if (i) await sleep(1000 * i);
    r = await coachOnce(method, path, tok, body, type);
    if (r.status !== 0 && (r.status < 500 || r.code === "money")) break;
  }
  return r;
}
async function coachOnce(method, path, tok, body, type) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), 60e3) : 0;
  const headers = { Authorization: "Bearer " + tok }; if (body !== undefined) headers["Content-Type"] = type;
  try {
    const res = await fetch(BASE + path, { method, headers, body, credentials: "omit", signal: ctl ? ctl.signal : undefined });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json, code: res.status === 404 ? "not_found" : json && typeof json.error === "string" ? json.error : null };
  } catch (e) { return { status: 0, json: null, code: null }; } finally { clearTimeout(timer); }
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
    const all = [...P.el.querySelectorAll('button, input, a[href], textarea, select, summary, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.getClientRects().length);
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
