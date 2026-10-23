// Tests for chat/src/coach-rules.js: the coach's pure rules for time, money and key frames. They run under plain
// `node --test`, with no Worker and no I/O. Run from chat/: node --test test/coach-rules.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOUR, DAY, TW_MS, twMonth, twDay, nextTwDay, nextTwMonth, nextUtcMonth, creditMonth, cleanupAfter,
  costUsd, estimateIn, worstUsd, sortError, waitFor,
  ATTEMPT_WAITS, MAX_TRIES, MAX_WAITS, CALLING_STALE, PROBE_EVERY, FRAME_TEXT_MAX, checkFrame,
} from "../src/coach-rules.js";
import { jpegB64 } from "./coach-fixtures.mjs";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + " is not " + expected);
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

// A 784 x 784 frame padded with zero bytes to the longest text allowed: 107,520 bytes, a whole number of 3-byte groups,
// so exactly 143,360 characters with no "=" at the end.
const longest = () => {
  const header = Buffer.from(jpegB64(), "base64");
  return Buffer.concat([header, Buffer.alloc(107_520 - header.length)]).toString("base64");
};

test("constants match the spec", () => {
  assert.equal(HOUR, 3_600_000);
  assert.equal(DAY, 86_400_000);
  assert.equal(TW_MS, 8 * HOUR);
  assert.deepEqual(ATTEMPT_WAITS, [60_000, 300_000]);
  assert.equal(MAX_TRIES, 3);
  assert.equal(MAX_WAITS, 12);
  assert.equal(CALLING_STALE, 16 * 60_000);
  assert.equal(PROBE_EVERY, 6 * HOUR);
  assert.equal(FRAME_TEXT_MAX, 143_360);
  assert.equal(FRAME_TEXT_MAX, 140 * 1024); // the 140 KB of text the spec allows a frame
});

// ---- Taiwan and UTC calendars ----------------------------------------------------------------

test("twMonth: the Taiwan month turns at 16:00 UTC on the last day", () => {
  assert.equal(twMonth(Date.UTC(2026, 9, 31, 16, 1)), "2026-11");
  assert.equal(twMonth(Date.UTC(2026, 9, 31, 16, 0)), "2026-11");
  assert.equal(twMonth(Date.UTC(2026, 9, 31, 15, 59)), "2026-10");
  assert.equal(twMonth(Date.UTC(2026, 9, 31, 15, 59, 59, 999)), "2026-10");
  assert.equal(twMonth(Date.UTC(2026, 11, 31, 16, 0)), "2027-01");
  assert.equal(twMonth(Date.UTC(2027, 0, 1)), "2027-01");
});

test("twDay: the Taiwan day turns at 16:00 UTC", () => {
  assert.equal(twDay(Date.UTC(2026, 9, 31, 15, 59, 59, 999)), "2026-10-31");
  assert.equal(twDay(Date.UTC(2026, 9, 31, 16, 0)), "2026-11-01");
  assert.equal(twDay(Date.UTC(2026, 9, 23, 0, 0)), "2026-10-23");
  assert.equal(twDay(Date.UTC(2028, 1, 28, 16, 0)), "2028-02-29");
});

test("nextTwDay: 00:00 Taiwan on the next day, always after the moment given", () => {
  assert.equal(nextTwDay(Date.UTC(2026, 9, 31, 15, 59)), Date.UTC(2026, 9, 31, 16, 0));
  assert.equal(nextTwDay(Date.UTC(2026, 9, 31, 16, 0)), Date.UTC(2026, 10, 1, 16, 0));
  assert.equal(nextTwDay(Date.UTC(2026, 9, 31, 20, 0)), Date.UTC(2026, 10, 1, 16, 0));
  assert.equal(nextTwDay(Date.UTC(2026, 11, 31, 16, 0)), Date.UTC(2027, 0, 1, 16, 0));
  assert.equal(twDay(nextTwDay(Date.UTC(2026, 9, 23, 3, 0))), "2026-10-24");
});

