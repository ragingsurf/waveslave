// The servers the Taiwan chat's browser checks run against (tests/chat/room.test.js and tests/chat/flow.test.js), in one copy so the
// two stay in step: `python3 -m http.server` serves a built page as index.html with web/chat.js next to it, as the site does, and
// `wrangler dev` runs the Worker and the room (chat/) with test secrets, ALLOWED_ORIGINS and APP_URL set to the page's origin.
// - start({file, name, line}) makes a scratch folder (chat-<name>-…), starts the page server and writes the test secrets; line is a
//   started tests/chat/fake-line.mjs, or null to point LINE at a closed port. It resolves to a servers object:
//     origin, chat           the page's and the backend's http://127.0.0.1:<port>
//     tmp                    the scratch folder (wrangler.log, the room's state)
//     startWrangler()        starts wrangler dev and waits until it answers; stopWrangler() stops it
//     roomDb()               the room's SQLite file, while wrangler dev is stopped
//     tearDown()             stops both servers and removes the scratch folder
// - wrangler dev runs the Worker with --compatibility-date 2026-10-13: the workerd that comes with the pinned wrangler knows dates up to
//   then, and wrangler.toml's 2026-10-21 is only for the deploy.
const fs = require("fs"), os = require("os"), path = require("path"), net = require("net"), { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", ".."), CHAT_DIR = path.join(ROOT, "chat");
// The test values; the real ones are the deploy's secrets. Session tokens for seeded accounts are signed with SESSION_SECRET.
const SECRETS = { LINE_CHANNEL_ID: "1234567890", LINE_CHANNEL_SECRET: "test-line-secret", SESSION_SECRET: "test-session-secret-0123456789abcdef",
  SUB_PEPPER: "test-pepper", ADMIN_CODE: "test-admin-code-0123456789abcdefghijklmnop" };

const wait = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((ok, no) => { const s = net.createServer().once("error", no).listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });
// Waits up to a minute for url to answer 200.
async function up(url, what, log) {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (e) {} await wait(500); }
  throw new Error(`${what} didn't come up${log ? ` (see ${log})` : ""}`);
}
// Stops a server started with its own process group (wrangler dev runs workerd under it), and waits for it to go.
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise(r => child.once("exit", r));
  try { process.kill(-child.pid, "SIGTERM"); } catch (e) {}
  if (await Promise.race([gone.then(() => true), wait(8000).then(() => false)])) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch (e) {} await gone;
}

async function start({ file, name, line = null }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `chat-${name}-`)), [pagePort, chatPort] = [await freePort(), await freePort()];
  const s = { tmp, origin: `http://127.0.0.1:${pagePort}`, chat: `http://127.0.0.1:${chatPort}`, wrangler: null, site: null };
  const dir = path.join(tmp, "site"), log = path.join(tmp, "wrangler.log"); fs.mkdirSync(dir);
  fs.copyFileSync(file, path.join(dir, "index.html")); fs.copyFileSync(path.join(ROOT, "web", "chat.js"), path.join(dir, "chat.js"));
  const lineUrl = line ? line.url : "http://127.0.0.1:9";
  fs.writeFileSync(path.join(tmp, "dev.env"), [`APP_URL=${s.origin}/`, `ALLOWED_ORIGINS=${s.origin}`, `LINE_AUTH_URL=${lineUrl}/authorize`, `LINE_TOKEN_URL=${lineUrl}/token`,
    ...Object.entries(SECRETS).map(([k, v]) => `${k}=${v}`), ""].join("\n"));
  s.startWrangler = () => {
    const out = fs.openSync(log, "a");
    s.wrangler = spawn(path.join(CHAT_DIR, "node_modules", ".bin", "wrangler"), ["dev", "--ip", "127.0.0.1", "--port", String(chatPort), "--env-file", path.join(tmp, "dev.env"),
      "--persist-to", path.join(tmp, "state"), "--compatibility-date", "2026-10-13", "--show-interactive-dev-session=false", "--log-level", "warn"],
      { cwd: CHAT_DIR, detached: true, stdio: ["ignore", out, out], env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
    return up(`${s.chat}/reports?spot=jinshan`, "wrangler dev", log);
  };
  s.stopWrangler = () => stop(s.wrangler);
  s.roomDb = () => { const dos = path.join(tmp, "state", "v3", "do", "waveslave-chat-Room"), db = fs.existsSync(dos) && fs.readdirSync(dos).find(n => /^[0-9a-f]{64}\.sqlite$/.test(n));
    if (!db) throw new Error("wrangler dev made no room database"); return path.join(dos, db); };
  s.tearDown = async () => { await stop(s.wrangler); await stop(s.site); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} };
  s.site = spawn("python3", ["-m", "http.server", String(pagePort), "--bind", "127.0.0.1", "--directory", dir], { detached: true, stdio: "ignore" });
  try { await up(`${s.origin}/chat.js`, "the page server"); } catch (e) { await s.tearDown(); throw e; }
  return s;
}

module.exports = { SECRETS, wait, freePort, start };
