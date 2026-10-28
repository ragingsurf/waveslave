// Browser checks of the AI coach's page shell on a built page (build one with tests/map/tool.py): web/coach.js, served for the page's
// coach.js, and its hooks in template.html (the hidden Coach tab, the tab handler, the language, developer mode and spot hooks, and the
// Escape and pull-to-refresh guards), and the test clips tests/coach/clips.js makes.
// Usage: node tests/coach/shell.test.js <page.html> [check ...]   (the checks named, or every one)
// Prints ok / FAIL for each check, and exits 1 on any FAIL or page error; a check name it doesn't have exits 2 before any check runs.
// Only what the real backend can't give runs here (ruling R15): every page opens in its own fresh browser context, offline. Only the page,
// chat.js and coach.js load (page.tried lists the other web addresses it asked for), and a fake backend at https://chat.test answers
// /reports with none and, for the checks that give the page a session token, GET /coach/me with a stand-in answer (page.asked lists every
// call to it). A phone 390x844, dpr 2, touch, reduced motion, the intro done, English, the Forecast view, on Donghe. Developer mode (World
// mode, its PIN in for this visit) is on unless a check says otherwise, which is how the coach shows until Bryan opens it to everyone;
// window.__coachPublic and window.__chatPublic stay out unless a check sets them. The chat is switched on the way the tests do it
// (window.__chatUrl and window.__chatContact), and window.__chatTest lets chat.js note each time its room is asked to open (CHAT._opened).
// The New review checks give the coach a clip from tests/coach/clips.js (VP9 WebM, ruling R13) and answer its calls from flowBackend().
// Playwright wherever node finds it (npm install playwright), else the copy this container keeps.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), os = require("os"), path = require("path"), { pathToFileURL } = require("url");
const { makeClip } = require("./clips.js");

const [file, ...ONLY] = process.argv.slice(2);
const USAGE = "usage: node tests/coach/shell.test.js <page.html> [check ...]";
if (!file) { console.error(USAGE); process.exit(2); }
const ROOT = path.join(__dirname, "..", ".."), PAGE = pathToFileURL(path.resolve(file)).href, HTML = fs.readFileSync(file, "utf8");
const CHAT_JS = fs.readFileSync(path.join(ROOT, "web", "chat.js"), "utf8"), COACH_JS = fs.readFileSync(path.join(ROOT, "web", "coach.js"), "utf8");
const LOCK = (HTML.match(/\bH="([0-9a-f]{64})"/) || [])[1]; // a site build opens on the passcode screen: start unlocked
const CHAT = "https://chat.test", CONTACT = { name: "Test Operator", email: "chat@example.com" };
const TAB = '.tabs button[data-v="coach"]';

const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const wait = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// What the page shows of the coach: the tab (there and shown, its text, which tab is picked), the panel (open, shown, html.coach-open),
// the view and the saved view.
const look = page => page.evaluate(sel => { const t = document.querySelector(sel), p = document.querySelector(".coachpanel"), html = document.documentElement;
  const vis = e => !!e && !e.hidden && !e.closest("[hidden]") && getComputedStyle(e).display !== "none" && !!e.getClientRects().length;
  let saved = null; try { saved = localStorage.getItem("waveslave-view"); } catch (e) {}
  return { tab: vis(t), text: t && t.textContent, picked: [...document.querySelectorAll(".tabs button")].filter(b => b.getAttribute("aria-selected") === "true").map(b => b.dataset.v),
    panel: vis(p), open: html.classList.contains("coach-open"), view: VIEW, saved, fc: !document.getElementById("viewFc").hidden, ws: !document.getElementById("viewWs").hidden }; }, TAB);
// One finger dragged straight down from a point on the screen by dy pixels, as in tests/chat/shell.test.js; lift = false leaves it down.
const dragDown = async (page, [x, y], dy, lift = true) => { const s = await page.context().newCDPSession(page);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) { await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy*i/12 }] }); await page.waitForTimeout(16); }
  if (lift) await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); return s; };
const ptr = page => page.evaluate(() => +getComputedStyle(document.querySelector(".ptr")).opacity);
// The coach's calls to the backend (anything under /coach), and the page's tries at the real one (Bryan's workers.dev Worker).
const coachCalls = page => page.asked.filter(a => a.startsWith("/coach"));
const backends = page => page.tried.filter(u => /workers\.dev/.test(u));

class Skip extends Error {}

// GET /coach/me's answer for a signed-in surfer (getMe in chat/src/coach.js), o's fields over these; and a fake backend that gives it (or,
// with another status, the backend's refusal: 401 auth, 403 banned, else 503 break) besides /reports. The token the checks give the page
// is a stand-in: only the fake backend sees it.
const me = o => ({ left: 2, sent_left: 4, monthly: 2, month: "2030-11", next_month: Date.UTC(2030, 10, 30, 16), full_today: false, stop: null, profile: null,
  agreed: true, admin: false, reviews: [], account: "u-test", ...o });
const coachBackend = (o = {}, status = 200) => q => q.pathname === "/coach/me"
  ? { status, body: status === 200 ? me(o) : { error: status === 401 ? "auth" : status === 403 ? "banned" : "break" } }
  : { body: { reports: [], online: 0, last_id: 0 } };
const TOKEN = { "waveslave-chat-token": "test-token" };

// ---- New review (web/coach.js's flow), offline. flowBackend(o, {failFrame}) is a fake coach backend for it: GET /coach/me as me(o) (with a
// profile, so only the move is asked), POST /coach/reviews {id: ID}, each key frame's POST {ok}, GET /coach/reviews/<id> {status:
// "uploading", have}, and POST …/send {ok, left: 1}. failFrame {n, times} cuts the network on key frame n's first `times` POSTs. It notes
// each start's body (st.starts), each key frame POST's n and body or failed (st.frames), the GETs of the review and the sends. While
// st.refuse is {status, body}, each start is refused with it; POST /coach/agree answers {ok} (st.agrees counts them).
const ID = "a".repeat(22), PROFILE = { level: "turning_well", board: "shortboard", stance: "regular" };
function flowBackend(o = {}, { failFrame = null } = {}) {
  const st = { starts: [], frames: [], gets: 0, sends: 0, have: new Set(), tries: 0, refuse: null, agrees: 0 };
  st.backend = (q, req) => {
    const p = q.pathname, m = req.method(), frame = /^\/coach\/reviews\/[\w-]{22}\/frames\/(\d+)$/.exec(p);
    if (p === "/coach/me") return { body: me({ profile: PROFILE, ...o }) };
    if (p === "/coach/agree" && m === "POST") { st.agrees++; return { body: { ok: true } }; }
    if (p === "/coach/reviews" && m === "POST") { st.starts.push(req.postDataJSON()); if (st.refuse) return st.refuse; st.have.clear(); return { body: { id: ID } }; }
    if (frame && m === "POST") { const n = +frame[1];
      if (failFrame && n === failFrame.n && st.tries++ < failFrame.times) { st.frames.push({ n, failed: true }); return null; }
      st.frames.push({ n, body: req.postData() }); st.have.add(n); return { body: { ok: true } }; }
    if (/^\/coach\/reviews\/[\w-]{22}$/.test(p) && m === "GET") { st.gets++; return { body: { id: ID, status: "uploading", move: "top_turn", created: 0, have: [...st.have], note: null } }; }
    if (/^\/coach\/reviews\/[\w-]{22}\/send$/.test(p) && m === "POST") { st.sends++; return { body: { ok: true, left: 1 } }; }
    return { body: { reports: [], online: 0, last_id: 0 } };
  };
  return st;
}
// ---- The review (web/coach.js's review page), offline. reviewBackend(text, o) is a fake coach backend for it: GET /coach/me as me() with
// three reviews, one ready (RID) and two not reviewed (one held as not surf, one with o.note, a person's note); GET /coach/reviews/<RID>
// published, with text, its key frames' times (KEY_MS) and o.checked, or o.get when given (another answer); each of its key frames as a
// JPEG (Bryan's example's first), or what o.frame(n) answers in its place when it answers, noting each ask's number and Authorization
// (st.frames); POST …/report answering st.report (o.report at first) or {ok} (st.reports notes the bodies) and DELETE {ok} (st.deletes).
const JPEG = fs.readFileSync(path.join(ROOT, "web", "coach-example", "1.jpg"));
const RID = "r".repeat(22), KEY_MS = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 10000 + 250 * (i + 1)]));
const REVIEW_AT = Date.UTC(2030, 10, 2, 2);
function reviewBackend(text, { checked = true, note = "We couldn't see you. Try filming closer.", get = null, report = null, frame = null } = {}) {
  const st = { frames: [], reports: [], deletes: 0, report }, frameAnswer = frame;
  const reviews = [{ id: RID, move: "top_turn", created: REVIEW_AT, status: "ready", published: REVIEW_AT + 3600e3, note: null },
    { id: "n".repeat(22), move: "cutback", created: REVIEW_AT - 86400e3, status: "not_reviewed", published: null, note: "not_surf" },
    { id: "m".repeat(22), move: "popup", created: REVIEW_AT - 2 * 86400e3, status: "not_reviewed", published: null, note }];
  st.backend = (q, req) => {
    const p = q.pathname, m = req.method(), frame = new RegExp(`^/coach/reviews/${RID}/frames/(\\d+)$`).exec(p);
    if (p === "/coach/me") return { body: me({ profile: PROFILE, reviews }) };
    if (p === `/coach/reviews/${RID}` && m === "GET") return get || { body: { id: RID, status: "published", move: "top_turn", created: REVIEW_AT, have: Object.keys(KEY_MS).map(Number), note: null,
      review: { text, times: KEY_MS, checked } } };
    if (frame && m === "GET") { st.frames.push({ n: +frame[1], auth: req.headers().authorization || null }); return (frameAnswer && frameAnswer(+frame[1])) || { jpeg: JPEG }; }
    if (p === `/coach/reviews/${RID}/report` && m === "POST") { st.reports.push(req.postDataJSON()); return st.report || { body: { ok: true } }; }
    if (p === `/coach/reviews/${RID}` && m === "DELETE") { st.deletes++; return { body: { ok: true } }; }
    return { body: { reports: [], online: 0, last_id: 0 } };
  };
  return st;
}
// A published review's text, in the reply's shape: what went well at key frame 2, the main fix at 6, 7 and 8, the drill, and o over it.
const reviewText = o => ({ is_surf_clip: true, can_see_surfer: true, sexual_content: false, surfer_looks_under_18: false, unusable_frames: [],
  went_well: { frame: 2, title: "Low and ready going in", detail: "Both knees are bent going into the turn." },
  main_fix: { frames: [6, 7, 8], title: "Stay over your front foot", what: "Your weight slides back onto the tail.", why: "The board runs away from under you." },
  drill: { title: "Front-knee turns on the sand", how: "Turn your head and shoulders, push your front knee forward and hold." },
  heads_up: { text: "", move: "" }, progress: "", ...o });
// Opens the ready review from the list and waits for its four key frames, each a blob URL that has loaded.
async function openRid(page) {
  await page.tap(TAB); await inPanel(page, "the ready review", `[data-k="r-${RID}"]`); await page.click(`.coachpanel [data-k="r-${RID}"]`);
  await page.waitForFunction(() => { const i = [...document.querySelectorAll(".coachpanel .co-review img")]; return i.length === 4 && i.every(x => x.src.startsWith("blob:") && x.complete && x.naturalWidth > 0); },
    null, { timeout: 10e3 }).catch(e => { throw new Error(`waited for the review's four key frames: ${e.message.split("\n")[0]}`); });
}
// ---- Bryan's Drafts list (web/coach.js), offline. draftsBackend(waiting, o) is a fake backend for it: GET /coach/me as me() for the
// admin (or st.me in its place, while it's set); GET /admin/coach/drafts with st.waiting (drafted(id) gives a draft) and none handled (st.gets counts them); each POST
// /admin/coach/drafts/<id> noted (st.acts) and answered by o.act(id) when given (a promise holds it back), else {ok}; GET /admin/where as
// o.where (text/plain; st.wheres notes each ask's Authorization); and each key frame as a JPEG (st.frames notes `${id}:${n}`).
const DA = "A".repeat(22), DB = "B".repeat(22), DC = "C".repeat(22), TWELVE = Array.from({ length: 12 }, (_, i) => i + 1);
const SETTINGS = { autopilot: false, paused: false, stopped: false, spend: { usd: 1, stop: 78, reviews: 1 }, unchanged: { n: 0, of: 0 } };
const drafted = (id, o = {}) => ({ id, status: "drafted", move: "top_turn", lang: "en", uid: "u-surfer", hold: 0, redos: 0, waiting_since: REVIEW_AT, handled_at: null,
  answers: { level: "turning_well", board: "shortboard", stance: "regular", note: "" }, times: KEY_MS, frames: [], have: [2, 6, 7, 8], flags: [], warnings: [],
  redo_note: [], draft: reviewText({}), english: null, final: null, waited_ms: 3600e3, reported: false, ...o });
function draftsBackend(waiting, { act = null, where = { text: "room colo=NRT\ncoach colo=KIX\n" } } = {}) {
  const st = { waiting, gets: 0, acts: [], wheres: [], frames: [], me: null };
  st.backend = (q, req) => {
    const p = q.pathname, m = req.method(), a = /^\/admin\/coach\/drafts\/([\w-]{22})$/.exec(p), fr = /^\/coach\/reviews\/([\w-]{22})\/frames\/(\d+)$/.exec(p);
    if (p === "/coach/me") return st.me || { body: me({ admin: true, account: "u-bryan" }) };
    if (p === "/admin/coach/drafts" && m === "GET") { st.gets++; return { body: { waiting: st.waiting, handled: [], settings: SETTINGS } }; }
    if (a && m === "POST") { st.acts.push([a[1], req.postDataJSON()]); return act ? act(a[1]) : { body: { ok: true } }; }
    if (p === "/admin/where" && m === "GET") { st.wheres.push(req.headers().authorization || null); return where; }
    if (fr && m === "GET") { st.frames.push(`${fr[1]}:${fr[2]}`); return { jpeg: JPEG }; }
    return { body: { reports: [], online: 0, last_id: 0 } };
  };
  return st;
}
// The page's version of review r (verOf in web/coach.js), which Approve, Redo, Reject and Withdraw send as ver (ruling P59).
const verOf = r => [r.status, r.redos, r.waiting_since, r.handled_at].join("|");
// Scrolls the panel so review id's key frames are at the top of its view.
const toFrames = (page, id) => page.evaluate(id => { const b = document.querySelector(".coachpanel .co-body"), g = document.querySelector(`.coachpanel .co-dr[data-id="${id}"] .co-kfs`);
  b.scrollTop += g.getBoundingClientRect().top - b.getBoundingClientRect().top; }, id);
const BLOCKED = "This account can't use the coach.", BREAK = "Coach is taking a break. Try again later.", TOO_MANY = "Too many tries today. Try again tomorrow.";
const inPanel = (page, what, sel, timeout = 15e3) => page.waitForSelector(".coachpanel " + sel, { timeout }).catch(e => { throw new Error(`waited for ${what}: ${e.message.split("\n")[0]}`); });
const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(".coachpanel " + s); return e && !e.closest("[hidden]") ? e.textContent : null; }, sel);
// The video's displayed size, as the coach reads it.
const shown = page => page.evaluate(() => { const v = document.querySelector(".coachpanel video"); return { w: v.videoWidth, h: v.videoHeight }; });
// Where (x, y), in the video's displayed pixels, is on the screen in the frame shown for tapping yourself (zoomed or not).
const onScreen = (page, x, y) => page.evaluate(([x, y]) => { const r = document.querySelector(".coachpanel .co-zoom").getBoundingClientRect(), v = document.querySelector(".coachpanel .co-zoom video");
  return { x: r.left + x / v.videoWidth * r.width, y: r.top + y / v.videoHeight * r.height }; }, [x, y]);
// Taps yourself at (x, y) in the frame once it's ready for a tap.
async function tapAt(page, x, y) { await inPanel(page, "the frame, ready for a tap", ".co-frame[data-ready]"); const p = await onScreen(page, x, y); await page.touchscreen.tap(p.x, p.y); }
// Runs New review to the check screen (or the key frame it opens first): the Coach tab, New review, the clip, the move (the profile gives
// the rest), Next, the slider at `at` seconds and Here, and tapping yourself at (x, y) in the video's pixels, where the clip's white box
// is then. before(page) runs on Tap yourself before the tap.
async function toCheck(page, clip, { at, x, y, move = "top_turn", before = null }) {
  await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
  await page.setInputFiles('.coachpanel input[type="file"]', clip);
  await inPanel(page, "the questions", `[data-k="move-${move}"]`); await page.click(`.coachpanel [data-k="move-${move}"]`); await page.click('.coachpanel [data-k="next"]');
  await slideTo(page, at); await page.click('.coachpanel [data-k="here"]');
  if (before) await before(page);
  await tapAt(page, x, y);
  await inPanel(page, "the check screen", '.co-grid, [data-k="notin"]', 30e3);
}
// Moves the slider to `at` seconds, as a finger does, and waits for the clip to be there.
async function slideTo(page, at) {
  await inPanel(page, "the slider", '[data-k="slider"]:not([disabled])');
  await page.evaluate(t => { const r = document.querySelector('.coachpanel [data-k="slider"]'); r.value = String(t); r.dispatchEvent(new Event("input", { bubbles: true })); }, at);
  await page.waitForFunction(t => { const v = document.querySelector(".coachpanel video"); return !!v && !v.seeking && Math.abs(v.currentTime - t) < 0.02; }, at);
}
// The draft in IndexedDB (waveslave-coach, draft: "current", with the id and sent of "progress" when it's the same flow's and save's, and
// "progress" itself), with each key frame's blob as its size: null when there's none, or the error.
const draft = page => page.evaluate(() => new Promise(ok => { const q = indexedDB.open("waveslave-coach");
  q.onerror = () => ok({ error: String(q.error) });
  q.onsuccess = () => { const d = q.result; if (!d.objectStoreNames.contains("draft")) { d.close(); return ok(null); }
    const tx = d.transaction("draft"), g = tx.objectStore("draft").get("current"), p = tx.objectStore("draft").get("progress");
    tx.oncomplete = () => { const r = g.result, pr = p.result && r && p.result.flow === r.flow && p.result.stamp === r.stamp ? p.result : null; d.close();
      ok(r ? { ...r, frames: r.frames.map(f => ({ ...f, blob: f.blob instanceof Blob ? f.blob.size : null })), id: pr ? pr.id : null, sent: pr ? pr.sent : [], progress: p.result || null } : null); };
    tx.onerror = () => ok({ error: String(tx.error) }); }; }));
// Each key frame sent (base64 text), decoded in the page: its size, its bytes, and where its white pixels are (their count and centre).
const decode = (page, bodies) => page.evaluate(async bodies => Promise.all(bodies.map(async b => {
  const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0)), bm = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext("2d"); g.drawImage(bm, 0, 0);
  const d = g.getImageData(0, 0, bm.width, bm.height).data; let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { n++; sx += (i / 4) % bm.width; sy += Math.floor(i / 4 / bm.width); }
  return { w: bm.width, h: bm.height, bytes: bytes.length, white: n, cx: n ? sx / n : null, cy: n ? sy / n : null }; })), bodies);
// An init script noting every size given to a canvas (window.__canvases) and every drawImage of a video: the canvas's size and the
// numbers it was given (window.__draws).
function watchCanvas() {
  window.__canvases = []; window.__draws = []; const ids = new WeakMap(); let next = 0;
  const id = c => { if (!ids.has(c)) ids.set(c, next++); return ids.get(c); };
  for (const k of ["width", "height"]) { const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
    Object.defineProperty(HTMLCanvasElement.prototype, k, { configurable: true, get: d.get, set(v) { d.set.call(this, v); window.__canvases.push({ id: id(this), w: this.width, h: this.height }); } }); }
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (src, ...a) { if (src instanceof HTMLVideoElement) window.__draws.push({ id: id(this.canvas), cw: this.canvas.width, ch: this.canvas.height, a }); return draw.call(this, src, ...a); };
}
// An init script noting each value given to a progress bar, with its max (window.__bar).
function watchBar() { window.__bar = []; const d = Object.getOwnPropertyDescriptor(HTMLProgressElement.prototype, "value");
  Object.defineProperty(HTMLProgressElement.prototype, "value", { configurable: true, get: d.get, set(v) { d.set.call(this, v); window.__bar.push([this.value, this.max]); } }); }
