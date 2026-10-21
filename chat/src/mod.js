// Moderation and validation for the Taiwan chat: pure functions with no I/O, so they run the same
// under plain Node (the tests) and inside the Worker. The design is in
// docs/superpowers/specs/2026-10-21-taiwan-chat-design.md, "Moderation" and "Validation".
//
//   normalise(text)           -> {stored, check}   the text to keep, and a copy to run the filters on
//   blocked(check, list)      -> null | {rule}     the hard-block filters (give it the check copy)
//   checkNick(nick)           -> {ok, nick, key} | {ok: false, code}
//   validReport / validSnap / validSession         the shape checks the room applies to every write

// ---- Codes ---------------------------------------------------------------------------------------

// The 8 Taiwan spots, by their ids on the site. Only these can be tagged on a message or a report.
export const SPOTS = Object.freeze(["donghe", "jialeshui", "nanwan", "jinshan", "fulong", "wushi", "suao", "hualien"]);
export const SIZES = Object.freeze(["flat", "knee", "waist", "chest", "head", "overhead"]);
export const CONDS = Object.freeze(["clean", "ok", "choppy", "blown"]);
export const CROWDS = Object.freeze(["empty", "few", "busy", "packed"]);
export const BOARDS = Object.freeze(["short", "fish", "minimal", "long", "softtop"]);
export const REASONS = Object.freeze(["spam", "harass", "sexual", "child", "other"]);

// The numbers a conditions snapshot may hold, each with its allowed range [low, high]. Every value is
// optional and may have a sibling "<key>_t" with the time of the reading it came from:
//   hs/tp/dp    wave height (m), period (s), direction (degrees)
//   shs/stp/sdp the swell part of the same
//   ws/wd       wind speed and direction
//   tide        tide height (m)
//   bhs/btp/bdp the buoy's height, period and direction
export const SNAP_KEYS = Object.freeze({
  hs: Object.freeze([0, 15]), tp: Object.freeze([0, 30]), dp: Object.freeze([0, 360]),
  shs: Object.freeze([0, 15]), stp: Object.freeze([0, 30]), sdp: Object.freeze([0, 360]),
  ws: Object.freeze([0, 120]), wd: Object.freeze([0, 360]), tide: Object.freeze([-5, 5]),
  bhs: Object.freeze([0, 15]), btp: Object.freeze([0, 30]), bdp: Object.freeze([0, 360]),
});

// ---- normalise -----------------------------------------------------------------------------------

// Every character that draws nothing, or that is only there to break up text. They can hide a banned word
// ("lin<control>.ee"), flip the order of text around a nickname, or push a message out of shape, and a
// spammer's own WebSocket client can send any of them even though the page's text box cannot.
//   - the default-ignorable ones: soft hyphen, zero-width spaces and joiners, the direction marks and
//     overrides (U+200E, U+200F, U+202A-U+202E, U+2066-U+2069), the word joiner, the byte-order mark,
//     variation selectors, tag characters, the Hangul fillers and the rest of that Unicode class;
//   - every control character: C0, DEL and C1 (tab and the line breaks are turned into a gap first, see BREAKS);
//   - every other format character (U+FFF9-U+FFFB interlinear marks, the Arabic number signs, ...), private
//     use, lone surrogates and noncharacters;
//   - U+FFFC, the object replacement character: a symbol by category, but it draws nothing or an empty box.
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Noncharacter_Code_Point}\u{FFFC}]/gu;

// Tab, the line breaks (CR, LF, VT, FF, NEL) and the line and paragraph separators (U+2028, U+2029). The
// characters above are simply gone from the page, but these show as a gap between words (in normal page
// flow a tab or a line break collapses to one space). So they become one space in the stored text and a
// "\n" in the checking copy, which is read both ways. See normalise().
const BREAKS = /[\t\n\v\f\r\u{0085}\u{2028}\u{2029}]+/gu;

// Accent and combining marks (the plain combining blocks; Japanese voiced marks are not in them).
const COMBINING = /[\u{0300}-\u{036f}\u{1ab0}-\u{1aff}\u{1dc0}-\u{1dff}\u{20d0}-\u{20ff}\u{fe20}-\u{fe2f}]/gu;

