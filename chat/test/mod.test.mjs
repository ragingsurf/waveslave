// Tests for chat/src/mod.js: the pure moderation and validation functions. They run under plain
// `node --test`, with no Worker and no I/O. Run from chat/: node --test test/mod.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SPOTS, SIZES, CONDS, CROWDS, BOARDS, REASONS, SNAP_KEYS,
  normalise, blocked, checkNick, validReport, validSnap, validSession,
} from "../src/mod.js";

const list = JSON.parse(readFileSync(new URL("../blocklist.json", import.meta.url), "utf8"));
const rule = (text, l = list) => { const r = blocked(normalise(text).check, l); return r && r.rule; };

// A time on the Taipei clock (UTC+8, no daylight saving), as epoch milliseconds.
const taipei = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 8, mi);

test("constants match the spec", () => {
  assert.deepEqual(SPOTS, ["donghe", "jialeshui", "nanwan", "jinshan", "fulong", "wushi", "suao", "hualien"]);
  assert.deepEqual(SIZES, ["flat", "knee", "waist", "chest", "head", "overhead"]);
  assert.deepEqual(CONDS, ["clean", "ok", "choppy", "blown"]);
  assert.deepEqual(CROWDS, ["empty", "few", "busy", "packed"]);
  assert.deepEqual(BOARDS, ["short", "fish", "minimal", "long", "softtop"]);
  assert.deepEqual(REASONS, ["spam", "harass", "sexual", "child", "other"]);
  assert.deepEqual(SNAP_KEYS, {
    hs: [0, 15], tp: [0, 30], dp: [0, 360], shs: [0, 15], stp: [0, 30], sdp: [0, 360],
    ws: [0, 120], wd: [0, 360], tide: [-5, 5], bhs: [0, 15], btp: [0, 30], bdp: [0, 360],
  });
});

// ---- normalise -------------------------------------------------------------------------------

test("normalise: full-width letters fold to plain ones", () => {
  assert.equal(normalise("ＬＩＮＥ").check, "line");
  assert.equal(normalise("ＬＩＮＥ").stored, "LINE");
});

test("normalise: stored text keeps its case, the checking copy does not", () => {
  const n = normalise("Chest High");
  assert.equal(n.stored, "Chest High");
  assert.equal(n.check, "chest high");
});

test("normalise: zero-width characters are removed from both copies", () => {
  const n = normalise("lin\u{200b}.ee");
  assert.equal(n.stored, "lin.ee");
  assert.equal(n.check, "lin.ee");
  for (const ch of ["\u{00ad}", "\u{180e}", "\u{200c}", "\u{200d}", "\u{2060}", "\u{feff}"]) {
    assert.equal(normalise("a" + ch + "b").stored, "ab", "U+" + ch.codePointAt(0).toString(16));
  }
});

test("normalise: direction-control characters are removed from the stored text", () => {
  assert.equal(normalise("\u{202e}hi").stored, "hi");
  assert.ok(!normalise("\u{202e}hi").stored.includes("\u{202e}"));
  for (const ch of ["\u{200e}", "\u{200f}", "\u{202a}", "\u{202b}", "\u{202c}", "\u{202d}", "\u{2066}", "\u{2067}", "\u{2068}", "\u{2069}"]) {
    assert.equal(normalise("a" + ch + "b").stored, "ab", "U+" + ch.codePointAt(0).toString(16));
  }
});

test("normalise: variation selectors and tag characters are removed", () => {
  assert.equal(normalise("a\u{fe0f}b").stored, "ab");
  assert.equal(normalise("a\u{e0100}b").stored, "ab");
  assert.equal(normalise("a\u{e0041}b").stored, "ab");
});

test("normalise: control characters are removed from both copies", () => {
  const n = normalise("lin\u0001.ee");
  assert.equal(n.stored, "lin.ee");
  assert.equal(n.check, "lin.ee");
  assert.deepEqual(normalise("0912\u007f345678"), { stored: "0912345678", check: "0912345678" });
  // every C0 and C1 control that is not a tab or a line break, and DEL
  const controls = [];
  for (let cp = 0; cp <= 0x9f; cp++) if (cp <= 0x1f || cp >= 0x7f) controls.push(cp);
  for (const cp of controls) {
    if ([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x85].includes(cp)) continue;
    const got = normalise("a" + String.fromCodePoint(cp) + "b");
    assert.deepEqual(got, { stored: "ab", check: "ab" }, "U+" + cp.toString(16));
  }
});

test("normalise: U+FFFC and the interlinear annotation marks are removed from both copies", () => {
  for (const ch of ["\u{fffc}", "\u{fff9}", "\u{fffa}", "\u{fffb}"]) {
    assert.deepEqual(normalise("line" + ch + ".me"), { stored: "line.me", check: "line.me" }, "U+" + ch.codePointAt(0).toString(16));
  }
});

