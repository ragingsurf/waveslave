// Shared builders for the coach's backend tests. They are plain functions with no Worker and no I/O (no
// "cloudflare:test"), so the plain-Node tests, the Vitest specs and the browser tests' fake AI can all import them.
//
//   jpegB64({w, h, progressive, app})   a JPEG as base64 text, the way the phone sends a key frame
//   goodReply(sentNums, lang)           a coach's reply that passes every check (chat/src/coach-guide.js, checkReply)
//   apiMessage(reply, {stop_reason, usage, model})   the Messages API's answer carrying that reply

const u16 = (n) => [n >> 8, n & 255];

// One JPEG segment: FF, the marker, the length (which counts its own two bytes), then the payload.
const segment = (marker, payload) => [0xff, marker, ...u16(payload.length + 2), ...payload];

const APP_MAX = 65_533; // the most one APPn segment can hold: the length field is 16 bits and counts itself

// A JPEG with a real header and a tiny scan: SOI, the APPn segments asked for, one quantisation table, the frame header
// (SOF0, or SOF2 when progressive) saying w x h, the two smallest Huffman tables, the scan header, 8 bytes of scan and
// EOI. The scan is not the whole picture, so a viewer shows grey or nothing, but every segment is well formed, which is
// all the frame check reads.
//
//   w, h         the size the frame header says (default 784 x 784, the size the phone sends)
//   progressive  SOF2 and a progressive scan header instead of SOF0
//   app          the payload size in bytes of each APPn segment, in order, put before the frame header (a phone's
//                EXIF, ICC and the like); a size is 0 to 65,533
export function jpegB64({ w = 784, h = 784, progressive = false, app = [] } = {}) {
  for (const size of app) {
    if (!Number.isInteger(size) || size < 0 || size > APP_MAX) throw new RangeError("app size " + size);
  }
  for (const side of [w, h]) {
    if (!Number.isInteger(side) || side < 1 || side > 65_535) throw new RangeError("side " + side);
  }
  const bytes = [0xff, 0xd8]; // SOI
  // One byte at a time: push(...big) would pass 65,000 arguments.
  const add = (list) => { for (const b of list) bytes.push(b); };
  app.forEach((size, i) => add(segment(0xe0 + (i % 16), new Array(size).fill(0))));
  add(segment(0xdb, [0, ...new Array(64).fill(1)])); // DQT: table 0, 8-bit, all ones
  add(segment(progressive ? 0xc2 : 0xc0, [8, ...u16(h), ...u16(w), 1, 1, 0x11, 0])); // SOF: 8-bit, one component
  add(segment(0xc4, [0x00, 1, ...new Array(15).fill(0), 0x00])); // DHT: DC table 0, one 1-bit code
  add(segment(0xc4, [0x10, 1, ...new Array(15).fill(0), 0x00])); // DHT: AC table 0, one 1-bit code
  add(segment(0xda, [1, 1, 0x00, ...(progressive ? [0, 0, 0] : [0, 63, 0])])); // SOS: DC first scan if progressive
  add([0, 0, 0, 0, 0, 0, 0, 0]); // the scan
  add([0xff, 0xd9]); // EOI
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ---- Replies from the AI ---------------------------------------------------------------------

const TWELVE = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

// The review's text in each language, in the reply's shape: the 9 fields a surfer reads. Taken from Bryan's example (a
// top turn), shortened. None of it holds a word surfers mustn't see.
const TEXT = {
  en: {
    went_well: {
      title: "Low and over the board",
      detail: "On the turn before this one you stay low, with your knees bent and your chest over the board.",
    },
    main_fix: {
      title: "Stay over your front foot",
      what: "As you hit the top, your weight slides back onto the tail and your front leg goes straight (key frame at 0:11.7).",
      why: "With your weight on the tail the board runs away from under you. Keep your front knee bent and your chest over it.",
    },
    drill: {
      title: "Front-knee turns on the sand",
      how: "Stand in your surf stance, turn your head and shoulders, push your front knee forward and hold. Do 10.",
    },
    heads_up: { text: "" },
    progress: "",
  },
  zh: {
    went_well: { title: "身體壓低，重心在板子上", detail: "前一個轉向時，你膝蓋彎曲、身體壓低，胸口在板子上方。" },
    main_fix: {
      title: "重心留在前腳",
      what: "衝上浪頂時，你的重心往後滑到板尾，前腳打直（0:11.7 的關鍵影格）。",
      why: "重心在板尾，板子會從你腳下溜走。前膝保持彎曲、胸口壓在前膝上方。",
    },
    drill: { title: "沙灘上練前膝轉向", how: "用衝浪站姿站好，轉頭、轉肩膀，把前膝往前推，停三秒。做 10 次。" },
    heads_up: { text: "" },
    progress: "",
  },
};

// A reply that passes every check, for the frames sent (`sentNums`, 1 to 12 by default) and the language ("en" or "zh"):
// a surf clip, the surfer seen, nothing flagged, no unusable frames, no heads-up and no progress line. What went well
// points at the first frame sent and the main fix at the last three (or fewer, when fewer were sent). A "zh" reply carries
// its English copy. Every call returns new objects, so a test can change one.
export function goodReply(sentNums = TWELVE, lang = "en") {
  const nums = [...sentNums];
  const text = structuredClone(lang === "zh" ? TEXT.zh : TEXT.en);
  const reply = {
    is_surf_clip: true,
    can_see_surfer: true,
    sexual_content: false,
    surfer_looks_under_18: false,
    unusable_frames: [],
    went_well: { frame: nums[0], ...text.went_well },
    main_fix: { frames: nums.slice(-3), ...text.main_fix },
    drill: text.drill,
    heads_up: { text: "", move: "" },
    progress: text.progress,
  };
  if (lang === "zh") reply.english = structuredClone(TEXT.en);
  return reply;
}

// What the Messages API answers, carrying `reply` as the text of its last block, after the empty thinking block the API
// sends when thinking is on and not shown. `reply` is turned into JSON, or sent as it is when it is already text (to test
// a reply that isn't JSON); null or undefined sends no text block. A "refusal" carries stop_details as the API's does.
// Pass `usage: null` for an answer with no token counts. The model name is a stand-in: the real one is only in
// wrangler.toml.
export function apiMessage(reply, {
  stop_reason = "end_turn",
  usage = { input_tokens: 15_400, output_tokens: 3_000 },
  model = "coach-test-model",
} = {}) {
  const content = [{ type: "thinking", thinking: "", signature: "test-signature" }];
  if (reply !== null && reply !== undefined) {
    content.push({ type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply) });
  }
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason,
    stop_sequence: null,
    stop_details: stop_reason === "refusal" ? { type: "refusal", category: null, explanation: "Declined in a test." } : null,
    usage,
  };
}
