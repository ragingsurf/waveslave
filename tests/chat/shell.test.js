// Browser checks of the Taiwan chat's page shell on a built page (build one with tests/map/tool.py): web/chat.js, served for the page's
// chat.js, and its hooks in template.html (the report strip under "Right now", the CHAT button, the ?chat link and the chat-open guards).
// Usage: node tests/chat/shell.test.js <page.html>
// Prints ok / FAIL for each check, and exits 1 on any FAIL or page error.
// Every page opens in its own fresh browser context, offline: only the page and chat.js load, and a fake backend at https://chat.test
// answers /reports the way each check sets it (two reports, 3 online and last_id 9 unless it says otherwise). A phone 390x844, dpr 2,
// touch, reduced motion, the intro done, English, Taiwan mode and the Forecast view, unless a check says otherwise. The chat is switched
// on the way the tests do it (window.__chatUrl and window.__chatContact), and window.__chatTest lets chat.js note each time the room is
// asked to open (CHAT._opened). The page's Date.now() holds still at the moment the run starts, unless a check moves it on (__skew).
// Playwright wherever node finds it (npm install playwright), else the copy this container keeps.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node22/lib/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path"), { pathToFileURL } = require("url");

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: node tests/chat/shell.test.js <page.html>"); process.exit(2); }
const PAGE = pathToFileURL(path.resolve(file)).href, HTML = fs.readFileSync(file, "utf8");
const CHAT_JS = fs.readFileSync(path.join(__dirname, "..", "..", "web", "chat.js"), "utf8");
const LOCK = (HTML.match(/\bH="([0-9a-f]{64})"/) || [])[1]; // a site build opens on the passcode screen: start unlocked
const CHAT = "https://chat.test", CONTACT = { name: "Test Operator", email: "chat@example.com" }, NOW = Date.now(), MIN = 60e3;
// The backend's answer for a spot: two reports, newest first, as the room sends them.
const TWO = { reports: [{ ts: NOW - 40*MIN, size: "chest", cond: "clean", crowd: "few" }, { ts: NOW - 125*MIN, size: "waist", cond: "ok", crowd: "busy" }], online: 3, last_id: 9 };
const reports = () => ({ body: TWO });

const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const wait = ms => new Promise(r => setTimeout(r, ms));
// What the page shows of the chat: the strip (hidden, its label, chips and empty line), the button (shown, its text, the dot) and the class tw.
const look = page => page.evaluate(() => { const s = document.getElementById("nowReports"), f = document.querySelector(".chatfab"), vis = e => !!e && getComputedStyle(e).display !== "none" && !e.closest("[hidden]");
  const word = f && f.querySelector("b"), n = f && f.querySelector(".chatfab-n"), dot = f && f.querySelector(".chatfab-dot");
  return { strip: !!s && !s.hidden, label: s && (s.querySelector(".label") || {}).textContent, post: s && (s.querySelector(".rp-post") || {}).textContent,
    chips: s ? [...s.querySelectorAll(".rp-chip")].map(c => [...c.children].map(x => x.textContent.trim())) : [], none: s && (s.querySelector(".rp-none") || {}).textContent,
    fab: vis(f), word: word && word.textContent, count: vis(n) ? n.textContent : null, dot: vis(dot), tw: document.documentElement.classList.contains("tw") }; });
// One finger dragged straight down from a point on the screen by dy pixels, as in tests/map/check.js; lift = false leaves the finger down.
const dragDown = async (page, [x, y], dy, lift = true) => { const s = await page.context().newCDPSession(page);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) { await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy*i/12 }] }); await page.waitForTimeout(16); }
  if (lift) await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); return s; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class Skip extends Error {}