test("nextTwMonth: 00:00 Taiwan on the next 1st", () => {
  assert.equal(nextTwMonth(Date.UTC(2026, 9, 31, 20, 0)), Date.UTC(2026, 10, 30, 16, 0));
  assert.equal(nextTwMonth(Date.UTC(2026, 9, 31, 15, 59)), Date.UTC(2026, 9, 31, 16, 0));
  assert.equal(nextTwMonth(Date.UTC(2026, 9, 31, 16, 0)), Date.UTC(2026, 10, 30, 16, 0)); // already November there
  assert.equal(nextTwMonth(Date.UTC(2026, 11, 15)), Date.UTC(2026, 11, 31, 16, 0)); // into the next year
  assert.equal(twMonth(nextTwMonth(Date.UTC(2026, 9, 23))), "2026-11");
});

test("nextUtcMonth: 00:00 UTC on the next 1st, which is 08:00 in Taiwan", () => {
  assert.equal(nextUtcMonth(Date.UTC(2026, 9, 31, 20, 0)), Date.UTC(2026, 10, 1));
  assert.equal(nextUtcMonth(Date.UTC(2026, 9, 31, 23, 59, 59, 999)), Date.UTC(2026, 10, 1));
  assert.equal(nextUtcMonth(Date.UTC(2026, 10, 1)), Date.UTC(2026, 11, 1));
  assert.equal(nextUtcMonth(Date.UTC(2026, 11, 15)), Date.UTC(2027, 0, 1));
  assert.equal(new Date(nextUtcMonth(Date.UTC(2026, 9, 5)) + TW_MS).getUTCHours(), 8);
});

test("creditMonth: starts on the credit day at 00:00 UTC", () => {
  assert.deepEqual(creditMonth(Date.UTC(2026, 10, 16), 16), { start: Date.UTC(2026, 10, 16), next: Date.UTC(2026, 11, 16) });
  assert.deepEqual(creditMonth(Date.UTC(2026, 10, 16) - 1, 16), { start: Date.UTC(2026, 9, 16), next: Date.UTC(2026, 10, 16) });
  assert.deepEqual(creditMonth(Date.UTC(2026, 10, 30, 23), 16), { start: Date.UTC(2026, 10, 16), next: Date.UTC(2026, 11, 16) });
  // January, before the 16th: the month began in December.
  assert.deepEqual(creditMonth(Date.UTC(2027, 0, 5), 16), { start: Date.UTC(2026, 11, 16), next: Date.UTC(2027, 0, 16) });
  // December, after the 16th: the next one is in January.
  assert.deepEqual(creditMonth(Date.UTC(2026, 11, 20), 16), { start: Date.UTC(2026, 11, 16), next: Date.UTC(2027, 0, 16) });
  // 00:00 UTC on the 16th is 08:00 Taiwan time, so that is when the new month's credit counts.
  assert.equal(creditMonth(Date.UTC(2026, 10, 15, 23, 59), 16).start, Date.UTC(2026, 9, 16)); // 07:59 on the 16th in Taiwan
  assert.equal(creditMonth(Date.UTC(2026, 10, 16, 0, 0), 16).start, Date.UTC(2026, 10, 16)); // 08:00 on the 16th in Taiwan
});

test("creditMonth: in a month without the credit day it starts on the month's last day", () => {
  assert.deepEqual(creditMonth(Date.UTC(2027, 1, 28), 31), { start: Date.UTC(2027, 1, 28), next: Date.UTC(2027, 2, 31) });
  assert.equal(creditMonth(Date.UTC(2027, 2, 15), 31).start, Date.UTC(2027, 1, 28)); // February 2027 starts on the 28th
  assert.equal(creditMonth(Date.UTC(2027, 1, 27), 31).start, Date.UTC(2027, 0, 31));
  assert.equal(creditMonth(Date.UTC(2027, 1, 27), 31).next, Date.UTC(2027, 1, 28));
  assert.equal(creditMonth(Date.UTC(2028, 2, 15), 31).start, Date.UTC(2028, 1, 29)); // a leap year
  assert.equal(creditMonth(Date.UTC(2026, 4, 10), 31).start, Date.UTC(2026, 3, 30)); // April has 30 days
  assert.equal(creditMonth(Date.UTC(2026, 4, 10), 30).start, Date.UTC(2026, 3, 30));
});

