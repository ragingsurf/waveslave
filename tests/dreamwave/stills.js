// Stills of each Dream Wave scene for Bryan's OK (plan Task 10): the default surfer from the free, nose and head cameras, at 6 s into the
// default wave, on a phone-size screen, saved as <out>/<scene>-<camera>.png, plus one contact sheet <out>/scenes.png; with a share dir, also
// the story picture of each scene from the free camera as <share>/share-<scene>.png (plan Task 12).
// Usage: node tests/dreamwave/stills.js <page.html> [outdir] [sharedir]   (outdir defaults to /mnt/project-files/surf-app/dream-wave/scenes)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path"), { pathToFileURL } = require("url");
const [file, out = "/mnt/project-files/surf-app/dream-wave/scenes", share] = process.argv.slice(2);
if (!file) { console.error("usage: node tests/dreamwave/stills.js <page.html> [outdir]"); process.exit(2); }
const PAGE = pathToFileURL(path.resolve(file)).href, LOCK = (fs.readFileSync(file, "utf8").match(/\bH="([0-9a-f]{64})"/) || [])[1], WEB = path.join(__dirname, "..", "..", "web");
const SCENES = ["neon", "tropical", "eastcoast", "golden", "stormy"], CAMS = ["free", "nose", "head"];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: "block" });
  await ctx.route("**/*", r => { const u = r.request().url(), bare = u.split(/[?#]/)[0];
    if (bare === PAGE || /fonts\.(googleapis|gstatic)\.com/.test(u)) return r.continue();
    const m = bare.match(/\/(chat\.js|dreamwave\.js|dreamwave\/[\w-]+\.js|vendor\/[\w.-]+\.js)$/);
    return u.startsWith("file:") && m ? r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(WEB, m[1])) }) : r.abort(); });
  await ctx.addInitScript(lock => { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-world", "1"); localStorage.setItem("waveslave-lang", "en");
    if (lock) sessionStorage.setItem("waveslave-unlock", lock); window.__chatUrl = ""; window.__dwTest = true; }, LOCK);
  const page = await ctx.newPage(); page.on("pageerror", e => console.error("page error:", String(e)));
  await page.goto(PAGE + "#donghe"); await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('.tabs button[data-v="dw"]').click());
  await page.waitForFunction(() => window.DREAMWAVE && window.DREAMWAVE._view, null, { timeout: 30000 });
  await page.evaluate(() => { document.querySelector("#viewDw .dw-bottom").style.visibility = "hidden"; document.querySelector("#viewDw .dw-x").style.visibility = "hidden"; window.DREAMWAVE._view.play(false); });
  const shots = [];
  for (const s of SCENES) for (const c of CAMS) {
    // play into the moment for a second so the spray and rain are flying, then hold it
    await page.evaluate(([s, c]) => { const v = window.DREAMWAVE._view; v.setScene(s); v.setCamera(c); v.setTime(5); v.play(true); }, [s, c]);
    await page.waitForTimeout(1000); await page.evaluate(() => { const v = window.DREAMWAVE._view; v.play(false); v.render(); }); await page.waitForTimeout(200); const f = path.join(out, `${s}-${c}.png`); await page.screenshot({ path: f }); shots.push(f); console.log(f);
  }
  if (share) { fs.mkdirSync(share, { recursive: true });
    for (const s of SCENES) {
      await page.evaluate(s => { const v = window.DREAMWAVE._view; v.setScene(s); v.setCamera("free"); v.setTime(5); v.play(true); }, s);
      await page.waitForTimeout(1000);
      const url = await page.evaluate(async () => { const v = window.DREAMWAVE._view; v.play(false);
        const c = await window.DW.snap.compose(v.snapshot(1080, 1920), { caption: window.DW.snap.caption(v.S), name: "@waveslave" }); return c.toDataURL("image/png"); });
      const f = path.join(share, `share-${s}.png`); fs.writeFileSync(f, Buffer.from(url.split(",")[1], "base64")); console.log(f);
    }
  }
  // The contact sheet: a row per scene, a column per camera.
  const imgs = shots.map(f => "data:image/png;base64," + fs.readFileSync(f).toString("base64"));
  const sheet = await ctx.newPage(); await sheet.setViewportSize({ width: 3 * 260 + 40, height: 5 * 563 + 60 });
  await sheet.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(3,260px);gap:10px;padding:10px">${imgs.map(s => `<img src="${s}" style="width:260px;height:563px">`).join("")}</body>`);
  await sheet.waitForTimeout(300); await sheet.screenshot({ path: path.join(out, "scenes.png"), fullPage: true }); console.log(path.join(out, "scenes.png"));
  await b.close();
})();