test("normalise: private-use characters, lone surrogates and noncharacters are removed", () => {
  for (const ch of ["\u{e000}", "\u{f8ff}", "\u{f0000}", "\u{10fffd}", "\ud800", "\udfff", "\u{fdd0}", "\u{ffff}", "\u{1fffe}"]) {
    assert.deepEqual(normalise("a" + ch + "b"), { stored: "ab", check: "ab" }, "U+" + ch.codePointAt(0).toString(16));
  }
});

test("normalise: text that joins up once the invisible characters are gone is still in NFKC form", () => {
  assert.equal(normalise("e\u{200d}\u{0301}").stored, "\u{e9}"); // e, a zero-width joiner, an acute accent
  assert.equal(normalise("e\u{200d}\u{0301}").check, "e");
  assert.equal(normalise("\u{1112}\u{3164}\u{1161}").stored, "\u{d558}"); // Hangul jamo around a filler become one syllable
});

test("normalise: a tab or line break becomes one space in the stored text and a newline in the checking copy", () => {
  assert.deepEqual(normalise("Good waves\r\n\tCrowded"), { stored: "Good waves Crowded", check: "good waves\ncrowded" });
  assert.deepEqual(normalise("a\u{85}b\u{2028}c\u{2029}d\u000be\u000cf"), { stored: "a b c d e f", check: "a\nb\nc\nd\ne\nf" });
  assert.deepEqual(normalise("li\tne.me"), { stored: "li ne.me", check: "li\nne.me" });
  assert.deepEqual(normalise("\n\nhi\t"), { stored: " hi ", check: "\nhi\n" }); // callers trim
});

test("normalise: no invisible character of any kind survives, and normalising twice changes nothing", () => {
  // Every code point there is, between two letters. The stored text must come back with nothing between
  // them (or one space, for a break), and the checking copy likewise ("\n" for a break).
  const invisible = /[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Noncharacter_Code_Point}\u{fffc}\u{2028}\u{2029}]/u;
  const isBreak = /[\t\n\v\f\r\u{85}\u{2028}\u{2029}]/u;
  let removed = 0;
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    const ch = String.fromCodePoint(cp);
    const n = normalise("a" + ch + "b");
    if (invisible.test(ch)) {
      removed++;
      const want = isBreak.test(ch) ? { stored: "a b", check: "a\nb" } : { stored: "ab", check: "ab" };
      if (n.stored !== want.stored || n.check !== want.check) assert.fail("U+" + cp.toString(16) + " came back as " + JSON.stringify(n));
    }
    if (invisible.test(n.stored) || invisible.test(n.check.replaceAll("\n", ""))) assert.fail("U+" + cp.toString(16) + " left an invisible character");
    if (normalise(n.stored).stored !== n.stored) assert.fail("U+" + cp.toString(16) + " is not stable");
  }
  assert.ok(removed > 100000, "the sweep covered " + removed + " invisible code points");
});

test("normalise: styled letters fold to plain ones", () => {
  assert.ok(normalise("𝐥𝐢𝐧𝐞.𝐦𝐞").check.includes("line.me"));
  assert.ok(normalise("\u{2113}ine.me").check.includes("line.me"));
});

test("normalise: look-alike Cyrillic, Greek and Latin letters fold to Latin", () => {
  assert.equal(normalise("l\u{0456}ne.me").check, "line.me");
  assert.equal(normalise("Bry\u{0430}n").check, "bryan");
  assert.equal(normalise("\u{0391}\u{0392}\u{0395}").check, "abe"); // Greek capitals
  assert.equal(normalise("\u{039d}\u{0397}").check, "nh"); // Greek capital Nu and Eta read as N and H
  assert.equal(normalise("\u{043e}\u{0440}\u{0435}").check, "ope");
  assert.equal(normalise("\u{00f8}\u{0142}").check, "ol");
});

test("normalise: combining marks do not hide a word", () => {
  assert.equal(normalise("l\u{0332}i\u{0332}n\u{0332}e\u{0332}.me").check, "line.me");
  assert.equal(normalise("l\u{00ed}ne").check, "line");
});

test("normalise: Japanese voiced marks survive in the checking copy", () => {
  assert.equal(normalise("ガ").check, "ガ");
  assert.equal(normalise("が").check, "が");
  assert.equal(normalise("\u{304b}\u{3099}").check, "が"); // typed as a kana plus a separate voiced mark
});

test("normalise: Chinese numerals become digits in the checking copy only", () => {
  const n = normalise("〇九一二三四五六七八 零");
  assert.equal(n.check, "0912345678 0");
  assert.equal(n.stored, "〇九一二三四五六七八 零");
});

test("normalise: Chinese and full-width full stops become dots in the checking copy", () => {
  assert.equal(normalise("line。me").check, "line.me");
  assert.equal(normalise("line．me").check, "line.me");
});

