// The coach's pure rules: Taiwan and UTC calendars, the credit month, what a call costs, how Anthropic's errors are
// sorted, how long to wait, and the check on a key frame. No imports and no I/O, so they run the same under plain Node
// (the tests) and inside the Worker. The design is in docs/superpowers/specs/2026-10-22-ai-coach-design.md, "Backend",
// "Money" and "Error handling".
//
//   twMonth, twDay             the Taiwan month ("2026-11") and day ("2026-11-01") a moment falls in
//   nextTwDay, nextTwMonth     the next 00:00 Taiwan time, and the next 00:00 Taiwan time on a 1st
//   nextUtcMonth               the next 00:00 UTC on a 1st: the calendar month Anthropic's Console limit counts
//   creditMonth(ms, day)       the credit month a moment is in: {start, next}
//   cleanupAfter(ms)           the next daily clean-up, 04:00 Taiwan time
//   costUsd, estimateIn, worstUsd   what a call cost, and what one that may have been cut off could have cost
//   sortError(status, body)    what to do about an error from Anthropic: pause, credit, limit, wait, attempt or fail
//   waitFor(retryAfter)        how long a 429 or 529 makes the review wait, in ms
//   checkFrame(text)           the check on a key frame's base64 text: null, or the error code to refuse it with
//
// Times are epoch milliseconds.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const TW_MS = 8 * HOUR; // Taiwan is UTC+8 all year, with no daylight saving

// ---- Retries and waits -----------------------------------------------------------------------

// A bad reply, a timeout or a 5xx counts as an attempt. Attempt 2 starts a minute after attempt 1 failed, attempt 3 five
// minutes after attempt 2; after the third the review has failed.
export const ATTEMPT_WAITS = Object.freeze([60_000, 300_000]);
export const MAX_TRIES = 3;
// A 429 or 529 doesn't count as an attempt. After this many waits in a row, the next one counts as one.
export const MAX_WAITS = 12;
// A review still "calling" after this long is picked up again: the AI call has a 10-minute timeout, and a deploy can
// stop the work midway.
export const CALLING_STALE = 16 * MINUTE;
// While the coach rests for money, the alarm tries one queued review this often, to end the rest early on a success.
export const PROBE_EVERY = 6 * HOUR;

const WAIT_DEFAULT = 30 * MINUTE; // how long a 429 or 529 waits when it names no time, and the longest it ever waits

// ---- Taiwan and UTC calendars ----------------------------------------------------------------

// Reviews are counted by calendar month in Taiwan time (Bryan, Oct 22): shifting a moment by 8 hours and reading it as
// UTC gives the Taiwan clock. The ISO text starts "YYYY-MM-DD".
export const twMonth = (ms) => new Date(ms + TW_MS).toISOString().slice(0, 7);
export const twDay = (ms) => new Date(ms + TW_MS).toISOString().slice(0, 10);

// 00:00 Taiwan time (16:00 UTC) on the day after the one `ms` falls in.
export const nextTwDay = (ms) => (Math.floor((ms + TW_MS) / DAY) + 1) * DAY - TW_MS;

// 00:00 Taiwan time on the 1st of the month after the one `ms` falls in. Date.UTC rolls month 12 over into January.
export function nextTwMonth(ms) {
  const d = new Date(ms + TW_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - TW_MS;
}

// 00:00 UTC on the 1st of the month after the one `ms` falls in, which is 08:00 in Taiwan. The Console's spend limit
// counts calendar months in UTC, so a limit reached ends then.
export function nextUtcMonth(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

// ---- The credit month ------------------------------------------------------------------------

// Bryan's Max plan renews on the 16th (Bryan, Oct 23), and the credit lands shortly after, so the coach counts its
// spending in months that start on the 16th at 00:00 UTC, which is 08:00 in Taiwan. In a month without that day (the
// 31st in a 30-day month, say) the month starts on its last day. Date.UTC rolls a month of -1 or 12 into the neighbouring
// year, which makes December and January work.
function creditStart(year, month, day) {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); // day 0 of the next month: this month's last day
  return Date.UTC(year, month, Math.min(day, last));
}

// The credit month `ms` is in: it started at `start` and the next one starts at `next`.
export function creditMonth(ms, day) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const start = creditStart(year, month, day);
  if (ms >= start) return { start, next: creditStart(year, month + 1, day) };
  return { start: creditStart(year, month - 1, day), next: start };
}