// Waits up to 10 s for check() to come true, and says what it waited for when it doesn't.
async function soon(what, check) { for (let i = 0; i < 100; i++) { if (await check()) return; await wait(100); } throw new Error(`waited 10 s for ${what}`); }
// An init script noting each play() and pause() of a video (window.__media).
function watchMedia() { window.__media = []; for (const k of ["play", "pause"]) { const f = HTMLMediaElement.prototype[k];
  HTMLMediaElement.prototype[k] = function () { window.__media.push(k); return f.apply(this, arguments); }; } }
// The white box's centre at t seconds in a clips.js clip w x h of secs seconds (before any turn): it slides left to right, halfway down.
const boxAt = (w, h, secs, t) => ({ x: (w - Math.floor(w / 14)) * t / secs + Math.floor(w / 14) / 2, y: h / 2 });
const SENT = "Sent. Your feedback comes within a day.", NEED8 = "We need you in at least 8 key frames. Try a clip filmed closer.", FAILED = "Couldn't send. Tap to try again.";
const GETTING = "Getting your clip ready… this can take a minute.", LENGTH = "Pick a clip between 3 seconds and 2 minutes. Slow-motion clips count at their slowed length.";
const CANT = "This phone can't open that clip. Try another, or open waveslave.tw in your phone's own browser.";
// Two fingers spread from 60 px apart to 120 px about the middle of the frame shown for tapping yourself: a pinch to 2x. Resolves to its
// zoom (the frame's transform).
async function pinch(page) {
  const m = await page.evaluate(() => { const r = document.querySelector(".coachpanel .co-frame").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const s = await page.context().newCDPSession(page), at = d => [{ x: m.x - d, y: m.y, id: 1 }, { x: m.x + d, y: m.y, id: 2 }];
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(30) });
  for (let i = 1; i <= 10; i++) { await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(30 + 3 * i) }); await page.waitForTimeout(16); }
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await s.detach();
  return page.evaluate(() => document.querySelector(".coachpanel .co-zoom").style.transform);
}