test("normalise: odd input does not throw", () => {
  assert.deepEqual(normalise(""), { stored: "", check: "" });
  assert.deepEqual(normalise(undefined), { stored: "", check: "" });
  assert.deepEqual(normalise(null), { stored: "", check: "" });
  assert.equal(normalise(12345).check, "12345");
});

// ---- blocked ---------------------------------------------------------------------------------

test("blocked: the blocklist file has the documented shape", () => {
  assert.deepEqual(Object.keys(list).sort(), ["allowHosts", "line", "phrases", "short"]);
  assert.deepEqual(Object.keys(list.phrases).sort(), ["scam", "slur", "vape"]);
  for (const v of [list.line, list.short, list.allowHosts, list.phrases.scam, list.phrases.vape, list.phrases.slur]) {
    assert.ok(Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0));
  }
});

test("blocked: returns the rule name, or null", () => {
  assert.deepEqual(blocked(normalise("line.me/ti/g/x").check, list), { rule: "line" });
  assert.equal(blocked("", list), null);
  assert.equal(blocked("chest high today", list), null);
});

test("blocked: LINE invites and IDs", () => {
  assert.equal(rule("line.me/ti/g/x"), "line");
  assert.equal(rule("lin.ee/abc"), "line");
  assert.equal(rule("加賴 abc123"), "line");
  assert.equal(rule("加LINE"), "line");
  assert.equal(rule("加 賴"), "line");
  assert.equal(rule("加ＬＩＮＥ"), "line");
  assert.equal(rule("l\u{0456}ne.me/x"), "line");
  assert.equal(rule("𝐥𝐢𝐧𝐞.𝐦𝐞"), "line");
  assert.equal(rule("lin\u{200b}.ee/abc"), "line");
  assert.equal(rule("line。me/ti/p/x"), "line");
  assert.equal(rule("https://page.line.me/abc"), "line");
  assert.equal(rule("my id @surfer88"), "line");
  assert.equal(rule("add line id surf88"), "line");
});

test("blocked: surf talk that mentions a line or an at-sign is not a LINE ID", () => {
  assert.equal(rule("Nice clean line on that one"), null);
  assert.equal(rule("line up at the peak, the lineup is long"), null);
  assert.equal(rule("Chest high @ 9 s"), null);
  assert.equal(rule("1.2 m@9s"), null);
  assert.equal(rule("3ft @12s, glassy"), null);
  assert.equal(rule("dawn patrol @6am"), null);
  assert.equal(rule("meet @10am at the car park"), null);
  assert.equal(rule("@阿凱 thanks!"), null);
  assert.equal(rule("airline.me/x"), "link"); // a real link, but not a LINE one
});

test("blocked: Telegram", () => {
  assert.equal(rule("t.me/x"), "telegram");
  assert.equal(rule("telegram.me/x"), "telegram");
  assert.equal(rule("join t\u{200b}.me/surf"), "telegram");
  assert.equal(rule("cat.me and dog"), null);
});

test("blocked: URL shorteners", () => {
  assert.equal(rule("https://bit.ly/x"), "short");
  assert.equal(rule("bit.ly/x"), "short");
  assert.equal(rule("www.bit.ly/x"), "short");
  assert.equal(rule("reurl.cc/abc"), "short");
  assert.equal(rule("pse.is/abc"), "short");
  assert.equal(rule("tinyurl.com/abc"), "short");
});

test("blocked: links", () => {
  assert.equal(rule("see example.com/x"), "link");
  assert.equal(rule("example.com"), "link");
  assert.equal(rule("shop.example.com.tw"), "link");
  assert.equal(rule("www.example"), "link");
  assert.equal(rule("https://example.org"), "link");
  assert.equal(rule("ftp://example.org"), "link");
  assert.equal(rule("example。com"), "link");
  assert.equal(rule("ｅｘａｍｐｌｅ．ｃｏｍ"), "link");
  assert.equal(rule("mail bob@gmail.com"), "link");
  assert.equal(rule("kiwi.surf/abc"), "link");
});

test("blocked: ordinary punctuation is not a link", () => {
  assert.equal(rule("Great waves.See you at 7"), null);
  assert.equal(rule("Fun session.It was clean"), null);
  assert.equal(rule("Chest high at 7:30, 1.2 m @ 9 s"), null);
  assert.equal(rule("Hs 1.2m/Tp 9s, wind 15 kt"), null);
  assert.equal(rule("e.g. fish or minimal, i.e. anything short"), null);
  assert.equal(rule("photo IMG_2031.jpg"), null);
});

test("blocked: the allowHosts list lets chosen sites through", () => {
  const withHost = { ...list, allowHosts: ["waveslave.tw"] };
  assert.equal(rule("https://waveslave.tw/#jinshan", withHost), null);
  assert.equal(rule("www.waveslave.tw", withHost), null);
  assert.equal(rule("waveslave.tw/#jinshan", withHost), null);
  assert.equal(rule("https://waveslave.tw.evil.com/x", withHost), "link");
  assert.equal(rule("https://notwaveslave.tw/x", withHost), "link");
  assert.equal(rule("https://waveslave.tw/ and https://evil.com", withHost), "link");
  assert.equal(rule("https://waveslave.tw/#jinshan"), "link"); // nothing is allowed by default
});

