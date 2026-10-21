// Browser checks of the Taiwan chat's room (web/chat.js) against the real backend (chat/): `wrangler dev` runs the Worker and the room
// with test secrets and ALLOWED_ORIGINS set to the page's origin, and `python3 -m http.server` serves a built page (tests/map/tool.py)
// with chat.js next to it, as the site does.
// Usage: node tests/chat/room.test.js <page.html>   (ONLY=reading,badge runs just those checks)
// Prints ok / FAIL for each check, and exits 1 on any FAIL or page error. It needs chat/'s node_modules (npm ci in chat/).
// - The room is seeded before the checks: wrangler dev starts once to make the room's tables, stops, the test writes accounts and 170-odd
//   messages straight into the room's SQLite file (python3's sqlite3), and wrangler dev starts again on it. Posting that many through the
//   socket would take an hour under the rate limits. Signed-in people get a session token signed here with the test SESSION_SECRET,
//   for a seeded account (the LINE sign-in is checked by tests/chat/flow.test.js).
// - Every page is a phone, 390x844, dpr 2, touch, reduced motion, English, Taiwan mode, the Forecast view, the intro done. The chat is
//   switched on the way the tests do it (window.__chatUrl and window.__chatContact). Anything but the page and the backend is cut off.
// - The room takes 5 sockets from one address, and every page here comes from 127.0.0.1, so each check opens at most 3 pages.
// - wrangler dev runs the Worker with --compatibility-date 2026-10-13: the workerd that comes with the pinned wrangler knows dates up to
//   then, and wrangler.toml's 2026-10-21 is only for the deploy.
// Playwright wherever node finds it (npm install playwright), else the copy this container keeps.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), os = require("os"), path = require("path"), net = require("net"), crypto = require("crypto"), { spawn, spawnSync } = require("child_process");

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: node tests/chat/room.test.js <page.html>"); process.exit(2); }
const ROOT = path.join(__dirname, "..", ".."), CHAT_DIR = path.join(ROOT, "chat"), HTML = fs.readFileSync(file, "utf8");
const WS = require(path.join(CHAT_DIR, "node_modules", "ws")); // the socket client the backend's own tooling brings (npm install in chat/)
const LOCK = (HTML.match(/\bH="([0-9a-f]{64})"/) || [])[1]; // a site build opens on the passcode screen: start unlocked
const CONTACT = { name: "Test Operator", email: "chat@example.com" };
const SECRET = "test-session-secret-0123456789abcdef", MIN = 60e3, DAY = 864e5;