const CHECKS = {
  // The test clips (tests/coach/clips.js), read the way the coach will read them: picked in an <input type="file"> and played from an
  // object URL. The white box is found at 10% and at 90% of the clip, where it should be: halfway down, its left edge at (w - box) x
  // that fraction. The rotate: 90 copy shows turned, 360x640, the box climbing from the bottom to the top.
  async makeClip(open, { blank, tmp }) {
    const plain = makeClip(tmp, { w: 640, h: 360, secs: 6 }), turned = makeClip(tmp, { w: 640, h: 360, secs: 6, rotate: 90 });
    const page = await blank(); await page.setContent('<input type="file" accept="video/*">');
    const find = async clip => { await page.setInputFiles("input", clip); return page.evaluate(async () => {
      const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(document.querySelector("input").files[0]);
      await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error(`the clip didn't open (error ${v.error && v.error.code})`)); });
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; const g = c.getContext("2d", { willReadFrequently: true }), at = [];
      for (const f of [0.1, 0.9]) {
        const drawn = new Promise(ok => { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => ok()); setTimeout(ok, 500); });
        v.currentTime = v.duration * f; await new Promise(ok => { v.onseeked = ok; }); await drawn;
        g.drawImage(v, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const k = 4 * (y * c.width + x); if (d[k] > 200 && d[k + 1] > 200 && d[k + 2] > 200) { sx += x; sy += y; n++; } }
        at.push(n ? { x: sx / n, y: sy / n, n } : null);
      }
      URL.revokeObjectURL(v.src); return { w: v.videoWidth, h: v.videoHeight, secs: v.duration, at }; }); };
    // The box is 45x40 on a 640x360 clip; its centre at fraction f is ((640 - 45) f + 22, 180), give or take a frame and VP9's edges.
    const centre = f => (640 - 45) * f + 22, near = (a, b) => Math.abs(a - b) <= 6;
    const a = await find(plain);
    if (a.w !== 640 || a.h !== 360 || Math.abs(a.secs - 6) > 0.05) throw new Error(`the clip is ${a.w}x${a.h}, ${a.secs} s, want 640x360, 6 s`);
    if (!a.at.every(Boolean) || !near(a.at[0].x, centre(0.1)) || !near(a.at[1].x, centre(0.9)) || !a.at.every(p => near(p.y, 180)))
      throw new Error(`the box is at ${JSON.stringify(a.at)}, want (${centre(0.1)}, 180) then (${centre(0.9)}, 180)`);
    const b = await find(turned);
    if (b.w !== 360 || b.h !== 640) throw new Error(`the rotate: 90 clip shows ${b.w}x${b.h}, want 360x640`);
    if (!b.at.every(Boolean) || !near(b.at[0].y, 639 - centre(0.1)) || !near(b.at[1].y, 639 - centre(0.9)) || !b.at.every(p => near(p.x, 180)))
      throw new Error(`in the rotate: 90 clip the box is at ${JSON.stringify(b.at)}, want (180, ${639 - centre(0.1)}) then (180, ${639 - centre(0.9)})`);
  },
  // Developer mode off: no Coach tab, COACH.open() does nothing, and nothing is asked of any backend, at load or on coming back to the page,
  // even signed in (a session token kept). With the chat also off for everyone the page asks nothing at all; with the chat opened to
  // everyone (window.__chatPublic, as it will be before the coach goes live) the chat asks for its reports and the coach still asks nothing.
  async devOff(open) {
    for (const pub of [false, true]) {
      const page = await open({ world: false, pub, store: TOKEN }); await wait(300);
      await page.evaluate(() => { window.COACH.open(); document.dispatchEvent(new Event("visibilitychange")); }); await wait(300); const l = await look(page);
      if (l.tab || l.panel || l.open) throw new Error(`developer mode off${pub ? ", the chat public" : ""}: the tab is ${l.tab ? "there" : "hidden"} and COACH.open() ${l.panel || l.open ? "opened" : "didn't open"} the panel`);
      const want = pub ? ["/reports?spot=donghe"] : [];
      if (!eq(page.asked, want) || backends(page).length) throw new Error(`developer mode off${pub ? ", the chat public" : ""}: the page asked the backend for ${JSON.stringify(page.asked)} and tried ${backends(page).join(", ") || "no other"}`);
    }
  },
  // Developer mode on, on a Taiwan spot: the tab is there, after Forecast and Map, reading Coach, unpicked, with no data-zh or data-ja
  // (coach.js writes its words itself). In 中文 it reads 教練; in 日本語, which the coach doesn't carry, Coach. It asks the backend nothing.
  async devOn(open) {
    const page = await open({}); await wait(300); let l = await look(page);
    if (!l.tab || l.text !== "Coach" || l.picked.join() !== "fc") throw new Error(`in developer mode the tab is ${l.tab ? "there" : "hidden"}, reads ${JSON.stringify(l.text)}, picked ${l.picked}`);
    const order = await page.evaluate(() => [...document.querySelectorAll(".tabs button")].map(b => b.dataset.v));
    if (!eq(order, ["fc", "ws", "coach"])) throw new Error(`the tabs are ${order}, want fc, ws, coach`);
    const tagged = await page.evaluate(s => { const t = document.querySelector(s); return [...t.attributes].map(a => a.name).filter(n => /^data-(zh|ja)/.test(n)); }, TAB);
    if (tagged.length) throw new Error(`the tab carries ${tagged.join(", ")}`);
    for (const [lang, want] of [["zh", "教練"], ["ja", "Coach"], ["en", "Coach"]]) {
      await page.evaluate(l => setLang(l), lang); await settle(page); l = await look(page);
      if (l.text !== want || !l.tab) throw new Error(`in ${lang} the tab reads ${JSON.stringify(l.text)}${l.tab ? "" : " and is hidden"}, want ${want}`);
    }
    if (coachCalls(page).length) throw new Error(`the coach asked the backend for ${coachCalls(page).join(", ")}`);
  },
  // Leaving developer mode (the W) takes the tab away at once and shuts an open panel; coming back (PIN in) brings the tab back.
  async devToggle(open) {
    const page = await open({}); await wait(300);
    await page.tap(TAB); await settle(page);
    if (!(await look(page)).open) throw new Error("the tab didn't open the panel");
    await page.evaluate(() => setWorld(false)); await settle(page); let l = await look(page);
    if (l.tab || l.panel || l.open) throw new Error(`out of developer mode the tab is ${l.tab ? "there" : "hidden"} and the panel ${l.panel || l.open ? "open" : "shut"}`);
    await page.evaluate(() => { sessionStorage.setItem("waveslave-unlock", window.__lockHash); return setWorld(true); }); await settle(page); l = await look(page);
    if (!l.tab || l.panel) throw new Error(`back in developer mode the tab is ${l.tab ? "there" : "hidden"} and the panel ${l.panel ? "open" : "shut"}`);
  },
  // Away from Taiwan there's no tab: a Japan spot in World mode has none, Taiwan brings it back, Japan takes it away again.
  async notTaiwan(open) {
    const page = await open({ spot: "shonan" }); await wait(300);
    if ((await look(page)).tab) throw new Error(`on ${await page.evaluate(() => CUR)} there's a Coach tab`);
    await page.evaluate(() => switchCountry("tw")); await settle(page); await wait(300);
    if (!(await look(page)).tab) throw new Error(`back on ${await page.evaluate(() => CUR)} in Taiwan there's no Coach tab`);
    await page.evaluate(() => switchCountry("jp")); await settle(page); await wait(300);
    if ((await look(page)).tab) throw new Error(`on ${await page.evaluate(() => CUR)} there's a Coach tab`);
  },
  // The coach needs the chat (its sign-in is the chat's): with chat.js missing, or switched off with the backend address (window.__chatUrl
  // ""), there's no tab. With the address empty coach.js is off too: no window.COACH. The page draws either way.
  async noChat(open) {
    for (const [what, o] of [["chat.js missing", { chatJs: null }], ["the address empty", { url: "" }]]) {
      const page = await open(o); await wait(300); const l = await look(page);
      const s = await page.evaluate(() => ({ chat: !!window.CHAT, coach: !!window.COACH, h: document.getElementById("nowH1").textContent, days: document.querySelectorAll("#days .day").length }));
      if (l.tab || s.chat) throw new Error(`${what}: the tab is ${l.tab ? "there" : "hidden"}, window.CHAT ${s.chat ? "set" : "unset"}`);
      if (o.url === "" && s.coach) throw new Error("with the address empty window.COACH is set");
      if (s.h === "–" || !s.days) throw new Error(`${what}: the page didn't draw (${JSON.stringify(s)})`);
      if (page.asked.length || backends(page).length) throw new Error(`${what}: the page asked ${JSON.stringify(page.asked)} and tried ${backends(page).join(", ")}`);
    }
  },
  // With coach.js missing the page works as before: no tab, the tabs still switch the view, and the chat's button is there.
  async noCoachJs(open) {
    const page = await open({ coachJs: null }); await wait(300); let l = await look(page);
    if (l.tab || await page.evaluate(() => !!window.COACH)) throw new Error(`without coach.js the tab is ${l.tab ? "there" : "hidden"}`);
    if (!await page.evaluate(() => !!document.querySelector(".chatfab") && getComputedStyle(document.querySelector(".chatfab")).display !== "none")) throw new Error("without coach.js there's no CHAT button");
    await page.tap('.tabs button[data-v="ws"]'); await page.waitForFunction(() => VIEW === "ws" && !document.getElementById("viewWs").hidden); l = await look(page);
    if (l.picked.join() !== "ws" || l.saved !== "ws") throw new Error(`without coach.js the Map tab left ${JSON.stringify(l)}`);
  },
  // Tapping the tab opens the full-screen panel (over everything, z-index 110) and sets html.coach-open, and leaves the Forecast/Map pill,
  // the view and the saved view (waveslave-view) as they were. ✕ shuts it and gives the focus back to the tab.
  async opens(open) {
    const page = await open({}); await wait(300);
    const pill = () => page.evaluate(() => { const p = document.querySelector(".tabs .glide-pill"); return p && [p.style.transform, p.style.width]; });
    const before = await pill();
    await page.tap(TAB); await wait(400); await settle(page); const l = await look(page);
    if (!l.panel || !l.open) throw new Error(`the tab left the panel ${l.panel ? "shown" : "hidden"} and html.coach-open ${l.open ? "set" : "unset"}`);
    if (l.picked.join() !== "fc" || l.view !== "fc" || l.saved !== "fc" || !l.fc || !eq(await pill(), before)) throw new Error(`the tab moved the pill or the view: ${JSON.stringify({ ...l, pill: await pill(), before })}`);
    const box = await page.evaluate(() => { const p = document.querySelector(".coachpanel"), r = p.getBoundingClientRect(), cs = getComputedStyle(p);
      return { r: [r.left, r.top, r.width, r.height], z: cs.zIndex, pos: cs.position, role: p.getAttribute("role"), modal: p.getAttribute("aria-modal"), top: document.elementFromPoint(195, 600) && p.contains(document.elementFromPoint(195, 600)),
        title: (document.getElementById(p.getAttribute("aria-labelledby")) || {}).textContent }; });
    if (!eq(box.r, [0, 0, 390, 844]) || box.z !== "110" || box.pos !== "fixed" || !box.top) throw new Error(`the panel is ${JSON.stringify(box)}, want the whole 390x844 screen, fixed, z-index 110, on top`);
    if (box.role !== "dialog" || box.modal !== "true" || box.title !== "COACH") throw new Error(`the panel is ${JSON.stringify(box)}, want a modal dialog titled COACH`);
    await page.tap(".coachpanel .co-x"); await settle(page);
    const shut = await look(page), focus = await page.evaluate(s => document.activeElement === document.querySelector(s), TAB);
    if (shut.panel || shut.open || !shut.tab || shut.view !== "fc") throw new Error(`after ✕: ${JSON.stringify(shut)}`);
    if (!focus) throw new Error("after ✕ the focus isn't back on the tab");
  },
  // From the map (the saved view the Map), COACH.open() switches to Forecast first, as the chat's room does, and the panel opens over it.
  async fromMap(open) {
    const page = await open({ view: "ws" }); await page.waitForFunction(() => VIEW === "ws" && !document.getElementById("viewWs").hidden);
    await page.evaluate(() => window.COACH.open()); await settle(page); await wait(300); const l = await look(page);
    if (l.view !== "fc" || !l.fc || l.ws || l.picked.join() !== "fc") throw new Error(`from the map COACH.open() left ${JSON.stringify(l)}`);
    if (!l.panel || !l.open) throw new Error(`from the map the panel is ${l.panel ? "shown" : "hidden"} and html.coach-open ${l.open ? "set" : "unset"}`);
  },
  // With the panel open Escape shuts the panel, and only the panel: with the full-screen map behind it the map stays. template.html's own
  // guard: while html.coach-open is set Escape doesn't close the map (and does once it's gone).
  async escape(open) {
    const page = await open({}); await wait(300);
    await page.tap(TAB); await settle(page);
    await page.keyboard.press("Escape"); await settle(page); let l = await look(page);
    if (l.panel || l.open) throw new Error("Escape didn't shut the panel");
    await page.evaluate(() => window.COACH.open()); await settle(page);
    await page.evaluate(() => setView("ws", true)); await settle(page);
    await page.keyboard.press("Escape"); await settle(page); l = await look(page);
    if (l.panel || l.open || l.view !== "ws") throw new Error(`with the map behind the panel, Escape left the panel ${l.panel ? "open" : "shut"} and the view ${l.view}`);
    await page.evaluate(() => document.documentElement.classList.add("coach-open")); await page.keyboard.press("Escape"); await settle(page);
    if (await page.evaluate(() => VIEW) !== "ws") throw new Error("Escape closed the map while html.coach-open is set");
    await page.evaluate(() => document.documentElement.classList.remove("coach-open")); await page.keyboard.press("Escape"); await settle(page);
    if (await page.evaluate(() => VIEW) !== "fc") throw new Error("Escape doesn't close the map with the coach shut (the check itself is off)");
  },
  // With the panel open a pull from the top starts no refresh; shut, it does.
  async pullToRefresh(open) {
    const page = await open({}); await wait(300);
    await page.evaluate(() => scrollTo(0, 0)); await page.tap(TAB); await settle(page);
    let s = await dragDown(page, [200, 200], 60, false); await settle(page); const shut = await ptr(page);
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await settle(page);
    if (!(await look(page)).open) throw new Error("the pull shut the panel");
    await page.keyboard.press("Escape"); await settle(page); await wait(300);
    s = await dragDown(page, [200, 200], 60, false); await settle(page); const shown = await ptr(page);
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    if (shut !== 0) throw new Error(`a pull with the panel open shows the refresh sign (opacity ${shut})`);
    if (!(shown > 0)) throw new Error("a pull with the panel shut doesn't show the refresh sign (the check itself is off)");
  },
  // With the panel open the CHAT button does nothing: a tap where it is lands on the panel, and Tab keeps the focus inside the panel, so
  // the room is never asked to open. Enter on the panel's ✕ shuts it; shut, the button opens the room.
  async chatButton(open) {
    const page = await open({}); await wait(300);
    const fab = await page.locator(".chatfab").boundingBox(); if (!fab) throw new Error("there's no CHAT button to check with");
    await page.tap(TAB); await settle(page);
    await page.touchscreen.tap(fab.x + fab.width / 2, fab.y + fab.height / 2); await settle(page);
    for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); const inside = await page.evaluate(() => document.querySelector(".coachpanel").contains(document.activeElement));
      if (!inside) throw new Error(`Tab ${i + 1} took the focus out of the panel, to ${await page.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 80))}`); }
    await page.focus(".coachpanel .co-x"); await page.keyboard.press("Enter"); await settle(page);
    let s = await page.evaluate(() => ({ opened: window.CHAT._opened.length, room: document.documentElement.classList.contains("chat-open") }));
    if (s.opened || s.room) throw new Error(`with the panel open the CHAT button opened the room (${JSON.stringify(s)})`);
    if ((await look(page)).open) throw new Error("Enter on ✕ didn't shut the panel");
    await page.touchscreen.tap(fab.x + fab.width / 2, fab.y + fab.height / 2); await settle(page);
    s = await page.evaluate(() => ({ opened: window.CHAT._opened.length, room: document.documentElement.classList.contains("chat-open") }));
    if (s.opened !== 1 || !s.room) throw new Error(`with the panel shut the CHAT button didn't open the room (${JSON.stringify(s)}; the check itself is off)`);
  },
  // COACH.open() while the page is still loading, before coach.js has started (as when chat.js finishes a sign-in for the coach during its
  // own start-up, here from the end of the chat.js served), isn't dropped: the panel opens once coach.js starts. With the coach off for
  // this visitor (developer mode off, the chat public), the same early COACH.open() leaves the panel shut.
  async earlyOpen(open) {
    const chatJs = CHAT_JS + "\n;window.COACH.open();\n";
    let page = await open({ chatJs }); await wait(300); let l = await look(page);
    if (!l.panel || !l.open || l.view !== "fc") throw new Error(`COACH.open() before coach.js started left ${JSON.stringify(l)}`);
    page = await open({ chatJs, world: false, pub: true }); await wait(300); l = await look(page);
    if (l.tab || l.panel || l.open) throw new Error(`with the coach off, COACH.open() before coach.js started left ${JSON.stringify(l)}`);
  },
  // Review Focus 3: the month the panel names is the server's, whatever the phone's clock says. At 23:59 on 31 October in Taiwan by the
  // phone, with GET /coach/me answering for November (month "2030-11", as a review sent a minute later counts), the panel says "2 of 2
  // reviews left in November", and 「11月還剩 2 次講評（共 2 次）」 in 中文. At the year's turn the list's dates follow the server's year too:
  // at 23:59 on 31 December 2030 by the phone, with the server in January 2031, a review from that evening is dated "31 December 2030".
  async monthFromServer(open) {
    let page = await open({ clock: Date.UTC(2030, 9, 31, 15, 59), store: TOKEN, backend: coachBackend({ month: "2030-11" }) }); await wait(300);
    const phone = await page.evaluate(() => new Date(Date.now() + 8 * 3600e3).getUTCMonth() + 1);
    if (phone !== 10) throw new Error(`in Taiwan the phone's clock says month ${phone}, want 10 (the check itself is off)`);
    await page.tap(TAB); await page.waitForFunction(() => !!document.querySelector(".coachpanel .co-left"), null, { timeout: 5000 }).catch(() => {});
    const line = () => page.evaluate(() => { const e = document.querySelector(".coachpanel .co-left"); return e && e.textContent; });
    let l = await line();
    if (l !== "2 of 2 reviews left in November") throw new Error(`the panel says ${JSON.stringify(l)}, want "2 of 2 reviews left in November"`);
    await page.evaluate(() => setLang("zh")); await settle(page); l = await line();
    if (l !== "11月還剩 2 次講評（共 2 次）") throw new Error(`in 中文 the panel says ${JSON.stringify(l)}, want "11月還剩 2 次講評（共 2 次）"`);
    const sent = Date.UTC(2030, 11, 31, 15, 0), review = { id: "y".repeat(22), move: "cutback", created: sent, status: "reviewing", published: null, note: null };
    page = await open({ clock: Date.UTC(2030, 11, 31, 15, 59), store: TOKEN, backend: coachBackend({ month: "2031-01", reviews: [review] }) }); await wait(300);
    await page.tap(TAB); await page.waitForFunction(() => !!document.querySelector(".coachpanel .co-list .co-date"), null, { timeout: 5000 }).catch(() => {});
    const date = await page.evaluate(() => { const e = document.querySelector(".coachpanel .co-list .co-date"); return e && e.textContent; });
    if (date !== "31 December 2030") throw new Error(`with the server in January 2031, a review from 31 December 2030 is dated ${JSON.stringify(date)}`);
  },
  // Signed in, the coach asks GET /coach/me once as the page loads, with the session token, and again on coming back to the page only
  // once a minute has gone by, as the chat asks for its reports. A review ready since this phone last opened one (waveslave-coach-seen)
  // puts a dot on the Coach tab with the panel shut; once opened it doesn't.
  async meAsks(open) {
    const T = Date.UTC(2030, 5, 1), ready = { id: "r".repeat(22), move: "top_turn", created: T - 3600e3, status: "ready", published: T, note: null }, heard = [];
    const backend = (q, req) => { if (q.pathname === "/coach/me" && req.method() === "GET") heard.push(req.headers().authorization || null); return coachBackend({ reviews: [ready] })(q); };
    const dot = page => page.evaluate(s => { const t = document.querySelector(s); return t.classList.contains("co-dot") && getComputedStyle(t, "::after").content !== "none"; }, TAB);
    let page = await open({ skew: true, store: TOKEN, backend }); await wait(300);
    if (!eq(heard, ["Bearer test-token"])) throw new Error(`at load the coach asked GET /coach/me with ${JSON.stringify(heard)}, want once with the token`);
    if (!await dot(page) || (await look(page)).open) throw new Error(`with a review ready and not yet opened, the tab has ${await dot(page) ? "a" : "no"} dot (the panel ${(await look(page)).open ? "open" : "shut"})`);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await wait(300);
    if (heard.length !== 1) throw new Error(`coming back within the minute asked again (${heard.length} asks)`);
    await page.evaluate(() => { window.__skew(61e3); document.dispatchEvent(new Event("visibilitychange")); }); await wait(300);
    if (heard.length !== 2) throw new Error(`coming back after a minute asked ${heard.length - 1} more times, want once`);
    page = await open({ store: { ...TOKEN, "waveslave-coach-seen": String(T) }, backend: coachBackend({ reviews: [ready] }) }); await wait(300);
    if (await dot(page)) throw new Error("a review this phone has already opened still puts a dot on the tab");
  },
  // Opening a ready review clears the dot even where localStorage won't keep waveslave-coach-seen (its setItem throws): for this page load.
  async seenNoStorage(open) {
    const T = Date.UTC(2030, 5, 1), ready = { id: "r".repeat(22), move: "top_turn", created: T - 3600e3, status: "ready", published: T, note: null };
    const page = await open({ store: TOKEN, backend: coachBackend({ reviews: [ready] }) }); await wait(300);
    const dot = () => page.evaluate(s => document.querySelector(s).classList.contains("co-dot"), TAB);
    if (!await dot()) throw new Error("no dot for the ready review (the check itself is off)");
    await page.evaluate(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === "waveslave-coach-seen") throw new Error("full"); return set.call(this, k, v); }; });
    await page.tap(TAB); await page.waitForFunction(() => !!document.querySelector(".coachpanel .co-list button"), null, { timeout: 5000 }).catch(() => {});
    await page.click(".coachpanel .co-list button"); await page.tap(".coachpanel .co-x"); await settle(page);
    if (await dot()) throw new Error("with localStorage refusing waveslave-coach-seen, opening the review left the dot");
  },
  // Tab goes through every control in the signed-in panel, How to film's line included, and wraps round: ✕, How to film, the 18+ tick,
  // I agree, and back to ✕.
  async tabTrap(open) {
    const page = await open({ store: TOKEN, backend: coachBackend({ agreed: false }) }); await wait(300);
    await page.tap(TAB); await page.waitForFunction(() => !!document.querySelector('.coachpanel [data-k="agree"]'), null, { timeout: 5000 }).catch(() => {});
    const went = [];
    for (let i = 0; i < 5; i++) { await page.keyboard.press("Tab");
      went.push(await page.evaluate(() => { const a = document.activeElement; return a.classList.contains("co-x") ? "x" : a.getAttribute("data-k") || a.tagName.toLowerCase(); })); }
    if (!eq(went, ["x", "film", "adult", "agree", "x"])) throw new Error(`Tab went ${went.join(" → ")}, want x → film → adult → agree → x`);
  },
  // A ?coach=drafts link whose GET /coach/me fails (here 503) opens the panel once: shut, it stays shut when the page draws again (a new
  // language, the spot drawn again).
  async draftsOnce(open) {
    const page = await open({ query: "?coach=drafts", store: TOKEN, backend: coachBackend({}, 503) }); await wait(300);
    await page.waitForFunction(() => !!document.querySelector('.coachpanel [data-k="retry"]'), null, { timeout: 5000 }).catch(() => {});
    let l = await look(page);
    if (!l.open || /coach=drafts/.test(await page.evaluate(() => location.href))) throw new Error(`?coach=drafts left the panel ${l.open ? "open" : "shut"} at ${await page.evaluate(() => location.href)}`);
    await page.tap(".coachpanel .co-x"); await settle(page);
    await page.evaluate(() => { setLang("zh"); window.COACH.spot(CUR); window.COACH.relang(); window.COACH.dev(); }); await settle(page); await wait(300); l = await look(page);
    if (l.open || l.panel) throw new Error("after ✕, drawing the page again opened the panel again");
  },
  // A token the backend refuses (401 auth) goes back through CHAT.token(old), which signs out quietly, and the panel shows the signed-out
  // view with Sign in with LINE.
  async refused(open) {
    const page = await open({ store: TOKEN, backend: coachBackend({}, 401) }); await wait(300);
    await page.tap(TAB); await page.waitForFunction(() => !!document.querySelector(".coachpanel .co-signin"), null, { timeout: 5000 }).catch(() => {});
    const st = await page.evaluate(() => ({ kept: localStorage.getItem("waveslave-chat-token"), signIn: !!document.querySelector(".coachpanel .co-signin"), left: !!document.querySelector(".coachpanel .co-left") }));
    if (st.kept !== null || !st.signIn || st.left) throw new Error(`after a 401: ${JSON.stringify(st)}, want the token gone and Sign in with LINE`);
  },
  // ---- New review (AI coach spec, "New review"), offline, its calls answered by flowBackend().
  // Review Focus 1, a portrait clip and one tagged to be shown turned (360x640 as the browser reports both): every box sent lies inside
  // the reported size, and every close-up is a 784x784 JPEG of at most 100 KB with the white box (the surfer) in its middle. The video is
  // only ever drawn whole into a canvas of a quarter of its size, or as the box into a 784x784 one, and no canvas is ever given a size over
  // 784x784 or a quarter of the frame. The turned clip's frame is pinched to 2x before the tap, which still lands on the box.
  async portrait(open, { tmp }) {
    const LANDS = 3; // the tap may land this far off (in the video's pixels) once the touch's place is rounded to the screen's
    for (const [what, clip, at, box, pinched] of [["a 360x640 clip", makeClip(tmp, { w: 360, h: 640, secs: 6 }), 3, boxAt(360, 640, 6, 3), false],
      ["the rotate: 90 clip", makeClip(tmp, { w: 640, h: 360, secs: 6, rotate: 90 }), 3, { x: 180, y: 639 - boxAt(640, 360, 6, 3).x }, true]]) {
      const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend, init: [watchCanvas] });
      let zoom = null;
      await toCheck(page, clip, { at, x: box.x, y: box.y, before: pinched ? async p => { zoom = await pinch(p); } : null });
      if (pinched && !/scale\(2\)/.test(zoom || "")) throw new Error(`${what}: the pinch left the frame at ${JSON.stringify(zoom)}, want scale(2)`);
      const size = await shown(page), d = await draft(page);
      if (size.w !== 360 || size.h !== 640) throw new Error(`${what}: the coach reads it as ${size.w}x${size.h}, want 360x640`);
      if (!d || !d.tap || Math.abs(d.tap.x - box.x) > LANDS || Math.abs(d.tap.y - box.y) > LANDS) throw new Error(`${what}: the tap landed at ${JSON.stringify(d && d.tap)}, want about (${box.x}, ${box.y})`);
      const lost = d.frames.filter(f => f.lost).map(f => f.n);
      if (lost.length) throw new Error(`${what}: the tracker lost the box in key frames ${lost}`);
      await page.click('.coachpanel [data-k="send"]'); await inPanel(page, `"${SENT}"`, ".co-ok");
      const frames = st.starts.length === 1 ? st.starts[0].frames : [];
      if (!eq(frames.map(f => f.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) throw new Error(`${what}: the review started with key frames ${JSON.stringify(frames.map(f => f.n))}`);
      const out = frames.filter(f => !(f.box[0] >= 0 && f.box[1] >= 0 && f.box[2] > 0 && f.box[0] + f.box[2] <= size.w && f.box[1] + f.box[2] <= size.h));
      if (out.length) throw new Error(`${what}: boxes outside ${size.w}x${size.h}: ${JSON.stringify(out)}`);
      const crops = await decode(page, st.frames.filter(f => !f.failed).map(f => f.body));
      const bad = crops.filter(c => c.w !== 784 || c.h !== 784 || c.bytes > 102400 || c.white < 500 || !(c.cx > 157 && c.cx < 627 && c.cy > 157 && c.cy < 627));
      if (crops.length !== 12 || bad.length) throw new Error(`${what}: ${crops.length} close-ups sent, these not 784x784 within 100 KB with the box in the middle: ${JSON.stringify(bad)}`);
      const q = { w: Math.round(size.w / 4), h: Math.round(size.h / 4) }, seen = await page.evaluate(() => ({ sizes: window.__canvases, draws: window.__draws }));
      const big = seen.sizes.filter(({ w, h }) => !((w <= 784 && h <= 784) || (w <= q.w && h <= q.h)));
      if (!seen.sizes.length || big.length) throw new Error(`${what}: canvases sized ${JSON.stringify(big)} (of ${seen.sizes.length})`);
      // The video is drawn into exactly two canvases, each kept for it: one only ever given a quarter of the frame's size, one only ever
      // 784 x 784 (a canvas starts at 300 x 150, so as its width is set first it's briefly that width by 150).
      const used = [...new Set(seen.draws.map(d => d.id))], sized = used.map(id => seen.sizes.filter(c => c.id === id));
      const finals = sized.map(all => all.length ? [all[all.length - 1].w, all[all.length - 1].h] : null), want = [[q.w, q.h], [784, 784]];
      const stray = sized.flatMap((all, i) => finals[i] ? all.filter(c => ![300, finals[i][0]].includes(c.w) || ![150, finals[i][1]].includes(c.h)) : []);
      if (used.length !== 2 || !eq(finals.map(String).sort(), want.map(String).sort()) || stray.length)
        throw new Error(`${what}: the video went into ${used.length} canvases, sized ${JSON.stringify(sized.map(a => a.map(c => [c.w, c.h])))}, want one of ${q.w}x${q.h} and one of 784x784`);
      const odd = seen.draws.filter(({ cw, ch, a }) => !(a.length === 4 && cw === q.w && ch === q.h && eq(a, [0, 0, q.w, q.h])
        || a.length === 8 && cw === 784 && ch === 784 && eq(a.slice(4), [0, 0, 784, 784]) && a[2] === a[3] && a[0] >= 0 && a[1] >= 0 && a[0] + a[2] <= size.w && a[1] + a[3] <= size.h));
      if (seen.draws.length < 24 || odd.length) throw new Error(`${what}: ${seen.draws.length} drawImage calls of the video, these not as they should be: ${JSON.stringify(odd.slice(0, 3))}`);
    }
  },
  // The tracker loses the surfer (the white box) on key frame 9, at 3.0 s, where the clip's box is gone: the check screen opens at that
  // frame first, asking for a tap; the tap keeps it, with its box round the tap, and as no other was lost the 12 close-ups show. "Not in
  // this one" on 4 of them leaves 8 and Send on; on a 5th, Send is off with the 8-frame line, and nothing is sent.
  async lostFirst(open, { tmp }) {
    const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend }), b = boxAt(640, 360, 6, 2.5), c = boxAt(640, 360, 6, 3);
    await toCheck(page, makeClip(tmp, { gap: [2.9, 3.1] }), { at: 2.5, x: b.x, y: b.y });
    const first = { head: await text(page, '[data-k="fh"]'), line: await text(page, ".co-flow > p"), notIn: await text(page, '[data-k="notin"]'), grid: !!await page.$(".coachpanel .co-grid") };
    if (!eq(first, { head: "Key frame at 0:03.0", line: "We lost you here. Tap yourself.", notIn: "Not in this one", grid: false })) throw new Error(`the check screen opened at ${JSON.stringify(first)}`);
    await tapAt(page, c.x, c.y); await inPanel(page, "the 12 close-ups", ".co-grid");
    const grid = await page.evaluate(() => ({ n: document.querySelectorAll(".coachpanel .co-tile").length, lost: document.querySelectorAll(".coachpanel .co-tile.co-lost").length }));
    const nine = ((await draft(page)) || { frames: [] }).frames[8], want = [Math.round(c.x) - 60, Math.round(c.y) - 60, 120];
    if (grid.n !== 12 || grid.lost || !nine || nine.lost || nine.box.some((v, i) => Math.abs(v - want[i]) > 3)) throw new Error(`after the tap: ${JSON.stringify(grid)}, key frame 9 ${JSON.stringify(nine && { box: nine.box, lost: nine.lost })}, want its box about ${want}`);
    for (const n of [1, 2, 3, 4, 5]) {
      await page.click(`.coachpanel [data-k="kf-${n}"]`); await inPanel(page, `key frame ${n} opened`, '[data-k="notin"]'); await page.click('.coachpanel [data-k="notin"]'); await inPanel(page, "the 12 close-ups", ".co-grid");
      const s = await page.evaluate(() => ({ off: document.querySelector('.coachpanel [data-k="send"]').disabled, lines: [...document.querySelectorAll(".coachpanel .co-err")].map(e => e.textContent),
        out: [...document.querySelectorAll(".coachpanel .co-tile.co-out .co-mark")].map(e => e.textContent) }));
      const want = n < 5 ? { off: false, lines: [], out: Array(n).fill("Not in this one") } : { off: true, lines: [NEED8], out: Array(n).fill("Not in this one") };
      if (!eq(s, want)) throw new Error(`with ${n} left out the check screen shows ${JSON.stringify(s)}, want ${JSON.stringify(want)}`);
    }
    await page.evaluate(() => document.querySelector('.coachpanel [data-k="send"]').click()); await wait(300);
    if (st.starts.length || st.frames.length) throw new Error(`with Send off the coach sent ${st.starts.length} starts and ${st.frames.length} key frames`);
  },
  // A clip of 2 s or of 125 s gives the length message, back on the picker; a 6 s one goes on to the questions.
  async clipLength(open, { tmp }) {
    const page = await open({ store: TOKEN, backend: flowBackend().backend });
    await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
    for (const [secs, want] of [[2, LENGTH], [125, LENGTH], [6, null]]) {
      await page.setInputFiles('.coachpanel input[type="file"]', makeClip(tmp, { w: 160, h: 90, secs }));
      if (want) await inPanel(page, `the message for a ${secs} s clip`, ".co-flow .co-err"); else await inPanel(page, "the slider", '[data-k="move-popup"]');
      await wait(300);
      const got = await text(page, ".co-flow .co-err");
      if (got !== want) throw new Error(`a ${secs} s clip says ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      if (want && !await page.$('.coachpanel input[type="file"]')) throw new Error(`after a ${secs} s clip there's no picker`);
    }
  },
  // A file the phone can't play (the <video> errors) says so, back on the picker.
  async cantOpen(open) {
    const page = await open({ store: TOKEN, backend: flowBackend().backend });
    await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
    await page.setInputFiles('.coachpanel input[type="file"]', { name: "IMG_0001.MOV", mimeType: "video/quicktime", buffer: Buffer.from("this isn't a clip at all") });
    await inPanel(page, "the message", ".co-flow .co-err");
    const got = await text(page, ".co-flow .co-err");
    if (got !== CANT) throw new Error(`a clip the phone can't open says ${JSON.stringify(got)}`);
  },
  // While the clip's length and size aren't known (loadedmetadata held back, readyState 0) the questions and Find the move say "Getting
  // your clip ready… this can take a minute." and Here stays off; once they come it goes. The first tap on the questions screen calls
  // play() then pause() on the clip, and no other tap does.
  async gettingReady(open, { tmp }) {
    const hold = () => { window.__hold = true; const add = EventTarget.prototype.addEventListener, rs = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "readyState");
      EventTarget.prototype.addEventListener = function (type, fn, o) { if (type !== "loadedmetadata" || !(this instanceof HTMLMediaElement)) return add.call(this, type, fn, o);
        const el = this; return add.call(this, type, e => { if (window.__hold) window.__held = () => fn.call(el, e); else fn.call(el, e); }, o); };
      Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get() { return window.__hold ? 0 : rs.get.call(this); } }); };
    const page = await open({ store: TOKEN, backend: flowBackend().backend, init: [hold, watchMedia] });
    await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
    await page.setInputFiles('.coachpanel input[type="file"]', makeClip(tmp, {})); await inPanel(page, "the questions", '[data-k="move-cutback"]');
    await page.waitForFunction(() => !!window.__held); const notes = () => page.evaluate(() => [...document.querySelectorAll('.coachpanel .co-note[role="status"]')].map(e => e.textContent));
    if (!eq(await notes(), [GETTING])) throw new Error(`with the clip not ready the questions say ${JSON.stringify(await notes())}`);
    const media = () => page.evaluate(() => window.__media);
    if ((await media()).length) throw new Error(`before any tap the clip was asked to ${await media()}`);
    await page.click('.coachpanel [data-k="move-cutback"]'); if (!eq(await media(), ["play", "pause"])) throw new Error(`the first tap called ${JSON.stringify(await media())}, want play then pause`);
    await page.click('.coachpanel [data-k="move-popup"]'); await page.click('.coachpanel [data-k="move-cutback"]');
    if (!eq(await media(), ["play", "pause"])) throw new Error(`later taps called ${JSON.stringify(await media())}`);
    await page.click('.coachpanel [data-k="next"]'); await inPanel(page, "Find the move", '[data-k="slider"]');
    const offs = () => page.evaluate(() => ({ slider: document.querySelector('.coachpanel [data-k="slider"]').disabled, here: document.querySelector('.coachpanel [data-k="here"]').disabled }));
    if (!eq(await notes(), [GETTING]) || !eq(await offs(), { slider: true, here: true })) throw new Error(`Find the move, the clip not ready: ${JSON.stringify(await notes())}, ${JSON.stringify(await offs())}`);
    await page.evaluate(() => { window.__hold = false; window.__held(); }); await settle(page);
    if ((await notes()).length || !eq(await offs(), { slider: false, here: false })) throw new Error(`once ready: ${JSON.stringify(await notes())}, ${JSON.stringify(await offs())}`);
  },
  // Where IndexedDB throws (a private window), the review still sends.
  async noIndexedDb(open, { tmp }) {
    const block = () => { Object.defineProperty(window, "indexedDB", { configurable: true, get() { throw new DOMException("The operation is insecure.", "SecurityError"); } }); };
    const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend, init: [block] }), b = boxAt(640, 360, 6, 3);
    await toCheck(page, makeClip(tmp, {}), { at: 3, x: b.x, y: b.y });
    await page.click('.coachpanel [data-k="send"]'); await inPanel(page, `"${SENT}"`, ".co-ok");
    if (await text(page, ".co-ok") !== SENT || st.starts.length !== 1 || st.frames.length !== 12 || st.sends !== 1) throw new Error(`without IndexedDB: ${st.starts.length} starts, ${st.frames.length} key frames, ${st.sends} sends`);
  },
  // A key frame's upload failing twice at the network and working the third time: the review sends, with each key frame once, and the
  // send's progress bar (the start, 12 key frames and send: 14 steps) gets to its end.
  async uploadRetries(open, { tmp }) {
    const st = flowBackend({}, { failFrame: { n: 3, times: 2 } }), page = await open({ store: TOKEN, backend: st.backend, init: [watchBar] }), b = boxAt(640, 360, 6, 3);
    await toCheck(page, makeClip(tmp, {}), { at: 3, x: b.x, y: b.y });
    await page.click('.coachpanel [data-k="send"]'); await inPanel(page, `"${SENT}"`, ".co-ok", 30e3);
    const ok = st.frames.filter(f => !f.failed).map(f => f.n), failed = st.frames.filter(f => f.failed).map(f => f.n);
    if (!eq(ok, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) || !eq(failed, [3, 3]) || st.starts.length !== 1 || st.sends !== 1) throw new Error(`sent ${JSON.stringify(ok)}, failed ${JSON.stringify(failed)}, ${st.starts.length} starts, ${st.sends} sends`);
    const bar = (await page.evaluate(() => window.__bar)).filter(([, max]) => max === 14);
    if (!bar.length || !eq(bar[bar.length - 1], [14, 14])) throw new Error(`the send's progress bar ended at ${JSON.stringify(bar[bar.length - 1])}, want [14, 14]`);
  },
  // IndexedDB failing to open once, and then closing under the coach (as Safari can in the background), doesn't end the saving: the next
  // save opens it again (each time the coach opens it is counted).
  async idbReopens(open, { tmp }) {
    const flaky = () => { window.__opens = 0; window.__breakTx = false; const o = IDBFactory.prototype.open, t = IDBDatabase.prototype.transaction;
      IDBFactory.prototype.open = function (name, ...a) { if (name === "waveslave-coach" && window.__opens++ === 0) throw new DOMException("failed", "UnknownError"); return o.call(this, name, ...a); };
      IDBDatabase.prototype.transaction = function (...a) { if (window.__breakTx) { window.__breakTx = false; throw new DOMException("The database connection is closing.", "InvalidStateError"); } return t.apply(this, a); }; };
    const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend, init: [flaky] }), opens = () => page.evaluate(() => window.__opens);
    await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
    await page.setInputFiles('.coachpanel input[type="file"]', makeClip(tmp, {}));
    await inPanel(page, "the questions", '[data-k="move-top_turn"]'); await page.click('.coachpanel [data-k="move-top_turn"]');
    await soon("IndexedDB opened again after it failed", async () => await opens() >= 2);
    const first = await opens(); let d = null;
    await soon("the move saved", async () => (d = await draft(page)) && d.answers && d.answers.move === "top_turn");
    if (first !== 2) throw new Error(`the coach opened IndexedDB ${first} times by the first save, want 2 (the first failed)`);
    await page.evaluate(() => { window.__breakTx = true; }); await page.click('.coachpanel [data-k="move-cutback"]');
    await soon("the closed connection to be met", () => page.evaluate(() => !window.__breakTx));
    const before = await opens(); await page.click('.coachpanel [data-k="next"]');
    await soon("IndexedDB opened again after the connection closed", async () => await opens() === before + 1);
    await soon("the next save", async () => (d = await draft(page)) && d.step === "find" && d.answers.move === "cutback");
  },
  // The write of changed key frames failing once (+ makes every box bigger, and that save's put throws): the send then writes the whole
  // draft again, so when it stops part-way (key frame 5 failing 3 times) and the page reloads, the key frames picked up are the bigger
  // ones, with the review's id and the 4 the server has. Sending again sends only the other 8, each a close-up of a bigger box (fewer
  // white pixels than the first boxes' gave), and ends; the review was started once.
  async failedSave(open, { tmp }) {
    const failOnce = () => { window.__failPut = false; const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v, k) { if (window.__failPut && k === "current") { window.__failPut = false; throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); } return put.call(this, v, k); }; };
    const st = flowBackend({}, { failFrame: { n: 5, times: 3 } }), page = await open({ store: TOKEN, backend: st.backend, init: [failOnce] }), b = boxAt(640, 360, 6, 3);
    await toCheck(page, makeClip(tmp, {}), { at: 3, x: b.x, y: b.y });
    let d = null; await soon("the key frames saved", async () => (d = await draft(page)) && d.step === "check" && d.frames.length === 12);
    await page.evaluate(() => { window.__failPut = true; }); await page.click('.coachpanel [data-k="bigger"]');
    await soon("the bigger boxes' failed save", () => page.evaluate(() => !window.__failPut)); await inPanel(page, "the 12 close-ups", ".co-grid");
    d = await draft(page);
    if (d.frames[0].box[2] !== 120) throw new Error(`the failed save still stored boxes of ${d.frames[0].box[2]}`);
    await page.click('.coachpanel [data-k="send"]'); await inPanel(page, `"${FAILED}"`, '[data-k="retry"]', 30e3);
    d = await draft(page);
    if (!d.frames.every(f => f.box[2] === 144) || d.id !== ID || !eq(d.sent, [1, 2, 3, 4])) throw new Error(`after the send stopped the draft is ${JSON.stringify({ sides: [...new Set(d.frames.map(f => f.box[2]))], id: d.id, sent: d.sent, progress: d.progress && { ...d.progress, same: d.progress.stamp === d.stamp } })}`);
    const before = st.frames.length;
    await page.reload({ waitUntil: "load" }); await settle(page);
    await page.tap(TAB); await inPanel(page, "Pick up", '[data-k="pickup"]'); await page.click('.coachpanel [data-k="pickup"]');
    await inPanel(page, "the check screen", '[data-k="send"]'); await page.click('.coachpanel [data-k="send"]'); await inPanel(page, `"${SENT}"`, ".co-ok", 30e3);
    const again = st.frames.slice(before), sent = st.frames.filter(f => !f.failed);
    if (st.starts.length !== 1 || st.gets !== 1 || !eq(again.map(f => f.n), [5, 6, 7, 8, 9, 10, 11, 12]) || st.sends !== 1)
      throw new Error(`after the reload: ${st.starts.length} starts, ${st.gets} asks, key frames ${JSON.stringify(again.map(f => f.n))}, ${st.sends} sends`);
    if (!st.starts[0].frames.every(f => f.box[2] === 144)) throw new Error(`the review started with boxes ${JSON.stringify(st.starts[0].frames.map(f => f.box))}`);
    const crops = await decode(page, sent.map(f => f.body)), stale = crops.map((c, i) => ({ n: sent[i].n, white: c.white })).filter(c => !(c.white > 40e3 && c.white < 65e3));
    if (sent.length !== 12 || stale.length) throw new Error(`close-ups sent that aren't of the bigger boxes (about 53,000 white pixels; the first boxes give about 77,000): ${JSON.stringify(stale)}`);
  },
  // A GET /coach/me answer without the account (ruling P51, failing closed): "Couldn't reach the coach." and Try again, no New review
  // and no Pick up, though a draft of this account is stored, and it stays stored; once the answer has the account again, Try again
  // offers it.
  async noAccount(open, { tmp }) {
    let withAccount = true; const st = flowBackend();
    const backend = (q, req) => q.pathname === "/coach/me" ? { body: me({ profile: PROFILE, ...(withAccount ? {} : { account: undefined }) }) } : st.backend(q, req);
    const page = await open({ store: TOKEN, backend });
    await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
    await page.setInputFiles('.coachpanel input[type="file"]', makeClip(tmp, {}));
    await inPanel(page, "the questions", '[data-k="move-top_turn"]'); await page.click('.coachpanel [data-k="move-top_turn"]');
    let d = null; await soon("the draft", async () => (d = await draft(page)) && d.answers && d.answers.move === "top_turn");
    withAccount = false; await page.reload({ waitUntil: "load" }); await settle(page);
    await page.tap(TAB); await inPanel(page, "Try again", '[data-k="retry"]'); await wait(500);
    const look = () => page.evaluate(() => { const q = s => document.querySelector(".coachpanel " + s);
      return { err: q(".co-err") && q(".co-err").textContent, retry: q('[data-k="retry"]') && q('[data-k="retry"]').textContent, newReview: !!q('[data-k="new"]'), resume: !!q(".co-resume"), left: !!q(".co-left") }; });
    let got = await look();
    if (!eq(got, { err: "Couldn't reach the coach.", retry: "Try again", newReview: false, resume: false, left: false })) throw new Error(`without the account the panel shows ${JSON.stringify(got)}`);
    await page.click('.coachpanel [data-k="retry"]'); await wait(500); got = await look();
    if (got.retry !== "Try again" || got.newReview || got.resume) throw new Error(`Try again, still without the account: ${JSON.stringify(got)}`);
    d = await draft(page);
    if (!d || d.account !== "u-test" || d.answers.move !== "top_turn") throw new Error(`without the account the draft became ${JSON.stringify(d && { account: d.account, answers: d.answers })}`);
    withAccount = true; await page.click('.coachpanel [data-k="retry"]'); await inPanel(page, "Pick up where you left off?", ".co-resume");
    if (st.starts.length || st.frames.length) throw new Error(`without the account the page sent ${st.starts.length} starts and ${st.frames.length} key frames`);
  },
  // Picked up after a reload at the check screen, the key frame the tracker lost opens first, as before the reload (spec step 5):
  // without the clip, its close-up and "Not in this one", which leaves it out.
  async lostAfterReload(open, { tmp }) {
    const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend }), b = boxAt(640, 360, 6, 2.5);
    await toCheck(page, makeClip(tmp, { gap: [2.9, 3.1] }), { at: 2.5, x: b.x, y: b.y });
    await soon("the key frames saved", async () => { const d = await draft(page); return !!d && d.step === "check" && d.frames.length === 12; });
    await page.reload({ waitUntil: "load" }); await settle(page);
    await page.tap(TAB); await inPanel(page, "Pick up", '[data-k="pickup"]'); await page.click('.coachpanel [data-k="pickup"]');
    await inPanel(page, "the lost key frame", '[data-k="notin"]');
    const got = { head: await text(page, '[data-k="fh"]'), big: !!await page.$(".coachpanel img.co-big"), frame: !!await page.$(".coachpanel .co-frame"), grid: !!await page.$(".coachpanel .co-grid") };
    if (!eq(got, { head: "Key frame at 0:03.0", big: true, frame: false, grid: false })) throw new Error(`picked up, the check screen opened at ${JSON.stringify(got)}`);
    await page.click('.coachpanel [data-k="notin"]'); await inPanel(page, "the 12 close-ups", ".co-grid");
    const grid = await page.evaluate(() => ({ lost: document.querySelectorAll(".coachpanel .co-tile.co-lost").length, out: [...document.querySelectorAll(".coachpanel .co-tile.co-out")].map(e => e.dataset.k) }));
    if (!eq(grid, { lost: 0, out: ["kf-9"] })) throw new Error(`after leaving it out: ${JSON.stringify(grid)}`);
    // Without the clip, ‹ Back leaves the flow as it always has, for Pick up; and the check screen offers the clip again (in 中文 too).
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "Pick up after ‹ Back", ".co-resume");
    await page.click('.coachpanel [data-k="pickup"]'); await inPanel(page, "Choose the clip again", '[data-k="again"]');
    await page.evaluate(() => setLang("zh")); await settle(page);
    const zh = await text(page, '[data-k="again"]'); await page.evaluate(() => setLang("en")); await settle(page);
    if (zh !== "重新選擇影片" || await text(page, '[data-k="again"]') !== "Choose the clip again") throw new Error(`the check screen offers ${JSON.stringify([zh, await text(page, '[data-k="again"]')])}`);
    // It goes to the picker, keeping the answers, the move and Here; the clip then goes straight to Find the move at Here, and Here
    // and a tap cut the key frames again from it.
    await page.click('.coachpanel [data-k="again"]'); await inPanel(page, "the picker", ".co-choose");
    // ‹ Back from the picker and Pick up come back to the check screen, as its key frames are still kept.
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "Pick up after the picker", ".co-resume");
    await page.click('.coachpanel [data-k="pickup"]'); await inPanel(page, "the check screen after the picker", '[data-k="again"], .co-choose');
    if (!await page.$('.coachpanel [data-k="again"]')) throw new Error("Pick up after ‹ Back from the picker opened the picker, not the check screen");
    await page.click('.coachpanel [data-k="again"]'); await inPanel(page, "the picker again", ".co-choose");
    const same =await page.$$eval(".coachpanel .co-note", e => e.map(x => x.textContent));
    if (!same.includes("Choose the same clip again to pick up where you left off.")) throw new Error(`the picker says ${JSON.stringify(same)}`);
    await page.setInputFiles('.coachpanel input[type="file"]', makeClip(tmp, { gap: [2.9, 3.1] })); await inPanel(page, "Find the move", '[data-k="slider"]:not([disabled])');
    const find = { head: await text(page, '[data-k="fh"]'), at: await page.evaluate(() => +document.querySelector('.coachpanel [data-k="slider"]').value), d: await draft(page) };
    if (find.head !== "Find the move" || find.at !== 2.5 || find.d.answers.move !== "top_turn" || find.d.step !== "check") throw new Error(`the clip chosen again shows ${JSON.stringify({ head: find.head, at: find.at, move: find.d.answers.move, step: find.d.step })}`);
    await page.click('.coachpanel [data-k="here"]'); await tapAt(page, b.x, b.y); await inPanel(page, "the cut again", '.co-grid, [data-k="notin"]', 30e3);
    if (!await page.$(".coachpanel .co-frame")) throw new Error("cut again, the lost key frame opens without the clip");
  },
  // Shutting the panel while the key frames are being cut stops the cutting (nothing more is drawn) and keeps the clip; opening the panel
  // again cuts them again from it, to the check screen (ruling P52).
  async closeDuringCut(open, { tmp }) {
    const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend, init: [watchCanvas] }), b = boxAt(640, 360, 6, 3);
    await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
    await page.setInputFiles('.coachpanel input[type="file"]', makeClip(tmp, {}));
    await inPanel(page, "the questions", '[data-k="move-top_turn"]'); await page.click('.coachpanel [data-k="move-top_turn"]'); await page.click('.coachpanel [data-k="next"]');
    await slideTo(page, 3); await page.click('.coachpanel [data-k="here"]');
    await tapAt(page, b.x, b.y); await page.waitForFunction(() => window.__draws.length >= 1);
    await page.keyboard.press("Escape");
    const at = await page.evaluate(() => ({ draws: window.__draws.length, open: document.documentElement.classList.contains("coach-open") })); await wait(1500);
    const later = await page.evaluate(async () => { const v = document.querySelector(".coachpanel video");
      return { draws: window.__draws.length, clip: !!v && await fetch(v.src).then(() => true, () => false) }; });
    const d = await draft(page);
    if (at.open || at.draws >= 24 || later.draws !== at.draws || !later.clip || !d || d.step !== "tap" || d.frames.length) throw new Error(`shut while cutting: ${JSON.stringify({ at, later, step: d && d.step, frames: d && d.frames.length })}`);
    await page.tap(TAB); await inPanel(page, "the 12 close-ups", ".co-grid", 30e3);
    const after = await page.evaluate(() => ({ tiles: document.querySelectorAll(".coachpanel .co-tile").length, draws: window.__draws.length }));
    if (after.tiles !== 12 || after.draws < at.draws + 24) throw new Error(`opened again: ${JSON.stringify(after)}, from ${at.draws} draws`);
    await soon("the key frames saved", async () => { const d = await draft(page); return !!d && d.step === "check" && d.frames.length === 12; });
  },
  // Three failures of one upload: "Couldn't send. Tap to try again.", and the draft in IndexedDB still has all 12 key frames, the review's
  // id and the two the server has. Tapping it asks the server which it has and sends only the rest.
  async threeFailures(open, { tmp }) {
    const st = flowBackend({}, { failFrame: { n: 3, times: 3 } }), page = await open({ store: TOKEN, backend: st.backend }), b = boxAt(640, 360, 6, 3);
    await toCheck(page, makeClip(tmp, {}), { at: 3, x: b.x, y: b.y });
    await page.click('.coachpanel [data-k="send"]'); await inPanel(page, `"${FAILED}"`, '[data-k="retry"]', 30e3);
    const d = await draft(page), got = await text(page, '[data-k="retry"]');
    if (got !== FAILED || st.frames.filter(f => f.failed).length !== 3) throw new Error(`after three failures the page says ${JSON.stringify(got)} (${st.frames.filter(f => f.failed).length} failed)`);
    if (!d || d.step !== "check" || d.frames.length !== 12 || !d.frames.every(f => f.blob > 0) || d.id !== ID || !eq(d.sent, [1, 2])) throw new Error(`the draft kept ${JSON.stringify(d && { step: d.step, frames: d.frames.map(f => f.blob), id: d.id, sent: d.sent })}`);
    const before = st.frames.length; await page.click('.coachpanel [data-k="retry"]'); await inPanel(page, `"${SENT}"`, ".co-ok", 30e3);
    const again = st.frames.slice(before).map(f => f.n);
    if (st.gets !== 1 || st.starts.length !== 1 || !eq(again, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) throw new Error(`tapping it: ${st.gets} asks, ${st.starts.length} starts, key frames ${JSON.stringify(again)}`);
    if (await draft(page) !== null) throw new Error("once sent, the draft is still in IndexedDB");
  },
  // In LINE on Android the picker shows "Nothing opens? Open in your browser" under the privacy line, linking to this page with
  // openExternalBrowser=1 (ruling R19); in LINE on an iPhone, or a browser, it doesn't.
  async lineAndroid(open) {
    const LINE_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Line/14.16.0/IAB";
    const LINE_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.16.0";
    for (const [what, ua, want] of [["LINE on Android", LINE_ANDROID, true], ["LINE on an iPhone", LINE_IPHONE, false], ["a browser", null, false]]) {
      const page = await open({ store: TOKEN, backend: flowBackend().backend, ua });
      await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]'); await inPanel(page, "the picker", ".co-privacy");
      const got = await page.evaluate(() => { const p = document.querySelector(".coachpanel .co-outside"), a = p && p.querySelector("a"), pr = document.querySelector(".coachpanel .co-privacy");
        if (!p) return null; const u = new URL(a.href), flag = u.searchParams.get("openExternalBrowser"); u.searchParams.delete("openExternalBrowser");
        return { text: p.textContent, flag, same: u.href === location.href, under: p.getBoundingClientRect().top >= pr.getBoundingClientRect().bottom }; });
      if (want && !eq(got, { text: "Nothing opens? Open in your browser", flag: "1", same: true, under: true })) throw new Error(`${what}: the picker shows ${JSON.stringify(got)}`);
      if (!want && got) throw new Error(`${what}: the picker shows ${JSON.stringify(got)}`);
    }
  },
  // Switching to 中文 mid-flow keeps the answers and the screen: on Find the move it reads 找到動作 with the move in 中文; back on the
  // questions the move is still picked, and the line still holds what was typed, cut to 200 characters as the backend counts them (here
  // emoji, two UTF-16 units each). The profile shows as one line with Change (修改).
  async zhMidFlow(open, { tmp }) {
    const page = await open({ store: TOKEN, backend: flowBackend().backend });
    await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
    await page.setInputFiles('.coachpanel input[type="file"]', makeClip(tmp, {})); await inPanel(page, "the questions", '[data-k="move-cutback"]');
    await page.click('.coachpanel [data-k="move-cutback"]'); await page.fill('.coachpanel [data-k="note"]', "Big day 🌊" + "🌊".repeat(250));
    const typed = "Big day 🌊" + "🌊".repeat(191), noteNow = () => page.evaluate(() => document.querySelector('.coachpanel [data-k="note"]').value);
    if (await noteNow() !== typed) throw new Error(`the line holds ${[...await noteNow()].length} characters, want 200`);
    await page.click('.coachpanel [data-k="next"]'); await slideTo(page, 2.5);
    await page.evaluate(() => setLang("zh")); await settle(page);
    const find = { head: await text(page, '[data-k="fh"]'), line: await text(page, ".co-flow > p"), at: await page.evaluate(() => +document.querySelector('.coachpanel [data-k="slider"]').value) };
    if (!eq(find, { head: "找到動作", line: "拖動滑桿到你的回切，再按「這裡」。", at: 2.5 })) throw new Error(`in 中文 Find the move shows ${JSON.stringify(find)}`);
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "the questions", '[data-k="move-cutback"]');
    const q = await page.evaluate(() => ({ head: document.querySelector('.coachpanel [data-k="fh"]').textContent, move: document.querySelector('.coachpanel [data-k="move-cutback"]').getAttribute("aria-pressed"),
      moveText: document.querySelector('.coachpanel [data-k="move-cutback"]').textContent, profile: document.querySelector(".coachpanel .co-sum").textContent }));
    if (!eq(q, { head: "新增講評", move: "true", moveText: "回切", profile: "轉向很熟練 · 短板 · 正腳（左腳在前）修改" }) || await noteNow() !== typed) throw new Error(`in 中文 the questions show ${JSON.stringify(q)}, the line ${[...await noteNow()].length} characters`);
    await page.evaluate(() => setLang("en")); await settle(page);
    const d = await draft(page);
    if (await text(page, '[data-k="move-cutback"]') !== "Cutback" || !d || d.answers.move !== "cutback" || d.answers.note !== typed || d.step !== "find") throw new Error(`back in English: ${JSON.stringify(d && { answers: d.answers, step: d.step })}`);
  },
  // ---- The review (AI coach spec, "The review") and the error table ("When something goes wrong"), offline.
  // Review Focus 4: a published review whose every text field, and a person's note in the list, hold <img src=x onerror=alert(1)>: it all
  // shows as text, and opening the review adds to the page only its four key frames, each a blob URL fetched with the token (the alert
  // never runs). A held clip says "We couldn't review this clip.". The heads-up names a move, so it has "Get a review of your cutback";
  // the footer says a person checked it.
  async reviewMarkup(open) {
    const X = "<img src=x onerror=alert(1)>", text = reviewText({ went_well: { frame: 2, title: X, detail: X }, main_fix: { frames: [6, 7, 8], title: X, what: X, why: X },
      drill: { title: X, how: X }, heads_up: { text: X, move: "cutback" }, progress: X });
    const st = reviewBackend(text, { note: X }), page = await open({ store: TOKEN, backend: st.backend, init: [() => { window.alert = () => { window.__alerted = true; }; }] });
    await page.tap(TAB); await inPanel(page, "the list", `[data-k="r-${RID}"]`);
    const notes = await page.$$eval(".coachpanel .co-list .co-rnote", e => e.map(x => x.textContent));
    if (!eq(notes, ["We couldn't review this clip.", X])) throw new Error(`the list's notes are ${JSON.stringify(notes)}`);
    await page.tap(".coachpanel .co-x"); const before = await page.evaluate(() => document.images.length);
    await openRid(page); await wait(300);
    const got = await page.evaluate(x => { const v = document.querySelector(".coachpanel .co-review");
      return { added: document.images.length, srcs: [...document.querySelectorAll(".coachpanel img")].map(i => i.src.slice(0, 5)), stray: document.querySelectorAll('img[src="x"], img[src$="/x"]').length,
        alerted: !!window.__alerted, marks: v.textContent.split(x).length - 1, heads: [...v.querySelectorAll(".co-part h4")].map(h => h.textContent),
        button: (v.querySelector('[data-k="headsup"]') || {}).textContent, foot: (v.querySelector(".co-foot") || {}).textContent }; }, X);
    if (got.added !== before + 4 || !eq(got.srcs, ["blob:", "blob:", "blob:", "blob:"]) || got.stray || got.alerted) throw new Error(`the review added ${got.added - before} images (${JSON.stringify(got.srcs)}), ${got.stray} with src x, alert ${got.alerted ? "ran" : "didn't run"}`);
    if (got.marks !== 9) throw new Error(`the markup shows as text ${got.marks} times, want 9 (every text field)`);
    if (!eq(got.heads, ["What went well", "The main fix", "Your drill", "Heads-up", "Progress"]) || got.button !== "Get a review of your cutback") throw new Error(`the review's parts: ${JSON.stringify(got)}`);
    if (got.foot !== "Reviewed by WaveSlave Coach (AI), checked by a person. Surf within your limits.") throw new Error(`the footer says ${JSON.stringify(got.foot)}`);
    if (!eq(st.frames.map(f => f.n).sort((a, b) => a - b), [2, 6, 7, 8]) || !st.frames.every(f => f.auth === "Bearer test-token")) throw new Error(`the key frames were asked for as ${JSON.stringify(st.frames)}`);
  },
  // Tapping a key frame enlarges it over the panel, the same blob URL with its time; Tab stays in it, Escape shuts it (and only it), and the
  // focus goes back to the key frame; ✕ shuts it too. A review checked by no one (autopilot) has the short footer, and without a heads-up
  // or progress line neither shows. ‹ Back to the list revokes the key frames' blob URLs, and so does shutting the panel.
  async enlarge(open) {
    const st = reviewBackend(reviewText({}), { checked: false }), page = await open({ store: TOKEN, backend: st.backend });
    await openRid(page);
    const look = () => page.evaluate(() => { const b = document.querySelector(".coachpanel .co-lb"), shown = !!b && !b.hidden && !!b.getClientRects().length, a = document.activeElement;
      const r = b && b.getBoundingClientRect(), top = b && document.elementFromPoint(195, 500);
      return { shown, head: shown ? b.querySelector("h3").textContent : null, src: shown ? b.querySelector("img").src : null, covers: shown && !!top && b.contains(top) && r.width === 390 && r.height === 844,
        focus: a ? a.getAttribute("data-k") || a.className : null, open: document.documentElement.classList.contains("coach-open") }; });
    const src = k => page.evaluate(k => document.querySelector(`.coachpanel [data-k="${k}"] img`).src, k);
    const parts = await page.evaluate(() => ({ heads: [...document.querySelectorAll(".coachpanel .co-review .co-part h4")].map(h => h.textContent), foot: document.querySelector(".coachpanel .co-foot").textContent }));
    if (!eq(parts, { heads: ["What went well", "The main fix", "Your drill"], foot: "Reviewed by WaveSlave Coach (AI). Surf within your limits." })) throw new Error(`an autopilot review without a heads-up: ${JSON.stringify(parts)}`);
    await page.click('.coachpanel [data-k="shot-w2"]'); let l = await look();
    if (!eq(l, { shown: true, head: "Key frame at 0:10.5", src: await src("shot-w2"), covers: true, focus: "bigx", open: true })) throw new Error(`key frame 2 enlarged: ${JSON.stringify(l)}`);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Tab"); if (!await page.evaluate(() => document.querySelector(".coachpanel .co-lb").contains(document.activeElement))) throw new Error(`Tab ${i + 1} left the enlarged key frame`); }
    await page.keyboard.press("Escape"); await settle(page); l = await look();
    if (l.shown || !l.open || l.focus !== "shot-w2") throw new Error(`after Escape: ${JSON.stringify(l)}`);
    await page.click('.coachpanel [data-k="shot-f7"]'); l = await look();
    if (!l.shown || l.head !== "Key frame at 0:11.8" || l.src !== await src("shot-f7")) throw new Error(`key frame 7 enlarged: ${JSON.stringify(l)}`);
    await page.click(".coachpanel .co-lb .co-x"); await settle(page); l = await look();
    if (l.shown || !l.open || l.focus !== "shot-f7") throw new Error(`after ✕: ${JSON.stringify(l)}`);
    const alive = srcs => page.evaluate(srcs => Promise.all(srcs.map(u => fetch(u).then(() => true, () => false))), srcs);
    for (const [what, shut] of [["‹ Back", () => page.click('.coachpanel [data-k="back"]')], ["✕", () => page.tap(".coachpanel .co-x")]]) {
      const srcs = await page.$$eval(".coachpanel .co-review img", i => i.map(x => x.src));
      if (!eq(await alive(srcs), [true, true, true, true])) throw new Error("the key frames' blob URLs don't load (the check itself is off)");
      await shut(); await settle(page);
      if (await page.$(".coachpanel .co-review")) throw new Error(`${what} left the review open`);
      if (!eq(await alive(srcs), [false, false, false, false])) throw new Error(`after ${what} the key frames' blob URLs still load`);
      if (what === "‹ Back") { await page.tap(".coachpanel .co-x"); await openRid(page); }
    }
  },
  // Something wrong? opens one optional line; Send posts it. invalid says "Couldn't send. Tap to try again." on the button, which sends
  // again; a review gone (404) or no longer published (409 state) goes back to the list, asking GET /coach/me again (ruling P56); a 401
  // there hands the token back and shows Sign in with LINE. Delete asks first (Cancel keeps it).
  async reviewActions(open) {
    const st = reviewBackend(reviewText({})), page = await open({ store: TOKEN, backend: st.backend });
    await openRid(page);
    await page.click('.coachpanel [data-k="del"]'); await inPanel(page, "Delete's question", '[data-k="delyes"]');
    const ask = await text(page, ".co-ask p");
    if (ask !== "Delete this review? It and its key frames are deleted from WaveSlave.") throw new Error(`Delete asks ${JSON.stringify(ask)}`);
    await page.click('.coachpanel [data-k="delno"]'); await inPanel(page, "the review's buttons", '[data-k="wrong"]');
    if (st.deletes) throw new Error("Cancel deleted the review");
    st.report = { status: 400, body: { error: "invalid" } };
    await page.click('.coachpanel [data-k="wrong"]'); await page.fill('.coachpanel [data-k="wrongline"]', "The drill doesn't fit my board.");
    await page.click('.coachpanel [data-k="wrongsend"]');
    await page.waitForFunction(t => { const b = document.querySelector('.coachpanel [data-k="wrongsend"]'); return !!b && b.textContent === t; }, FAILED, { timeout: 5000 }).catch(() => {});
    const failed = await text(page, '[data-k="wrongsend"]');
    if (failed !== FAILED || !eq(st.reports, [{ line: "The drill doesn't fit my board." }])) throw new Error(`invalid says ${JSON.stringify(failed)}; sent ${JSON.stringify(st.reports)}`);
    for (const [status, error] of [[404, "not_found"], [409, "state"]]) {
      st.report = { status, body: { error } }; const asks = page.asked.filter(a => a === "/coach/me").length;
      await page.click('.coachpanel [data-k="wrongsend"]'); await inPanel(page, `the list after ${error}`, `[data-k="r-${RID}"]`);
      if (await page.$(".coachpanel .co-review")) throw new Error(`${error} left the review open`);
      await soon(`GET /coach/me again after ${error}`, () => page.asked.filter(a => a === "/coach/me").length > asks);
      await page.tap(".coachpanel .co-x"); await openRid(page); await page.click('.coachpanel [data-k="wrong"]');
    }
    st.report = { status: 401, body: { error: "auth" } }; await page.click('.coachpanel [data-k="wrongsend"]'); await inPanel(page, "Sign in with LINE", ".co-signin");
    if (await page.evaluate(() => localStorage.getItem("waveslave-chat-token")) !== null) throw new Error("a 401 on Something wrong? left the token");
  },
  // The heads-up's button with no draft waiting starts New review with its move picked, kept at once as a draft with no clip yet (step
  // "pick"): ‹ Back and Pick up, or a reload and Pick up, go to the picker without "Choose the same clip again", and the clip then brings
  // the questions with the move pressed. With a draft waiting the button doesn't replace it: the panel offers Pick up / Start over (ruling
  // P55). Pick up brings the waiting draft back as it was, and forgets the heads-up's move, so a Start over after it picks none; Start
  // over from the heads-up's own offer has its move pressed.
  async headsUpDraft(open, { tmp }) {
    const st = reviewBackend(reviewText({ heads_up: { text: "Your back knee locks straight on your cutback.", move: "cutback" } }));
    const page = await open({ store: TOKEN, backend: st.backend }), clip = makeClip(tmp, {}), SAME = "Choose the same clip again to pick up where you left off.";
    const picker = async what => { await inPanel(page, `the picker (${what})`, ".co-choose");
      if ((await page.$$eval(".coachpanel .co-note", e => e.map(x => x.textContent))).includes(SAME)) throw new Error(`${what}: the picker asks for the same clip`); };
    const pressed = async (what, want) => { await inPanel(page, `the questions (${what})`, '[data-k="move-popup"]');
      const got = await page.$$eval('.coachpanel [data-k^="move-"][aria-pressed="true"]', b => b.map(x => x.getAttribute("data-k")));
      if (!eq(got, want)) throw new Error(`${what}: the questions have ${JSON.stringify(got)} pressed, want ${JSON.stringify(want)}`); };
    const choose = () => page.setInputFiles('.coachpanel input[type="file"]', clip);
    const offer = async what => { await page.click('.coachpanel [data-k="back"]'); await inPanel(page, `Pick up where you left off? (${what})`, ".co-resume"); };
    const headsUp = async () => { await page.tap(".coachpanel .co-x"); await openRid(page); await page.click('.coachpanel [data-k="headsup"]'); };
    await openRid(page); await page.click('.coachpanel [data-k="headsup"]'); await picker("from the heads-up");
    let d = null; await soon("the heads-up's draft", async () => (d = await draft(page)) && d.step === "pick" && d.answers.move === "cutback" && d.account === "u-test");
    await offer("from the picker"); await page.click('.coachpanel [data-k="pickup"]'); await picker("Pick up after ‹ Back");
    await choose(); await pressed("Pick up after ‹ Back", ["move-cutback"]);
    await page.reload({ waitUntil: "load" }); await settle(page); await page.tap(TAB); await inPanel(page, "Pick up after a reload", ".co-resume");
    await page.click('.coachpanel [data-k="pickup"]'); await picker("Pick up after a reload");
    await choose(); await pressed("Pick up after a reload", ["move-cutback"]);
    await page.click('.coachpanel [data-k="move-top_turn"]');
    await soon("the draft with the top turn", async () => (d = await draft(page)) && d.answers.move === "top_turn" && d.step === "questions");
    const waiting = d.flow;
    await offer("the top turn's draft"); await headsUp(); await inPanel(page, "the offer from the heads-up", ".co-resume");
    if (await page.$(".coachpanel .co-choose")) throw new Error("the heads-up's button left the waiting draft for New review");
    d = await draft(page); if (!d || d.flow !== waiting || d.answers.move !== "top_turn") throw new Error(`the heads-up's button changed the waiting draft: ${JSON.stringify(d && { flow: d.flow === waiting, move: d.answers.move })}`);
    await page.click('.coachpanel [data-k="pickup"]'); await pressed("Pick up from the heads-up's offer", ["move-top_turn"]);
    d = await draft(page); if (!d || d.flow !== waiting || d.answers.move !== "top_turn") throw new Error(`Pick up changed the waiting draft: ${JSON.stringify(d && { flow: d.flow === waiting, move: d.answers.move })}`);
    await offer("after Pick up"); await page.click('.coachpanel [data-k="over"]'); await picker("Start over after Pick up"); await choose(); await pressed("Start over after Pick up", []);
    await page.click('.coachpanel [data-k="move-top_turn"]'); await soon("a new draft", async () => (d = await draft(page)) && d.answers.move === "top_turn" && d.flow !== waiting);
    await offer("a new draft"); await headsUp(); await inPanel(page, "the offer from the heads-up again", ".co-resume");
    await page.click('.coachpanel [data-k="over"]'); await picker("Start over from the heads-up's offer"); await choose(); await pressed("Start over from the heads-up's offer", ["move-cutback"]);
  },
  // A key frame that doesn't load (here 503 break, the first time) shows its place with "Tap to try again", and a tap loads it; one the
  // backend no longer has (404, as after the 30-day clean-up) is left out. Every load has the session token.
  async frameAgain(open) {
    let tries = 0;
    const st = reviewBackend(reviewText({}), { frame: n => n === 7 && tries++ === 0 ? { status: 503, body: { error: "break" } } : n === 8 ? { status: 404, body: { error: "not_found" } } : null });
    const page = await open({ store: TOKEN, backend: st.backend });
    await page.tap(TAB); await inPanel(page, "the ready review", `[data-k="r-${RID}"]`); await page.click(`.coachpanel [data-k="r-${RID}"]`);
    await inPanel(page, "key frame 7 to try again", '[data-k="again-f7"]'); await settle(page);
    const look = () => page.evaluate(() => [...document.querySelectorAll(".coachpanel .co-review .co-kf")].map(f => { const a = f.querySelector("button.co-again");
      return [f.querySelector("figcaption").textContent, f.querySelector('img[src^="blob:"]') ? "img" : a ? `${a.textContent} (${a.getAttribute("aria-label")})` : "waiting"]; }));
    let got = await look();
    const failed = ["Key frame at 0:11.8", "Tap to try again (The key frame at 0:11.8 didn't load. Tap to try again.)"];
    if (!eq(got, [["Key frame at 0:10.5", "img"], ["Key frame at 0:11.5", "img"], failed])) throw new Error(`with key frame 7 failing and 8 gone the review shows ${JSON.stringify(got)}`);
    await page.evaluate(() => setLang("zh")); await settle(page);
    const zh = await page.evaluate(() => { const a = document.querySelector('.coachpanel [data-k="again-f7"]'); return a && [a.textContent, a.getAttribute("aria-label")]; });
    if (!eq(zh, ["點一下再試一次", "0:11.8 的關鍵影格載入失敗，點一下再試一次。"])) throw new Error(`in 中文 key frame 7's button reads ${JSON.stringify(zh)}`);
    await page.evaluate(() => setLang("en")); await settle(page);
    await page.click('.coachpanel [data-k="again-f7"]'); await inPanel(page, "key frame 7 again", '[data-k="shot-f7"] img[src^="blob:"]'); got = await look();
    if (!eq(got, [["Key frame at 0:10.5", "img"], ["Key frame at 0:11.5", "img"], ["Key frame at 0:11.8", "img"]])) throw new Error(`after the tap the review shows ${JSON.stringify(got)}`);
    if (!eq(st.frames.map(f => f.n).sort((a, b) => a - b), [2, 6, 7, 7, 8]) || !st.frames.every(f => f.auth === "Bearer test-token")) throw new Error(`the key frames were asked for as ${JSON.stringify(st.frames)}`);
  },
  // Each key frame shows as soon as it lands: with key frame 7 held back, 2, 6 and 8 show while 7 waits in its place, and 7 shows once it
  // comes.
  async frameStall(open) {
    let release = null; const held = new Promise(r => { release = r; });
    const st = reviewBackend(reviewText({}), { frame: n => n === 7 ? held.then(() => ({ jpeg: JPEG })) : null });
    try {
      const page = await open({ store: TOKEN, backend: st.backend });
      await page.tap(TAB); await inPanel(page, "the ready review", `[data-k="r-${RID}"]`); await page.click(`.coachpanel [data-k="r-${RID}"]`);
      let got = null;
      const shows = want => async () => eq(got = await page.evaluate(() => [...document.querySelectorAll(".coachpanel .co-review .co-kf")].map(f =>
        f.querySelector('img[src^="blob:"]') ? "img" : f.querySelector(".co-again") ? "again" : "waiting")), want);
      await soon("key frames 2, 6 and 8 with 7 held back", shows(["img", "img", "waiting", "img"])).catch(e => { throw new Error(`${e.message}: the review shows ${JSON.stringify(got)}`); });
      release();
      await soon("key frame 7 once it comes", shows(["img", "img", "img", "img"])).catch(e => { throw new Error(`${e.message}: the review shows ${JSON.stringify(got)}`); });
    } finally { release(); }
  },
  // A key frame landing while the surfer types in Something wrong?'s line doesn't draw the line again (its keyboard would drop): the key
  // frame shows once the line is left.
  async frameWhileTyping(open) {
    let release = null; const held = new Promise(r => { release = r; });
    const st = reviewBackend(reviewText({}), { frame: n => n === 7 ? held.then(() => ({ jpeg: JPEG })) : null }), kf7 = '.co-review [data-k="shot-f7"] img[src^="blob:"]';
    try {
      const page = await open({ store: TOKEN, backend: st.backend });
      await page.tap(TAB); await inPanel(page, "the ready review", `[data-k="r-${RID}"]`); await page.click(`.coachpanel [data-k="r-${RID}"]`);
      await inPanel(page, "Something wrong?", '[data-k="wrong"]'); await page.click('.coachpanel [data-k="wrong"]');
      await inPanel(page, "Something wrong?'s line", '[data-k="wrongline"]'); await page.type('.coachpanel [data-k="wrongline"]', "The fix is wrong");
      await page.evaluate(() => { window.__line = document.activeElement; });
      release(); await wait(1000);
      const got = await page.evaluate(k => ({ same: document.activeElement === window.__line && window.__line.isConnected, value: window.__line.value, kf7: !!document.querySelector(".coachpanel " + k) }), kf7);
      if (!eq(got, { same: true, value: "The fix is wrong", kf7: false })) throw new Error(`key frame 7 landing as the surfer typed: ${JSON.stringify(got)}`);
      await page.evaluate(() => window.__line.blur()); await inPanel(page, "key frame 7 once the line is left", kf7, 5e3);
      const line = await page.$eval('.coachpanel [data-k="wrongline"]', i => i.value);
      if (line !== "The fix is wrong") throw new Error(`Something wrong?'s line reads ${JSON.stringify(line)} once drawn again`);
    } finally { release(); }
  },
  // GET /coach/reviews/{id} refused: 403 banned says "This account can't use the coach." with no Try again, as GET /coach/me's does; 503
  // break says the coach is taking a break, with Try again.
  async reviewRefused(open) {
    for (const [status, error, err, retry] of [[403, "banned", BLOCKED, false], [503, "break", BREAK, true]]) {
      const st = reviewBackend(reviewText({}), { get: { status, body: { error } } }), page = await open({ store: TOKEN, backend: st.backend });
      await page.tap(TAB); await inPanel(page, "the ready review", `[data-k="r-${RID}"]`); await page.click(`.coachpanel [data-k="r-${RID}"]`);
      await inPanel(page, `the review answered ${status}`, ".co-review .co-err");
      const got = await page.evaluate(() => ({ err: document.querySelector(".coachpanel .co-review .co-err").textContent, retry: !!document.querySelector('.coachpanel .co-review [data-k="retry"]') }));
      if (!eq(got, { err, retry })) throw new Error(`GET /coach/reviews/<id> answering ${status} ${error} shows ${JSON.stringify(got)}, want ${JSON.stringify({ err, retry })}`);
    }
  },
  // Bryan typing in a draft's edit box, an input method still composing (中文), keeps that box, its text and its caret while answers land:
  // another card's Approve, the list asked for again, and GET /coach/me's. The panel is drawn again once he leaves the box, with the text
  // he composed, the approved card gone and "Published." (the focus left where he put it).
  async draftsTyping(open) {
    let release = null; const held = new Promise(r => { release = r; }), box = `.coachpanel [data-k="ed-${DB}-went_well.title"]`;
    const st = draftsBackend([drafted(DA), drafted(DB)], { act: () => held.then(() => { st.waiting = [drafted(DB)]; return { body: { ok: true } }; }) });
    try {
      const page = await open({ skew: true, store: TOKEN, backend: st.backend });
      await page.tap(TAB); await inPanel(page, "B's edit box", `[data-k="ed-${DB}-went_well.title"]`);
      await page.click(`.coachpanel [data-k="act-${DA}-approve"]`); await soon("A's Approve on its way", () => st.acts.length === 1);
      await page.focus(box);
      await page.evaluate(s => { const t = document.querySelector(s); window.__box = t; t.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
        t.value += "ㄓㄨ"; t.setSelectionRange(t.value.length - 1, t.value.length - 1);
        t.dispatchEvent(new InputEvent("input", { isComposing: true, data: "ㄓㄨ", inputType: "insertCompositionText" })); }, box);
      const want = await page.evaluate(() => [window.__box.value, window.__box.selectionStart, window.__box.selectionEnd]), gets = st.gets;
      const mes = () => page.asked.filter(a => a === "/coach/me").length, before = mes();
      release(); await soon("the list asked for again after Approve", () => st.gets > gets);
      await page.evaluate(() => { window.__skew(61e3); document.dispatchEvent(new Event("visibilitychange")); });
      await soon("GET /coach/me asked again", () => mes() > before); await wait(1000);
      const now = () => page.evaluate(s => { const t = document.querySelector(s);
        return { same: document.activeElement === window.__box && t === window.__box, at: t && [t.value, t.selectionStart, t.selectionEnd], said: !!document.querySelector('.coachpanel [data-k="dsaid"]') }; }, box);
      let got = await now();
      if (!eq(got, { same: true, at: want, said: false })) throw new Error(`with 中文 composing in B's edit box as the answers landed: ${JSON.stringify(got)}, want the same box, ${JSON.stringify(want)} and no redraw`);
      await page.evaluate(() => window.__box.dispatchEvent(new CompositionEvent("compositionend", { data: "ㄓㄨ" }))); await wait(500); got = await now();
      if (!eq(got, { same: true, at: want, said: false })) throw new Error(`the composition done, still in the box: ${JSON.stringify(got)}`);
      await page.evaluate(() => window.__box.blur()); await inPanel(page, "Published. once the box is left", '[data-k="dsaid"]', 5e3);
      got = await page.evaluate(([s, a]) => ({ said: document.querySelector('.coachpanel [data-k="dsaid"]').textContent, box: (document.querySelector(s) || {}).value,
        a: !!document.querySelector(`.coachpanel .co-dr[data-id="${a}"]`), focus: document.activeElement.getAttribute("data-k") }), [box, DA]);
      if (!eq(got, { said: "Published.", box: want[0], a: false, focus: null })) throw new Error(`once the box was left: ${JSON.stringify(got)}`);
    } finally { release(); }
  },
  // While one card's action is on its way its buttons say so (Sending… on the one tapped, the others off), and stay off until the list
  // has answered again; another card's buttons still work meanwhile.
  async draftsBusy(open) {
    let release = null, list = null; const hold = new Promise(r => { release = r; }), listed = new Promise(r => { list = r; });
    const st = draftsBackend([drafted(DA, { have: TWELVE }), drafted(DB)], { act: id => id === DA ? hold.then(() => ({ body: { ok: true } })) : { body: { ok: true } } }), backend = st.backend;
    let holdList = false, held = 0;
    st.backend = (q, req) => { if (q.pathname !== "/admin/coach/drafts" || !holdList) return backend(q, req); held++; return listed.then(() => backend(q, req)); };
    try {
      const page = await open({ store: TOKEN, backend: st.backend });
      await page.tap(TAB); await inPanel(page, "A's buttons", `[data-k="act-${DA}-approve"]`);
      const acts = id => page.evaluate(id => [...document.querySelectorAll(`.coachpanel .co-dr[data-id="${id}"] .co-dr-acts button`)].map(b => [b.textContent, b.getAttribute("aria-disabled") === "true"]), id);
      await page.click(`.coachpanel [data-k="act-${DA}-approve"]`); await soon("A's Approve on its way", () => st.acts.length === 1); await settle(page);
      let got = await acts(DA);
      if (!eq(got, [["Sending…", true], ["Redo", true], ["Reject", true], ["Ban", true]])) throw new Error(`A's buttons with its Approve on its way: ${JSON.stringify(got)}`);
      await page.click(`.coachpanel [data-k="act-${DA}-redo"]`, { force: true }); await settle(page);
      if (await page.$(`.coachpanel [data-k="note-${DA}"]`)) throw new Error("Redo on A opened its note while A's Approve was on its way");
      await page.click(`.coachpanel [data-k="act-${DB}-approve"]`); await soon("B's Approve done meanwhile, and the list asked for again", () => st.acts.length === 2 && st.gets === 2);
      holdList = true; release(); await soon("A's Approve done, the list asked for again", () => held === 1); await settle(page); await wait(100);
      got = await acts(DA);
      if (!eq(got, [["Approve", true], ["Redo", true], ["Reject", true], ["Ban", true]])) throw new Error(`A's buttons approved, the list not yet answered: ${JSON.stringify(got)}`);
      await page.click(`.coachpanel [data-k="act-${DA}-approve"]`, { force: true }); await wait(300);
      if (st.acts.length !== 2) throw new Error(`a second tap on A's Approve before the list answered sent ${JSON.stringify(st.acts)}`);
      st.waiting = []; list(); await inPanel(page, "No drafts waiting.", ".co-drafts .co-note", 5e3);
    } finally { release(); list(); }
  },
  // What Bryan has typed in a draft's edit box and not sent is kept for the tab (sessionStorage): shutting the panel lets the list go, and
  // opening it again shows the edit again, as a reload does. (A reload here could lose the tab's storage itself: this harness's init
  // script touches sessionStorage as each page loads, which in Playwright can race the reload.) Once the review has changed (a Redo came
  // back) it's gone, and so it is once he approves it. Where the tab won't keep it, it's kept in the panel.
  async draftsKept(open) {
    const st = draftsBackend([drafted(DA)]), box = `.coachpanel [data-k="ed-${DA}-went_well.title"]`, kept = `waveslave-coach-ed-${DA}`;
    const page = await open({ store: TOKEN, backend: st.backend }), at = () => page.$eval(box, t => t.value), has = () => page.evaluate(k => sessionStorage.getItem(k) !== null, kept);
    await page.tap(TAB); await inPanel(page, "A's edit box", `[data-k="ed-${DA}-went_well.title"]`);
    await page.fill(box, "Kept for the tab"); await page.tap(".coachpanel .co-x"); await settle(page);
    await page.tap(TAB); await inPanel(page, "A's edit box, the panel opened again", `[data-k="ed-${DA}-went_well.title"]`);
    if (await at() !== "Kept for the tab") throw new Error(`the panel opened again, A's edit box reads ${JSON.stringify(await at())}`);
    st.waiting = [drafted(DA, { redos: 1, waiting_since: REVIEW_AT + 60e3 })]; await page.click('.coachpanel [data-k="drefresh"]'); await soon("the list asked for again", () => st.gets >= 3); await wait(300);
    if (await at() !== "Low and ready going in" || await has()) throw new Error(`A changed (a Redo came back): its box reads ${JSON.stringify(await at())}, ${await has() ? "still" : "no longer"} kept`);
    await page.fill(box, "Approved as typed"); if (!await has()) throw new Error("a new edit isn't kept for the tab");
    await page.click(`.coachpanel [data-k="act-${DA}-approve"]`); await soon("A's Approve", () => st.acts.length === 1); await wait(300);
    if (!eq(st.acts[0], [DA, { action: "approve", ver: verOf(st.waiting[0]), edits: { "went_well.title": "Approved as typed" } }]) || await has()) throw new Error(`Approve sent ${JSON.stringify(st.acts)}, the edit ${await has() ? "still" : "no longer"} kept`);
    await page.evaluate(() => { for (const k of ["setItem", "getItem", "removeItem"]) { const f = Storage.prototype[k];
      Storage.prototype[k] = function (key, ...a) { if (String(key).startsWith("waveslave-coach-ed-")) throw new Error("denied"); return f.call(this, key, ...a); }; } });
    st.waiting = [drafted(DA, { redos: 2 })]; await page.click('.coachpanel [data-k="drefresh"]'); await soon("the list once more", () => st.gets >= 5); await wait(300);
    await page.fill(box, "Kept in the panel"); await page.click('.coachpanel [data-k="drefresh"]'); await soon("the list again", () => st.gets >= 6); await wait(300);
    if (await at() !== "Kept in the panel") throw new Error(`with the tab refusing to keep it, A's box reads ${JSON.stringify(await at())}`);
  },
  // A sign-out never waits on typing: GET /coach/me answering 401 while 中文 is being composed in a draft's edit box shows Sign in with
  // LINE at once. What Bryan had typed stays kept for the tab, for his account, and is back in the box once he signs in again.
  async draftsSignOut(open) {
    const st = draftsBackend([drafted(DA)]), box = `.coachpanel [data-k="ed-${DA}-went_well.title"]`, kept = `waveslave-coach-ed-${DA}`;
    const page = await open({ skew: true, store: TOKEN, backend: st.backend });
    await page.tap(TAB); await inPanel(page, "A's edit box", `[data-k="ed-${DA}-went_well.title"]`);
    await page.fill(box, "Kept through a sign-out"); await page.focus(box);
    await page.evaluate(s => { const t = document.querySelector(s); t.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      t.value += "ㄓ"; t.dispatchEvent(new InputEvent("input", { isComposing: true, data: "ㄓ", inputType: "insertCompositionText" })); }, box);
    st.me = { status: 401, body: { error: "auth" } };
    await page.evaluate(() => { window.__skew(61e3); document.dispatchEvent(new Event("visibilitychange")); });
    await inPanel(page, "Sign in with LINE at once", ".co-signin", 2e3);
    const got = await page.evaluate(k => { let o = null; try { o = JSON.parse(sessionStorage.getItem(k)); } catch (e) {}
      return { drafts: !!document.querySelector(".coachpanel .co-drafts"), who: o && o.who, text: o && o.f && o.f["went_well.title"] }; }, kept);
    if (!eq(got, { drafts: false, who: "u-bryan", text: "Kept through a sign-out" })) throw new Error(`after a 401 mid-composition: ${JSON.stringify(got)}`);
    st.me = null; await page.evaluate(() => { localStorage.setItem("waveslave-chat-token", "test-token"); window.COACH.dev(); });
    await inPanel(page, "A's edit box after signing in again", `[data-k="ed-${DA}-went_well.title"]`, 5e3);
    const back = await page.$eval(box, t => t.value);
    if (back !== "Kept through a sign-out") throw new Error(`signed in again, A's edit box reads ${JSON.stringify(back)}`);
  },
  // A card drawn before a held redraw doesn't send for a review that has since changed: Approve again on a card already approved (now
  // gone from the list), or Approve on one whose draft a Redo rewrote meanwhile, says "This draft changed. Check it again." and draws the
  // list as it is, sending nothing.
  async draftsStale(open) {
    for (const tap of [DA, DB]) {
      let release = null; const held = new Promise(r => { release = r; }), box = `.coachpanel [data-k="ed-${DB}-went_well.title"]`;
      const st = draftsBackend([drafted(DA), drafted(DB)], { act: () => held.then(() => { st.waiting = [drafted(DB, { redos: 1, waiting_since: REVIEW_AT + 60e3 })]; return { body: { ok: true } }; }) });
      try {
        const page = await open({ store: TOKEN, backend: st.backend });
        await page.tap(TAB); await inPanel(page, "B's edit box", `[data-k="ed-${DB}-went_well.title"]`);
        await page.click(`.coachpanel [data-k="act-${DA}-approve"]`); await soon("A's Approve on its way", () => st.acts.length === 1);
        await page.focus(box); await page.keyboard.type("x"); const gets = st.gets;
        release(); await soon("the list asked for again after Approve", () => st.gets > gets); await wait(500);
        await page.evaluate(k => document.querySelector(`.coachpanel [data-k="${k}"]`).click(), `act-${tap}-approve`); await wait(300);
        const got = await page.evaluate(() => ({ said: (document.querySelector('.coachpanel [data-k="dsaid"]') || {}).textContent || null,
          cards: [...document.querySelectorAll(".coachpanel .co-dr")].map(c => c.getAttribute("data-id")) }));
        const want = { said: "This draft changed. Check it again.", cards: [DB] };
        if (!eq(got, want) || st.acts.length !== 1) throw new Error(`Approve on ${tap === DA ? "A, already approved" : "B, changed meanwhile"}, from the card drawn before: ${JSON.stringify(got)}, sent ${JSON.stringify(st.acts)}`);
        if (!eq(st.acts[0], [DA, { action: "approve", ver: verOf(drafted(DA)) }])) throw new Error(`A's Approve sent ${JSON.stringify(st.acts[0])}, want its ver`);
      } finally { release(); }
    }
  },
  // A draft's key frames are asked for once its card comes near the panel's view (IntersectionObserver), each once; where the phone has
  // no IntersectionObserver, all of them at once.
  async draftsLazy(open) {
    const all = [DA, DB, DC], frames = id => [2, 6, 7, 8].map(n => `${id}:${n}`);
    let st = draftsBackend(all.map(id => drafted(id))), page = await open({ store: TOKEN, backend: st.backend });
    await page.tap(TAB); await inPanel(page, "the last card", `.co-dr[data-id="${DC}"]`); await wait(1000);
    if (st.frames.some(f => f.startsWith(DC))) throw new Error(`with the last card out of sight its key frames were asked for: ${JSON.stringify(st.frames)}`);
    await toFrames(page, DC); await soon("the last card's key frames", () => st.frames.filter(f => f.startsWith(DC)).length === 4); await wait(500);
    if (!eq(st.frames.filter(f => f.startsWith(DC)).sort(), frames(DC)) || new Set(st.frames).size !== st.frames.length) throw new Error(`the key frames were asked for as ${JSON.stringify(st.frames)}`);
    st = draftsBackend(all.map(id => drafted(id))); page = await open({ store: TOKEN, backend: st.backend, init: [() => { delete window.IntersectionObserver; }] });
    await page.tap(TAB); await soon("every key frame without IntersectionObserver", () => st.frames.length === 12);
    if (!eq([...st.frames].sort(), all.flatMap(frames).sort())) throw new Error(`without IntersectionObserver the key frames were asked for as ${JSON.stringify(st.frames)}`);
  },
  // Settings' Where it runs: GET /admin/where's two lines (text/plain, "room colo=NRT" and "coach colo=KIX"), each as code on a line of its
  // own, asked once with the session token; an answer that isn't those two lines says it couldn't ask.
  async whereLine(open) {
    for (const [answer, want] of [["room colo=NRT\ncoach colo=KIX\n", ["Where it runs: room colo=NRTcoach colo=KIX", ["room colo=NRT", "coach colo=KIX"]]],
      ["room colo=nrt\n", ["Where it runs: couldn't ask. Close the panel and open it again in a minute.", []]]]) {
      const st = draftsBackend([], { where: { text: answer } }), page = await open({ store: TOKEN, backend: st.backend });
      await page.tap(TAB); await inPanel(page, "Where it runs", ".co-dr-where");
      await page.waitForFunction(() => !/Loading/.test(document.querySelector(".coachpanel .co-dr-where").textContent), null, { timeout: 5e3 }).catch(() => {}); await wait(300);
      const got = await page.evaluate(() => { const w = document.querySelector(".coachpanel .co-dr-where"); return [w.textContent, [...w.querySelectorAll("code")].map(c => c.textContent)]; });
      if (!eq(got, want) || !eq(st.wheres, ["Bearer test-token"])) throw new Error(`GET /admin/where answering ${JSON.stringify(answer)} shows ${JSON.stringify(got)}, asked ${JSON.stringify(st.wheres)}`);
    }
  },
  // Every refusal at the start of a send, with its message from the spec's table (a money rest naming its day in Taiwan time: "16
  // November", 「11月16日」, on a phone in Los Angeles, where it's still the 15th), and the Send button there again; invalid and state say
  // "Couldn't send. Tap to try again." on the button; agree shows the agreement again, and once it's agreed the check screen is back with
  // Send, no failure left. The draft keeps its 12 key frames all along, and nothing is sent but the starts, until one goes through.
  async sendCodes(open, { tmp }) {
    const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend, tz: "America/Los_Angeles" }), b = boxAt(640, 360, 6, 3);
    await toCheck(page, makeClip(tmp, {}), { at: 3, x: b.x, y: b.y });
    const look = () => page.evaluate(() => { const q = s => document.querySelector(".coachpanel " + s), s = q('[data-k="send"]');
      return { said: q(".co-said") && q(".co-said").textContent, retry: q('[data-k="retry"]') && q('[data-k="retry"]').textContent, send: !!s && !s.disabled }; });
    const refuse = async (status, body) => { st.refuse = { status, body }; const n = st.starts.length;
      await page.click('.coachpanel [data-k="send"], .coachpanel [data-k="retry"]'); await soon(`the start refused with ${body.error}`, () => st.starts.length > n);
      await inPanel(page, "the check screen", '.co-grid', 20e3); await settle(page); return look(); };
    const MONEY = { error: "money", until: Date.UTC(2030, 10, 16) };
    for (const [status, body, said] of [[503, MONEY, "Coach is resting until 16 November."], [503, { error: "break" }, BREAK], [429, { error: "full_today" }, "Coach is full today. Try again tomorrow."],
      [429, { error: "no_reviews_left" }, "You've used your 2 reviews for November. More on December 1."], [409, { error: "in_progress" }, "Your last review is still with the coach."],
      [403, { error: "blocked" }, BLOCKED], [403, { error: "banned" }, BLOCKED], [400, { error: "too_few_frames" }, NEED8], [429, { error: "too_many" }, TOO_MANY],
      [400, { error: "invalid" }, null], [409, { error: "state" }, null]]) {
      const got = await refuse(status, body), want = said ? { said, retry: null, send: true } : { said: null, retry: FAILED, send: false };
      if (!eq(got, want)) throw new Error(`${status} ${body.error} shows ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
    await page.evaluate(() => setLang("zh")); await settle(page);
    for (const [status, body, said] of [[503, MONEY, "教練休息到11月16日。"], [429, { error: "no_reviews_left" }, "11月的 2 次講評已經用完了，12月1日起可以再申請。"]]) {
      const got = await refuse(status, body);
      if (got.said !== said) throw new Error(`in 中文 ${body.error} says ${JSON.stringify(got.said)}, want ${JSON.stringify(said)}`);
    }
    await page.evaluate(() => setLang("en")); await settle(page);
    st.refuse = { status: 403, body: { error: "agree" } }; const n = st.starts.length;
    await page.click('.coachpanel [data-k="send"]'); await soon("the start refused with agree", () => st.starts.length > n); await inPanel(page, "the agreement", ".co-agree");
    if (await page.$(".coachpanel .co-grid")) throw new Error("agree left the check screen showing with the agreement");
    await page.check('.coachpanel [data-k="adult"]'); await page.click('.coachpanel [data-k="agree"]'); await inPanel(page, "the check screen again", ".co-grid");
    const back = await look(), d = await draft(page);
    if (st.agrees !== 1 || !eq(back, { said: null, retry: null, send: true })) throw new Error(`after agreeing again: ${st.agrees} agrees, ${JSON.stringify(back)}`);
    if (!d || d.frames.length !== 12 || !d.frames.every(f => f.blob > 0) || st.frames.length) throw new Error(`after the refusals the draft has ${d && d.frames.length} key frames, ${st.frames.length} sent`);
    st.refuse = null; await page.click('.coachpanel [data-k="send"]'); await inPanel(page, `"${SENT}"`, ".co-ok", 30e3);
    if (st.frames.length !== 12 || st.sends !== 1) throw new Error(`the send at last: ${st.frames.length} key frames, ${st.sends} sends`);
  },
  // A 401 at send (signed out elsewhere) hands the token back through CHAT.token(old) and shows Sign in with LINE, and the draft stays in
  // IndexedDB with its 12 key frames. Signing in again as the same account brings the check screen back, and the review sends.
  async sendRefused(open, { tmp }) {
    const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend }), b = boxAt(640, 360, 6, 3);
    await toCheck(page, makeClip(tmp, {}), { at: 3, x: b.x, y: b.y });
    await soon("the key frames saved", async () => { const d = await draft(page); return !!d && d.step === "check" && d.frames.length === 12; });
    st.refuse = { status: 401, body: { error: "auth" } };
    await page.click('.coachpanel [data-k="send"]'); await inPanel(page, "Sign in with LINE", ".co-signin");
    const d = await draft(page), kept = await page.evaluate(() => localStorage.getItem("waveslave-chat-token"));
    if (kept !== null || !d || d.account !== "u-test" || d.frames.length !== 12 || !d.frames.every(f => f.blob > 0)) throw new Error(`after a 401 at send: the token ${kept === null ? "gone" : "kept"}, the draft ${JSON.stringify(d && { account: d.account, frames: d.frames.length })}`);
    st.refuse = null; await page.evaluate(() => { localStorage.setItem("waveslave-chat-token", "test-token"); window.COACH.open(); });
    await inPanel(page, "the check screen after signing in again", ".co-grid");
    await page.click('.coachpanel [data-k="send"], .coachpanel [data-k="retry"]'); await inPanel(page, `"${SENT}"`, ".co-ok", 30e3);
  },
  // What GET /coach/me says stops a review shows in the panel (money with its Taiwan day, on a phone in Los Angeles; a break, the day full,
  // no reviews left this server month), in English and 中文; and its refusals: 403 banned "This account can't use the coach." with no Try
  // again, 503 break "Coach is taking a break. Try again later." with it. I agree answered 503 break says so too, and 403 agree (the
  // page's agreement older than the backend's, ruling P57) asks for a reload.
  async meCodes(open) {
    const look = page => page.evaluate(() => { const q = s => document.querySelector(".coachpanel " + s);
      return { why: q(".co-why") && q(".co-why").textContent, err: q(".co-err:not(.co-why)") && q(".co-err:not(.co-why)").textContent, retry: !!q('[data-k="retry"]') }; });
    const shown = async (o, status = 200) => { const page = await open({ store: TOKEN, backend: coachBackend(o, status), tz: "America/Los_Angeles" }); await page.tap(TAB);
      await page.waitForFunction(() => !!document.querySelector(".coachpanel .co-left, .coachpanel .co-err"), null, { timeout: 5000 }).catch(() => {}); await settle(page); return page; };
    for (const [o, en, zh] of [[{ stop: { kind: "money", until: Date.UTC(2030, 10, 16) } }, "Coach is resting until 16 November.", "教練休息到11月16日。"], [{ stop: { kind: "break" } }, BREAK, "教練暫時休息中，請稍後再試。"],
      [{ full_today: true }, "Coach is full today. Try again tomorrow.", "教練今天已經額滿了，明天再試試。"], [{ left: 0 }, "You've used your 2 reviews for November. More on December 1.", "11月的 2 次講評已經用完了，12月1日起可以再申請。"], [{}, null, null]]) {
      const page = await shown(o); let got = await look(page);
      if (got.why !== en) throw new Error(`with ${JSON.stringify(o)} the panel says ${JSON.stringify(got.why)}, want ${JSON.stringify(en)}`);
      await page.evaluate(() => setLang("zh")); await settle(page); got = await look(page);
      if (got.why !== zh) throw new Error(`in 中文 with ${JSON.stringify(o)} the panel says ${JSON.stringify(got.why)}, want ${JSON.stringify(zh)}`);
    }
    for (const [status, want] of [[403, { why: null, err: BLOCKED, retry: false }], [503, { why: null, err: BREAK, retry: true }]]) {
      const got = await look(await shown({}, status));
      if (!eq(got, want)) throw new Error(`GET /coach/me answering ${status}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
    for (const [status, error, want, zh] of [[503, "break", BREAK, null], [403, "agree", "The coach has been updated. Reload the page to see what's new.", "教練已更新，請重新整理頁面。"]]) {
      const backend = (q, req) => q.pathname === "/coach/agree" ? { status, body: { error } } : coachBackend({ agreed: false })(q, req);
      const page = await open({ store: TOKEN, backend }); await page.tap(TAB); await inPanel(page, "the agreement", '[data-k="agree"]');
      await page.check('.coachpanel [data-k="adult"]'); await page.click('.coachpanel [data-k="agree"]');
      await page.waitForFunction(() => { const e = [...document.querySelectorAll(".coachpanel .co-agree .co-err")].find(x => !x.hidden); return !!e; }, null, { timeout: 5000 }).catch(() => {});
      const said = () => page.evaluate(() => [...document.querySelectorAll(".coachpanel .co-agree .co-err")].filter(x => !x.hidden).map(x => x.textContent));
      if (!eq(await said(), [want])) throw new Error(`I agree answered ${status} ${error} says ${JSON.stringify(await said())}`);
      if (zh) { await page.evaluate(() => setLang("zh")); await settle(page); if (!eq(await said(), [zh])) throw new Error(`in 中文 I agree answered ${status} ${error} says ${JSON.stringify(await said())}`); }
    }
  },
  // The reasons a review wasn't reviewed are codes the page says in the panel's language: "late" (the 14-day close) and "failed" (it
  // failed on our side and doesn't count), "not_surf" as before; a person's note shows as written. A move the surfer named themselves
  // ("other") shows by their name for it (move_other), in the list and on the review.
  async noteCodes(open) {
    const OID = "o".repeat(22), rows = [{ id: OID, move: "other", move_other: "Air reverse", created: REVIEW_AT, status: "ready", published: REVIEW_AT + 3600e3, note: null },
      { id: "l".repeat(22), move: "cutback", move_other: "", created: REVIEW_AT - 86400e3, status: "not_reviewed", published: null, note: "late" },
      { id: "f".repeat(22), move: "popup", move_other: "", created: REVIEW_AT - 2 * 86400e3, status: "not_reviewed", published: null, note: "failed" },
      { id: "s".repeat(22), move: "other", move_other: "Snap", created: REVIEW_AT - 3 * 86400e3, status: "not_reviewed", published: null, note: "not_surf" },
      { id: "p".repeat(22), move: "top_turn", move_other: "", created: REVIEW_AT - 4 * 86400e3, status: "not_reviewed", published: null, note: "Film closer." }];
    const backend = q => q.pathname === "/coach/me" ? { body: me({ reviews: rows }) }
      : q.pathname === `/coach/reviews/${OID}` ? { body: { id: OID, status: "published", move: "other", move_other: "Air reverse", created: REVIEW_AT, have: [], note: null,
        review: { text: reviewText({}), times: KEY_MS, checked: true } } }
      : /\/frames\/\d+$/.test(q.pathname) ? { jpeg: JPEG } : { body: { reports: [], online: 0, last_id: 0 } };
    const page = await open({ store: TOKEN, backend });
    await page.tap(TAB); await inPanel(page, "the list", ".co-list");
    const list = () => page.$$eval(".coachpanel .co-list li", ls => ls.map(li => [li.querySelector(".co-mv").textContent, (li.querySelector(".co-rnote") || {}).textContent || null]));
    const en = [["Air reverse", null], ["Cutback", "Sorry, we couldn't review this in time."], ["Pop-up", "Something went wrong on our side. This one doesn't count."],
      ["Snap", "We couldn't review this clip."], ["Top turn", "Film closer."]];
    const zh = [["Air reverse", null], ["回切", "抱歉，我們沒能及時完成這份講評。"], ["起乘", "我們這邊出了問題，這次不算在次數內。"], ["Snap", "我們無法講評這段影片。"], ["頂部轉向", "Film closer."]];
    let got = await list(); if (!eq(got, en)) throw new Error(`the list shows ${JSON.stringify(got)}`);
    await page.evaluate(() => setLang("zh")); await settle(page);
    got = await list(); if (!eq(got, zh)) throw new Error(`in 中文 the list shows ${JSON.stringify(got)}`);
    await page.evaluate(() => setLang("en")); await settle(page);
    await page.click(`.coachpanel [data-k="r-${OID}"]`); await inPanel(page, "the review", ".co-review .co-part");
    if (await text(page, '[data-k="fh"]') !== "Air reverse") throw new Error(`the review is headed ${JSON.stringify(await text(page, '[data-k="fh"]'))}`);
  },
  // Every review in the list but a ready one (whose page has Delete) and one held for the owner's check (held: deleting it would keep
  // the account's block for 90 days with nothing left for him to Clear, ruling P72) has Delete, with the same question as the review's;
  // one still with the coach too, as the backend deletes a review in any state. Cancel keeps it; yes sends DELETE /coach/reviews/{id},
  // and the list goes on without it, saying "Review deleted.". The list's green "Ready" is at least 4.5:1 on the light background.
  async rowDelete(open) {
    const QID = "q".repeat(22), NID = "n".repeat(22), HID = "h".repeat(22), deletes = [], rows = [
      { id: QID, move: "cutback", created: REVIEW_AT, status: "reviewing", published: null, note: null },
      { id: RID, move: "top_turn", created: REVIEW_AT - 3600e3, status: "ready", published: REVIEW_AT, note: null },
      { id: NID, move: "popup", created: REVIEW_AT - 86400e3, status: "not_reviewed", published: null, note: "late" },
      { id: HID, move: "cutback", created: REVIEW_AT - 2 * 86400e3, status: "not_reviewed", published: null, note: "not_surf", held: true }];
    const backend = (q, req) => { if (q.pathname === "/coach/me") return { body: me({ reviews: rows.filter(r => !deletes.includes(r.id)) }) };
      const m = /^\/coach\/reviews\/([\w-]{22})$/.exec(q.pathname); if (m && req.method() === "DELETE") { deletes.push(m[1]); return { body: { ok: true } }; }
      return { body: { reports: [], online: 0, last_id: 0 } }; };
    const page = await open({ store: TOKEN, backend }), ASK = "Delete this review? It and its key frames are deleted from WaveSlave.";
    await page.tap(TAB); await inPanel(page, "Delete on the review still with the coach", `[data-k="rdel-${QID}"]`);
    if (await page.$(`.coachpanel [data-k="rdel-${RID}"]`) || !await page.$(`.coachpanel [data-k="rdel-${NID}"]`)) throw new Error("Delete isn't on every row but the ready one");
    if (await page.$(`.coachpanel [data-k="rdel-${HID}"]`)) throw new Error("Delete is on a review held for the owner's check");
    const ready = await page.evaluate(() => { const lum = c => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b; }, [x, y] = [lum(getComputedStyle(document.querySelector(".coachpanel .co-st-ready")).color),
        lum(getComputedStyle(document.querySelector(".coachpanel")).backgroundColor)].sort((p, q) => q - p);
      return Math.round((x + 0.05) / (y + 0.05) * 100) / 100; });
    if (!(ready >= 4.5)) throw new Error(`"Ready" is ${ready}:1 on the light background`);
    await page.click(`.coachpanel [data-k="rdel-${QID}"]`); await inPanel(page, "Delete's question", `[data-k="rdelyes-${QID}"]`);
    const ask = await text(page, ".co-list .co-ask p");
    if (ask !== ASK) throw new Error(`Delete asks ${JSON.stringify(ask)}`);
    await page.evaluate(() => setLang("zh")); await settle(page);
    const zh = [await text(page, ".co-list .co-ask p"), await text(page, `[data-k="rdelyes-${QID}"]`)]; await page.evaluate(() => setLang("en")); await settle(page);
    if (!eq(zh, ["要刪除這份講評嗎？講評和它的關鍵影格都會從 WaveSlave 刪除。", "刪除"])) throw new Error(`in 中文 Delete asks ${JSON.stringify(zh)}`);
    await page.click(`.coachpanel [data-k="rdelno-${QID}"]`); await settle(page);
    if (deletes.length || await page.$(".coachpanel .co-list .co-ask")) throw new Error(`Cancel: ${JSON.stringify(deletes)}`);
    await page.click(`.coachpanel [data-k="rdel-${NID}"]`); await page.click(`.coachpanel [data-k="rdelyes-${NID}"]`); await inPanel(page, '"Review deleted."', '[data-k="said"]');
    const left = await page.$$eval(".coachpanel .co-list li .co-mv", e => e.map(x => x.textContent));
    if (!eq(deletes, [NID]) || await text(page, '[data-k="said"]') !== "Review deleted." || !eq(left, ["Cutback", "Top turn", "Cutback"])) throw new Error(`after Delete: ${JSON.stringify({ deletes, left })}`);
  },
  // An account GET /coach/me says is blocked has the blocked line in place of New review (and of the agreement), in English and 中文.
  async blockedMe(open) {
    for (const agreed of [true, false]) {
      const page = await open({ store: TOKEN, backend: coachBackend({ blocked: true, agreed }) }); await page.tap(TAB); await inPanel(page, "the panel", ".co-left");
      const got = await page.evaluate(() => ({ why: (document.querySelector(".coachpanel .co-why") || {}).textContent || null, new: !!document.querySelector('.coachpanel [data-k="new"]'),
        agree: !!document.querySelector(".coachpanel .co-agree") }));
      if (!eq(got, { why: BLOCKED, new: false, agree: false })) throw new Error(`blocked (agreed ${agreed}): ${JSON.stringify(got)}`);
      await page.evaluate(() => setLang("zh")); await settle(page);
      if (await text(page, ".co-why") !== "這個帳號無法使用教練。") throw new Error(`in 中文 blocked says ${JSON.stringify(await text(page, ".co-why"))}`);
    }
  },
  // GET /coach/me refused 429 too_many (one account's cap a day, ruling P68) says so, with Try again, in English and 中文.
  async tooMany(open) {
    const backend = q => q.pathname === "/coach/me" ? { status: 429, body: { error: "too_many" } } : { body: { reports: [], online: 0, last_id: 0 } };
    const page = await open({ store: TOKEN, backend }); await page.tap(TAB); await inPanel(page, "the refusal", ".co-err");
    const got = { err: await text(page, ".co-err"), retry: !!await page.$('.coachpanel [data-k="retry"]') };
    await page.evaluate(() => setLang("zh")); await settle(page);
    if (!eq(got, { err: TOO_MANY, retry: true }) || await text(page, ".co-err") !== "今天嘗試太多次了，請明天再試。") throw new Error(`too_many: ${JSON.stringify(got)}, in 中文 ${JSON.stringify(await text(page, ".co-err"))}`);
  },
  // A draft with fewer than 8 key frames kept has no Redo; one refused no_frames all the same (its key frames cleared meanwhile) says
  // why on its card, in English and 中文, and its note box shuts.
  async draftsNoFrames(open) {
    const st = draftsBackend([drafted(DA, { have: TWELVE }), drafted(DB)], { act: () => ({ status: 409, body: { error: "no_frames" } }) });
    const page = await open({ store: TOKEN, backend: st.backend });
    await page.tap(TAB); await inPanel(page, "A's Redo", `[data-k="act-${DA}-redo"]`);
    const acts = await page.$$eval(`.coachpanel .co-dr[data-id="${DB}"] .co-dr-acts button`, b => b.map(x => x.textContent));
    if (!eq(acts, ["Approve", "Reject", "Ban"])) throw new Error(`with 4 key frames kept B's buttons are ${JSON.stringify(acts)}`);
    await page.click(`.coachpanel [data-k="act-${DA}-redo"]`); await page.fill(`.coachpanel [data-k="note-${DA}"]`, "Back foot");
    await page.click(`.coachpanel [data-k="yes-${DA}"]`); await inPanel(page, "A's red line", `.co-dr[data-id="${DA}"] .co-dr-err`);
    const line = await text(page, `.co-dr[data-id="${DA}"] .co-dr-err`), note = !!await page.$(`.coachpanel [data-k="note-${DA}"]`);
    await page.evaluate(() => setLang("zh")); await settle(page);
    const zh = await text(page, `.co-dr[data-id="${DA}"] .co-dr-err`);
    if (line !== "Its key frames are already cleared, so it can't be redone." || note || zh !== "它的關鍵影格已經清除了，所以不能重寫。") throw new Error(`no_frames: ${JSON.stringify({ line, note, zh })}`);
  },
  // Emptying the heads-up's box or the progress line's removes that part (ruling P64): Approve sends them empty. Any other line emptied
  // is refused on the page, sending nothing.
  async draftsRemove(open) {
    const text2 = reviewText({ heads_up: { text: "Watch the rocks on the inside.", move: "bottom_turn" }, progress: "Lower than last time." });
    const st = draftsBackend([drafted(DA, { draft: text2 }), drafted(DB)]), page = await open({ store: TOKEN, backend: st.backend });
    const box = (id, p) => `.coachpanel [data-k="ed-${id}-${p}"]`;
    await page.tap(TAB); await inPanel(page, "A's heads-up box", `[data-k="ed-${DA}-heads_up.text"]`);
    await page.fill(box(DA, "heads_up.text"), "  "); await page.fill(box(DA, "progress"), "");
    await page.click(`.coachpanel [data-k="act-${DA}-approve"]`); await soon("A's Approve", () => st.acts.length === 1);
    if (!eq(st.acts[0], [DA, { action: "approve", ver: verOf(drafted(DA)), edits: { "heads_up.text": "", progress: "" } }])) throw new Error(`Approve sent ${JSON.stringify(st.acts[0])}`);
    await page.fill(box(DB, "went_well.title"), " "); await page.click(`.coachpanel [data-k="act-${DB}-approve"]`); await inPanel(page, "B's red line", `.co-dr[data-id="${DB}"] .co-dr-err`);
    const line = await text(page, `.co-dr[data-id="${DB}"] .co-dr-err`);
    if (st.acts.length !== 1 || line !== "Each line needs 1 to 1,000 characters. Only the heads-up and progress may be left empty.") throw new Error(`B with an empty title: ${JSON.stringify({ line, acts: st.acts.length })}`);
  },
  // On a 360-wide phone each edit box is as tall as its text, in English and 中文 (no line cut off), at least two lines, and at most
  // its maximum, past which it scrolls; it grows as it's typed in.
  async draftsFit(open) {
    const LONG = "Keep your front knee bent and your chest over it as you come off the top of the wave. ".repeat(11);
    const en = reviewText({ heads_up: { text: "Your back knee locks straight on your cutback too, so the board slides out from under you when you lean into the turn.", move: "cutback" },
      main_fix: { frames: [6, 7, 8], title: "Stay over your front foot", what: LONG, why: "The board runs away from under you." } });
    const zh = reviewText({ went_well: { frame: 2, title: "身體壓低，重心在板子上", detail: "進入轉向前，你兩個膝蓋都彎著，頭抬高、看著前方。板子平穩地貼在浪壁上，這個起步又穩又好。" },
      main_fix: { frames: [6, 7, 8], title: "重心留在前腳", what: "衝上浪頂時，你的重心往後滑到板尾。前腿打直，整個人坐到後腳上（0:11.7 的關鍵影格）。板子往前衝出去，你就往後摔下來（0:12.0 和 0:12.2 的關鍵影格）。",
        why: "重心在板尾，板子會從你腳下溜走，轉到一半就摔下來。前膝保持彎曲、胸口壓在前膝上方，板子就會留在你腳下。" },
      drill: { title: "沙灘上練前膝轉向", how: "在沙灘上用衝浪站姿站好，膝蓋彎曲。轉頭、轉肩膀，想像自己正在浪頂。轉的同時把前膝往前推，胸口帶到前膝上方，停三秒。下水前慢慢做 10 次。" } });
    const st = draftsBackend([drafted(DA, { draft: en }), drafted(DB, { lang: "zh", draft: zh })]), page = await open({ store: TOKEN, backend: st.backend });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.tap(TAB); await inPanel(page, "B's edit boxes", `[data-k="ed-${DB}-drill.how"]`); await settle(page);
    const boxes = () => page.evaluate(() => [...document.querySelectorAll(".coachpanel .co-ed textarea")].map(t => { const c = getComputedStyle(t);
      return { k: t.dataset.k, cut: t.scrollHeight - t.clientHeight, h: t.getBoundingClientRect().height, line: parseFloat(c.lineHeight), max: parseFloat(c.maxHeight), oy: c.overflowY }; }));
    const fits = async what => { const bs = await boxes(); if (bs.length !== 18) throw new Error(`${what}: ${bs.length} edit boxes`);
      for (const b of bs) { const long = b.k === `ed-${DA}-main_fix.what`;
        if (!(b.max > 0) || b.h > b.max + 1 || b.h < 2 * b.line) throw new Error(`${what}: ${b.k} is ${b.h}px tall, ${b.line}px lines, at most ${b.max}px`);
        if (long ? !(b.cut > 0 && b.oy === "auto") : b.cut > 1) throw new Error(`${what}: ${b.k} cuts off ${b.cut}px (overflow ${b.oy})`); } return bs; };
    const before = await fits("in English");
    const hu = `ed-${DA}-heads_up.text`; await page.focus(`.coachpanel [data-k="${hu}"]`); await page.keyboard.press("End");
    await page.keyboard.type(" Look up the line first, then turn.".repeat(3)); await settle(page);
    const grown = await fits("typed in"), h0 = before.find(b => b.k === hu).h, h1 = grown.find(b => b.k === hu).h;
    if (!(h1 > h0)) throw new Error(`the heads-up box didn't grow as it was typed in: ${h0}px, then ${h1}px`);
    await page.evaluate(() => document.activeElement.blur()); await page.evaluate(() => setLang("zh")); await settle(page); await fits("in 中文");
  },
  // Enter while an input method still has the key (keyCode 229, as an iPhone's 中文 keyboard gives it) doesn't send Something wrong?'s
  // line or a Drafts note; Enter itself does.
  async enterIme(open) {
    const ime = sel => (page => page.evaluate(s => { const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(e, "keyCode", { get: () => 229 }); document.querySelector(s).dispatchEvent(e); }, sel));
    const st = reviewBackend(reviewText({})), page = await open({ store: TOKEN, backend: st.backend });
    await openRid(page); await page.click('.coachpanel [data-k="wrong"]'); await page.fill('.coachpanel [data-k="wrongline"]', "選錯了");
    await ime('.coachpanel [data-k="wrongline"]')(page); await wait(500);
    if (st.reports.length) throw new Error(`Enter at keyCode 229 sent ${JSON.stringify(st.reports)}`);
    await page.focus('.coachpanel [data-k="wrongline"]'); await page.keyboard.press("Enter"); await soon("the report", () => st.reports.length === 1);
    const d = draftsBackend([drafted(DA)]), dp = await open({ store: TOKEN, backend: d.backend });
    await dp.tap(TAB); await inPanel(dp, "A's Reject", `[data-k="act-${DA}-reject"]`); await dp.click(`.coachpanel [data-k="act-${DA}-reject"]`);
    await dp.fill(`.coachpanel [data-k="note-${DA}"]`, "拍近一點"); await ime(`.coachpanel [data-k="note-${DA}"]`)(dp); await wait(500);
    if (d.acts.length) throw new Error(`Enter at keyCode 229 in a Drafts note sent ${JSON.stringify(d.acts)}`);
    await dp.focus(`.coachpanel [data-k="note-${DA}"]`); await dp.keyboard.press("Enter"); await soon("Reject", () => d.acts.length === 1);
  },
  // A seek on its way while the page is hidden gets 20 s afresh once the page shows again: with the clip's seeks held back, hidden as
  // the cut starts and shown 12 s later, the cut is still going 22 s in (the stall timer's first mark finds the page shown, and once
  // gave up there: "This phone can't open that clip.").
  async seekHidden(open, { tmp }) {
    const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend }), b = boxAt(640, 360, 6, 3);
    await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
    await page.setInputFiles('.coachpanel input[type="file"]', makeClip(tmp, {}));
    await inPanel(page, "the questions", '[data-k="move-top_turn"]'); await page.click('.coachpanel [data-k="move-top_turn"]'); await page.click('.coachpanel [data-k="next"]');
    await slideTo(page, 3); await page.click('.coachpanel [data-k="here"]'); await inPanel(page, "the frame, ready for a tap", ".co-frame[data-ready]");
    await page.evaluate(() => { const v = document.querySelector(".coachpanel video"), d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
      Object.defineProperty(v, "currentTime", { configurable: true, get() { return d.get.call(this); }, set() {} });
      window.__vis = "hidden"; Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__vis });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__vis === "hidden" });
      document.dispatchEvent(new Event("visibilitychange")); });
    await tapAt(page, b.x, b.y); await inPanel(page, "the cut", ".co-prog");
    await wait(12e3); await page.evaluate(() => { window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
    await wait(10e3);
    const got = { head: await text(page, '[data-k="fh"]'), err: await text(page, ".co-err") };
    if (!eq(got, { head: "Cutting your key frames…", err: null })) throw new Error(`22 s in, shown again at 12 s: ${JSON.stringify(got)}`);
  },
  // ‹ Back on the check screen: with a key frame open, it shuts it; with the clip there, it goes back to Find the move, at Here.
  async checkBack(open, { tmp }) {
    const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend }), b = boxAt(640, 360, 6, 2.5);
    await toCheck(page, makeClip(tmp, { gap: [2.9, 3.1] }), { at: 2.5, x: b.x, y: b.y });
    await inPanel(page, "the lost key frame", '[data-k="notin"]');
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "the 12 close-ups", ".co-grid");
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "Find the move", '[data-k="slider"]');
    const got = { head: await text(page, '[data-k="fh"]'), at: await page.evaluate(() => +document.querySelector('.coachpanel [data-k="slider"]').value) };
    if (!eq(got, { head: "Find the move", at: 2.5 })) throw new Error(`‹ Back from the check screen shows ${JSON.stringify(got)}`);
    // On to the questions and out: Pick up opens the check screen again, its key frames as they were, not the questions.
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "the questions", '[data-k="move-top_turn"]');
    await page.click('.coachpanel [data-k="back"]'); await inPanel(page, "Pick up", '[data-k="pickup"]');
    await page.click('.coachpanel [data-k="pickup"]'); await inPanel(page, "the check screen again", ".co-grid, .co-flow h3");
    const back = { grid: !!await page.$(".coachpanel .co-grid"), lost: (await page.$$(".coachpanel .co-tile.co-lost")).length };
    if (!back.grid || back.lost < 1) throw new Error(`Pick up after ‹ Back from the check screen shows ${JSON.stringify(back)}`);
  },
  // A Drafts card shows the heads-up's button as the surfer will have it ("Get a review of your bottom turn"), which does nothing there,
  // and the "used a word" warning names the words the backend found, in English and 中文.
  async draftsHeadsUp(open) {
    const st = draftsBackend([drafted(DA, { draft: reviewText({ heads_up: { text: "Watch the rocks on the inside.", move: "bottom_turn" } }), warnings: ["words"], words: ["video", "照片"] })]);
    const page = await open({ store: TOKEN, backend: st.backend });
    await page.tap(TAB); await inPanel(page, "A's heads-up button", `[data-k="headsup-${DA}"]`);
    const look = () => page.evaluate(id => ({ btn: document.querySelector(`.coachpanel [data-k="headsup-${id}"]`).textContent,
      off: document.querySelector(`.coachpanel [data-k="headsup-${id}"]`).getAttribute("aria-disabled"), warn: [...document.querySelectorAll(".coachpanel .co-warn li")].map(l => l.textContent) }), DA);
    const en = await look();
    await page.click(`.coachpanel [data-k="headsup-${DA}"]`, { force: true }); await settle(page); // aria-disabled: Playwright won't click it unforced
    if (await page.$(".coachpanel .co-flow")) throw new Error("the heads-up's button on a Drafts card started New review");
    await page.evaluate(() => setLang("zh")); await settle(page); const zh = await look();
    const wantEn = { btn: "Get a review of your bottom turn", off: "true", warn: ["It used a word surfers shouldn't see. Find it and change it before you approve. Found: “video”, “照片”."] };
    const wantZh = { btn: "讓教練講評你的底部轉向", off: "true", warn: ["用到了不該讓衝浪者看到的字詞，核准前請找出來改掉。找到：「video」、「照片」。"] };
    if (!eq(en, wantEn) || !eq(zh, wantZh)) throw new Error(`the card shows ${JSON.stringify(en)}, in 中文 ${JSON.stringify(zh)}`);
  },
  // Find the move's slider is in the coach's amber (accent-color); the coach's amber is darker in the light theme, so its small text is
  // at least 4.5:1 on the page's background, and in the dark theme it is the site's own amber, as it was.
  async amber(open, { tmp }) {
    const page = await open({ store: TOKEN, backend: flowBackend().backend });
    await page.tap(TAB); await inPanel(page, "New review", '[data-k="new"]'); await page.click('.coachpanel [data-k="new"]');
    await page.setInputFiles('.coachpanel input[type="file"]', makeClip(tmp, {})); await inPanel(page, "the questions", '[data-k="move-top_turn"]');
    await page.click('.coachpanel [data-k="move-top_turn"]'); await page.click('.coachpanel [data-k="next"]'); await inPanel(page, "the slider", '[data-k="slider"]');
    const look = () => page.evaluate(() => { const lum = c => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b; }, ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const back = getComputedStyle(document.querySelector('.coachpanel [data-k="back"]')).color, bg = getComputedStyle(document.querySelector(".coachpanel")).backgroundColor;
      return { slider: getComputedStyle(document.querySelector('.coachpanel [data-k="slider"]')).accentColor, back, ratio: Math.round(ratio(back, bg) * 100) / 100 }; });
    const light = await look();
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark")); await settle(page); const dark = await look();
    if (light.slider !== light.back || !(light.ratio >= 4.5) || dark.back !== "rgb(255, 207, 92)" || dark.slider !== dark.back) throw new Error(`light ${JSON.stringify(light)}, dark ${JSON.stringify(dark)}`);
  },
  // web/coach.js ships to every surfer, so its comments say "the owner", never his name (ruling P65).
  async noOwnerName() {
    const named = COACH_JS.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /Bryan/.test(l)).map(([n]) => n);
    if (named.length) throw new Error(`web/coach.js names the owner on lines ${named.join(", ")}`);
  },
  // The page's hooks never throw, whatever they're given, and a spot the page doesn't have leaves the tab as html.tw says.
  async hooksHold(open) {
    const page = await open({}); await wait(300);
    const errs = await page.evaluate(() => { const out = [];
      for (const [k, a] of [["spot", [undefined]], ["spot", [123]], ["spot", ["nowhere"]], ["relang", []], ["dev", []], ["open", []], ["open", []], ["spot", ["donghe"]]])
        try { window.COACH[k](...a); } catch (e) { out.push(`${k}(${a}) threw ${e}`); }
      return out; });
    if (errs.length) throw new Error(errs.join("; "));
  },
  // coach.js adds one global, window.COACH = {dev, relang, spot, open}, and nothing else; it has no HTML sinks and writes no data-zh or
  // data-ja, and no element of the coach carries them.
  async noGlobals(open) {
    const names = async page => { await settle(page); await wait(300); return page.evaluate(() => Object.getOwnPropertyNames(window)); };
    const on = await open({ test: false }), a = await names(on), b = new Set(await names(await open({ test: false, coachJs: "" }))), extra = a.filter(k => !b.has(k));
    if (!eq(extra, ["COACH"])) throw new Error(`coach.js adds ${JSON.stringify(extra)}, want only COACH`);
    const keys = await on.evaluate(() => Object.keys(window.COACH).sort());
    if (!eq(keys, ["dev", "open", "relang", "spot"])) throw new Error(`window.COACH has ${keys.join(", ")}`);
    const code = COACH_JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    const sinks = code.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|data-zh|data-ja/g);
    if (sinks) throw new Error(`coach.js uses ${[...new Set(sinks)].join(", ")}`);
    await on.tap(TAB); await settle(on);
    const tagged = await on.evaluate(() => [document.querySelector(".coachpanel"), ...document.querySelectorAll(".coachpanel *")].filter(e => [...e.attributes].some(a => /^data-(zh|ja)/.test(a.name))).length);
    if (tagged) throw new Error(`${tagged} coach elements carry data-zh or data-ja`);
  },
};
// A check name it doesn't have is a mistake in the command, not a pass with nothing run.
const unknown = ONLY.filter(n => !Object.prototype.hasOwnProperty.call(CHECKS, n));
if (unknown.length) { console.error(`no check called ${unknown.join(", ")}\n${USAGE}`); process.exit(2); }