test("blocked: Taiwan phone numbers, however they are spaced or spelled", () => {
  assert.equal(rule("0912-345-678"), "phone");
  assert.equal(rule("0912 345 678"), "phone");
  assert.equal(rule("0912345678"), "phone");
  assert.equal(rule("0912.345.678"), "phone");
  assert.equal(rule("0912/345/678"), "phone");
  assert.equal(rule("0912・345・678"), "phone");
  assert.equal(rule("0 9 1 2 3 4 5 6 7 8"), "phone");
  assert.equal(rule("〇九一二三四五六七八"), "phone");
  assert.equal(rule("零九一二-三四五-六七八"), "phone");
  assert.equal(rule("０９１２３４５６７８"), "phone");
  assert.equal(rule("+886 912345678"), "phone");
  assert.equal(rule("+886-912-345-678"), "phone");
  assert.equal(rule("886912345678"), "phone");
  assert.equal(rule("call me on 0912\u{200b}345\u{200b}678 ok"), "phone");
});

test("blocked: numbers that are not phone numbers", () => {
  assert.equal(rule("09/10/2026"), null);
  assert.equal(rule("Wind 20 kt, 1.2 m at 9 s, 07:30-09:30"), null);
  assert.equal(rule("0912"), null);
  assert.equal(rule("091234567"), null); // one digit short
  assert.equal(rule("20260912345678"), null); // inside a longer number
  assert.equal(rule("Chest high at 7:30, 1.2 m @ 9 s"), null);
});

test("blocked: a list of wave heights or periods is not a phone number", () => {
  // Each height is a decimal of its own, so the list doesn't run together into "0911131620".
  assert.equal(rule("swell 0.9 1.1 1.3 1.6 2.0 over the weekend"), null);
  assert.equal(rule("0.9 1.1 1.0 1.2 1.3"), null);
  assert.equal(rule("Hs 0.9, 0.8 0.9 1.0 1.2 m"), null);
  assert.equal(rule("0.9-1.2 1.3-1.6 2.0"), null);
  assert.equal(rule("〇。九 一。一 一。三 一。六 二。〇"), null); // the same, in Chinese numerals and full stops
  assert.equal(rule("periods 9.5 10.2 11.0 9.8 12.1 s"), null);
  assert.equal(rule("0.95 1.25 1.30 1.65 2.05"), null); // two decimals
  assert.equal(rule("swell 0.9 1.1 1.3 1.6 2.0."), null); // at the end of a sentence
});

test("blocked: a dot after a single digit still joins a phone number when it isn't a decimal", () => {
  assert.equal(rule("0.9.1.2.3.4.5.6.7.8"), "phone"); // a chain of dots is not one decimal
  assert.equal(rule("0.912.345.678"), "phone");
  assert.equal(rule("0.912-345-678"), "phone"); // three digits after the dot
  assert.equal(rule("0 9 1 2 3 4 5 6 7 8"), "phone");
  assert.equal(rule("0912.345.678"), "phone");
});

test("blocked: investment-scam phrases", () => {
  assert.equal(rule("飆股"), "scam");
  assert.equal(rule("帶單"), "scam");
  assert.equal(rule("飆 股"), "scam");
  assert.equal(rule("老師帶單群"), "scam");
  assert.equal(rule("send USDT now"), "scam");
  assert.equal(rule("usdt888"), "scam");
  assert.equal(rule("保證獲利"), "scam");
});

test("blocked: e-cigarette terms", () => {
  assert.equal(rule("電子煙"), "vape");
  assert.equal(rule("电子烟"), "vape");
  assert.equal(rule("selling VAPE pods"), "vape");
  assert.equal(rule("vaping on the beach"), "vape");
});

test("blocked: slurs match whole words only", () => {
  assert.equal(rule("you nigger"), "slur");
  assert.equal(rule("黑鬼"), "slur");
  assert.equal(rule("a snigger from the line-up"), null);
});

test("blocked: casual swearing and ordinary words pass", () => {
  assert.equal(rule("幹嘛"), null);
  assert.equal(rule("樹幹"), null);
  assert.equal(rule("幹 浪超好"), null);
  assert.equal(rule("靠北今天好亂"), null);
  assert.equal(rule("Chest high at 7:30, 1.2 m @ 9 s"), null);
  assert.equal(rule("今天金山浪不錯，早上六點到"), null);
  assert.equal(rule("Escape the crowd, the vapor was thick, spicy ramen after"), null);
});