// Characters swapped for a plain one in the checking copy only. Each entry is a Latin letter followed by
// the look-alikes it stands for, keyed by exact character so a capital Greek Eta (looks like H) and a small
// one (looks like n) can differ. Full-width and styled letters need no entry: NFKC already folds them.
const LOOKALIKES = {
  a: "\u{0430}\u{0410}\u{03b1}\u{0391}\u{0251}",                  // Cyrillic a A, Greek alpha, Latin alpha
  b: "\u{0412}\u{0392}",                                          // Cyrillic Ve, Greek Beta (capitals)
  c: "\u{0441}\u{0421}\u{03f2}\u{03f9}",                          // Cyrillic Es, Greek lunate sigma
  d: "\u{0501}\u{0111}\u{0110}",                                  // Cyrillic komi de, d with stroke
  e: "\u{0435}\u{0415}\u{03b5}\u{0395}",                          // Cyrillic ie, Greek epsilon
  g: "\u{0261}",                                                  // Latin script g
  h: "\u{04bb}\u{04ba}\u{043d}\u{041d}\u{0397}\u{0127}\u{0126}",  // Cyrillic shha and En, Greek capital Eta, h with stroke
  i: "\u{0456}\u{0406}\u{0131}\u{03b9}\u{0399}\u{0269}",          // Cyrillic Byelorussian-Ukrainian i, dotless i, Greek iota
  j: "\u{0458}\u{0408}\u{03f3}",                                  // Cyrillic je, Greek yot
  k: "\u{043a}\u{041a}\u{03ba}\u{039a}",                          // Cyrillic ka, Greek kappa
  l: "\u{04cf}\u{04c0}\u{0142}\u{0141}",                          // Cyrillic palochka, l with stroke
  m: "\u{043c}\u{041c}\u{039c}",                                  // Cyrillic em, Greek capital Mu
  n: "\u{039d}\u{03b7}\u{0578}",                                  // Greek capital Nu, small eta, Armenian vo
  o: "\u{043e}\u{041e}\u{03bf}\u{039f}\u{0585}\u{00f8}\u{00d8}",  // Cyrillic o, Greek omicron, Armenian oh, o with stroke
  p: "\u{0440}\u{0420}\u{03c1}\u{03a1}",                          // Cyrillic er, Greek rho
  q: "\u{051b}\u{051a}",                                          // Cyrillic qa
  s: "\u{0455}\u{0405}",                                          // Cyrillic dze
  t: "\u{0442}\u{0422}\u{03c4}\u{03a4}",                          // Cyrillic te, Greek tau
  u: "\u{03c5}\u{03bc}\u{057d}",                                  // Greek upsilon and mu, Armenian seh
  v: "\u{03bd}\u{0475}\u{0474}",                                  // Greek nu, Cyrillic izhitsa
  w: "\u{0461}\u{0460}\u{051d}\u{051c}\u{03c9}",                  // Cyrillic omega and we, Greek omega
  x: "\u{0445}\u{0425}\u{03c7}\u{03a7}",                          // Cyrillic ha, Greek chi
  y: "\u{0443}\u{0423}\u{04af}\u{04ae}\u{03b3}\u{03a5}",          // Cyrillic u (plain and straight), Greek gamma, capital Upsilon
  z: "\u{0396}",                                                  // Greek capital Zeta
};

// Chinese numerals become digits, so a phone number can't be hidden behind them. The ideographic full stop
// is folded in normalise() itself, as it depends on what comes before it.
const OTHER_FOLDS = {
  "〇": "0", "零": "0", "一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9",
};

// The ideographic full stop becomes a dot right after a Latin letter or a digit, so "line。me", "example。com"
// and "0912。345。678" are read as typed with a dot. After anything else it is left as it is: after a Chinese
// character it ends a sentence, and "今天浪很好。Net is slow" must not read as the link "今天浪很好.net". A
// written-out Chinese name with 。 for its dot ("衝浪。tw") passes for the same reason; with a real dot it is a link.
const IDEO_STOP = "。";
const DOT_AFTER = /^[a-z0-9]$/;

const FOLD = new Map(Object.entries(OTHER_FOLDS));
for (const [latin, look] of Object.entries(LOOKALIKES)) for (const ch of look) FOLD.set(ch, latin);