test("cleanupAfter: the first 20:00 UTC (04:00 Taiwan) strictly after the moment", () => {
  assert.equal(cleanupAfter(Date.UTC(2026, 9, 23, 20, 0)), Date.UTC(2026, 9, 24, 20, 0));
  assert.equal(cleanupAfter(Date.UTC(2026, 9, 23, 19, 59, 59, 999)), Date.UTC(2026, 9, 23, 20, 0));
  assert.equal(cleanupAfter(Date.UTC(2026, 9, 23, 0, 0)), Date.UTC(2026, 9, 23, 20, 0));
  assert.equal(cleanupAfter(Date.UTC(2026, 9, 23, 23, 0)), Date.UTC(2026, 9, 24, 20, 0));
  assert.equal(cleanupAfter(Date.UTC(2026, 11, 31, 21, 0)), Date.UTC(2027, 0, 1, 20, 0));
  assert.equal(new Date(cleanupAfter(Date.UTC(2026, 9, 23, 5, 0)) + TW_MS).getUTCHours(), 4);
});

// ---- Money -----------------------------------------------------------------------------------

test("costUsd: tokens times US$ per million", () => {
  near(costUsd({ input_tokens: 15_400, output_tokens: 3_000 }, { in: 4, out: 20 }), 0.1216);
  near(costUsd({ input_tokens: 0, output_tokens: 0 }, { in: 4, out: 20 }), 0);
  near(costUsd({ input_tokens: 1_000_000, output_tokens: 0 }, { in: 4, out: 20 }), 4);
  near(costUsd({ input_tokens: 0, output_tokens: 1_000_000 }, { in: 4, out: 20 }), 20);
});

test("estimateIn: 784 tokens a frame and a token for every two characters of text, rounded up", () => {
  assert.equal(estimateIn(12, 12_000), 12 * 784 + 6_000);
  assert.equal(estimateIn(8, 0), 6_272);
  assert.equal(estimateIn(12, 1), 12 * 784 + 1);
  assert.equal(estimateIn(12, 3), 12 * 784 + 2);
});

test("worstUsd: the estimated input plus every token max_tokens allows", () => {
  near(worstUsd(estimateIn(12, 12_000), 16_000, { in: 4, out: 20 }), 0.381632);
  assert.ok(Math.abs(worstUsd(estimateIn(12, 12_000), 16_000, { in: 4, out: 20 }) - 0.3816) < 5e-5);
  near(worstUsd(0, 16_000, { in: 4, out: 20 }), 0.32);
});

// ---- Errors from Anthropic -------------------------------------------------------------------

// The body Anthropic's API sends for an error.
const err = (type, message = "message") => JSON.stringify({ type: "error", error: { type, message } });

test("sortError: a key or model that does not work pauses the coach", () => {
  assert.equal(sortError(401, err("authentication_error", "invalid x-api-key")), "pause");
  assert.equal(sortError(403, err("permission_error", "Your API key does not have permission to use the specified resource.")), "pause");
  assert.equal(sortError(404, err("not_found_error", "model: nope")), "pause");
});

test("sortError: no credit is a money rest until the next credit day", () => {
  assert.equal(sortError(400, err("billing_error", "There is a problem with your billing")), "credit");
  assert.equal(sortError(402, err("billing_error", "x")), "credit");
  assert.equal(sortError(400, err("invalid_request_error",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.")), "credit");
});

test("sortError: a usage limit is a money rest until the next calendar month", () => {
  assert.equal(sortError(400, err("invalid_request_error", "You have reached your specified workspace API usage limits.")), "limit");
  assert.equal(sortError(400, err("invalid_request_error",
    "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.")), "limit");
  assert.equal(sortError(429, err("rate_limit_error", "enforced_spend_limit_reached")), "limit");
  assert.equal(sortError(429, JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "x", code: "enforced_spend_limit_reached" } })), "limit");
  assert.equal(sortError(429, "{\"detail\":\"enforced_spend_limit_reached\"}"), "limit"); // found anywhere in the body
});

