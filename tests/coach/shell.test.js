// Browser checks of the AI coach's page shell on a built page (build one with tests/map/tool.py): web/coach.js, served for the page's
// coach.js, and its hooks in template.html (the hidden Coach tab, the tab handler, the language, developer mode and spot hooks, and the
// Escape and pull-to-refresh guards), and the test clips tests/coach/clips.js makes.
// Usage: node tests/coach/shell.test.js <page.html>
// Prints ok / FAIL for each check, and exits 1 on any FAIL or page error.
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

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: node tests/coach/shell.test.js <page.html>"); process.exit(2); }
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
// JPEG (Bryan's example's first), noting each ask's number and Authorization (st.frames); POST …/report answering st.report (o.report
// at first) or {ok} (st.reports notes the bodies) and DELETE {ok} (st.deletes).
const JPEG = fs.readFileSync(path.join(ROOT, "web", "coach-example", "1.jpg"));
const RID = "r".repeat(22), KEY_MS = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 10000 + 250 * (i + 1)]));
const REVIEW_AT = Date.UTC(2030, 10, 2, 2);
function reviewBackend(text, { checked = true, note = "We couldn't see you. Try filming closer.", get = null, report = null } = {}) {
  const st = { frames: [], reports: [], deletes: 0, report };
  const reviews = [{ id: RID, move: "top_turn", created: REVIEW_AT, status: "ready", published: REVIEW_AT + 3600e3, note: null },
    { id: "n".repeat(22), move: "cutback", created: REVIEW_AT - 86400e3, status: "not_reviewed", published: null, note: "not_surf" },
    { id: "m".repeat(22), move: "popup", created: REVIEW_AT - 2 * 86400e3, status: "not_reviewed", published: null, note }];
  st.backend = (q, req) => {
    const p = q.pathname, m = req.method(), frame = new RegExp(`^/coach/reviews/${RID}/frames/(\\d+)$`).exec(p);
    if (p === "/coach/me") return { body: me({ profile: PROFILE, reviews }) };
    if (p === `/coach/reviews/${RID}` && m === "GET") return get || { body: { id: RID, status: "published", move: "top_turn", created: REVIEW_AT, have: Object.keys(KEY_MS).map(Number), note: null,
      review: { text, times: KEY_MS, checked } } };
    if (frame && m === "GET") { st.frames.push({ n: +frame[1], auth: req.headers().authorization || null }); return { jpeg: JPEG }; }
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
const BLOCKED = "This account can't use the coach.", BREAK = "Coach is taking a break. Try again later.";
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
  // Something wrong? opens one optional line; Send posts it. invalid (or state) says "Couldn't send. Tap to try again." on the button, which
  // sends again; a 401 there hands the token back and shows Sign in with LINE. Delete asks first (Cancel keeps it).
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
    st.report = { status: 401, body: { error: "auth" } }; await page.click('.coachpanel [data-k="wrongsend"]'); await inPanel(page, "Sign in with LINE", ".co-signin");
    if (await page.evaluate(() => localStorage.getItem("waveslave-chat-token")) !== null) throw new Error("a 401 on Something wrong? left the token");
  },
  // Every refusal at the start of a send, with its message from the spec's table (a money rest naming its day in Taiwan time: "16
  // November", 「11月16日」), and the Send button there again; invalid and state say "Couldn't send. Tap to try again." on the button; agree
  // shows the agreement again, and once it's agreed the check screen is back. The draft keeps its 12 key frames all along, and nothing
  // is sent but the starts, until one goes through.
  async sendCodes(open, { tmp }) {
    const st = flowBackend(), page = await open({ store: TOKEN, backend: st.backend }), b = boxAt(640, 360, 6, 3);
    await toCheck(page, makeClip(tmp, {}), { at: 3, x: b.x, y: b.y });
    const look = () => page.evaluate(() => { const q = s => document.querySelector(".coachpanel " + s), s = q('[data-k="send"]');
      return { said: q(".co-said") && q(".co-said").textContent, retry: q('[data-k="retry"]') && q('[data-k="retry"]').textContent, send: !!s && !s.disabled }; });
    const refuse = async (status, body) => { st.refuse = { status, body }; const n = st.starts.length;
      await page.click('.coachpanel [data-k="send"], .coachpanel [data-k="retry"]'); await soon(`the start refused with ${body.error}`, () => st.starts.length > n);
      await inPanel(page, "the check screen", '.co-grid', 20e3); await settle(page); return look(); };
    const MONEY = { error: "money", until: Date.UTC(2030, 10, 16) };
    for (const [status, body, said] of [[503, MONEY, "Coach is resting until 16 November."], [503, { error: "break" }, BREAK], [429, { error: "full_today" }, "Coach is full today. Try again tomorrow."],
      [429, { error: "no_reviews_left" }, "You've used your 2 reviews for November. More on December 1."], [409, { error: "in_progress" }, "Your last review is still with the coach."],
      [403, { error: "blocked" }, BLOCKED], [403, { error: "banned" }, BLOCKED], [400, { error: "too_few_frames" }, NEED8], [400, { error: "invalid" }, null], [409, { error: "state" }, null]]) {
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
    if (st.agrees !== 1 || !eq(back, { said: null, retry: FAILED, send: false })) throw new Error(`after agreeing again: ${st.agrees} agrees, ${JSON.stringify(back)}`);
    if (!d || d.frames.length !== 12 || !d.frames.every(f => f.blob > 0) || st.frames.length) throw new Error(`after the refusals the draft has ${d && d.frames.length} key frames, ${st.frames.length} sent`);
    st.refuse = null; await page.click('.coachpanel [data-k="retry"]'); await inPanel(page, `"${SENT}"`, ".co-ok", 30e3);
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
  // What GET /coach/me says stops a review shows in the panel (money with its Taiwan day, a break, the day full, no reviews left this
  // server month), in English and 中文; and its refusals: 403 banned "This account can't use the coach." with no Try again, 503 break
  // "Coach is taking a break. Try again later." with it. I agree answered 503 break says so too.
  async meCodes(open) {
    const look = page => page.evaluate(() => { const q = s => document.querySelector(".coachpanel " + s);
      return { why: q(".co-why") && q(".co-why").textContent, err: q(".co-err:not(.co-why)") && q(".co-err:not(.co-why)").textContent, retry: !!q('[data-k="retry"]') }; });
    const shown = async (o, status = 200) => { const page = await open({ store: TOKEN, backend: coachBackend(o, status) }); await page.tap(TAB);
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
    const backend = (q, req) => q.pathname === "/coach/agree" ? { status: 503, body: { error: "break" } } : coachBackend({ agreed: false })(q, req);
    const page = await open({ store: TOKEN, backend }); await page.tap(TAB); await inPanel(page, "the agreement", '[data-k="agree"]');
    await page.check('.coachpanel [data-k="adult"]'); await page.click('.coachpanel [data-k="agree"]');
    await page.waitForFunction(() => { const e = [...document.querySelectorAll(".coachpanel .co-agree .co-err")].find(x => !x.hidden); return !!e; }, null, { timeout: 5000 }).catch(() => {});
    const said = await page.evaluate(() => [...document.querySelectorAll(".coachpanel .co-agree .co-err")].filter(x => !x.hidden).map(x => x.textContent));
    if (!eq(said, [BREAK])) throw new Error(`I agree answered 503 break says ${JSON.stringify(said)}`);
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

(async () => {
  const browser = await chromium.launch(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coach-shell-")); let bad = false, ctxs = [], errs = [];
  // A fresh context for every page. The page, chat.js (chatJs) and coach.js (coachJs) load from here, null leaving one out; the fake
  // backend answers what backend(url) gives back (null: the network fails); everything else is cut off. page.asked lists the backend calls.
  //   world: developer mode (World mode, the PIN in); pub: window.__chatPublic; coachPub: window.__coachPublic; url: window.__chatUrl;
  //   view: the saved view; test: window.__chatTest; store: localStorage entries; clock: the page's fixed time (page.clock); skew: Date.now
  //   moved on by window.__skew(ms); query: the address's ?… before #<spot>. backend(url, request) answers the fake backend's calls. ua: the
//   browser's user agent; init: more init scripts, each a function (or [function, its argument]). An answer with jpeg (bytes) goes as
//   image/jpeg.
  async function open({ spot = "donghe", world = true, pub = false, coachPub = false, url = CHAT, view = "fc", test = true, store = {}, chatJs = CHAT_JS, coachJs = COACH_JS,
    clock = null, skew = false, query = "", backend = () => ({ body: { reports: [], online: 0, last_id: 0 } }), ua = null, init = [] }) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block", ...(ua ? { userAgent: ua } : {}) });
    ctxs.push(ctx); const asked = [], tried = [];
    await ctx.route("**/*", r => { const u = r.request().url(), bare = u.split(/[?#]/)[0];
      if (bare === PAGE) return r.continue();
      if (u.startsWith("file:") && bare.endsWith("/chat.js")) return chatJs == null ? r.abort() : r.fulfill({ contentType: "text/javascript", body: chatJs });
      if (u.startsWith("file:") && bare.endsWith("/coach.js")) return coachJs == null ? r.abort() : r.fulfill({ contentType: "text/javascript", body: coachJs });
      if (u.startsWith(CHAT + "/")) { const q = new URL(u); asked.push(q.pathname + q.search); const a = backend(q, r.request());
        return a ? r.fulfill({ status: a.status || 200, contentType: a.jpeg ? "image/jpeg" : "application/json", headers: { "access-control-allow-origin": "*" }, body: a.jpeg || JSON.stringify(a.body) }) : r.abort(); }
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
  try { for (const [name, run] of Object.entries(CHECKS)) await step(name, () => run(open, { blank, tmp })); }
  finally { await browser.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  process.exitCode = bad ? 1 : 0;
})();