// Returns the text to store and a copy to run the filters on (the check copy is never shown or kept).
//   stored: NFKC (which also turns full-width and styled letters into plain ones), then every invisible
//           character removed. A tab or line break (a run of them) becomes one space instead, so the words
//           either side of it do not run together and the text stays on one line. Case and everything else
//           is kept as typed.
//   check:  stored, accents dropped, then each character folded to lower case or to its plain look-alike
//           (Cyrillic, Greek and similar letters to Latin, Chinese numerals to digits, and 。 to a dot after a
//           Latin letter or a digit, see IDEO_STOP). The other difference
//           from stored: where the message had a tab or line break the check copy has a "\n", not a space.
//           Removing it would glue the words either side of it together ("hello<newline>line.me" would read
//           "helloline.me", and "buy<newline>vape" would lose its word edge), and a space would let
//           "li<tab>ne.me" through. So blocked() reads each "\n" both ways. Give blocked() this copy, not the
//           stored text.
// The look-alike table is applied before lower-casing within the same pass, because a capital and a small
// letter can look like different Latin letters.
export function normalise(text) {
  const parts = String(text ?? "").normalize("NFKC").split(BREAKS).map((part) => part.replace(INVISIBLE, "").normalize("NFKC"));
  const stored = parts.join(" ");
  let check = "";
  let last = ""; // the last character written to check that isn't a line break, for IDEO_STOP
  for (const ch of parts.join("\n").normalize("NFD").replace(COMBINING, "").normalize("NFC")) {
    const out = ch === IDEO_STOP ? (DOT_AFTER.test(last) ? "." : ch) : FOLD.get(ch) ?? ch.toLowerCase();
    check += out;
    if (out !== "\n") last = out;
  }
  return { stored, check };
}

// ---- blocked -------------------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// LINE invite addresses, with or without "https://" or a subdomain. The checks look behind the name too,
// so "airline.me" is not read as "line.me".
const LINE_URL = /(?<![a-z0-9-])(?:line\.me|lin\.ee|line\.naver\.jp)(?![a-z0-9])/u;

// LINE IDs are written "@abc123": four or more letters, digits, dots, dashes or underscores with at least
// one letter. Surf talk uses the at sign too, as in "1.2 m @ 9 s", "dawn patrol @6am" or "3ft@12s", so a
// time or a measurement after it is not an ID, and neither is a word glued to it ("m@9s"). Messages never
// use "@name" to reply (there is a reply button), so a plain ASCII "@name" is read as a LINE ID.
const LINE_ID = /(?<![a-z0-9])@(?!\d{1,4}(?:am|pm|sec|kts?|hrs?|ft|cm|km|s|m|h)(?![a-z0-9]))(?=[0-9._-]*[a-z])[a-z0-9][a-z0-9._-]{3,}/u;

// Telegram invite addresses.
const TELEGRAM = /(?<![a-z0-9-])(?:(?:t\.me|telegram\.(?:me|org|dog))(?![a-z0-9])|tg:\/\/)/u;

// Domains caught even with no scheme and no path. Words that are also top-level domains (.top, .fun,
// .live, .work, .shop, ...) are left out on purpose: a message typed "Good surf.Fun day" would be refused.
// Those still count as links when they have a path ("scam.top/abc"), a "www." or a scheme.
// The names before the top-level domain may be in any script (金山浪.com, surf台灣.com), as browsers take
// them; the top-level domain itself is a Latin one. The end of the domain only has to be clear of Latin
// letters and digits, so Chinese written straight after it ("金山浪.com看") doesn't hide it.
const BARE_TLDS = "com|net|org|info|biz|xyz|cc|io|tw|jp|kr|hk|cn|tv|sg|edu|gov";
const LABEL = "[\\p{L}\\p{N}][\\p{L}\\p{N}-]*\\.";
const LINK = new RegExp(
  "[a-z][a-z0-9+.-]*:\\/\\/" +                                                    // any scheme://
  "|(?<![a-z0-9-])www\\d?\\." +                                                   // www.
  "|(?<![\\p{L}\\p{N}-])(?:" + LABEL + ")+(?:" + BARE_TLDS + ")(?![a-z0-9-])" +   // name.com
  "|(?<![\\p{L}\\p{N}-])(?:" + LABEL + ")+[a-z]{2,24}\\/\\S",                     // name.anything/path
  "u");