const wait = ms => new Promise(r => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const b64u = s => Buffer.from(s).toString("base64url");
// A session token for a seeded account, as chat/src/auth.js signToken makes one: base64url {uid, tv, exp}, a dot, its HMAC-SHA256.
const token = uid => { const p = b64u(JSON.stringify({ uid, tv: 0, exp: Date.now() + DAY })); return p + "." + crypto.createHmac("sha256", SECRET).update(p).digest("base64url"); };
const freePort = () => new Promise((ok, no) => { const s = net.createServer().once("error", no).listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });

// ---- The seeded room. Accounts are 40 days old, so the checks that post only meet the 5 s and 10-minute limits; each posting check
// posts as its own account.
const USERS = {
  bryan: { nick: "Bryan", role: "admin" }, kai: { nick: "阿凱" }, mika: { nick: "Mika" }, leo: { nick: "Leo" }, fish: { nick: "小魚" },
  shalom: { nick: "שלום" }, evil: { nick: "<img src=x onerror=alert(2)>" },
  p1: { nick: "Poster1" }, p2: { nick: "Poster2" }, p3: { nick: "Poster3" }, p4: { nick: "Poster4" }, p5: { nick: "Poster5" },
};
const LONG = "W".repeat(500), EMOJI = "🏄🌊🤙🏄🌊🤙🏄🌊🤙🏄", RLO = "‮abc";
const SPOTS = [null, "jinshan", "fulong", "wushi", null, "suao", "donghe"];
function seedMessages(now) {
  const out = [], add = (who, kind, spot, body, more = {}) => { out.push({ uid: "u-" + who, kind, spot, body, ts: now - (240 - out.length) * MIN, ...more }); return out.length - 1; };
  const people = ["kai", "mika", "leo", "fish"];
  for (let i = 0; i < 150; i++) {
    const who = people[i % 4], spot = SPOTS[i % SPOTS.length];
    if (i % 25 === 7) add(who, "report", spot || "jinshan", { size: "chest", cond: "clean", crowd: "few", snap: { hs: 1.1, tp: 9, ws: 6, wd: 45, bhs: 1.0, hs_t: "2026-10-21T07:00" } });
    else if (i % 30 === 11) add(who, "session", spot || "wushi", { start: now - 3 * 3600e3, end: now - 1.5 * 3600e3, stars: 4, board: "minimal", note: "Kept nosediving on takeoff", cond: { hs: 0.9, tp: 7, ws: 9, wd: 40, tide: 0.3 } });
    else add(who, "text", spot, { text: `Message ${i + 1}` });
  }
  const parent = add("mika", "text", "wushi", { text: "Any tips? 有人可以給建議嗎？" });
  add("leo", "text", "wushi", { text: "Paddle two more strokes" }, { reply: parent });
  const gone = add("kai", "text", null, { text: "This one gets deleted" }, { gone: true });
  add("fish", "text", null, { text: "A reply to a deleted message" }, { reply: gone });
  add("bryan", "text", null, { text: "Welcome to the Taiwan chat. Be kind." });
  add("evil", "text", "jinshan", { text: "<img src=x onerror=alert(3)>" });
  add("evil", "report", "fulong", { size: "head", cond: "ok", crowd: "busy", snap: { hs: "<img src=x onerror=alert(4)>", bhs: 1.2 } });
  add("shalom", "text", null, { text: LONG });
  add("shalom", "text", null, { text: EMOJI });
  add("shalom", "text", "suao", { text: RLO });
  for (let i = 0; i < 6; i++) add(people[i % 4], "text", SPOTS[(i + 2) % SPOTS.length], { text: `Later message ${i + 1}` });
  add("bryan", "text", "jinshan", { text: "Swell's coming Thursday." });
  return out;
}
// Writes the accounts and messages into the room's SQLite file (wrangler dev stopped), as the room would have stored them.
const SEED = String.raw`
import json, sqlite3, sys
d = json.load(sys.stdin); c = sqlite3.connect(d["db"]); ids = []
with c:
    for u in d["users"]:
        c.execute("INSERT INTO users (id, sub_hash, nick, nick_key, role, tv, created, last_seen, nick_changed, consent_at, consent_ver) VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, 'v1')",
                  (u["id"], u["sub"], u["nick"], u["key"], u["role"], u["created"], u["seen"], u["created"]))
        c.execute("INSERT INTO subs (sub_hash, banned) VALUES (?, 0)", (u["sub"],))
    for m in d["messages"]:
        reply = ids[m["reply"]] if m.get("reply") is not None else None
        ids.append(c.execute("INSERT INTO messages (ts, uid, kind, spot, body, reply_to) VALUES (?, ?, ?, ?, ?, ?)",
                             (m["ts"], m["uid"], m["kind"], m["spot"], json.dumps(m["body"], ensure_ascii=False), reply)).lastrowid)
    for m, i in zip(d["messages"], ids):
        if m.get("gone"): c.execute("DELETE FROM messages WHERE id = ?", (i,))
    c.execute("INSERT INTO meta (key, value) VALUES ('admin_uid', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", ("u-bryan",))
c.close(); print(json.dumps(ids))
`;

// ---- The servers.
let tmp, pagePort, chatPort, wrangler = null, site = null;
const ORIGIN = () => `http://127.0.0.1:${pagePort}`, CHAT = () => `http://127.0.0.1:${chatPort}`;
function startWrangler() {
  const log = fs.openSync(path.join(tmp, "wrangler.log"), "a");
  wrangler = spawn(path.join(CHAT_DIR, "node_modules", ".bin", "wrangler"), ["dev", "--ip", "127.0.0.1", "--port", String(chatPort), "--env-file", path.join(tmp, "dev.env"),
    "--persist-to", path.join(tmp, "state"), "--compatibility-date", "2026-10-13", "--show-interactive-dev-session=false", "--log-level", "warn"],
    { cwd: CHAT_DIR, detached: true, stdio: ["ignore", log, log], env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
  return up(`${CHAT()}/reports?spot=jinshan`, "wrangler dev");
}
async function up(url, what) {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (e) {} await wait(500); }
  throw new Error(`${what} didn't come up (see ${path.join(tmp, "wrangler.log")})`);
}
// Stops a server started with its own process group (wrangler dev runs workerd under it), and waits for it to go.
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise(r => child.once("exit", r));
  try { process.kill(-child.pid, "SIGTERM"); } catch (e) {}
  if (await Promise.race([gone.then(() => true), wait(8000).then(() => false)])) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch (e) {} await gone;
}
async function setUp() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chat-room-")); [pagePort, chatPort] = [await freePort(), await freePort()];
  const dir = path.join(tmp, "site"); fs.mkdirSync(dir);
  fs.copyFileSync(file, path.join(dir, "index.html")); fs.copyFileSync(path.join(ROOT, "web", "chat.js"), path.join(dir, "chat.js"));
  // The test values; the real ones are the deploy's secrets. LINE isn't used here.
  fs.writeFileSync(path.join(tmp, "dev.env"), [`APP_URL=${ORIGIN()}/`, `ALLOWED_ORIGINS=${ORIGIN()}`, "LINE_AUTH_URL=http://127.0.0.1:9/authorize", "LINE_TOKEN_URL=http://127.0.0.1:9/token",
    "LINE_CHANNEL_ID=1234567890", "LINE_CHANNEL_SECRET=test-line-secret", `SESSION_SECRET=${SECRET}`, "SUB_PEPPER=test-pepper", "ADMIN_CODE=test-admin-code-0123456789abcdefghijklmnop", ""].join("\n"));
  site = spawn("python3", ["-m", "http.server", String(pagePort), "--bind", "127.0.0.1", "--directory", dir], { detached: true, stdio: "ignore" });
  await up(`${ORIGIN()}/chat.js`, "the page server");
  await startWrangler(); await stop(wrangler);
  const dos = path.join(tmp, "state", "v3", "do", "waveslave-chat-Room"), db = fs.readdirSync(dos).find(n => /^[0-9a-f]{64}\.sqlite$/.test(n));
  if (!db) throw new Error("wrangler dev made no room database");
  const now = Date.now(), users = Object.entries(USERS).map(([k, u]) => ({ id: "u-" + k, sub: "sub-" + k, nick: u.nick, key: `key-${k}`, role: u.role || "user", created: now - 40 * DAY, seen: now }));
  const messages = seedMessages(now), run = spawnSync("python3", ["-I", "-c", SEED], { input: JSON.stringify({ db: path.join(dos, db), users, messages }), encoding: "utf8" });
  if (run.status !== 0) throw new Error("seeding failed: " + run.stderr);
  await startWrangler();
}
async function tearDown() { await stop(wrangler); await stop(site); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

// The room as a reader sees it, straight from the socket: the history after hello (the last 100 visible messages, oldest first).
function history() {
  return new Promise((ok, no) => { const ws = new WS(`${CHAT().replace("http", "ws")}/ws`, { origin: ORIGIN() }), t = setTimeout(() => { ws.terminate(); no(new Error("no history")); }, 10e3);
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", v: 1 })));
    ws.on("message", d => { const f = JSON.parse(String(d)); if (f.type === "history") { clearTimeout(t); ws.close(); ok(f.messages); } });
    ws.on("error", e => { clearTimeout(t); no(e); }); });
}

// ---- Helpers on a page.
const room = page => page.locator(".chatroom");
const articles = page => page.evaluate(() => [...document.querySelectorAll(".chatroom .cr-msgs article")].map(a => ({ id: +a.dataset.id,
  nick: a.querySelector(".cm-nick").textContent, badge: (a.querySelector(".cm-badge") || {}).textContent || null, text: (a.querySelector(".cm-text") || {}).textContent ?? null,
  quote: (a.querySelector(".cm-quote") || {}).textContent ?? null, meta: a.querySelector(".cm-meta").textContent })));
async function openRoom(page) {
  await page.click(".chatfab");
  await page.waitForFunction(() => document.documentElement.classList.contains("chat-open") && document.querySelectorAll(".chatroom .cr-msgs article").length > 0 && document.querySelector(".chatroom .cr-status").hidden);
}
const textArticle = (page, text) => page.waitForFunction(t => [...document.querySelectorAll(".chatroom .cm-text")].some(p => p.textContent === t), text, { timeout: 15e3 });
async function say(page, text) {
  await page.fill(".chatroom .cr-in", text); await page.press(".chatroom .cr-in", "Enter"); await textArticle(page, text);
}
// The ⋯ menu's items as read out.
const menuItems = page => page.evaluate(() => { const m = document.querySelector(".chatroom .cr-pop[role=menu]"); return m ? [...m.querySelectorAll("[role^=menuitem]")].map(b => b.textContent) : null; });
const focused = page => page.evaluate(() => { const a = document.activeElement; return a ? (a.closest("article") ? `article ${a.closest("article").dataset.id} ${a.className}` : a.textContent) : null; });
const idOf = async (page, text) => (await articles(page)).find(a => a.text === text)?.id;
const dragDown = async (page, [x, y], dy) => { const s = await page.context().newCDPSession(page);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) { await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy*i/12 }] }); await page.waitForTimeout(16); }
  return s; };