test("sortError: busy or overloaded waits without using an attempt", () => {
  assert.equal(sortError(429, err("rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit")), "wait");
  assert.equal(sortError(529, err("overloaded_error", "Overloaded")), "wait");
  assert.equal(sortError(429, ""), "wait");
});

test("sortError: a server error counts an attempt", () => {
  assert.equal(sortError(500, err("api_error", "An unexpected error has occurred internal to Anthropic's systems.")), "attempt");
  assert.equal(sortError(503, err("api_error", "x")), "attempt");
  assert.equal(sortError(502, "<html>Bad gateway</html>"), "attempt");
  assert.equal(sortError(504, ""), "attempt");
});

test("sortError: any other request error fails the review", () => {
  assert.equal(sortError(400, err("invalid_request_error", "messages.0.content.3.image: could not process image")), "fail");
  assert.equal(sortError(413, err("request_too_large", "Request exceeds the maximum allowed number of bytes.")), "fail");
  assert.equal(sortError(422, err("invalid_request_error", "x")), "fail");
  assert.equal(sortError(400, ""), "fail");
});

test("sortError: reads the body as text or as the parsed object, and copes with a body that is neither", () => {
  assert.equal(sortError(401, { type: "error", error: { type: "authentication_error", message: "x" } }), "pause");
  assert.equal(sortError(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low." } }), "credit");
  assert.equal(sortError(400, null), "fail");
  assert.equal(sortError(400, undefined), "fail");
  assert.equal(sortError(400, "not json at all"), "fail");
  assert.equal(sortError(500, "not json at all"), "attempt");
  assert.equal(sortError(400, "[1, 2]"), "fail");
  assert.equal(sortError(400, "{\"error\": \"just a string\"}"), "fail");
  assert.equal(sortError(400, "null"), "fail");
});

test("sortError: the type and message decide, and the status only where the body does not say", () => {
  // The credit and limit messages win over the status they arrive with.
  assert.equal(sortError(429, err("invalid_request_error", "Your credit balance is too low")), "credit");
  assert.equal(sortError(500, err("billing_error", "x")), "credit");
  // A 401, 403 or 404 whose body says nothing we know still pauses: the key or the model is the likely cause.
  assert.equal(sortError(401, ""), "pause");
  assert.equal(sortError(403, "<html>Forbidden</html>"), "pause");
  assert.equal(sortError(404, err("something_new", "x")), "pause");
});

test("waitFor: a retry-after in seconds, or 30 minutes", () => {
  assert.equal(waitFor("120"), 120_000);
  assert.equal(waitFor("1"), 1_000);
  assert.equal(waitFor("1800"), 1_800_000);
  assert.equal(waitFor(120), 120_000);
  for (const bad of [null, undefined, "", "0", "-5", "x", "12 seconds", "NaN", "Infinity", "4000", "99999999"]) {
    assert.equal(waitFor(bad), 1_800_000, JSON.stringify(bad));
  }
});

// ---- Frames ----------------------------------------------------------------------------------

test("jpegB64: the header says the size asked for", () => {
  // Read back with Buffer, not with checkFrame, so the fixture is checked on its own.
  const bytes = Buffer.from(jpegB64({ w: 2576, h: 100 }), "base64");
  assert.equal(jpegB64().slice(0, 4), "/9j/");
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...bytes.subarray(-2)], [0xff, 0xd9]);
  const sof = bytes.indexOf(Buffer.from([0xff, 0xc0]));
  assert.equal(bytes.readUInt16BE(sof + 5), 100); // height
  assert.equal(bytes.readUInt16BE(sof + 7), 2576); // width
  const progressive = Buffer.from(jpegB64({ progressive: true }), "base64");
  assert.ok(progressive.includes(Buffer.from([0xff, 0xc2])));
  assert.ok(!progressive.includes(Buffer.from([0xff, 0xc0])));
  // Each APPn segment adds its payload and 4 bytes for its marker and length.
  const plain = Buffer.from(jpegB64(), "base64").length;
  assert.equal(Buffer.from(jpegB64({ app: [3144, 1024] }), "base64").length, plain + 3144 + 1024 + 2 * 4);
  assert.throws(() => jpegB64({ app: [65_534] }), RangeError);
  assert.throws(() => jpegB64({ w: 0 }), RangeError);
});