// Taiwan mobile numbers: 09xxxxxxxx, or +886 9xxxxxxxx (also 886, 00886, and a leftover 0 after 886), with any spaces,
// dashes, dots, "・" or slashes between the digits (SEP). Its edges are read on the text as typed: the character just
// before its first digit and the one just after its last must not be digits. So "0912 345 678 2 boards" is a phone
// number followed by a 2, while "20260912345678" is one long number. The cost: a run of spaced numbers that starts with
// 09 and has ten digits or more ("09 10 12 14 16 18") reads as a phone number with more after it, as a number hidden
// that way would. A dot between digits counts as a separator, except the point of a decimal such as a wave height: one
// digit, a dot and one or two digits, standing alone (not part of a chain of dots like "0.9.1.2"). Without that, "swell
// 0.9 1.1 1.3 1.6 2.0" would read "0911131620". A phone number written as a list of decimals ("0.9 1.2 3.4 5.6 7.8")
// looks the same as a list of heights, so it passes too: this chat talks about wave heights far more than anyone would
// spell a number that way.
const SEP = "[\\s\\-.・/]*";
const DECIMAL = /(?<![\d.])\d\.\d{1,2}(?!\d|\.\d)/gu;
const PHONE = new RegExp(`(?<!\\d)(?:0|(?:\\+|0${SEP}0${SEP})?8${SEP}8${SEP}6(?:${SEP}0)?)${SEP}9(?:${SEP}\\d){8}(?!\\d)`, "u");

// The text the phone check reads: each decimal point becomes a comma, which is not a separator.
const phoneText = (text) => text.replace(DECIMAL, (d) => d.replace(".", ","));

// The lists in blocklist.json, turned into patterns once per list object. Entries go through
// normalise() as well, so they can be written in any form (capitals, full-width, Chinese numerals).
const compiled = new WeakMap();
const NONE = {};

// A phrase matches as typed, with these allowances:
//  - an edge that is an ASCII letter must sit on a word edge, so "vape" does not match "vapes" and "spic"
//    would not match "spicy": list each form you want to catch;
//  - spaces in the phrase match any run of spaces, and between non-ASCII characters (Chinese, Japanese)
//    any spaces are allowed, so "飆 股" is caught as well as "飆股".
function phraseRegex(raw) {
  const phrase = normalise(raw).check.trim().replace(/\s+/g, " ");
  if (!phrase) return null;
  const chars = [...phrase];
  let src = /[a-z]/.test(chars[0]) ? "(?<![a-z])" : "";
  chars.forEach((ch, i) => {
    if (i > 0 && ch !== " " && chars[i - 1] !== " " && (ch.charCodeAt(0) > 127 || chars[i - 1].charCodeAt(0) > 127)) src += "\\s*";
    src += ch === " " ? "\\s+" : escapeRe(ch);
  });
  if (/[a-z]/.test(chars[chars.length - 1])) src += "(?![a-z])";
  return new RegExp(src, "u");
}

// A domain in the "short" list: "bit.ly" must not be the end of another name ("rabbit.ly") or the start
// of a longer one ("bit.lyx").
function domainRegex(raw) {
  const host = normalise(raw).check.trim();
  return host ? new RegExp("(?<![a-z0-9-])" + escapeRe(host) + "(?![a-z0-9-])", "u") : null;
}

// A site that may be linked: the host with its optional scheme and "www.", but not as part of another
// name ("evilsite.tw", "site.tw.evil.com"). The match is blanked out before the link checks.
function allowRegex(raw) {
  const host = normalise(raw).check.trim();
  return host ? new RegExp("(?<![a-z0-9@.-])(?:[a-z][a-z0-9+.-]*:\\/\\/)?(?:www\\.)?" + escapeRe(host) + "(?![a-z0-9-]|\\.[a-z0-9])", "gu") : null;
}

function compile(list) {
  const key = list && typeof list === "object" ? list : NONE;
  let c = compiled.get(key);
  if (!c) {
    const each = (arr, make) => (Array.isArray(arr) ? arr.filter((s) => typeof s === "string").map(make).filter(Boolean) : []);
    const phrases = key.phrases || {};
    c = {
      line: each(key.line, phraseRegex),
      short: each(key.short, domainRegex),
      scam: each(phrases.scam, phraseRegex),
      vape: each(phrases.vape, phraseRegex),
      slur: each(phrases.slur, phraseRegex),
      allow: each(key.allowHosts, allowRegex),
    };
    compiled.set(key, c);
  }
  return c;
}