test("blocked: a Latin phrase must sit on word edges, a Chinese one need not", () => {
  const custom = { phrases: { scam: ["spic", "飆股"], vape: [], slur: [] }, line: [], short: [], allowHosts: [] };
  assert.equal(rule("spic", custom), "scam");
  assert.equal(rule("a spic!", custom), "scam");
  assert.equal(rule("spicy tacos", custom), null);
  assert.equal(rule("auspic", custom), null);
  assert.equal(rule("今天的飆股分享", custom), "scam");
});

test("blocked: list entries are matched after the same normalising as messages", () => {
  const custom = { phrases: { scam: ["ＢＡＤ Ｗｏｒｄ", "投資一對一"], vape: [], slur: [] }, line: [], short: [], allowHosts: [] };
  assert.equal(rule("this is a bad word!", custom), "scam");
  assert.equal(rule("投資1對1", custom), "scam");
  assert.equal(rule("投資一對一", custom), "scam");
});

test("blocked: a control character or an object-replacement mark cannot hide a banned word", () => {
  assert.equal(rule("lin\u0001.ee/abc"), "line");
  assert.equal(rule("line\u{fffc}.me"), "line");
  assert.equal(rule("line\u{fff9}.me"), "line");
  assert.equal(rule("line\u{fffa}.me"), "line");
  assert.equal(rule("line\u{fffb}.me"), "line");
  assert.equal(rule("l\u007fine.me"), "line");
  assert.equal(rule("l\u0090ine.me"), "line");
  assert.equal(rule("t\u0085.me/x"), "telegram");
  assert.equal(rule("t\u0002.me/x"), "telegram");
  assert.equal(rule("bit\u0003.ly/x"), "short");
  assert.equal(rule("example\u0004.com"), "link");
  assert.equal(rule("0912\u007f345678"), "phone");
  assert.equal(rule("0912\u0001-345\u0001-678"), "phone");
  assert.equal(rule("飆\u0001股"), "scam");
  assert.equal(rule("電\u{fffc}子煙"), "vape");
  assert.equal(rule("nig\u0001ger"), "slur");
  assert.equal(rule("\u{e000}加\u{e001}賴\u{e002} abc123"), "line");
});

test("blocked: a tab or line break does not hide a banned word", () => {
  assert.equal(rule("li\tne.me"), "line");
  assert.equal(rule("li\nne.me"), "line");
  assert.equal(rule("li\r\nne.me"), "line");
  assert.equal(rule("t\n.me/x"), "telegram");
  assert.equal(rule("0912\n345\n678"), "phone");
  assert.equal(rule("0912\t345\t678"), "phone");
  assert.equal(rule("飆\r\n股"), "scam");
  assert.equal(rule("電\n子煙"), "vape");
  assert.equal(rule("line\u{2028}.me"), "line");
});

test("blocked: a tab or line break is still the edge of a word", () => {
  // Read as nothing, these would glue to the word before and lose their edge ("helloline.me", "buyvape").
  assert.equal(rule("hello\nline.me"), "line");
  assert.equal(rule("hello\tline.me"), "line");
  assert.equal(rule("buy\nvape"), "vape");
  assert.equal(rule("you\r\nnigger"), "slur");
  assert.equal(rule("add me\nline id surf88"), "line");
  assert.equal(rule("my id\n@surfer88"), "line");
  // Both readings hit here (a link when glued, Telegram when spaced): the earlier rule is reported.
  assert.equal(rule("hello\tt.me/x"), "telegram");
  assert.equal(rule("hello\nline.me/ti/x"), "line");
});

test("blocked: ordinary text with tabs and line breaks passes", () => {
  assert.equal(rule("Clean peaks\nGood tide\r\n\tFew people"), null);
  assert.equal(rule("Chest high\nat 7:30,\n1.2 m @ 9 s"), null);
  assert.equal(rule("今天金山浪不錯\n早上六點到"), null);
  assert.equal(rule("\n\n  \t "), null);
});

// ---- checkNick -------------------------------------------------------------------------------

test("checkNick: reserved words are refused, however they are dressed up", () => {
  for (const nick of ["Br\u0001yan", "Br\u{fffc}yan", "Br\u007fyan", "Bryan", "ＢＲＹＡＮ", "Bry\u{0430}n", "Br\u{200b}yan", "WaveSlave官方", "管理员", "教練Leo",
    "bryan", "B r y a n", "Admin", "xAdminx", "Coach Kai", "Staff", "Mod_88", "管理員", "教练", "站長", "官方小幫手"]) {
    assert.deepEqual(checkNick(nick), { ok: false, code: "reserved" }, nick);
  }
});

test("checkNick: length is 2 to 20 characters", () => {
  assert.deepEqual(checkNick("a"), { ok: false, code: "length" });
  assert.deepEqual(checkNick(""), { ok: false, code: "length" });
  assert.deepEqual(checkNick("   "), { ok: false, code: "length" });
  assert.deepEqual(checkNick(undefined), { ok: false, code: "length" });
  assert.equal(checkNick("ab").ok, true);
  assert.equal(checkNick("x".repeat(20)).ok, true);
  assert.deepEqual(checkNick("x".repeat(21)), { ok: false, code: "length" });
  assert.equal(checkNick("浪".repeat(20)).ok, true);
  assert.deepEqual(checkNick("浪".repeat(21)), { ok: false, code: "length" });
});