const CHECKS = {
  // The CHAT button opens the room full screen, above the full-screen map's z-index, and sets html.chat-open. While it's open, a pull from
  // the top doesn't start the page's refresh, and Escape belongs to the room: the page's own Escape handling (the map's) never sees it.
  // Escape closes the room, and the next Escape reaches the page again.
  async opening(open) {
    const page = await open({});
    await page.evaluate(() => { window.__esc = 0; document.addEventListener("keydown", e => { if (e.key === "Escape") window.__esc++; }); });
    await openRoom(page);
    const s = await page.evaluate(() => { const r = document.querySelector(".chatroom"), b = r.getBoundingClientRect(), z = +getComputedStyle(r).zIndex;
      const map = document.createElement("div"); map.className = "wsmap fs"; document.body.append(map); const mz = +getComputedStyle(map).zIndex; map.remove();
      const pts = [[2, 2], [195, 422], [388, 842], [2, 842], [388, 2]].map(([x, y]) => r.contains(document.elementFromPoint(x, y)));
      return { box: [b.left, b.top, b.width, b.height], z, mz, pts, overflow: getComputedStyle(document.body).overflow }; });
    if (!eq(s.box, [0, 0, 390, 844]) || !(s.z > s.mz) || s.mz !== 100 || s.pts.includes(false)) throw new Error(`the room is at ${s.box}, z-index ${s.z} over the map's ${s.mz}, covering the corners and middle: ${s.pts}`);
    if (s.overflow !== "hidden") throw new Error(`the page behind can scroll (body overflow ${s.overflow})`);
    const ptr = () => page.evaluate(() => +getComputedStyle(document.querySelector(".ptr")).opacity);
    const touch = await dragDown(page, [200, 330], 140); const pulled = await ptr();
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    if (pulled !== 0) throw new Error(`a pull with the room open shows the refresh sign (opacity ${pulled})`);
    await page.keyboard.press("Escape"); await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({ open: document.documentElement.classList.contains("chat-open"), hidden: document.querySelector(".chatroom").hidden, esc: window.__esc, VIEW, fab: getComputedStyle(document.querySelector(".chatfab")).display }));
    if (after.open || !after.hidden || after.esc !== 0 || after.VIEW !== "fc" || after.fab === "none") throw new Error(`after Escape: ${JSON.stringify(after)}`);
    await page.keyboard.press("Escape");
    if (await page.evaluate(() => window.__esc) !== 1) throw new Error("with the room shut, Escape doesn't reach the page");
  },
  // A reader gets the room's last 100 messages, newest at the bottom and in view, with the LINE button under the list, not over it.
  // A spot filter shows exactly that spot's messages (reports, session cards and tagged text); All shows them all again.
  async reading(open) {
    const page = await open({}); await openRoom(page);
    const want = await history(), got = await articles(page);
    if (!eq(got.map(a => a.id), want.map(m => m.id))) throw new Error(`the room shows ${got.length} messages (${got[0]?.id}..${got.at(-1)?.id}), the socket's history ${want.length} (${want[0].id}..${want.at(-1).id})`);
    const s = await page.evaluate(() => { const r = e => e.getBoundingClientRect(), list = r(document.querySelector(".chatroom .cr-list")), line = document.querySelector(".chatroom .cr-line"),
      last = r(document.querySelector(".chatroom .cr-msgs article:last-child"));
      return { line: line && line.getClientRects().length ? r(line).top : null, word: line && line.textContent, listBottom: list.bottom, lastBottom: last.bottom, lastTop: last.top, listTop: list.top,
        input: !!document.querySelector(".chatroom .cr-in").getClientRects().length }; });
    if (s.line == null || s.word !== "LINELog in with LINE" || s.input) throw new Error(`signed out the bar shows ${s.line == null ? "no LINE button" : JSON.stringify(s.word)}${s.input ? " and the message box" : ""}`);
    if (!(s.line >= s.listBottom) || !(s.lastBottom <= s.listBottom + 1) || !(s.lastTop >= s.listTop)) throw new Error(`the newest message is at ${s.lastTop}-${s.lastBottom}, the list ${s.listTop}-${s.listBottom}, the LINE button from ${s.line}`);
    for (const spot of ["jinshan", "fulong"]) {
      await page.click(`.chatroom .cr-filters button[data-f="${spot}"]`);
      const ids = (await articles(page)).map(a => a.id), expect = want.filter(m => m.spot === spot).map(m => m.id);
      if (!expect.length || !eq(ids, expect)) throw new Error(`the ${spot} filter shows ${JSON.stringify(ids)}, want ${JSON.stringify(expect)}`);
      if (await page.evaluate(() => localStorage.getItem("waveslave-chat-filter")) !== spot) throw new Error("the filter isn't kept");
    }
    await page.click('.chatroom .cr-filters button[data-f="all"]');
    if ((await articles(page)).length !== want.length) throw new Error("All doesn't show everything again");
  },
  // Text from the network goes in as text: a message "<img src=x onerror=alert(1)>" posted from a second, signed-in page shows as those
  // characters on both pages, and neither gets an img or a dialog. The seeded nickname, message and conditions value with HTML in them
  // draw no img either.
  async escaping(open) {
    const reader = await open({}), poster = await open({ as: "p1" }), x = "<img src=x onerror=alert(1)>";
    await openRoom(reader); await openRoom(poster);
    await say(poster, x); await textArticle(reader, x);
    for (const p of [reader, poster]) {
      const n = await p.evaluate(() => document.querySelectorAll(".chatroom img, .chatroom b b, .chatroom script").length);
      if (n || p.dialogs.length) throw new Error(`${n} stray elements and ${p.dialogs.length} dialogs (${p.dialogs.join(", ")})`);
    }
    const seeded = (await articles(reader)).filter(a => a.nick === USERS.evil.nick);
    if (seeded.length !== 2 || seeded[0].text !== "<img src=x onerror=alert(3)>") throw new Error(`the seeded HTML shows as ${JSON.stringify(seeded)}`);
    if (await poster.inputValue(".chatroom .cr-in") !== "") throw new Error("the box still holds the sent text");
  },
  // Review Focus 1: the network goes away (context.setOffline) and comes back. The room says it's offline, opens a new socket within 30 s
  // of the network's return, and shows every message once, including one posted while it was away.
  async reconnect(open) {
    const page = await open({}), poster = await open({ as: "p2" });
    await openRoom(page); await openRoom(poster);
    await say(poster, "Before the drop"); await textArticle(page, "Before the drop");
    const before = page.sockets.length;
    await page.context().setOffline(true);
    await page.waitForFunction(() => /Chat is offline/.test(document.querySelector(".chatroom .cr-status").textContent), null, { timeout: 5e3 });
    await wait(5200); await say(poster, "Posted while you were away");
    const back = Date.now(); await page.context().setOffline(false);
    await textArticle(page, "Posted while you were away").catch(() => { throw new Error("the message posted while away never showed"); });
    const took = Date.now() - back, all = await articles(page), ids = all.map(a => a.id);
    if (took > 30e3) throw new Error(`it took ${took} ms to come back`);
    if (new Set(ids).size !== ids.length) throw new Error("a message shows twice");
    for (const t of ["Before the drop", "Posted while you were away"]) if (all.filter(a => a.text === t).length !== 1) throw new Error(`"${t}" shows ${all.filter(a => a.text === t).length} times`);
    if (!(page.sockets.length > before)) throw new Error("no new socket after the network came back");
    if (!(await page.evaluate(() => document.querySelector(".chatroom .cr-status").hidden))) throw new Error("the offline line stays up");
  },
  // 100 s without a frame from the room (the page's clock run on, so the room's 45 s ticks can't arrive): the socket counts as dead, and a
  // new one opens. 90 s isn't enough.
  async deadSocket(open) {
    const page = await open({ clock: true }); await openRoom(page);
    const n = page.sockets.length, count = (await articles(page)).length;
    await page.clock.fastForward(90e3); await wait(1500);
    if (page.sockets.length !== n) throw new Error("after 90 s without a frame the page already opened a new socket");
    await page.clock.fastForward(11e3);
    for (let i = 0; i < 50 && page.sockets.length === n; i++) await wait(100);
    if (page.sockets.length !== n + 1) throw new Error(`after 101 s without a frame the page has ${page.sockets.length - n} new sockets, want 1`);
    await page.waitForFunction(() => document.querySelector(".chatroom .cr-status").hidden);
    await page.waitForFunction(c => document.querySelectorAll(".chatroom .cr-msgs article").length === c, count);
    const ids = (await articles(page)).map(a => a.id); if (new Set(ids).size !== ids.length) throw new Error("a message shows twice after the reconnect");
  },
  // Back in the foreground the page sends "ping": a "pong" keeps the socket, and none within 10 s replaces it. 5 minutes in the background
  // closes the socket (the room's ticks still arriving), and coming back opens a new one. The room here is a stand-in that answers hello
  // with one message, so the page's clock can run on.
  async background(open) {
    let n = 0, cur = null, mute = false, closed = 0; const pings = [];
    const page = await open({ clock: true, ws: route => { n++; cur = route; route.onClose(() => { closed++; });
      route.onMessage(m => { if (m === "ping") { pings.push(n); if (!mute) route.send("pong"); return; }
        if (JSON.parse(m).type === "hello") route.send(JSON.stringify({ type: "history", messages: [{ id: 1, ts: Date.now() - 60e3, nick: "Kai", role: null, kind: "text", spot: null, body: { text: "Hi" }, reply_to: null, likes: 0 }] })); }); } });
    await openRoom(page);
    const vis = v => page.evaluate(v => { for (const [k, x] of [["visibilityState", v], ["hidden", v === "hidden"]]) Object.defineProperty(document, k, { configurable: true, get: () => x });
      document.dispatchEvent(new Event("visibilitychange")); }, v);
    const until = async (f, what) => { for (let i = 0; i < 50 && !f(); i++) await wait(100); if (!f()) throw new Error(what); };
    await vis("hidden"); await vis("visible");
    await until(() => pings.length === 1, `coming back sent ${pings.length} pings`);
    await wait(200); await page.clock.fastForward(11e3); await wait(500);
    if (n !== 1) throw new Error(`with the pong in, coming back opened ${n - 1} new sockets`);
    mute = true; await vis("hidden"); await vis("visible");
    await until(() => pings.length === 2, "the second return sent no ping");
    await page.clock.fastForward(11e3);
    await until(() => n === 2, `with no pong in 10 s the page has ${n - 1} new sockets, want 1`);
    await page.waitForFunction(() => document.querySelector(".chatroom .cr-status").hidden && document.querySelectorAll(".chatroom .cr-msgs article").length === 1);
    mute = false; await vis("hidden");
    for (let t = 0; t < 4; t++) { await page.clock.fastForward(60e3); cur.send(JSON.stringify({ type: "tick", online: 2 })); await wait(200); }
    if (closed !== 1 || n !== 2) throw new Error(`4 minutes in the background: ${closed} sockets closed, ${n} opened`);
    await page.clock.fastForward(61e3);
    await until(() => closed === 2, "5 minutes in the background didn't close the socket");
    await wait(500); if (n !== 2) throw new Error("the page opened a socket while in the background");
    await vis("visible");
    await until(() => n === 3, `coming back after 5 minutes opened ${n - 2} sockets, want 1`);
    await page.waitForFunction(() => document.querySelector(".chatroom .cr-status").hidden && document.querySelectorAll(".chatroom .cr-msgs article").length === 1);
  },
  // Review Focus 4: a 500-character unbroken word, emoji-only text, an RTL override and a right-to-left nickname all stay inside 390 px,
  // and each message's nickname comes before its age on one line.
  async layout(open) {
    const page = await open({}); await openRoom(page);
    const s = await page.evaluate(([long, emoji, rlo]) => { const out = [];
      for (const a of document.querySelectorAll(".chatroom .cr-msgs article")) {
        const t = a.querySelector(".cm-text"), nick = a.querySelector(".cm-nick").getBoundingClientRect(), age = a.querySelector("time").getBoundingClientRect(), b = a.getBoundingClientRect();
        const special = t && [long, emoji, rlo].includes(t.textContent);
        if (b.left < 0 || b.right > 390 || (t && t.scrollWidth > t.clientWidth + 1) || !(nick.right <= age.left + 1) || Math.abs(nick.top - age.top) > 6) out.push({ id: a.dataset.id, nick: [nick.left, nick.right, nick.top], age: [age.left, age.top], box: [b.left, b.right] });
        if (special) out.push("seen");
      }
      const list = document.querySelector(".chatroom .cr-list");
      return { bad: out.filter(x => x !== "seen"), seen: out.filter(x => x === "seen").length, list: [list.scrollWidth, list.clientWidth], page: document.documentElement.scrollWidth };
    }, [LONG, EMOJI, RLO]);
    if (s.seen !== 3) throw new Error(`found ${s.seen} of the 3 hard messages`);
    if (s.bad.length) throw new Error(`messages out of shape: ${JSON.stringify(s.bad.slice(0, 3))}`);
    if (s.list[0] > s.list[1] || s.page > 390) throw new Error(`the room scrolls sideways (${s.list}, page ${s.page})`);
  },
  // Review Focus 5: with text typed in the box and the room scrolled up, switching to 中文 from the room's menu redraws the words and keeps
  // the text and the place in the list. An open sheet stays open through a switch, in the new language.
  async language(open) {
    const page = await open({ as: "p5" }); await openRoom(page);
    const draft = "draft 草稿 🏄"; await page.fill(".chatroom .cr-in", draft);
    await page.evaluate(() => { const l = document.querySelector(".chatroom .cr-list"); l.scrollTop = Math.round(l.scrollHeight * 0.4); });
    await page.waitForTimeout(200);
    const place = () => page.evaluate(() => { const l = document.querySelector(".chatroom .cr-list"), top = l.getBoundingClientRect().top + document.querySelector(".chatroom .cr-pin").offsetHeight;
      const a = [...l.querySelectorAll("article")].find(a => a.getBoundingClientRect().bottom > top); return { id: a.dataset.id, y: Math.round(a.getBoundingClientRect().top), top: l.scrollTop }; });
    const was = await place();
    await page.click(".chatroom .cr-menu"); await page.click('.chatroom .cr-pop [lang="zh-Hant-TW"]');
    await page.waitForFunction(() => document.querySelector('.chatroom .cr-filters [data-f="all"]').textContent === "全部");
    const now = await place(), s = await page.evaluate(() => ({ value: document.querySelector(".chatroom .cr-in").value, ph: document.querySelector(".chatroom .cr-in").placeholder,
      sub: document.querySelector(".chatroom .cr-sub").textContent, pin: document.querySelector(".chatroom .cr-pin").textContent, open: document.documentElement.classList.contains("chat-open"),
      metas: [...document.querySelectorAll(".chatroom .cm-meta")].map(m => m.textContent).join("|") }));
    if (s.value !== draft) throw new Error(`the box holds ${JSON.stringify(s.value)} after the switch`);
    if (s.ph !== "說點什麼…" || !/台灣浪友/.test(s.sub) || !/版規|互相幫忙/.test(s.pin) || !/金山|福隆/.test(s.metas) || /Jinshan|min ago/.test(s.metas) || !s.open) throw new Error(`in 中文 the room reads ${JSON.stringify(s).slice(0, 300)}`);
    if (now.id !== was.id || Math.abs(now.y - was.y) > 2) throw new Error(`the list moved: message ${was.id} at ${was.y} before, message ${now.id} at ${now.y} after`);
    await page.click(".chatroom .cr-pin .cr-link");
    await page.waitForFunction(() => document.querySelector("#chatSheetTitle").textContent === "版規");
    await page.evaluate(() => setLang("ja"));
    await page.waitForFunction(() => document.querySelector("#chatSheetTitle").textContent === "ルール" && !document.querySelector(".chatroom .cr-shade").hidden);
    if (await page.inputValue(".chatroom .cr-in") !== draft) throw new Error("the box lost its text on the second switch");
  },
  // The nickname changes from the room's menu, once a week: a name the room refuses says why and leaves the sheet up, a good one closes
  // it and shows on the next message, and a second change says when the next one is due.
  async nickname(open) {
    const page = await open({ as: "p5" }); await openRoom(page);
    const sheet = () => page.evaluate(() => ({ open: !document.querySelector(".chatroom .cr-shade").hidden, title: document.querySelector("#chatSheetTitle").textContent,
      value: document.querySelector(".chatroom .cr-sheet .cr-field")?.value ?? null, err: document.querySelector(".chatroom .cr-sheet .cr-err")?.textContent ?? null }));
    const start = async () => { await page.click(".chatroom .cr-menu"); await page.click(".chatroom .cr-pop >> text=Change nickname"); };
    const errSays = t => page.waitForFunction(t => document.querySelector(".chatroom .cr-sheet .cr-err")?.textContent === t, t, { timeout: 10e3 });
    await start();
    const s = await sheet();
    if (!s.open || s.title !== "Change nickname (once a week)" || s.value !== "Poster5") throw new Error(`the nickname sheet reads ${JSON.stringify(s)}`);
    await page.fill(".chatroom .cr-sheet .cr-field", "x"); await page.press(".chatroom .cr-sheet .cr-field", "Enter");
    await errSays("2–20 characters").catch(async () => { throw new Error(`a 1-letter name: ${JSON.stringify(await sheet())}`); });
    await page.fill(".chatroom .cr-sheet .cr-field", "Wave Rider"); await page.press(".chatroom .cr-sheet .cr-field", "Enter");
    await page.waitForFunction(() => document.querySelector(".chatroom .cr-shade").hidden && /Done/.test(document.querySelector(".chatroom .cr-note").textContent), null, { timeout: 10e3 });
    await say(page, "Hello as Wave Rider");
    const mine = (await articles(page)).find(a => a.text === "Hello as Wave Rider");
    if (mine.nick !== "Wave Rider") throw new Error(`the new message is from ${mine.nick}`);
    await start();
    if ((await sheet()).value !== "Wave Rider") throw new Error("the sheet doesn't start from the new name");
    await page.fill(".chatroom .cr-sheet .cr-field", "Wave Rider Two"); await page.press(".chatroom .cr-sheet .cr-field", "Enter");
    await errSays("Once a week: you can change it again in 7 days").catch(async () => { throw new Error(`a second change: ${JSON.stringify(await sheet())}`); });
  },
  // The ⋯ button opens Reply, 👍 and Report on someone else's message, by keyboard too: Enter opens it on the first item, the arrows move,
  // Escape shuts it and goes back to ⋯ with the room still open. Reply quotes the parent; your own message's menu has Delete, and once
  // it's deleted the reply shows "Message deleted" on the other page, like the seeded reply to a deleted message.
  async messageMenu(open) {
    const a = await open({ as: "p3" }), b = await open({ as: "p4" });
    await openRoom(a); await openRoom(b);
    const seededGone = (await articles(b)).find(x => x.text === "A reply to a deleted message");
    if (!seededGone || seededGone.quote !== "↳ Message deleted") throw new Error(`the seeded reply to a deleted message quotes ${JSON.stringify(seededGone && seededGone.quote)}`);
    const tips = await idOf(b, "Any tips? 有人可以給建議嗎？"), reply = (await articles(b)).find(x => x.text === "Paddle two more strokes");
    if (!reply || reply.quote !== "↳ Mika Any tips? 有人可以給建議嗎？") throw new Error(`the seeded reply quotes ${JSON.stringify(reply && reply.quote)}`);
    await b.focus(`.chatroom article[data-id="${tips}"] .cm-more`); await b.keyboard.press("Enter");
    if (!eq(await menuItems(b), ["Reply", "👍", "Report"])) throw new Error(`the menu on someone else's message has ${JSON.stringify(await menuItems(b))}`);
    if (await focused(b) !== "Reply") throw new Error(`the menu opens with ${await focused(b)} focused`);
    await b.keyboard.press("ArrowDown"); await b.keyboard.press("ArrowDown");
    if (await focused(b) !== "Report") throw new Error(`two ArrowDowns land on ${await focused(b)}`);
    await b.keyboard.press("Escape");
    if (await menuItems(b) !== null || !(await b.evaluate(() => document.documentElement.classList.contains("chat-open")))) throw new Error("Escape didn't just close the menu");
    if (!/^article \d+ cm-more$/.test(await focused(b))) throw new Error(`after Escape the focus is on ${await focused(b)}`);
    // 👍 by keyboard: Enter, ArrowDown, Enter; everyone sees the count.
    await b.keyboard.press("Enter"); await b.keyboard.press("ArrowDown"); await b.keyboard.press("Enter");
    await a.waitForFunction(id => /👍 1/.test(document.querySelector(`.chatroom article[data-id="${id}"] .cm-foot`)?.textContent || ""), tips);
    // A reply to a live message, then its parent deleted by its own poster.
    await say(a, "Parent to delete"); await textArticle(b, "Parent to delete");
    const parent = await idOf(b, "Parent to delete");
    await b.focus(`.chatroom article[data-id="${parent}"] .cm-more`); await b.keyboard.press("Enter"); await b.keyboard.press("Enter");
    if (!(await b.evaluate(() => /replying to Poster3/.test(document.querySelector(".chatroom .cr-reply").textContent) && document.activeElement === document.querySelector(".chatroom .cr-in"))))
      throw new Error("Reply didn't set up a reply to Poster3 in the box");
    await b.keyboard.type("Replying here"); await b.keyboard.press("Enter"); await textArticle(a, "Replying here");
    const quoted = (await articles(a)).find(x => x.text === "Replying here").quote;
    if (quoted !== "↳ Poster3 Parent to delete") throw new Error(`the reply quotes ${JSON.stringify(quoted)}`);
    await a.click(`.chatroom article[data-id="${parent}"] .cm-more`);
    if (!eq(await menuItems(a), ["Reply", "👍", "Delete"])) throw new Error(`the menu on your own message has ${JSON.stringify(await menuItems(a))}`);
    await a.click(".chatroom .cr-pop >> text=Delete");
    if (!(await a.evaluate(() => /tap again/.test(document.querySelector(".chatroom .cr-pop").textContent)))) throw new Error("Delete doesn't ask for a second tap");
    await a.click(".chatroom .cr-pop >> text=Delete");
    await b.waitForFunction(id => !document.querySelector(`.chatroom article[data-id="${id}"]`), parent);
    const now = (await articles(b)).find(x => x.text === "Replying here").quote;
    if (now !== "↳ Message deleted") throw new Error(`after the delete the reply quotes ${JSON.stringify(now)}`);
  },
  // Scrolled to the top, the room asks once for the 50 messages before the oldest it holds, and keeps the reading place.
  async olderMessages(open) {
    const page = await open({}); await openRoom(page);
    const asks = []; page.sockets.at(-1).on("framesent", f => { if (/"older"/.test(f.payload)) asks.push(JSON.parse(f.payload)); });
    const first = await articles(page); if (first.length !== 100) throw new Error(`the room opened with ${first.length} messages`);
    await page.evaluate(() => { document.querySelector(".chatroom .cr-list").scrollTop = 0; });
    await page.waitForFunction(() => document.querySelectorAll(".chatroom .cr-msgs article").length === 150);
    await wait(1500);
    const now = await articles(page), top = await page.evaluate(() => document.querySelector(".chatroom .cr-list").scrollTop);
    if (now.length !== 150 || asks.length !== 1 || asks[0].before_id !== first[0].id) throw new Error(`after the top: ${now.length} messages, asked ${JSON.stringify(asks)}`);
    if (!eq(now.slice(50).map(a => a.id), first.map(a => a.id)) || !(top > 0)) throw new Error(`the older page didn't go above the others (scrollTop ${top})`);
  },
  // Review Focus 1 after a long time away: more than 100 messages posted while the room was shut, or while its socket was down, so the
  // new history starts past everything held. The room shows just the new 100 (a reply into the gap quotes "an earlier message", not
  // "Message deleted"), and scrolling up loads every older page down to the room's first message, each message once. It starts as a
  // small room (all of it held, nothing older), which must page again. Fewer than 100 while away keeps what's held. The room here is a
  // stand-in, since posting hundreds of messages through the real one would meet its rate limits.
  async reopenAfterMany(open) {
    const all = [], asks = [], REPLY = { 205: 70, 330: 240 }; let n = 0, cur = null;
    const post = k => { for (let i = 0; i < k; i++) { const id = all.length + 1;
      all.push({ id, ts: Date.now() - 3600e3 + id * 1e3, nick: "Kai", role: null, kind: "text", spot: null, body: { text: `M${id}` }, reply_to: REPLY[id] || null, likes: 0 }); } };
    post(60);
    const page = await open({ as: "p1", ws: route => { n++; cur = route;
      route.onMessage(m => { const f = JSON.parse(m);
        if (f.type === "hello") route.send(JSON.stringify({ type: "history", messages: all.slice(-100) }));
        if (f.type === "older") { asks.push(f.before_id); route.send(JSON.stringify({ type: "history", before_id: f.before_id, messages: all.filter(x => x.id < f.before_id).slice(-50) })); } }); } });
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    const ids = async () => (await articles(page)).map(a => a.id);
    const quote = async id => (await articles(page)).find(a => a.id === id)?.quote;
    const shows = async (a, b, what) => { const got = await ids();
      if (!eq(got, range(a, b))) throw new Error(`${what}: the room shows ${got.length} messages (${got.slice(0, 3)} … ${got.slice(-3)}), want ${a}..${b} once each`); };
    const live = (sockets, last) => page.waitForFunction(([s, last]) => document.querySelector(".chatroom .cr-status").hidden
      && document.querySelector(".chatroom .cr-msgs article:last-child")?.dataset.id === String(last), [sockets, last], { timeout: 10e3 })
      .then(() => { if (n !== sockets) throw new Error(`${n} sockets, want ${sockets}`); });
    // Up to the top until the room has nothing older: the older button goes once a short page comes back.
    const scrollUp = async () => { for (let i = 0; i < 12; i++) {
      if (await page.evaluate(() => document.querySelector(".chatroom .cr-older").hidden)) return;
      const had = (await ids()).length;
      await page.evaluate(() => { document.querySelector(".chatroom .cr-list").scrollTop = 0; });
      await page.waitForFunction(had => document.querySelectorAll(".chatroom .cr-msgs article").length !== had || document.querySelector(".chatroom .cr-older").hidden, had, { timeout: 5e3 })
        .catch(() => { throw new Error(`scrolled to the top with ${had} messages and nothing loaded (asked ${asks})`); });
      await wait(150);
    } throw new Error("12 pages and the room still had older ones"); };

    await openRoom(page); await shows(1, 60, "a small room");
    if (!(await page.evaluate(() => document.querySelector(".chatroom .cr-older").hidden))) throw new Error("a room of 60 offers older messages");
    // Shut, 150 posted, opened again: the new history is 111..210.
    await page.keyboard.press("Escape"); post(150);
    await page.click(".chatfab"); await live(2, 210);
    await shows(111, 210, "opened again after 150 new");
    if (await quote(205) !== "↳ an earlier message") throw new Error(`a reply into the gap quotes ${JSON.stringify(await quote(205))}`);
    await scrollUp(); await shows(1, 210, "scrolled up after opening again");
    if (!eq(asks, [111, 61, 11])) throw new Error(`asked for the pages before ${asks}, want 111, 61, 11`);
    if (await quote(205) !== "↳ Kai M70") throw new Error(`once loaded, the reply quotes ${JSON.stringify(await quote(205))}`);
    // The socket drops, 150 more are posted before it's back: the new history is 261..360. A reply begun before the drop goes with the
    // gap (its line would show nothing), and one begun before a short drop stays. Reading far up when it dropped, the place read went
    // with the gap: the room comes back at its newest.
    const replyTo = async id => { await page.click(`.chatroom article[data-id="${id}"] .cm-more`); await page.click(".chatroom .cr-pop >> text=Reply"); };
    const replying = () => page.evaluate(() => !document.querySelector(".chatroom .cr-reply").hidden);
    await replyTo(200); if (!(await replying())) throw new Error("Reply didn't show the reply line");
    await page.evaluate(() => document.querySelector('.chatroom article[data-id="30"]').scrollIntoView({ block: "center" })); await wait(200);
    post(150); cur.close({ code: 1001, reason: "gone" }); await live(3, 360);
    await shows(261, 360, "back after a drop and 150 new");
    if (await replying()) throw new Error("the reply line still holds a reply to a message the gap took");
    const end = await page.evaluate(() => { const l = document.querySelector(".chatroom .cr-list"); return l.scrollHeight - l.scrollTop - l.clientHeight; });
    if (end > 2) throw new Error(`back after the gap the room sits ${Math.round(end)} px above its newest message`);
    if (await quote(330) !== "↳ an earlier message") throw new Error(`after the drop a reply into the gap quotes ${JSON.stringify(await quote(330))}`);
    asks.length = 0; await scrollUp(); await shows(1, 360, "scrolled up after the drop");
    if (!eq(asks, [261, 211, 161, 111, 61, 11])) throw new Error(`after the drop asked for the pages before ${asks}`);
    // A drop with 30 new: the history (291..390) meets what's held, which stays, and nothing older is asked for.
    await replyTo(350); post(30); asks.length = 0; cur.close({ code: 1001, reason: "gone" }); await live(4, 390);
    await shows(1, 390, "back after a drop and 30 new");
    if (!(await replying())) throw new Error("a short drop lost the reply begun before it");
    if (asks.length || await page.evaluate(() => !document.querySelector(".chatroom .cr-older").hidden)) throw new Error(`with everything held the room asked for ${asks} or offers older`);
  },
  // Bryan's messages carry the fixed WaveSlave badge, and nobody else's does.
  async badge(open) {
    const page = await open({}); await openRoom(page);
    const all = await articles(page), badged = all.filter(a => a.badge), bryans = all.filter(a => a.nick === "Bryan");
    if (bryans.length !== 2 || !eq(badged.map(a => a.id), bryans.map(a => a.id)) || badged.some(a => a.badge !== "WaveSlave")) throw new Error(`badges on ${JSON.stringify(badged)}; Bryan's: ${bryans.map(a => a.id)}`);
  },
  // A 4429 close says "Chat is resting until 08:00" and doesn't hammer the room with retries; a plain drop says "Chat is offline · Retry",
  // and Retry opens a new socket.
  async restingAndOffline(open) {
    let tries = 0;
    const rest = await open({ ws: route => { tries++; route.close({ code: 4429, reason: "resting" }); } });
    await rest.click(".chatfab");
    await rest.waitForFunction(() => document.querySelector(".chatroom .cr-status").textContent === "Chat is resting until 08:00");
    await wait(3000); if (tries !== 1) throw new Error(`resting, the page tried ${tries} times in 3 s`);
    let drops = 0;
    const off = await open({ ws: route => { drops++; route.close({ code: 1001, reason: "gone" }); } });
    await off.click(".chatfab");
    await off.waitForFunction(() => document.querySelector(".chatroom .cr-status").textContent === "Chat is offline · Retry");
    const had = drops; await off.click(".chatroom .cr-status button");
    for (let i = 0; i < 30 && drops === had; i++) await wait(100);
    if (drops !== had + 1) throw new Error(`Retry opened ${drops - had} sockets`);
  },
  // ?chat=privacy (the credits' Privacy link) opens the room with the house rules, the privacy note and the contact; the credits' chat line
  // shows once the chat is on.
  async privacyLink(open) {
    const page = await open({ query: "?chat=privacy" });
    await page.waitForFunction(() => !document.querySelector(".chatroom .cr-shade").hidden);
    const s = await page.evaluate(() => ({ title: document.querySelector("#chatSheetTitle").textContent, body: document.querySelector(".chatroom .cr-sheet-b").textContent,
      mail: document.querySelector('.chatroom .cr-sheet-b a[href^="mailto:"]')?.getAttribute("href"), credits: !document.getElementById("chatCredits").hidden, href: location.href }));
    if (s.title !== "House rules" || !/No ads or selling/.test(s.body) || !/Privacy note/.test(s.body) || !s.body.includes("Test Operator runs the Taiwan chat") || s.mail !== "mailto:chat@example.com")
      throw new Error(`the sheet reads ${JSON.stringify(s).slice(0, 300)}`);
    if (!s.credits || /chat=/.test(s.href)) throw new Error(`the credits' chat line is ${s.credits ? "shown" : "hidden"}, the address ${s.href}`);
    await page.keyboard.press("Escape");
    if (!(await page.evaluate(() => document.querySelector(".chatroom .cr-shade").hidden && document.documentElement.classList.contains("chat-open")))) throw new Error("Escape didn't close just the sheet");
  },
};