// The rules, in the order they are tried and reported.
const RULE_ORDER = ["line", "telegram", "short", "link", "phone", "scam", "vape", "slur"];

// Runs the hard-block filters on one reading of a check copy (the rules are tried in RULE_ORDER).
function blockedReading(text, list) {
  const c = compile(list);
  const hit = (res, s) => res.some((re) => re.test(s));

  if (LINE_URL.test(text) || LINE_ID.test(text) || hit(c.line, text)) return { rule: "line" };
  if (TELEGRAM.test(text)) return { rule: "telegram" };

  let net = text;
  for (const re of c.allow) net = net.replace(re, " ");
  if (hit(c.short, net)) return { rule: "short" };
  if (LINK.test(net)) return { rule: "link" };

  if (PHONE.test(phoneText(text))) return { rule: "phone" };

  if (hit(c.scam, text)) return { rule: "scam" };
  if (hit(c.vape, text)) return { rule: "vape" };
  if (hit(c.slur, text)) return { rule: "slur" };
  return null;
}

// Runs the hard-block filters on a check copy (from normalise) against the lists in blocklist.json.
// Returns null if the text may be posted, or {rule}: line, telegram, short, link, phone, scam, vape or
// slur. The first rule that matches is reported, in that order, so "lin.ee/abc" is a LINE invite and not
// just a link. Sites in the list's allowHosts may be linked. Casual swearing (幹, 靠北) is allowed on
// purpose (Bryan, Oct 21): 幹嘛 and 樹幹 pass, and so does a bare 幹.
// A "\n" in the check copy stands for a tab or line break in the message (see normalise). It is read both
// ways, as nothing and as a space, and the message is blocked if either reading is. If both are, the rule
// that comes first in RULE_ORDER is reported, so "hello<tab>t.me/x" is Telegram (the space reading), not a
// link (the glued reading, "hellot.me/x").
// A break right after a full stop is read only as a space: it ends a sentence, and glued it would turn
// "Nice session.<newline>TW forecast" into the link "session.tw". A link split there ("example.<newline>com")
// shows as "example. com", which passes when typed on one line too.
export function blocked(check, list) {
  const text = String(check ?? "");
  if (!text) return null;
  if (!text.includes("\n")) return blockedReading(text, list);
  const glued = blockedReading(text.replace(/\.\n+/g, ". ").replace(/\n+/g, ""), list);
  const spaced = blockedReading(text.replace(/\n+/g, " "), list);
  if (!glued || !spaced) return glued ?? spaced;
  return RULE_ORDER.indexOf(spaced.rule) < RULE_ORDER.indexOf(glued.rule) ? spaced : glued;
}

// ---- checkNick -----------------------------------------------------------------------------------

// Words nobody may have in a nickname, so no one can pass as Bryan or as the staff. They are checked
// against the folded key, so styled letters, look-alikes, hidden characters, spaces and _ . - do not help.
const RESERVED = ["bryan", "admin", "waveslave", "coach", "mod", "staff", "官方", "管理", "管理员", "管理員", "教練", "教练", "站長"]
  .map((w) => normalise(w).check);