test("checkFrame: accepts a 784 x 784 JPEG, however its header is laid out", () => {
  assert.equal(checkFrame(jpegB64()), null);
  assert.equal(checkFrame(jpegB64({ progressive: true })), null);
  assert.equal(checkFrame(jpegB64({ app: [3144, 1024] })), null);
  assert.equal(checkFrame(jpegB64({ app: [0] })), null);
  assert.equal(checkFrame(jpegB64({ app: new Array(17).fill(100) })), null); // APP0 to APP15 and round again
});

test("checkFrame: refuses any other size", () => {
  assert.equal(checkFrame(jpegB64({ w: 2576, h: 2576 })), "bad_frame");
  assert.equal(checkFrame(jpegB64({ w: 783, h: 784 })), "bad_frame");
  assert.equal(checkFrame(jpegB64({ w: 784, h: 783 })), "bad_frame");
  assert.equal(checkFrame(jpegB64({ w: 785, h: 784 })), "bad_frame");
  assert.equal(checkFrame(jpegB64({ w: 1, h: 1 })), "bad_frame");
  assert.equal(checkFrame(jpegB64({ w: 65_535, h: 65_535 })), "bad_frame");
  assert.equal(checkFrame(jpegB64({ w: 784, h: 392, progressive: true })), "bad_frame");
  assert.equal(checkFrame(jpegB64({ w: 392, h: 784 })), "bad_frame");
});

test("checkFrame: the frame header has to come within the first 65,536 decoded bytes", () => {
  // Before the frame header come the SOI (2 bytes), an APPn (4 bytes of marker and length, then its payload) and the
  // fixture's quantisation table (4 + 65), and the frame header itself is 9 bytes up to the end of its width.
  const edge = 65_536 - (2 + 4 + 69) - 9;
  assert.equal(checkFrame(jpegB64({ app: [edge] })), null); // the last byte read is the 65,536th
  assert.equal(checkFrame(jpegB64({ app: [edge + 1] })), "bad_frame"); // the 65,537th
  assert.equal(checkFrame(jpegB64({ app: [40_000, 40_000] })), "bad_frame");
});

test("checkFrame: refuses what is not a JPEG", () => {
  const png = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 16, 0, 0, 3, 16, 8, 0, 0, 0, 0]);
  assert.equal(checkFrame(png), "bad_frame");
  assert.equal(checkFrame(b64(Buffer.from("GIF89a" + "\0".repeat(30)))), "bad_frame");
  assert.equal(checkFrame(b64(Buffer.from("just some text, long enough to decode"))), "bad_frame");
  assert.equal(checkFrame(b64([0xff, 0xd8])), "bad_frame"); // a SOI and then nothing
  assert.equal(checkFrame(b64([0xd8, 0xff, 0xc0, 0, 11, 8, 3, 16, 3, 16, 1, 1, 0x11, 0])), "bad_frame"); // no SOI first
});