// ---- The daily clean-up ----------------------------------------------------------------------

const CLEANUP_HOUR_UTC = 20; // 04:00 in Taiwan

// The first clean-up time strictly after `ms`.
export function cleanupAfter(ms) {
  const today = Math.floor(ms / DAY) * DAY + CLEANUP_HOUR_UTC * HOUR;
  return today > ms ? today : today + DAY;
}

// ---- Money -----------------------------------------------------------------------------------

// Prices are US$ per million tokens: {in, out}. `usage` is the reply's {input_tokens, output_tokens}.
export const costUsd = (usage, prices) => (usage.input_tokens * prices.in + usage.output_tokens * prices.out) / 1_000_000;

// A key frame is 784 x 784, and the AI counts cost in 28-pixel tiles, so each one costs 28 x 28 = 784 tokens.
const FRAME_SIDE = 784;
const FRAME_TOKENS = 784;

// An estimate of the tokens a request sends: the frames, and a token for every two characters of the rest (the guide, the
// examples and the surfer's text). That counts high for English, which keeps the worst case on the safe side.
export const estimateIn = (frames, textChars) => frames * FRAME_TOKENS + Math.ceil(textChars / 2);

// What a call that timed out or was cut off may have cost: the whole request, and every token `max_tokens` allows.
export const worstUsd = (estIn, maxTokens, prices) => costUsd({ input_tokens: estIn, output_tokens: maxTokens }, prices);

// ---- Errors from Anthropic -------------------------------------------------------------------

// The error's type from the reply's body, {type: "error", error: {type, message}}, or "" when there isn't one. The body
// may arrive as text or already parsed, and may not be Anthropic's at all (a gateway's page).
function errorType(body) {
  let parsed = body;
  if (typeof body === "string") {
    try { parsed = JSON.parse(body); } catch { parsed = null; }
  }
  const type = parsed !== null && typeof parsed === "object" ? parsed.error?.type : null;
  return typeof type === "string" ? type : "";
}

const PAUSE_TYPES = new Set(["authentication_error", "permission_error", "not_found_error"]);
const CREDIT_LOW = /credit balance is too low/i;
const SPEND_LIMIT = /enforced_spend_limit_reached/;
const USAGE_LIMIT = /reached your specified (?:workspace )?(?:api )?usage limit/i;

// What to do about a failed call, sorted by the error's type and message, not by the HTTP status alone:
//   "pause"    the key, or the model named in COACH_MODEL, doesn't work: the coach stops itself and Bryan is told
//   "credit"   the credit has run out: a money rest until the next credit day
//   "limit"    the Console's monthly limit is reached: a money rest until 08:00 Taiwan on the 1st of next month
//   "wait"     busy or overloaded (429, 529): wait, and don't count an attempt
//   "attempt"  a server error: count an attempt
//   "fail"     any other 400, or a 413: this review fails
// A 401, 403 or 404 whose body says nothing we know still pauses: a rejected key or a wrong model is the likely cause,
// and stopping to email Bryan costs less than failing every review in turn.
export function sortError(status, body) {
  const text = typeof body === "string" ? body : body == null ? "" : JSON.stringify(body);
  const type = errorType(body);
  if (PAUSE_TYPES.has(type)) return "pause";
  if (type === "billing_error" || CREDIT_LOW.test(text)) return "credit";
  if (SPEND_LIMIT.test(text) || USAGE_LIMIT.test(text)) return "limit";
  if (status === 401 || status === 403 || status === 404) return "pause";
  if (status === 429 || status === 529) return "wait";
  if (status >= 500) return "attempt";
  return "fail";
}