(async () => {
  const browser = await chromium.launch(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coach-shell-")); let bad = false, ctxs = [], errs = [];
  // A fresh context for every page. The page, chat.js (chatJs) and coach.js (coachJs) load from here, null leaving one out; the fake
  // backend answers what backend(url) gives back (null: the network fails); everything else is cut off. page.asked lists the backend calls.
  //   world: developer mode (World mode, the PIN in); pub: window.__chatPublic; coachPub: window.__coachPublic; url: window.__chatUrl;
  //   view: the saved view; test: window.__chatTest; store: localStorage entries; clock: the page's fixed time (page.clock); skew: Date.now
  //   moved on by window.__skew(ms); query: the address's ?… before #<spot>. backend(url, request) answers the fake backend's calls. ua: the
//   browser's user agent; init: more init scripts, each a function (or [function, its argument]); tz: the phone's time zone (the
//   machine's when null). An answer with jpeg (bytes) goes as image/jpeg, one with text as text/plain; backend may answer with a promise of
//   one, to hold it back.
  async function open({ spot = "donghe", world = true, pub = false, coachPub = false, url = CHAT, view = "fc", test = true, store = {}, chatJs = CHAT_JS, coachJs = COACH_JS,
    clock = null, skew = false, query = "", backend = () => ({ body: { reports: [], online: 0, last_id: 0 } }), ua = null, init = [], tz = null }) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block",
      ...(ua ? { userAgent: ua } : {}), ...(tz ? { timezoneId: tz } : {}) });
    ctxs.push(ctx); const asked = [], tried = [];
    await ctx.route("**/*", async r => { const u = r.request().url(), bare = u.split(/[?#]/)[0];
      if (bare === PAGE) return r.continue();
      if (u.startsWith("file:") && bare.endsWith("/chat.js")) return chatJs == null ? r.abort() : r.fulfill({ contentType: "text/javascript", body: chatJs });
      if (u.startsWith("file:") && bare.endsWith("/coach.js")) return coachJs == null ? r.abort() : r.fulfill({ contentType: "text/javascript", body: coachJs });
      if (u.startsWith(CHAT + "/")) { const q = new URL(u); asked.push(q.pathname + q.search); const a = await backend(q, r.request());
        // An answer held back may come after its context has closed: that's no failure of the page.
        return (a ? r.fulfill({ status: a.status || 200, contentType: a.jpeg ? "image/jpeg" : typeof a.text === "string" ? "text/plain" : "application/json", headers: { "access-control-allow-origin": "*" },
          body: a.jpeg || (typeof a.text === "string" ? a.text : JSON.stringify(a.body)) }) : r.abort()).catch(() => {}); }
      if (u.startsWith("https:") || u.startsWith("http:") || u.startsWith("wss:")) tried.push(u);
      return r.abort(); });
    await ctx.addInitScript(([o, lock]) => {
      try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", o.view); localStorage.setItem("waveslave-lang", "en"); localStorage.setItem("waveslave-world", o.world ? "1" : "0");
        for (const k in o.store) localStorage.setItem(k, o.store[k]); if (lock) sessionStorage.setItem("waveslave-unlock", lock); } catch (e) {}
      window.__chatUrl = o.url; window.__chatContact = o.contact; if (o.test) window.__chatTest = true; if (o.pub) window.__chatPublic = true; if (o.coachPub) window.__coachPublic = true;
      if (o.skew) { const now = Date.now; let by = 0; Date.now = () => now() + by; window.__skew = ms => { by += ms; }; } },
      [{ view, world, store, url, contact: CONTACT, test, pub, coachPub, skew }, LOCK]);
    for (const i of init) await (Array.isArray(i) ? ctx.addInitScript(i[0], i[1]) : ctx.addInitScript(i));
    const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e)));
    if (clock != null) await page.clock.setFixedTime(clock);
    await page.goto(PAGE + query + "#" + spot, { waitUntil: "load" }); await settle(page);
    page.asked = asked; page.tried = tried; return page;
  }
  // Runs one check and prints `ok <name>` or `FAIL <name>: why`; a page error during it fails it.
  async function step(name, run) {
    let status = "ok", note = ""; errs = [];
    try { await run(); } catch (e) { [status, note] = e instanceof Skip ? ["skip", e.message] : ["FAIL", e.message]; }
    if (errs.length) [status, note] = ["FAIL", "page error: " + errs.join("; ")];
    if (status === "FAIL") bad = true;
    console.log(status === "FAIL" ? `FAIL ${name}: ${note}` : `${status} ${name}${note ? ` (${note})` : ""}`);
    await Promise.all(ctxs.map(c => c.close())); ctxs = [];
  }
  // A blank page in a fresh context, for the checks that don't need the site.
  const blank = async () => { const ctx = await browser.newContext(); ctxs.push(ctx); const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e))); return page; };
  try { for (const [name, run] of Object.entries(CHECKS)) if (!ONLY.length || ONLY.includes(name)) await step(name, () => run(open, { blank, tmp })); }
  finally { await browser.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  process.exitCode = bad ? 1 : 0;
})();
