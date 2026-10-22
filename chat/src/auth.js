// Tokens and LINE ID token checks for the Taiwan chat: pure functions on Web Crypto (crypto.subtle), which is
// global in Node 22 and in Workers, so they run the same under plain Node (the tests) and inside the Worker.
// No imports and no dependencies. The design is in docs/superpowers/specs/2026-10-21-taiwan-chat-design.md,
// "Login (LINE, web flow)".
//
//   b64u / unb64u               bytes <-> base64url text (no padding)
//   randomB64u(n)               n random bytes as base64url
//   sha256b64u / hmacB64u       SHA-256 and HMAC-SHA256 of UTF-8 text, as base64url
//   sameText(a, b)              constant-time equality of two strings
//   signToken / readToken       the session token: base64url {uid, tv, exp}, a dot, then its HMAC
//   verifyLineIdToken           the checks the spec lists on the ID token LINE hands back
//   subHash(sub, pepper)        the one-way code kept for a LINE account; the raw sub is never stored
//   pin6()                      the 6-digit code for the "login finished in another browser" path
//
// Units: the session token's exp is epoch MILLISECONDS (it is compared with nowMs). LINE's ID token follows
// the JWT standard, so its exp is epoch SECONDS. Both functions take nowMs, in milliseconds.

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

const isText = (x) => typeof x === "string";
const isFilled = (x) => typeof x === "string" && x !== "";

// ---- base64url -----------------------------------------------------------------------------------

export function b64u(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Strict: it throws on anything b64u() could not have written (a padding "=", the plain "+" and "/" alphabet, a
// space, a stray last character), so one byte string has one text form and a lookalike never decodes. atob does
// the decoding and refuses the worst of it; the last line then rules out the rest by writing the bytes back out
// and requiring the very same text.
export function unb64u(s) {
  if (!isText(s)) throw new TypeError("not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (b64u(out) !== s) throw new TypeError("not canonical base64url");
  return out;
}

export function randomB64u(n) {
  return b64u(crypto.getRandomValues(new Uint8Array(n)));
}

// ---- hashes --------------------------------------------------------------------------------------

// Text only: a missing value would otherwise be hashed as an empty string, and "nothing" would match a hash
// someone chose to be the hash of nothing.
export async function sha256b64u(s) {
  if (!isText(s)) throw new TypeError("sha256 input is not text");
  return b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}

// An empty key is refused here, because Node and Workers differ on it and a secret that went missing from the
// environment must fail loudly, not sign with nothing. The data must be text, for the reason given above.
export async function hmacB64u(key, data) {
  if (!isFilled(key)) throw new TypeError("hmac key is empty");
  if (!isText(data)) throw new TypeError("hmac data is not text");
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data))));
}

// Constant time: both strings are reduced to a 32-byte SHA-256 digest first, so the work does not depend on
// where they differ or on how long they are, and the digests are then compared byte by byte with no early exit.
// Anything that is not a string is never equal, not even to another missing value.
export async function sameText(a, b) {
  if (!isText(a) || !isText(b)) return false;
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---- session token -------------------------------------------------------------------------------

// The token is b64u(JSON {uid, tv, exp}) + "." + the HMAC-SHA256 of that first part under SESSION_SECRET. Only
// those three fields are signed. The caller sets exp (the spec gives 180 days). The room still checks on every
// call that the user exists, isn't banned and that tv matches, so this only proves the token is ours and fresh.
export async function signToken({ uid, tv, exp }, secret) {
  const payload = b64u(enc.encode(JSON.stringify({ uid, tv, exp })));
  return payload + "." + await hmacB64u(secret, payload);
}

// {uid, tv, exp} for a good, unexpired token, or null for anything else: not a token, a bad signature, another
// secret (an empty one throws in hmacB64u, which lands in the catch), a payload of the wrong shape, or exp at or
// before nowMs. It never throws.
export async function readToken(token, secret, nowMs) {
  try {
    if (!isText(token) || !Number.isFinite(nowMs)) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    // The signature first: nothing in the payload is looked at until it is known to be ours.
    if (!await sameText(await hmacB64u(secret, parts[0]), parts[1])) return null;
    const { uid, tv, exp } = JSON.parse(dec.decode(unb64u(parts[0]))) ?? {};
    if (!isFilled(uid) || !Number.isSafeInteger(tv) || tv < 0 || !Number.isFinite(exp) || !(exp > nowMs)) return null;
    return { uid, tv, exp };
  } catch {
    return null;
  }
}

// ---- LINE ID token -------------------------------------------------------------------------------

const LINE_ISSUER = "https://access.line.me";

// Checks the ID token LINE returns from its token endpoint, as the spec lists them, and returns its claims or null:
//   1. three parts, and a header whose alg is exactly "HS256" (so "none", ES256, HS512 and the rest are refused
//      before anything else, and the check can't be talked into a weaker one);
//   2. the HMAC-SHA256 signature of "header.payload", keyed with the channel secret;
//   3. iss is "https://access.line.me", aud is our channel ID, nonce is the one we stored for this login, and
//      exp (seconds) is after nowMs.
// It also needs a non-empty sub, because the account code is made from it. The channel ID and the nonce must be
// given and non-empty, so a Worker that lost either refuses everyone instead of matching empty to empty (an empty
// secret does the same: hmacB64u throws, which lands in the catch). It never throws; claims come back as LINE
// sent them, and the caller uses sub (the name only prefills the nickname and is not stored).
export async function verifyLineIdToken(jwt, { channelId, secret, nonce, nowMs } = {}) {
  try {
    if (!isText(jwt) || !isFilled(channelId) || !isFilled(nonce) || !Number.isFinite(nowMs)) return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    if (JSON.parse(dec.decode(unb64u(parts[0])))?.alg !== "HS256") return null;
    if (!await sameText(await hmacB64u(secret, parts[0] + "." + parts[1]), parts[2])) return null;
    const c = JSON.parse(dec.decode(unb64u(parts[1])));
    if (c?.iss !== LINE_ISSUER || c.aud !== channelId || c.nonce !== nonce) return null;
    if (!Number.isFinite(c.exp) || !(c.exp > nowMs / 1000) || !isFilled(c.sub)) return null;
    return c;
  } catch {
    return null;
  }
}

// ---- account code and pin ------------------------------------------------------------------------

// The only thing kept about a LINE account: HMAC-SHA256 keyed with SUB_PEPPER over LINE's sub. A missing sub or
// pepper throws, because hashing "undefined" would give every account the same code.
export async function subHash(sub, pepper) {
  if (!isFilled(sub)) throw new TypeError("sub is empty");
  return hmacB64u(pepper, sub);
}

// Six digits, leading zeros kept ("000042"). A 32-bit random number is only used below 4,294,000,000, the
// biggest whole multiple of a million that fits, so every pin is exactly as likely as every other.
export function pin6() {
  const one = new Uint32Array(1);
  do {
    crypto.getRandomValues(one);
  } while (one[0] >= 4_294_000_000);
  return String(one[0] % 1_000_000).padStart(6, "0");
}