// Letters, digits and _ . - with single spaces between words.
const NICK_CHARS = /^[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;

// What the key leaves out: the spaces and the punctuation a nickname may have. "Br.yan", "Bry_an" and
// "B-r-y-a-n" read as Bryan, and "Le.o" as Leo, so they must count as those names.
const KEY_DROPS = /[ _.-]/g;

// A nickname is 2 to 20 characters after normalising. Returns {ok: true, nick, key} where nick is what to
// show and key is the folded form with the spaces, "_", "." and "-" taken out, which must be unique across
// users. Or {ok: false, code} with code "length", "chars" (including a name with no letter or digit, whose
// key would be empty) or "reserved". Leading and trailing spaces are dropped.
// The key is built from the check copy, which also turns Chinese numerals into digits, so 阿三 and 阿3 (or
// Leo一 and Leo1) are one name: read aloud they are the same, and the second would pass as the first. The one
// who comes second is told the name is taken.
export function checkNick(nick) {
  const n = normalise(typeof nick === "string" ? nick : "");
  const shown = n.stored.trim();
  const length = [...shown].length;
  if (length < 2 || length > 20) return { ok: false, code: "length" };
  // A tab or line break inside the name (one at either end is trimmed away, like a space) is not a letter.
  if (!NICK_CHARS.test(shown) || n.check.trim().includes("\n")) return { ok: false, code: "chars" };
  const key = normalise(shown).check.replace(KEY_DROPS, "");
  if (key === "") return { ok: false, code: "chars" };
  if (RESERVED.some((word) => key.includes(word))) return { ok: false, code: "reserved" };
  return { ok: true, nick: shown, key };
}

// ---- validation ----------------------------------------------------------------------------------

const DAY_MS = 86400e3;
const HOUR_MS = 3600e3;
const TAIPEI_MS = 8 * HOUR_MS; // Taiwan is UTC+8 all year, with no daylight saving.

const isPlain = (o) => {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return false;
  const proto = Object.getPrototypeOf(o);
  return proto === Object.prototype || proto === null;
};

// A time of a reading: "2026-10-21T07:00" on the Taipei clock, or the page's own "2026-10-21T06:40:00Z".
const ISO_TIME = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?Z?$/;

// A conditions snapshot: only the known keys, each a finite number inside its range, each with an
// optional ISO time in "<key>_t", plus the page's "updated" time. Anything else, including a time with
// no value, a string where a number belongs or a number outside its range, rejects the whole thing.
// Returns a clean copy, or null.
export function validSnap(o) {
  if (!isPlain(o)) return null;
  const out = {};
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (Object.hasOwn(SNAP_KEYS, key)) {
      const [low, high] = SNAP_KEYS[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v < low || v > high) return null;
    } else if (key === "updated" || (key.endsWith("_t") && Object.hasOwn(SNAP_KEYS, key.slice(0, -2)))) {
      if (typeof v !== "string" || v.length > 24 || !ISO_TIME.test(v)) return null;
    } else {
      return null;
    }
    out[key] = v;
  }
  for (const key of Object.keys(out)) {
    if (key.endsWith("_t") && !Object.hasOwn(out, key.slice(0, -2))) return null;
  }
  return out;
}

// A spot report: tap-only, so every field is one of the codes. The snapshot is what the poster's app
// showed at that hour; it may be left out (an empty one is kept). Returns the four codes and the snapshot,
// or null.
export function validReport(o) {
  if (!isPlain(o)) return null;
  const { spot, size, cond, crowd } = o;
  if (!SPOTS.includes(spot) || !SIZES.includes(size) || !CONDS.includes(cond) || !CROWDS.includes(crowd)) return null;
  const snap = o.snap === undefined ? {} : validSnap(o.snap);
  if (!snap) return null;
  return { spot, size, cond, crowd, snap };
}

// A surf-diary session. start and end are epoch milliseconds. A session can be for today or the two
// days before (Bryan, Oct 21), counted on the Taipei clock: the earliest start is 00:00 Taiwan time two
// days ago, and a start can't be in the future. The end must come after the start, at most 12 hours
// later. Stars are a whole number from 1 to 5. The note is up to 300 characters (it may be left out) and
// comes back normalised and trimmed, so a hidden character can't be kept in a private note and shared
// later. The conditions may be null or left out, for an hour with no data. Returns the cleaned fields, or null.
export function validSession(o, nowMs) {
  if (!isPlain(o) || typeof nowMs !== "number" || !Number.isFinite(nowMs)) return null;
  const { spot, start, end, stars, board } = o;
  if (!SPOTS.includes(spot) || !BOARDS.includes(board)) return null;

  const todayStart = Math.floor((nowMs + TAIPEI_MS) / DAY_MS) * DAY_MS - TAIPEI_MS;
  if (!Number.isSafeInteger(start) || start < todayStart - 2 * DAY_MS || start > nowMs) return null;
  if (!Number.isSafeInteger(end) || end <= start || end - start > 12 * HOUR_MS) return null;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return null;

  let note = "";
  if (o.note !== undefined && o.note !== null) {
    if (typeof o.note !== "string") return null;
    note = normalise(o.note).stored.trim();
    if ([...note].length > 300) return null;
  }

  let cond = null;
  if (o.cond !== undefined && o.cond !== null) {
    cond = validSnap(o.cond);
    if (!cond) return null;
  }
  return { spot, start, end, stars, board, note, cond };
}