test("checkNick: only letters, digits, _ . - and single inner spaces", () => {
  assert.deepEqual(checkNick("a<b"), { ok: false, code: "chars" });
  assert.deepEqual(checkNick("a  b"), { ok: false, code: "chars" });
  assert.deepEqual(checkNick("a\tb"), { ok: false, code: "chars" });
  assert.deepEqual(checkNick("a\nb"), { ok: false, code: "chars" });
  assert.deepEqual(checkNick("Mary\r\nJane"), { ok: false, code: "chars" });
  assert.deepEqual(checkNick("Leo😀"), { ok: false, code: "chars" });
  assert.deepEqual(checkNick("Leo!"), { ok: false, code: "chars" });
  assert.deepEqual(checkNick("Leo@home"), { ok: false, code: "chars" });
  assert.equal(checkNick("Mary Jane").ok, true);
  assert.equal(checkNick("John.D-2").ok, true);
});

test("checkNick: good nicknames come back normalised with a key", () => {
  assert.deepEqual(checkNick("Le\u0001o"), { ok: true, nick: "Leo", key: "leo" }); // a hidden control is dropped
  assert.deepEqual(checkNick("\nLeo\r\n"), { ok: true, nick: "Leo", key: "leo" }); // a break at either end is trimmed
  assert.deepEqual(checkNick("阿凱"), { ok: true, nick: "阿凱", key: "阿凱" });
  assert.deepEqual(checkNick("Leo_88"), { ok: true, nick: "Leo_88", key: "leo_88" });
  assert.deepEqual(checkNick("  Mary Jane "), { ok: true, nick: "Mary Jane", key: "maryjane" });
  assert.deepEqual(checkNick("ＬＥＯ"), { ok: true, nick: "LEO", key: "leo" });
});

test("checkNick: look-alikes share one key", () => {
  const key = checkNick("Leo").key;
  assert.equal(key, "leo");
  assert.equal(checkNick("ＬＥＯ").key, key);
  assert.equal(checkNick("L\u{0435}\u{043e}").key, key); // Cyrillic ie and o
  assert.equal(checkNick("L e o").key, key);
  assert.equal(checkNick("Le\u{200b}o").key, key);
  assert.notEqual(checkNick("Leon").key, key);
});

// ---- validSnap / validReport ------------------------------------------------------------------

test("validSnap: accepts known keys inside their range, with ISO times", () => {
  const snap = { hs: 1.1, hs_t: "2026-10-21T07:00", tp: 9, tp_t: "2026-10-21T07:00", ws: 12, tide: -0.4, tide_t: "2026-10-21T07:00" };
  assert.deepEqual(validSnap(snap), snap);
  assert.notEqual(validSnap(snap), snap); // a copy
  assert.deepEqual(validSnap({}), {});
  assert.deepEqual(validSnap({ hs: 1.1 }), { hs: 1.1 }); // the time is optional
});

test("validSnap: range edges are inclusive", () => {
  for (const [key, [lo, hi]] of Object.entries(SNAP_KEYS)) {
    assert.deepEqual(validSnap({ [key]: lo }), { [key]: lo }, key + " low");
    assert.deepEqual(validSnap({ [key]: hi }), { [key]: hi }, key + " high");
    assert.equal(validSnap({ [key]: hi + 0.01 }), null, key + " above");
    assert.equal(validSnap({ [key]: lo - 0.01 }), null, key + " below");
  }
});

test("validSnap: rejects anything else", () => {
  assert.equal(validSnap(null), null);
  assert.equal(validSnap(undefined), null);
  assert.equal(validSnap("hs"), null);
  assert.equal(validSnap([]), null);
  assert.equal(validSnap([1, 2]), null);
  assert.equal(validSnap({ foo: 1 }), null); // unknown key
  assert.equal(validSnap({ hs: 1, extra: 1 }), null);
  assert.equal(validSnap({ hs: "1.1" }), null); // string value
  assert.equal(validSnap({ hs: null }), null);
  assert.equal(validSnap({ hs: true }), null);
  assert.equal(validSnap({ hs: NaN }), null);
  assert.equal(validSnap({ hs: Infinity }), null);
  assert.equal(validSnap({ hs: 99 }), null); // out of range
  assert.equal(validSnap({ hs_t: "2026-10-21T07:00" }), null); // a time with no value
  assert.equal(validSnap({ hs: 1, hs_t: "soon" }), null); // not an ISO time
  assert.equal(validSnap({ hs: 1, hs_t: 700 }), null);
  assert.equal(validSnap({ hs: 1, hs_t: "2026-10-21T07:00" + "x".repeat(50) }), null);
  assert.equal(validSnap({ hs: 1, hs_x: "2026-10-21T07:00" }), null);
  assert.equal(validSnap(JSON.parse('{"__proto__": 1}')), null);
  assert.equal(validSnap(JSON.parse('{"hs": 1, "constructor": 1}')), null);
});