const CHECKS = {
  // Switched off (no CHAT_URL), as the live site is until Bryan's setup is done: neither window.__chatUrl nor window.__chatContact, so
  // the built-in CONTACT is there and only the empty CHAT_URL keeps it off. No page error, no button, the strip stays hidden, and nothing
  // is asked of any backend.
  async chatOff(open) {
    const page = await open({ chat: false, contact: false }), l = await look(page);
    if (await page.evaluate(() => !!document.querySelector(".chatfab"))) throw new Error("there's a CHAT button with the chat switched off");
    if (l.strip) throw new Error("#nowReports shows with the chat switched off");
    if (page.asked.length) throw new Error(`the page asked the backend for ${page.asked.join(", ")}`);
  },
  // A CHAT_URL with an empty operator's name or email (window.__chatContact) is still off: the privacy note can't go out without them
  // (Bryan, Oct 21).
  async needsContact(open) {
    for (const contactV of [{ name: "", email: "" }, { name: "WaveSlave", email: "" }, { name: "", email: "chat@example.com" }]) {
      const page = await open({ contactV }); await wait(300); const l = await look(page);
      if (await page.evaluate(() => !!document.querySelector(".chatfab")) || l.strip || page.asked.length) throw new Error(`with CONTACT ${JSON.stringify(contactV)} the button is ${l.fab ? "there" : "gone"}, the strip ${l.strip ? "shows" : "is hidden"} and the page asked for ${page.asked.join(", ") || "nothing"}`);
    }
  },
  // The operator's name and email are built in (Bryan, Oct 22): he stays anonymous, as "WaveSlave" with waveslave050@gmail.com. With a
  // CHAT_URL and no window.__chatContact the chat comes on, and the privacy note and contact behind More (?chat=privacy) name them.
  async builtInContact(open) {
    const page = await open({ contact: false, query: "?chat=privacy" });
    await page.waitForFunction(() => { const s = document.querySelector(".chatroom .cr-shade"); return !!s && !s.hidden; }, null, { timeout: 5e3 })
      .catch(() => { throw new Error("with no window.__chatContact the chat didn't come on"); });
    const s = await page.evaluate(() => ({ body: document.querySelector(".chatroom .cr-sheet-b").textContent,
      mail: [...document.querySelectorAll('.chatroom .cr-sheet-b a[href^="mailto:"]')].map(a => [a.getAttribute("href"), a.textContent]) }));
    if (!s.body.includes("WaveSlave runs this chat. Questions and takedown requests: waveslave050@gmail.com.")
      || !eq(s.mail, [["mailto:waveslave050@gmail.com", "waveslave050@gmail.com"]])) throw new Error(`the note reads ${JSON.stringify(s).slice(0, 400)}`);
  },
  // On a Taiwan spot: two chips in the order given with the dots coloured by conditions, "Post a report", and the button reading CHAT and
  // 3 online with the pink dot while waveslave-chat-seen is under last_id 9. No chat element carries data-zh or data-ja.
  async stripAndButton(open) {
    const page = await open({ store: { "waveslave-chat-seen": "5" } });
    await page.waitForFunction(() => !document.getElementById("nowReports").hidden);
    const l = await look(page), want = [["Chest · Clean", "Few people · 40 min ago"], ["Waist · OK", "Busy · 2 h ago"]];
    if (!eq(l.chips, want)) throw new Error(`the chips read ${JSON.stringify(l.chips)}, want ${JSON.stringify(want)}`);
    if (l.label !== "Surfer reports · last 4 h") throw new Error(`the strip's label is ${JSON.stringify(l.label)}`);
    if (!/Post a report/.test(l.post || "")) throw new Error(`no "Post a report" button (${JSON.stringify(l.post)})`);
    if (!l.fab || l.word !== "CHAT" || l.count !== "3 online" || !l.dot) throw new Error(`the button is ${l.fab ? "shown" : "hidden"}, reads ${l.word} / ${l.count}, dot ${l.dot}`);
    const dots = await page.evaluate(() => { const s = document.getElementById("nowReports"), c = v => { const p = document.createElement("i"); p.style.background = `var(${v})`; s.append(p); const k = getComputedStyle(p).backgroundColor; p.remove(); return k; };
      return { got: [...s.querySelectorAll(".rp-chip .rp-dot")].map(d => getComputedStyle(d).backgroundColor), want: [c("--good"), c("--fair")], red: c("--bad") }; });
    if (!eq(dots.got, dots.want) || dots.want[0] === dots.want[1] || dots.want.includes(dots.red)) throw new Error(`the dots are ${dots.got.join(", ")}, want ${dots.want.join(", ")} (Clean green, OK amber, neither the red ${dots.red})`);
    const tagged = await page.evaluate(() => document.querySelectorAll("#nowReports [data-zh], #nowReports [data-ja], .chatfab[data-zh], .chatfab [data-zh], .chatfab[data-ja], .chatfab [data-ja]").length);
    if (tagged) throw new Error(`${tagged} chat elements carry data-zh or data-ja`);
    // The strip sits under the facts, the card's full width.
    const box = await page.evaluate(() => { const r = e => e.getBoundingClientRect(), s = r(document.getElementById("nowReports")), f = r(document.getElementById("nowFacts")), n = document.querySelector("section.now"), cs = getComputedStyle(n), c = r(n);
      return { top: s.top, factsBottom: f.bottom, w: s.width, inner: c.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth) }; });
    if (!(box.top >= box.factsBottom) || Math.abs(box.w - box.inner) > 1) throw new Error(`the strip is at ${box.top} (facts end at ${box.factsBottom}), ${box.w} px wide of the card's ${box.inner}`);
    // Seen up to last_id: no dot.
    const seen = await look(await open({ store: { "waveslave-chat-seen": "9" } }).then(async p => { await p.waitForFunction(() => !document.getElementById("nowReports").hidden); return p; }));
    if (seen.dot || seen.count !== "3 online") throw new Error(`with waveslave-chat-seen 9 the dot is ${seen.dot ? "lit" : "off"} and the count ${seen.count}`);
  },
  // "Post a report" opens the room with the report form preset to the spot, and the button opens the room. The room covers the page
  // (tests/chat/room.test.js), so Escape shuts it between the two.
  async openHooks(open) {
    const page = await open({ spot: "jinshan" });
    await page.waitForFunction(() => !document.getElementById("nowReports").hidden);
    await page.click("#nowReports .rp-post");
    let got = await page.evaluate(() => window.CHAT._opened.slice());
    if (got.length !== 1 || got[0].sheet !== "report" || got[0].spot !== "jinshan") throw new Error(`"Post a report" asked the room for ${JSON.stringify(got)}, want one {sheet: "report", spot: "jinshan"}`);
    if (!(await page.evaluate(() => document.documentElement.classList.contains("chat-open")))) throw new Error(`"Post a report" didn't open the room`);
    await page.keyboard.press("Escape"); await settle(page);
    await page.click(".chatfab");
    got = await page.evaluate(() => window.CHAT._opened.slice());
    if (got.length !== 2 || got[1].sheet != null || got[1].spot != null) throw new Error(`the CHAT button asked the room for ${JSON.stringify(got[1])}, want no sheet and no spot`);
  },
  // No reports in the last 4 hours: the strip shows the button and "No reports in the last 4 h". So does an answer with only a report from
  // before then (the strip keeps to its 4 hours on a page left open).
  async noReports(open) {
    for (const reports of [[], [{ ts: NOW - 241*MIN, size: "chest", cond: "clean", crowd: "few" }]]) {
      const page = await open({ backend: () => ({ body: { reports, online: 0, last_id: 0 } }) });
      await page.waitForFunction(() => !document.getElementById("nowReports").hidden);
      const l = await look(page);
      if (l.chips.length || l.none !== "No reports in the last 4 h" || !/Post a report/.test(l.post || "")) throw new Error(`with ${reports.length} reports the strip shows ${JSON.stringify(l)}`);
    }
  },
  // Switching spot asks /reports once for each new spot, with its own chips; switching language (the strip redraws in it) or going to the
  // map and back asks nothing.
  async oneFetchPerSpot(open) {
    const per = { donghe: TWO, jinshan: { reports: [TWO.reports[1]], online: 4, last_id: 9 }, fulong: { reports: [], online: 5, last_id: 9 } };
    const page = await open({ backend: q => ({ body: per[q.searchParams.get("spot")] }) });
    const shows = async (id, n) => { await page.waitForFunction(([id, n]) => CUR === id && !document.getElementById("nowReports").hidden && document.querySelectorAll("#nowReports .rp-chip").length === n, [id, n]); };
    await shows("donghe", 2);
    await page.evaluate(() => switchSpot("jinshan")); await shows("jinshan", 1);
    await page.evaluate(() => switchSpot("fulong")); await shows("fulong", 0);
    const want = ["/reports?spot=donghe", "/reports?spot=jinshan", "/reports?spot=fulong"];
    await wait(300); if (!eq(page.asked, want)) throw new Error(`after the spot switches the page asked ${JSON.stringify(page.asked)}, want ${JSON.stringify(want)}`);
    await page.evaluate(() => setLang("zh")); await settle(page); await wait(300);
    const zh = await look(page);
    if (zh.label !== "浪友回報 · 4 小時內" || zh.word !== "聊天" || zh.count !== "5 人線上") throw new Error(`in 中文 the strip reads ${zh.label} and the button ${zh.word} / ${zh.count}`);
    await page.evaluate(() => setView("ws", true)); await settle(page); await wait(300);
    if ((await look(page)).fab) throw new Error("the CHAT button shows on the map");
    await page.evaluate(() => setView("fc", true)); await settle(page); await wait(300);
    if (!eq(page.asked, want)) throw new Error(`after the language and the map the page asked ${JSON.stringify(page.asked)}, want only ${JSON.stringify(want)}`);
    if (!(await look(page)).fab) throw new Error("the CHAT button is gone after coming back from the map");
  },
  // World mode: Japan hides the button and the strip; back to Taiwan shows them again.
  async worldMode(open) {
    const page = await open({ world: true });
    await page.waitForFunction(() => !document.getElementById("nowReports").hidden);
    if (!(await look(page)).fab) throw new Error("no CHAT button on Donghe in World mode");
    await page.evaluate(() => switchCountry("jp")); await settle(page); await wait(300);
    const jp = await look(page);
    if (jp.fab || jp.strip || jp.tw) throw new Error(`on ${await page.evaluate(() => CUR)} the button is ${jp.fab ? "shown" : "hidden"}, the strip ${jp.strip ? "shows" : "is hidden"}, html.tw ${jp.tw}`);
    await page.evaluate(() => switchCountry("tw"));
    await page.waitForFunction(() => !document.getElementById("nowReports").hidden);
    const tw = await look(page);
    if (!tw.fab || !tw.tw || tw.chips.length !== 2) throw new Error(`back in Taiwan the button is ${tw.fab ? "shown" : "hidden"}, html.tw ${tw.tw}, ${tw.chips.length} chips`);
  },
  // An unreachable backend, or one resting: the strip stays hidden, the page draws, and the button shows no count.
  async unreachable(open) {
    for (const [what, backend] of [["unreachable", () => null], ["resting", () => ({ status: 503, body: { resting: true } })]]) {
      const page = await open({ backend });
      await page.waitForFunction(() => document.querySelectorAll("#days .day").length > 0); await wait(500);
      if (!page.asked.length) throw new Error(`${what}: the page never asked for the reports`);
      const l = await look(page), drew = await page.evaluate(() => ({ h: document.getElementById("nowH1").textContent, facts: document.querySelectorAll("#nowFacts .fact").length }));
      if (l.strip) throw new Error(`${what}: the strip shows`);
      if (drew.h === "–" || !drew.facts) throw new Error(`${what}: the Right now card didn't draw (${JSON.stringify(drew)})`);
      if (l.count) throw new Error(`${what}: the button says ${l.count}`);
    }
  },
  // Whatever the backend sends goes in as text or through chat.js's own tables: unknown codes drop their chip, a count that isn't a number
  // shows none, and no element or dialog comes of it.
  async badData(open) {
    const x = "<img src=x onerror=alert(1)>";
    const page = await open({ backend: () => ({ body: { reports: [{ ts: NOW - 5*MIN, size: x, cond: "clean", crowd: "few" }, { ts: NOW - 6*MIN, size: "head", cond: "blown", crowd: "constructor" },
      { ts: "soon", size: "head", cond: "ok", crowd: "few" }, { ts: NOW - 20*MIN, size: "knee", cond: "choppy", crowd: "empty" }], online: "<b>7</b>", last_id: x } }) });
    await page.waitForFunction(() => !document.getElementById("nowReports").hidden);
    const l = await look(page), tags = await page.evaluate(() => document.querySelectorAll("#nowReports img, #nowReports b b, .chatfab img, .chatfab b b").length);
    if (!eq(l.chips, [["Knee · Choppy", "Empty · 20 min ago"]])) throw new Error(`the chips read ${JSON.stringify(l.chips)}`);
    // Choppy (and Blown out) is the red dot.
    const red = await page.evaluate(() => { const s = document.getElementById("nowReports"), p = document.createElement("i"); p.style.background = "var(--bad)"; s.append(p);
      const want = getComputedStyle(p).backgroundColor; p.remove(); return { got: getComputedStyle(s.querySelector(".rp-chip .rp-dot")).backgroundColor, want }; });
    if (red.got !== red.want) throw new Error(`the Choppy dot is ${red.got}, want ${red.want} (--bad)`);
    if (l.count || l.dot || tags || page.dialogs.length) throw new Error(`the button says ${l.count}, dot ${l.dot}, ${tags} stray elements, ${page.dialogs.length} dialogs`);
  },
  // Coming back to the page asks for the reports again only once a minute has gone by.
  async visibilityOncePerMinute(open) {
    const page = await open({}); await page.waitForFunction(() => !document.getElementById("nowReports").hidden);
    const back = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await back(); await wait(300);
    if (page.asked.length !== 1) throw new Error(`back within the minute, the page asked ${JSON.stringify(page.asked)}`);
    await page.evaluate(() => window.__skew(61e3)); await back(); await wait(300);
    if (page.asked.length !== 2) throw new Error(`back after a minute, the page asked ${JSON.stringify(page.asked)}`);
  },
  // While a finger drags the day picker the button lets touches through (pointer-events: none), and takes them again when it lifts.
  async tapsPassThrough(open) {
    const page = await open({}); await page.waitForFunction(() => !document.getElementById("nowReports").hidden);
    await page.locator("#days").scrollIntoViewIfNeeded();
    const b = await page.locator("#days").boundingBox(), pe = () => page.evaluate(() => getComputedStyle(document.querySelector(".chatfab")).pointerEvents);
    if (await pe() === "none") throw new Error("the button lets touches through before any drag");
    const s = await page.context().newCDPSession(page), x = b.x + b.width*0.3, y = b.y + b.height/2;
    await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 40, y }] });
    const during = await pe();
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await settle(page);
    const after = await pe();
    if (during !== "none" || after === "none") throw new Error(`pointer-events is ${during} during the drag and ${after} after it`);
  },
  // ?chat with the Map view saved: the address is tidied to #<spot> at once, and the room is asked to open once, with the Forecast view up.
  async chatLink(open) {
    const page = await open({ spot: "jinshan", query: "?chat", view: "ws" });
    const s = await page.evaluate(() => ({ search: location.search, hash: location.hash, opened: window.CHAT._opened, VIEW, fc: !document.getElementById("viewFc").hidden, ws: !document.getElementById("viewWs").hidden }));
    if (s.search !== "" || s.hash !== "#jinshan") throw new Error(`the address is ${s.search}${s.hash}, want #jinshan`);
    if (s.opened.length !== 1 || s.opened[0].view !== "fc" || !s.opened[0].forecast) throw new Error(`the room was asked ${JSON.stringify(s.opened)}, want once with the Forecast view up`);
    if (!eq(Object.keys(s.opened[0]).sort(), ["forecast", "view"])) throw new Error(`?chat asked the room for ${JSON.stringify(s.opened[0])}, want no sheet, spot or sign-in`);
    if (s.VIEW !== "fc" || !s.fc || s.ws) throw new Error(`after ?chat VIEW is ${s.VIEW}, the forecast ${s.fc ? "shown" : "hidden"} and the map ${s.ws ? "shown" : "hidden"}`);
  },
  // Back from LINE (?chat#c=...&p=... or #e=...): the fragment is gone from the address at once, the page goes back to the spot saved
  // before leaving (sessionStorage waveslave-chat-return), and the room is asked to open.
  async loginReturn(open) {
    const want = { "c=abc123&p=482913": { code: "abc123", pin: "482913" }, "e=access_denied": { error: "access_denied" } };
    for (const frag of Object.keys(want)) {
      const page = await open({ spot: frag, query: "?chat", session: { "waveslave-chat-return": "wushi" }, store: { "waveslave-spot": "donghe", "waveslave-spot-tw": "donghe" } });
      const s = await page.evaluate(() => ({ href: location.href, hash: location.hash, cur: CUR, opened: window.CHAT._opened, ret: sessionStorage.getItem("waveslave-chat-return") }));
      if (/[?&#](c|e|p)=|\?chat/.test(s.href) || s.hash !== "#wushi" || s.cur !== "wushi") throw new Error(`#${frag}: the address is ${s.href} on ${s.cur}, want #wushi`);
      if (s.opened.length !== 1 || s.ret !== null) throw new Error(`#${frag}: the room was asked ${s.opened.length} times and waveslave-chat-return holds ${s.ret}`);
      if (!eq(s.opened[0].signin, want[frag])) throw new Error(`#${frag}: the room got the sign-in ${JSON.stringify(s.opened[0].signin)}, want ${JSON.stringify(want[frag])}`);
    }
  },
  // template.html's guards: while html.chat-open is set, Escape doesn't close the full-screen map and a pull from the top doesn't start a refresh.
  async chatOpenGuards(open) {
    const page = await open({});
    await page.evaluate(() => { setView("ws", true); document.documentElement.classList.add("chat-open"); }); await settle(page);
    await page.keyboard.press("Escape"); await settle(page);
    if (await page.evaluate(() => VIEW) !== "ws") throw new Error("Escape closed the map while the chat is open");
    await page.evaluate(() => document.documentElement.classList.remove("chat-open")); await page.keyboard.press("Escape"); await settle(page);
    if (await page.evaluate(() => VIEW) !== "fc") throw new Error("Escape doesn't close the map with the chat shut (the check itself is off)");
    await page.evaluate(() => { scrollTo(0, 0); document.documentElement.classList.add("chat-open"); }); await settle(page);
    const ptr = () => page.evaluate(() => +getComputedStyle(document.querySelector(".ptr")).opacity);
    let s = await dragDown(page, [200, 200], 60, false); await settle(page); const shut = await ptr();
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await settle(page);
    await page.evaluate(() => document.documentElement.classList.remove("chat-open"));
    s = await dragDown(page, [200, 200], 60, false); await settle(page); const shown = await ptr();
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    if (shut !== 0) throw new Error(`a pull with the chat open shows the refresh sign (opacity ${shut})`);
    if (!(shown > 0)) throw new Error("a pull with the chat shut doesn't show the refresh sign (the check itself is off)");
  },
  // Every string is there in English, 中文 and 日本語, with the same codes and the same number of house rules, none empty, and the privacy
  // note names the operator (CONTACT) in each.
  async everyLanguage(open) {
    const page = await open({}), bad = await page.evaluate(c => { const T = window.CHAT._strings, out = [], langs = ["en", "zh", "ja"];
      const text = (v, k) => { const s = typeof v === "function" ? v(...(k === "privacy" ? [c] : k === "forecastSaid" ? ["1.1 m", "1.0 m", "07:00"] : [7])) : v;
        return Array.isArray(s) ? s.flat() : s && typeof s === "object" ? Object.values(s) : [s]; };
      if (!eq(Object.keys(T).sort(), langs.slice().sort())) out.push(`languages ${Object.keys(T)}`);
      function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
      for (const k of Object.keys(T.en)) for (const l of langs) {
        const v = T[l][k], e = T.en[k];
        if (v === undefined) { out.push(`${l} has no ${k}`); continue; }
        if (typeof v !== typeof e || Array.isArray(v) !== Array.isArray(e)) out.push(`${l}.${k} is a ${typeof v}, en's a ${typeof e}`);
        if (e && typeof e === "object" && !Array.isArray(e) && !eq(Object.keys(v), Object.keys(e))) out.push(`${l}.${k} has ${Object.keys(v)}, en ${Object.keys(e)}`);
        const ts = text(v, k), te = text(e, k);
        if (ts.length !== te.length) out.push(`${l}.${k} has ${ts.length} parts, en ${te.length}`);
        if (ts.some(s => typeof s !== "string" || !s.trim())) out.push(`${l}.${k} has an empty or missing part`);
        if (k === "privacy" && !(ts.join(" ").includes(c.name) && ts.join(" ").includes(c.email))) out.push(`${l}.privacy doesn't name ${c.name} and ${c.email}`);
      }
      for (const l of langs) for (const k of Object.keys(T[l])) if (!(k in T.en)) out.push(`${l} has ${k}, en doesn't`);
      return out; }, CONTACT);
    if (bad.length) throw new Error(bad.join("; "));
    if (!await page.evaluate(() => window.CHAT._strings.en.lineLogin === "Log in with LINE" && window.CHAT._strings.zh.lineLogin === "使用LINE帳號登入" && window.CHAT._strings.ja.lineLogin === "LINEでログイン"))
      throw new Error("the LINE button's wording isn't LINE's own");
  },
  // A long wait reads in minutes or hours, never as 61234 s: the day's limits on shares and logs answer with waits of up to a day.
  async longWaits(open) {
    const page = await open({}), got = await page.evaluate(() => ["en", "zh", "ja"].map(l => [30, 600, 61234].map(s => window.CHAT._strings[l].slowDown(s))));
    const want = [["Slow down a little · try again in 30 s", "Slow down a little · try again in 10 min", "Slow down a little · try again in 18 h"],
      ["慢一點 · 30 秒後再試", "慢一點 · 10 分鐘後再試", "慢一點 · 18 小時後再試"],
      ["少しペースを落としてください · 30秒後に再試行", "少しペースを落としてください · 10分後に再試行", "少しペースを落としてください · 18時間後に再試行"]];
    if (!eq(got, want)) throw new Error(`waits read ${JSON.stringify(got)}`);
  },
  // chat.js adds one global, window.CHAT = {spot, relang}, and nothing else; and it has no HTML sinks.
  async noGlobals(open) {
    const names = async page => { await settle(page); await wait(300); return page.evaluate(() => Object.getOwnPropertyNames(window)); };
    const on = await open({ test: false }); await on.waitForFunction(() => !document.getElementById("nowReports").hidden);
    const a = await names(on), b = new Set(await names(await open({ test: false, chatJs: "" }))), extra = a.filter(k => !b.has(k));
    if (!eq(extra, ["CHAT"])) throw new Error(`chat.js adds ${JSON.stringify(extra)}, want only CHAT`);
    const keys = await on.evaluate(() => Object.keys(window.CHAT).sort());
    if (!eq(keys, ["relang", "spot"])) throw new Error(`window.CHAT has ${keys.join(", ")}`);
    const code = CHAT_JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    const sinks = code.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|data-zh|data-ja/g);
    if (sinks) throw new Error(`chat.js uses ${[...new Set(sinks)].join(", ")}`);
  },
};