// How long a 429 or 529 makes the review wait: the reply's `retry-after` header (whole seconds), or 30 minutes when it
// is missing, isn't a positive number, or asks for more than 30 minutes.
export function waitFor(retryAfter) {
  const seconds = typeof retryAfter === "string" || typeof retryAfter === "number" ? Number(retryAfter) : NaN;
  return seconds > 0 && seconds * SECOND <= WAIT_DEFAULT ? Math.ceil(seconds * SECOND) : WAIT_DEFAULT;
}

// ---- Key frames ------------------------------------------------------------------------------

// A frame is at most 140 KB of base64 text (spec "Routes"). The phone keeps each close-up to 100 KB, which is about
// 136,500 characters as base64, so that leaves a little room.
export const FRAME_TEXT_MAX = 143_360;

// The frame header has to start within this many decoded bytes. A phone's EXIF and the like come first and run to a few
// KB, so a header further in is not a frame the phone cut.
const HEAD_MAX = 65_536;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

// The width and height a JPEG's frame header (SOF0, baseline, or SOF2, progressive) says, as [width, height], or null
// when the text isn't a JPEG whose header comes in time. `text` is base64 that checkFrame has already vetted. It decodes
// from the start only as far as the walk needs (a few KB for a phone's frame), and walks the segments by their lengths:
// each is FF, a marker byte, a 2-byte length that counts itself, then the rest. Only segments with a length may come
// before the frame header, and the scan header (SOS) coming first means there is no frame header to read.
function jpegSize(text) {
  let bytes = new Uint8Array(0);
  // True once at least n bytes are decoded. Each time it decodes again from the start, at double the size, so the work
  // stays within about twice the bytes the walk reaches.
  const have = (n) => {
    if (n > HEAD_MAX) return false;
    if (n > bytes.length) {
      const want = Math.min(HEAD_MAX, Math.max(n, 2 * bytes.length, 4096));
      const bin = atob(text.slice(0, Math.min(text.length, Math.ceil(want / 3) * 4))); // whole groups of 4 characters
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    return n <= bytes.length;
  };
  if (!have(2) || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // SOI
  let pos = 2;
  for (;;) {
    if (!have(pos + 4) || bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1];
    // These have no length, so they can't be stepped over: a stuffed zero, TEM, fill bytes, RSTn, SOI and EOI. SOS is
    // refused too: once the scan starts, a frame header after it is not one.
    const noLength = marker === 0x00 || marker === 0x01 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd9);
    if (noLength || marker === 0xda) return null;
    const length = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (length < 2) return null;
    if (marker === 0xc0 || marker === 0xc2) {
      // FF, marker, length (2), precision (1), height (2), width (2).
      if (length < 8 || !have(pos + 9)) return null;
      return [(bytes[pos + 7] << 8) | bytes[pos + 8], (bytes[pos + 5] << 8) | bytes[pos + 6]];
    }
    pos += 2 + length;
  }
}

// The check on one key frame's text, done in Coach (the Worker never reads a frame): null when it passes, else the
// error code to refuse it with. Over 140 KB is "too_big"; anything else that isn't a 784 x 784 JPEG in base64 is
// "bad_frame" (spec "Frame checks"): base64 characters only, and the header says 784 x 784. Size is looked at first, so
// a huge text costs nothing to turn away.
export function checkFrame(text) {
  if (typeof text !== "string") return "bad_frame";
  if (text.length > FRAME_TEXT_MAX) return "too_big";
  if (text.length % 4 !== 0 || !BASE64.test(text)) return "bad_frame";
  const size = jpegSize(text);
  return size !== null && size[0] === FRAME_SIDE && size[1] === FRAME_SIDE ? null : "bad_frame";
}