test("validSnap: the page's update time is allowed", () => {
  assert.deepEqual(validSnap({ updated: "2026-10-21T06:40:00Z", hs: 1 }), { updated: "2026-10-21T06:40:00Z", hs: 1 });
  assert.equal(validSnap({ updated: 5 }), null);
  assert.equal(validSnap({ updated: "later" }), null);
});

const goodReport = () => ({ spot: "jinshan", size: "chest", cond: "clean", crowd: "few", snap: { hs: 1.1, hs_t: "2026-10-21T07:00" } });

test("validReport: accepts a good report and returns only its own fields", () => {
  assert.deepEqual(validReport(goodReport()), goodReport());
  assert.deepEqual(validReport({ ...goodReport(), uid: "x", extra: 1 }), goodReport());
});

test("validReport: the snapshot may be empty or left out", () => {
  assert.deepEqual(validReport({ ...goodReport(), snap: {} }).snap, {});
  const { snap, ...noSnap } = goodReport();
  assert.deepEqual(validReport(noSnap), { ...noSnap, snap: {} });
});

test("validReport: rejects bad codes", () => {
  assert.equal(validReport({ ...goodReport(), spot: "pipeline" }), null);
  assert.equal(validReport({ ...goodReport(), size: "huge" }), null);
  assert.equal(validReport({ ...goodReport(), cond: "great" }), null);
  assert.equal(validReport({ ...goodReport(), crowd: "lots" }), null);
  for (const key of ["spot", "size", "cond", "crowd"]) {
    const r = goodReport(); delete r[key];
    assert.equal(validReport(r), null, "missing " + key);
  }
  assert.equal(validReport({ ...goodReport(), spot: ["jinshan"] }), null);
  assert.equal(validReport({ ...goodReport(), spot: "toString" }), null);
});

test("validReport: rejects a bad snapshot", () => {
  assert.equal(validReport({ ...goodReport(), snap: { foo: 1 } }), null);
  assert.equal(validReport({ ...goodReport(), snap: { hs: "1.1" } }), null);
  assert.equal(validReport({ ...goodReport(), snap: { hs: 99 } }), null);
  assert.equal(validReport({ ...goodReport(), snap: null }), null);
  assert.equal(validReport({ ...goodReport(), snap: "x" }), null);
});

test("validReport: rejects things that are not objects", () => {
  for (const v of [null, undefined, "report", 5, [], [goodReport()]]) assert.equal(validReport(v), null);
});

// ---- validSession ----------------------------------------------------------------------------

const NOW = Date.UTC(2026, 9, 21, 4); // 2026-10-21 12:00 in Taipei
const goodSession = () => ({
  spot: "nanwan", start: taipei(2026, 10, 21, 9), end: taipei(2026, 10, 21, 11), stars: 4, board: "long",
  note: "Kept nosediving on takeoff", cond: { hs: 1.1, hs_t: "2026-10-21T10:00" },
});

test("validSession: accepts a good session and returns exactly its fields", () => {
  const out = validSession(goodSession(), NOW);
  assert.deepEqual(out, goodSession());
  assert.deepEqual(Object.keys(out).sort(), ["board", "cond", "end", "note", "spot", "stars", "start"]);
  assert.deepEqual(validSession({ ...goodSession(), uid: "x" }, NOW), goodSession());
});

test("validSession: today, yesterday and the day before are allowed, nothing older", () => {
  const at = (start) => ({ ...goodSession(), start, end: start + 3600e3 });
  assert.ok(validSession(at(taipei(2026, 10, 19, 0, 0)), NOW));
  assert.equal(validSession(at(taipei(2026, 10, 18, 23, 59)), NOW), null);
  assert.equal(validSession(at(taipei(2026, 10, 19, 0, 0) - 1), NOW), null);
  assert.ok(validSession(at(taipei(2026, 10, 20, 6, 30)), NOW));
});

test("validSession: the oldest allowed start follows the Taipei clock, not the UTC one", () => {
  const justAfterTaipeiMidnight = taipei(2026, 10, 21, 0, 30);
  const at = (start) => ({ ...goodSession(), start, end: start + 3600e3 });
  assert.ok(validSession(at(taipei(2026, 10, 19, 0, 0)), justAfterTaipeiMidnight));
  assert.equal(validSession(at(taipei(2026, 10, 18, 23, 59)), justAfterTaipeiMidnight), null);
  const justBeforeTaipeiMidnight = taipei(2026, 10, 21, 23, 30);
  assert.ok(validSession(at(taipei(2026, 10, 19, 0, 0)), justBeforeTaipeiMidnight));
  assert.equal(validSession(at(taipei(2026, 10, 18, 23, 59)), justBeforeTaipeiMidnight), null);
});