(async () => {
  let browser, bad = false, ctxs = [], errs = [];
  // A fresh context for every page: the page and the backend load, everything else is cut off. as: a seeded account to sign in as;
  // clock: the page's timers under Playwright's clock; ws: a stand-in for the room's socket. page.sockets lists the sockets it opened,
  // page.dialogs any alert.
  async function open({ as = null, spot = "jinshan", query = "", clock = false, ws = null }) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
    ctxs.push(ctx);
    await ctx.route("**/*", r => { const u = r.request().url(); return u.startsWith(ORIGIN() + "/") || u.startsWith(CHAT() + "/") ? r.continue() : r.abort(); });
    if (clock) await ctx.clock.install();
    await ctx.addInitScript(([o, lock]) => {
      try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", "fc"); localStorage.setItem("waveslave-lang", "en"); localStorage.setItem("waveslave-world", "0");
        if (o.token && !sessionStorage.getItem("signed")) { localStorage.setItem("waveslave-chat-token", o.token); sessionStorage.setItem("signed", "1"); }
        if (lock) sessionStorage.setItem("waveslave-unlock", lock); } catch (e) {}
      window.__chatUrl = o.url; window.__chatContact = o.contact; }, [{ token: as ? token("u-" + as) : null, url: CHAT(), contact: CONTACT }, LOCK]);
    const page = await ctx.newPage(); page.sockets = []; page.dialogs = [];
    if (ws) await page.routeWebSocket(/\/ws$/, ws);
    page.on("websocket", s => page.sockets.push(s)); page.on("pageerror", e => errs.push(String(e)));
    page.on("dialog", d => { page.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    await page.goto(`${ORIGIN()}/${query}#${spot}`, { waitUntil: "load" });
    // The CHAT button is up, or the room already is (a ?chat link).
    await page.waitForFunction(() => { const f = document.querySelector(".chatfab"); return !!f && (document.documentElement.classList.contains("chat-open") || getComputedStyle(f).display !== "none"); });
    return page;
  }
  async function step(name, run) {
    let status = "ok", note = ""; errs = [];
    try { await run(); } catch (e) { status = "FAIL"; note = e.message; }
    if (errs.length) [status, note] = ["FAIL", "page error: " + errs.join("; ")];
    if (status === "FAIL") bad = true;
    console.log(status === "FAIL" ? `FAIL ${name}: ${note}` : `ok ${name}`);
    await Promise.all(ctxs.map(c => c.close())); ctxs = []; await wait(300);
  }
  const quit = () => tearDown().finally(() => process.exit(1));
  process.once("SIGINT", quit); process.once("SIGTERM", quit);
  try {
    await setUp(); browser = await chromium.launch();
    const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
    for (const [name, run] of Object.entries(CHECKS)) if (!only || only.includes(name)) await step(name, () => run(open));
  } catch (e) { bad = true; console.log(`FAIL setup: ${e.message}`); }
  finally { if (browser) await browser.close(); await tearDown(); }
  process.exitCode = bad ? 1 : 0;
})();