(async () => {
  const browser = await chromium.launch(); let bad = false, ctxs = [], errs = [];
  // A fresh context for every page. The page and chat.js load from here; the fake backend answers what backend(url) gives back (null:
  // the network fails); everything else is cut off. page.asked lists the backend calls, page.dialogs any alert.
  async function open({ spot = "donghe", query = "", chat = true, contact = true, contactV = CONTACT, backend = reports, store = {}, session = {}, world = false, view = "fc", test = true, chatJs = CHAT_JS }) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
    ctxs.push(ctx); const asked = [], dialogs = [];
    await ctx.route("**/*", r => { const u = r.request().url();
      if (u.split(/[?#]/)[0] === PAGE) return r.continue();
      if (u.startsWith("file:") && u.split(/[?#]/)[0].endsWith("/chat.js")) return r.fulfill({ contentType: "text/javascript", body: chatJs });
      if (u.startsWith(CHAT + "/")) { const q = new URL(u); asked.push(q.pathname + q.search); const a = backend(q);
        return a ? r.fulfill({ status: a.status || 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(a.body) }) : r.abort(); }
      return r.abort(); });
    await ctx.addInitScript(([o, now, lock]) => { let skew = 0; Date.now = () => now + skew; window.__skew = ms => { skew += ms; };
      try { sessionStorage.setItem("waveslave-intro", "1"); localStorage.setItem("waveslave-view", o.view); localStorage.setItem("waveslave-lang", "en"); localStorage.setItem("waveslave-world", o.world ? "1" : "0");
        for (const k in o.store) localStorage.setItem(k, o.store[k]); for (const k in o.session) sessionStorage.setItem(k, o.session[k]); if (lock) sessionStorage.setItem("waveslave-unlock", lock); } catch (e) {}
      if (o.chat) window.__chatUrl = o.url; if (o.contact) window.__chatContact = o.contactV; if (o.test) window.__chatTest = true; },
      [{ view, world, store, session, chat, contact, test, url: CHAT, contactV }, NOW, LOCK]);
    const page = await ctx.newPage(); page.on("pageerror", e => errs.push(String(e))); page.on("dialog", d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    await page.goto(PAGE + query + "#" + spot, { waitUntil: "load" }); await settle(page);
    page.asked = asked; page.dialogs = dialogs; return page;
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
  try { for (const [name, run] of Object.entries(CHECKS)) await step(name, () => run(open)); }
  finally { await browser.close(); }
  process.exitCode = bad ? 1 : 0;
})();