test("checkFrame: refuses a JPEG whose segments do not lead to a frame header", () => {
  const soi = [0xff, 0xd8];
  const sos = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0];
  const sof = [0xff, 0xc0, 0, 11, 8, 3, 16, 3, 16, 1, 1, 0x11, 0];
  assert.equal(checkFrame(b64([...soi, ...sos, 0, 0, 0xff, 0xd9])), "bad_frame"); // the scan comes before any frame header
  assert.equal(checkFrame(b64([...soi, ...sos, ...sof])), "bad_frame"); // even when a frame header follows it
  assert.equal(checkFrame(b64([...soi, 0xff, 0xd9])), "bad_frame"); // EOI
  assert.equal(checkFrame(b64([...soi, 0xff, 0xe0, 0, 1, 0, 0])), "bad_frame"); // a length shorter than itself
  assert.equal(checkFrame(b64([...soi, 0xff, 0xe0, 0, 0, 0, 0])), "bad_frame");
  assert.equal(checkFrame(b64([...soi, 0xff, 0xe0, 0, 16, 1, 2, 3, 4])), "bad_frame"); // cut short inside a segment
  assert.equal(checkFrame(b64([...soi, 0xff, 0xc0, 0, 7, 8, 3, 16, 3, 16, 0])), "bad_frame"); // a frame header too short to hold a size
  assert.equal(checkFrame(b64([...soi, 0x00, 0xe0, 0, 4, 0, 0])), "bad_frame"); // a segment without its FF
  assert.equal(checkFrame(b64([...soi, 0xff, 0xff, 0xe0, 0, 4, 0, 0, ...sof])), "bad_frame"); // fill bytes are not accepted
  assert.equal(checkFrame(b64([...soi, 0xff, 0xc1, 0, 11, 8, 3, 16, 3, 16, 1, 1, 0x11, 0, ...sos])), "bad_frame"); // SOF1 is not SOF0 or SOF2
  // The same bytes with a segment of another kind in front of a 784 x 784 header (784 = 0x0310) do pass.
  assert.equal(checkFrame(b64([...soi, 0xff, 0xc4, 0, 4, 0, 0, ...sof])), null);
  assert.equal(checkFrame(b64([...soi, ...sof])), null);
});

test("checkFrame: the whole text has to be base64", () => {
  const good = jpegB64();
  assert.equal(checkFrame(good), null);
  assert.equal(checkFrame('"' + good), "bad_frame");
  assert.equal(checkFrame(good + '"'), "bad_frame");
  assert.equal(checkFrame(good.slice(0, 40) + '"' + good.slice(40)), "bad_frame");
  assert.equal(checkFrame(good.slice(0, 40) + "\n" + good.slice(40)), "bad_frame");
  assert.equal(checkFrame(good + " "), "bad_frame");
  assert.equal(checkFrame(good + "\n"), "bad_frame");
  assert.equal(checkFrame(good.slice(0, 40) + "=" + good.slice(41)), "bad_frame"); // padding in the middle
  assert.equal(checkFrame(good + "="), "bad_frame");
  assert.equal(checkFrame(good.slice(0, -1)), "bad_frame"); // not a whole number of 4-character groups
  assert.equal(checkFrame(good + "AAA"), "bad_frame");
  assert.equal(checkFrame("data:image/jpeg;base64," + good), "bad_frame");
  assert.equal(checkFrame(good.replace(/\//g, "_")), "bad_frame"); // the URL-safe alphabet ("/9j/" becomes "_9j_")
  assert.equal(checkFrame(good + "éAAA"), "bad_frame");
  // A bad character far past the point the header walk stops at still refuses the frame.
  assert.equal(checkFrame(good + "A".repeat(20_000) + '"AAA'), "bad_frame");
  assert.equal(checkFrame(""), "bad_frame");
  for (const notText of [null, undefined, 784, {}, [], ["/9j/"], Buffer.from(good, "base64")]) {
    assert.equal(checkFrame(notText), "bad_frame", String(notText));
  }
});

test("checkFrame: more than 140 KB of text is too big, before anything else is looked at", () => {
  const good = jpegB64();
  assert.equal(checkFrame("A".repeat(143_361)), "too_big");
  assert.equal(checkFrame('"'.repeat(143_361)), "too_big"); // not base64 either, but size is the first check
  // Exactly at the limit, still fine: the header is read and the rest is only looked at for its characters.
  const full = longest();
  assert.equal(full.length, FRAME_TEXT_MAX);
  assert.equal(checkFrame(full), null);
  assert.equal(checkFrame(full + "AAAA"), "too_big");
  assert.equal(checkFrame("A".repeat(FRAME_TEXT_MAX - 1) + '"'), "bad_frame");
});

test("checkFrame: decodes only the start of a long text", () => {
  const real = globalThis.atob;
  const decoded = []; // the length of every text handed to atob
  globalThis.atob = (text) => { decoded.push(text.length); return real(text); };
  try {
    assert.equal(checkFrame(longest()), null);
  } finally {
    globalThis.atob = real;
  }
  assert.ok(decoded.length > 0);
  assert.ok(Math.max(...decoded) <= 8192, "decoded " + decoded.join(", ") + " characters of 143,360");
});