test("validSession: the end must come after the start, within 12 hours", () => {
  const start = taipei(2026, 10, 21, 0, 0);
  const at = (end) => ({ ...goodSession(), start, end });
  assert.ok(validSession(at(start + 1), NOW));
  assert.equal(validSession(at(start), NOW), null);
  assert.equal(validSession(at(start - 1), NOW), null);
  assert.equal(validSession(at(start - 3600e3), NOW), null);
  assert.ok(validSession(at(start + 12 * 3600e3), NOW));
  assert.equal(validSession(at(start + 12 * 3600e3 + 1), NOW), null);
});

test("validSession: the start cannot be in the future", () => {
  const at = (start) => ({ ...goodSession(), start, end: start + 3600e3 });
  assert.ok(validSession(at(NOW), NOW));
  assert.equal(validSession(at(NOW + 1), NOW), null);
  assert.equal(validSession(at(NOW + 3600e3), NOW), null);
});

test("validSession: stars are a whole number from 1 to 5", () => {
  for (const stars of [1, 2, 3, 4, 5]) assert.ok(validSession({ ...goodSession(), stars }, NOW), String(stars));
  for (const stars of [0, 6, -1, 2.5, NaN, Infinity, "4", null, undefined, true]) {
    assert.equal(validSession({ ...goodSession(), stars }, NOW), null, String(stars));
  }
});

test("validSession: the note is up to 300 characters", () => {
  assert.ok(validSession({ ...goodSession(), note: "x".repeat(300) }, NOW));
  assert.equal(validSession({ ...goodSession(), note: "x".repeat(301) }, NOW), null);
  assert.ok(validSession({ ...goodSession(), note: "浪".repeat(300) }, NOW));
  assert.equal(validSession({ ...goodSession(), note: "浪".repeat(301) }, NOW), null);
  assert.ok(validSession({ ...goodSession(), note: "🌊".repeat(300) }, NOW)); // counted as characters, not UTF-16 units
  assert.equal(validSession({ ...goodSession(), note: 5 }, NOW), null);
  assert.equal(validSession({ ...goodSession(), note: ["x"] }, NOW), null);
});

test("validSession: a missing note is empty, and the note is stored in its cleaned form", () => {
  const { note, ...noNote } = goodSession();
  assert.equal(validSession(noNote, NOW).note, "");
  assert.equal(validSession({ ...goodSession(), note: "  nice\u{200b} waves \u{202e} " }, NOW).note, "nice waves");
  assert.equal(validSession({ ...goodSession(), note: "Kept\u0001 nosediving\non\ttakeoff\u{fffc}" }, NOW).note, "Kept nosediving on takeoff");
});

test("validSession: spot and board must be known codes", () => {
  assert.equal(validSession({ ...goodSession(), spot: "pipeline" }, NOW), null);
  assert.equal(validSession({ ...goodSession(), board: "gun" }, NOW), null);
  for (const key of ["spot", "board"]) {
    const s = goodSession(); delete s[key];
    assert.equal(validSession(s, NOW), null, "missing " + key);
  }
  for (const board of BOARDS) assert.ok(validSession({ ...goodSession(), board }, NOW), board);
  for (const spot of SPOTS) assert.ok(validSession({ ...goodSession(), spot }, NOW), spot);
});

test("validSession: start and end must be whole millisecond numbers", () => {
  for (const bad of ["2026-10-21T09:00", null, undefined, NaN, Infinity, 1.5, {}, [], true]) {
    assert.equal(validSession({ ...goodSession(), start: bad }, NOW), null, "start " + String(bad));
    assert.equal(validSession({ ...goodSession(), end: bad }, NOW), null, "end " + String(bad));
  }
});

test("validSession: conditions are optional, but must be a valid snapshot when present", () => {
  assert.equal(validSession({ ...goodSession(), cond: null }, NOW).cond, null);
  assert.equal(validSession({ ...goodSession(), cond: undefined }, NOW).cond, null);
  assert.deepEqual(validSession({ ...goodSession(), cond: {} }, NOW).cond, {});
  assert.equal(validSession({ ...goodSession(), cond: { hs: 99 } }, NOW), null);
  assert.equal(validSession({ ...goodSession(), cond: { foo: 1 } }, NOW), null);
  assert.equal(validSession({ ...goodSession(), cond: "x" }, NOW), null);
});

test("validSession: rejects things that are not objects, and a bad clock", () => {
  for (const v of [null, undefined, "x", 5, [], [goodSession()]]) assert.equal(validSession(v, NOW), null);
  assert.equal(validSession(goodSession(), NaN), null);
  assert.equal(validSession(goodSession(), "now"), null);
  assert.equal(validSession(goodSession(), undefined), null);
});
