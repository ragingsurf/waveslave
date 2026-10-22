// Tests for chat/src/auth.js: session tokens, LINE ID token checks and the small crypto helpers. They run under
// plain `node --test`, with no Worker. Run from chat/: node --test test/auth.test.mjs
//
// The test builds its own tokens with node:crypto, not with auth.js, so the module is checked against an
// independent HMAC and base64url, and not against itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  b64u, unb64u, randomB64u, sha256b64u, hmacB64u, sameText,
  signToken, readToken, verifyLineIdToken, subHash, pin6,
} from "../src/auth.js";

const SECRET = "channel-secret-for-tests";
const CHANNEL = "1234567890";
const NONCE = "nonce-from-the-logins-row";
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0); // epoch milliseconds
const NOW_S = NOW / 1000; // the same moment in epoch seconds, which is what a JWT "exp" uses

const hex = (b64) => Buffer.from(b64, "base64url").toString("hex");

// ---- base64url and hashes --------------------------------------------------------------------

test("b64u: URL-safe alphabet and no padding", () => {
  assert.equal(b64u(new Uint8Array([0xfb, 0xff])), "-_8");
  assert.equal(b64u(new Uint8Array([0xfb, 0xff, 0xbf])), "-_-_");
  assert.equal(b64u(new Uint8Array([1])), "AQ");
  assert.equal(b64u(new Uint8Array([1, 2])), "AQI");
  assert.equal(b64u(new Uint8Array([])), "");
});

test("b64u and unb64u: round trip, including every byte value", () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual(unb64u(b64u(all)), all);
  for (let n = 0; n < 8; n++) {
    const bytes = all.slice(250 - n, 250);
    assert.deepEqual(unb64u(b64u(bytes)), bytes);
  }
  assert.ok(unb64u("-_8") instanceof Uint8Array);
  assert.equal(b64u(all), Buffer.from(all).toString("base64url"));
});

test("unb64u: throws on anything that is not canonical base64url", () => {
  for (const bad of [
    "a",        // one character left over is never valid
    "ab=c", "ab==", // padding
    "a+b/",     // the plain base64 alphabet
    "ab cd",    // a space (atob alone would skip it)
    "ab\ncd",
    "QR",       // decodes, but the last character carries non-zero spare bits: QQ is the canonical form
  ]) assert.throws(() => unb64u(bad), undefined, JSON.stringify(bad));
  assert.throws(() => unb64u(undefined));
  assert.throws(() => unb64u(42));
  assert.deepEqual(unb64u("QQ"), new Uint8Array([0x41]));
  assert.deepEqual(unb64u(""), new Uint8Array([]));
});

test("randomB64u: n random bytes, in base64url, different every time", () => {
  const a = randomB64u(16);
  assert.match(a, /^[A-Za-z0-9_-]{22}$/); // 16 bytes
  assert.equal(unb64u(a).length, 16);
  assert.equal(unb64u(randomB64u(32)).length, 32);
  assert.notEqual(randomB64u(16), randomB64u(16));
});

test("sha256b64u: matches SHA-256 of the UTF-8 text", async () => {
  assert.equal(hex(await sha256b64u("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(hex(await sha256b64u("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const text = "浪奴 waveslave 台灣 𠮷";
  assert.equal(await sha256b64u(text), createHash("sha256").update(text, "utf8").digest("base64url"));
});

test("hmacB64u: HMAC-SHA256 of the data under the key (RFC 4231, case 2)", async () => {
  const mac = await hmacB64u("Jefe", "what do ya want for nothing?");
  assert.equal(hex(mac), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
});

test("hmacB64u: UTF-8 keys and data match node:crypto; the key order matters", async () => {
  const key = "祕密-key", data = "資料 data";
  assert.equal(await hmacB64u(key, data), createHmac("sha256", key).update(data, "utf8").digest("base64url"));
  assert.notEqual(await hmacB64u(key, data), await hmacB64u(data, key));
});

test("hmacB64u: an empty key is refused, the same in Node and in Workers", async () => {
  await assert.rejects(() => hmacB64u("", "data"));
  await assert.rejects(() => hmacB64u(undefined, "data"));
});

test("sha256b64u and hmacB64u: refuse data that is not text, so nothing is hashed as an empty string", async () => {
  // Otherwise a request with no login verifier would hash to the hash of "", which someone could have chosen.
  for (const bad of [undefined, null, 42, {}, [], new Uint8Array(2)]) {
    await assert.rejects(() => sha256b64u(bad), TypeError, `sha256 ${bad}`);
    await assert.rejects(() => hmacB64u("key", bad), TypeError, `hmac ${bad}`);
  }
});

test("sameText: equal text is true, anything else is false", async () => {
  assert.equal(await sameText("a", "a"), true);
  assert.equal(await sameText("a", "b"), false);
  assert.equal(await sameText("", ""), true);
  assert.equal(await sameText("a", "ab"), false);
  assert.equal(await sameText("ab", "a"), false);
  assert.equal(await sameText("台灣", "台灣"), true);
  assert.equal(await sameText("台灣", "台湾"), false);
  assert.equal(await sameText("abc", "abd"), false);
  assert.equal(await sameText("abc", "ABC"), false);
});

test("sameText: compares every byte of the digests", async () => {
  // SHA-256 is swapped for made-up digests, since two real texts that differ only in the last byte of their digest
  // cannot be found. "a" is all zeros, and "b" differs from it in one byte, whichever byte that is.
  let differsAt = -1;
  crypto.subtle.digest = async (alg, data) => {
    assert.equal(alg, "SHA-256");
    const out = new Uint8Array(32);
    if (new TextDecoder().decode(data) === "b" && differsAt >= 0) out[differsAt] = 1;
    return out.buffer;
  };
  try {
    assert.equal(await sameText("a", "b"), true); // the digests are the same here, so the texts count as the same
    for (differsAt = 0; differsAt < 32; differsAt++) {
      assert.equal(await sameText("a", "b"), false, `byte ${differsAt}`);
      assert.equal(await sameText("b", "a"), false, `byte ${differsAt}`);
      assert.equal(await sameText("a", "a"), true);
    }
  } finally {
    delete crypto.subtle.digest;
  }
  assert.ok(!Object.hasOwn(crypto.subtle, "digest")); // the built-in one is back
});

test("sameText: a missing value never equals another missing value", async () => {
  assert.equal(await sameText(undefined, undefined), false);
  assert.equal(await sameText(null, null), false);
  assert.equal(await sameText(undefined, "undefined"), false);
  assert.equal(await sameText(1, 1), false);
});

// ---- pin6 ------------------------------------------------------------------------------------

test("pin6: six digits", () => {
  for (let i = 0; i < 200; i++) assert.match(pin6(), /^\d{6}$/);
});

test("pin6: varies from call to call", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(pin6());
  assert.ok(seen.size > 190, `only ${seen.size} different pins in 200`);
});

// A fixed source of random numbers stands in for crypto.getRandomValues for the length of one call.
function withRandom(values, fn) {
  const queue = [...values];
  crypto.getRandomValues = (buf) => buf.fill(queue.shift());
  try { return fn(); } finally { delete crypto.getRandomValues; } // back to the built-in one on the prototype
}

test("pin6: keeps leading zeros, and draws again instead of folding a biased range", () => {
  // 4294 * 1,000,000 = 4,294,000,000 is the top of the even range inside a 32-bit number. Drawing at or above
  // it would make the low pins slightly likelier, so those draws are thrown away.
  assert.equal(withRandom([42], () => pin6()), "000042");
  assert.equal(withRandom([0], () => pin6()), "000000");
  assert.equal(withRandom([999999], () => pin6()), "999999");
  assert.equal(withRandom([1_000_001], () => pin6()), "000001");
  assert.equal(withRandom([4_293_999_999], () => pin6()), "999999");
  assert.equal(withRandom([4_294_000_000, 4_294_967_295, 7], () => pin6()), "000007");
});

// ---- session tokens --------------------------------------------------------------------------

const claims = { uid: "6f1c2a52-0d6e-4c1c-9c0a-0a6a6d6f4b11", tv: 3, exp: NOW + 180 * 86400_000 };

// A token signed the way signToken documents it, built here with node:crypto from any payload.
const rawToken = (payload, secret = SECRET) => {
  const p = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)).toString("base64url");
  return `${p}.${createHmac("sha256", secret).update(p).digest("base64url")}`;
};

test("signToken: base64url JSON, a dot, then the HMAC-SHA256 of the first part", async () => {
  const token = await signToken(claims, SECRET);
  const [payload, sig, ...rest] = token.split(".");
  assert.deepEqual(rest, []);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), claims);
  assert.equal(sig, createHmac("sha256", SECRET).update(payload).digest("base64url"));
});

test("signToken: signs only uid, tv and exp", async () => {
  const token = await signToken({ ...claims, role: "admin", email: "a@b.c" }, SECRET);
  assert.deepEqual(JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()), claims);
});

test("signToken: refuses to sign with no secret", async () => {
  await assert.rejects(() => signToken(claims, ""));
  await assert.rejects(() => signToken(claims, undefined));
});

test("token: round trip", async () => {
  const token = await signToken(claims, SECRET);
  assert.deepEqual(await readToken(token, SECRET, NOW), claims);
  assert.deepEqual(await readToken(token, SECRET, claims.exp - 1), claims);
  // A token built here with node:crypto reads the same: the format, not this module, is the contract.
  assert.deepEqual(await readToken(rawToken(claims), SECRET, NOW), claims);
  assert.deepEqual(await readToken(await signToken({ uid: "u", tv: 0, exp: NOW + 1 }, SECRET), SECRET, NOW),
    { uid: "u", tv: 0, exp: NOW + 1 });
});

test("readToken: null once the token has expired, up to the millisecond", async () => {
  const token = await signToken({ ...claims, exp: NOW }, SECRET);
  assert.equal(await readToken(token, SECRET, NOW), null); // exp is the first moment it is no longer valid
  assert.equal(await readToken(token, SECRET, NOW + 1), null);
  assert.equal(await readToken(token, SECRET, NOW + 365 * 86400_000), null);
  assert.deepEqual(await readToken(token, SECRET, NOW - 1), { ...claims, exp: NOW });
  assert.equal(await readToken(await signToken({ ...claims, exp: NOW - 1000 }, SECRET), SECRET, NOW), null);
});

test("readToken: null when the payload is altered", async () => {
  const token = await signToken(claims, SECRET);
  const sig = token.split(".")[1];
  const other = (patch) => Buffer.from(JSON.stringify({ ...claims, ...patch })).toString("base64url") + "." + sig;
  assert.equal(await readToken(other({ uid: "someone-else" }), SECRET, NOW), null);
  assert.equal(await readToken(other({ tv: 4 }), SECRET, NOW), null);
  assert.equal(await readToken(other({ exp: claims.exp + 86400_000 }), SECRET, NOW), null);
  assert.equal(await readToken(other({ role: "admin" }), SECRET, NOW), null);
  const [p] = token.split(".");
  for (const i of [0, Math.floor(p.length / 2), p.length - 1]) {
    const flipped = p.slice(0, i) + (p[i] === "A" ? "B" : "A") + p.slice(i + 1);
    assert.equal(await readToken(flipped + "." + sig, SECRET, NOW), null, `payload char ${i}`);
  }
});

test("readToken: null when the signature is altered, including its last character", async () => {
  const token = await signToken(claims, SECRET);
  const [p, sig] = token.split(".");
  for (const i of [0, Math.floor(sig.length / 2), sig.length - 1]) {
    const flipped = sig.slice(0, i) + (sig[i] === "A" ? "B" : "A") + sig.slice(i + 1);
    assert.equal(await readToken(p + "." + flipped, SECRET, NOW), null, `signature char ${i}`);
  }
  assert.equal(await readToken(p + "." + sig.slice(0, -1), SECRET, NOW), null);
  assert.equal(await readToken(p + "." + sig + "A", SECRET, NOW), null);
  assert.equal(await readToken(p + ".", SECRET, NOW), null);
});

test("readToken: null when signed with another secret, or read with the wrong one", async () => {
  const token = await signToken(claims, "another-secret");
  assert.equal(await readToken(token, SECRET, NOW), null);
  assert.deepEqual(await readToken(token, "another-secret", NOW), claims);
  assert.equal(await readToken(await signToken(claims, SECRET), "another-secret", NOW), null);
  assert.equal(await readToken(await signToken(claims, SECRET), "", NOW), null);
  assert.equal(await readToken(await signToken(claims, SECRET), undefined, NOW), null);
});

test("readToken: returns only uid, tv and exp, and refuses anything after the signature", async () => {
  // A payload with more in it, signed properly: the extras are not handed on.
  assert.deepEqual(await readToken(rawToken({ ...claims, role: "admin", email: "a@b.c" }), SECRET, NOW), claims);
  const token = await signToken(claims, SECRET);
  for (const tail of [".", ".x", "." + token.split(".")[1], ".."]) {
    assert.equal(await readToken(token + tail, SECRET, NOW), null, JSON.stringify(tail));
  }
  assert.equal(await readToken("." + token, SECRET, NOW), null);
  assert.deepEqual(await readToken(token, SECRET, NOW), claims); // control
});

test("readToken: null for anything that is not a token", async () => {
  for (const bad of [
    "", ".", "..", "abc", "a.b", "a.b.c", "a.b.c.d", ".sig", "payload.", " ", "Bearer x",
    undefined, null, 0, 42, {}, [], ["a", "b"], true, "x".repeat(5000),
  ]) assert.equal(await readToken(bad, SECRET, NOW), null, JSON.stringify(bad)?.slice(0, 40));
});

test("readToken: null for a signed payload of the wrong shape", async () => {
  for (const bad of [
    { uid: "u", tv: 1 },                       // no exp
    { uid: "u", exp: NOW + 1000 },             // no tv
    { tv: 1, exp: NOW + 1000 },                // no uid
    { uid: "", tv: 1, exp: NOW + 1000 },
    { uid: 7, tv: 1, exp: NOW + 1000 },
    { uid: "u", tv: "1", exp: NOW + 1000 },
    { uid: "u", tv: 1.5, exp: NOW + 1000 },
    { uid: "u", tv: -1, exp: NOW + 1000 },
    { uid: "u", tv: null, exp: NOW + 1000 },
    { uid: "u", tv: 1, exp: String(NOW + 1000) },
    { uid: "u", tv: 1, exp: null },
    { uid: "u", tv: 1, exp: Infinity },        // JSON turns this into null
    "not json", "[]", "null", "42", '"str"', '["u",1,2]', "",
  ]) assert.equal(await readToken(rawToken(bad), SECRET, NOW), null, JSON.stringify(bad));
  // The good one next to them, so a broken helper cannot make all of these pass for the wrong reason.
  assert.deepEqual(await readToken(rawToken({ uid: "u", tv: 1, exp: NOW + 1000 }), SECRET, NOW),
    { uid: "u", tv: 1, exp: NOW + 1000 });
});

test("readToken: null when the clock is missing", async () => {
  const token = await signToken(claims, SECRET);
  assert.equal(await readToken(token, SECRET, undefined), null);
  assert.equal(await readToken(token, SECRET, NaN), null);
  assert.equal(await readToken(token, SECRET, "1"), null);
});

// ---- LINE ID token ---------------------------------------------------------------------------

const GOOD = {
  iss: "https://access.line.me", sub: "U1234567890abcdef1234567890abcdef", aud: CHANNEL,
  exp: NOW_S + 3600, iat: NOW_S - 5, nonce: NONCE, name: "Test Surfer", picture: "https://profile.line-scdn.net/x",
};
const OPTS = { channelId: CHANNEL, secret: SECRET, nonce: NONCE, nowMs: NOW };

// A JWT built the way LINE builds one: header and payload as base64url JSON, then the HMAC of "header.payload".
function jwt({ header = { typ: "JWT", alg: "HS256" }, payload = GOOD, secret = SECRET, hash = "sha256", sig } = {}) {
  const h = Buffer.from(typeof header === "string" ? header : JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)).toString("base64url");
  const s = sig ?? createHmac(hash, secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

test("verifyLineIdToken: passes a good HS256 token and returns its claims", async () => {
  const out = await verifyLineIdToken(jwt(), OPTS);
  assert.deepEqual(out, GOOD);
  assert.equal(out.sub, GOOD.sub);
});

test("verifyLineIdToken: exp is in seconds, and a token on its exp second is expired", async () => {
  assert.deepEqual(await verifyLineIdToken(jwt({ payload: { ...GOOD, exp: NOW_S + 1 } }), OPTS), { ...GOOD, exp: NOW_S + 1 });
  assert.deepEqual(await verifyLineIdToken(jwt({ payload: { ...GOOD, exp: NOW_S + 0.5 } }), OPTS), { ...GOOD, exp: NOW_S + 0.5 });
  assert.equal(await verifyLineIdToken(jwt({ payload: { ...GOOD, exp: NOW_S } }), OPTS), null);
  assert.equal(await verifyLineIdToken(jwt({ payload: { ...GOOD, exp: NOW_S - 1 } }), OPTS), null);
  assert.equal(await verifyLineIdToken(jwt({ payload: { ...GOOD, exp: NOW_S - 86400 } }), OPTS), null);
  // The same exp read as milliseconds would be in the year 58000: a unit mix-up must not pass an old token.
  assert.equal(await verifyLineIdToken(jwt({ payload: { ...GOOD, exp: NOW_S - 1 } }), { ...OPTS, nowMs: NOW }), null);
  // Later clock: the good token goes stale.
  assert.equal(await verifyLineIdToken(jwt(), { ...OPTS, nowMs: NOW + 3600_000 }), null);
  assert.deepEqual(await verifyLineIdToken(jwt(), { ...OPTS, nowMs: NOW + 3599_000 }), GOOD);
});

test("verifyLineIdToken: null unless the header alg is exactly HS256", async () => {
  // Each of these is otherwise a fully valid token: the signature is the real HS256 one over its own header.
  for (const alg of ["none", "None", "NONE", "ES256", "RS256", "HS384", "HS512", "hs256", "HS256 ", " HS256", "", null, 256, ["HS256"]]) {
    assert.equal(await verifyLineIdToken(jwt({ header: { typ: "JWT", alg } }), OPTS), null, `alg ${JSON.stringify(alg)}`);
  }
  assert.equal(await verifyLineIdToken(jwt({ header: { typ: "JWT" } }), OPTS), null, "no alg");
  assert.equal(await verifyLineIdToken(jwt({ header: {} }), OPTS), null);
  assert.equal(await verifyLineIdToken(jwt({ header: "[]" }), OPTS), null);
  assert.equal(await verifyLineIdToken(jwt({ header: "null" }), OPTS), null);
  assert.equal(await verifyLineIdToken(jwt({ header: "not json" }), OPTS), null);
  // The HS512 token with a real HS512 signature, and the unsigned token with an empty signature.
  const h512 = Buffer.from(JSON.stringify({ typ: "JWT", alg: "HS512" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(GOOD)).toString("base64url");
  const mac512 = createHmac("sha512", SECRET).update(`${h512}.${p}`).digest("base64url");
  assert.equal(await verifyLineIdToken(`${h512}.${p}.${mac512}`, OPTS), null);
  assert.equal(await verifyLineIdToken(jwt({ header: { alg: "none" }, sig: "" }), OPTS), null);
  assert.equal(await verifyLineIdToken(jwt({ header: { alg: "none" }, sig: "" }).slice(0, -1), OPTS), null); // no trailing dot either
  // Control: the same builder with the right alg passes.
  assert.deepEqual(await verifyLineIdToken(jwt({ header: { alg: "HS256" } }), OPTS), GOOD);
});

test("verifyLineIdToken: null for the wrong aud", async () => {
  for (const aud of ["999", "", "1234567890 ", undefined, null, 1234567890, [CHANNEL], { 0: CHANNEL }]) {
    const payload = { ...GOOD, aud };
    if (aud === undefined) delete payload.aud;
    assert.equal(await verifyLineIdToken(jwt({ payload }), OPTS), null, `aud ${JSON.stringify(aud)}`);
  }
  assert.equal(await verifyLineIdToken(jwt(), { ...OPTS, channelId: "999" }), null);
});

test("verifyLineIdToken: null for the wrong nonce", async () => {
  for (const nonce of ["other", "", NONCE + "x", NONCE.toUpperCase(), undefined, null, 1, [NONCE]]) {
    const payload = { ...GOOD, nonce };
    if (nonce === undefined) delete payload.nonce;
    assert.equal(await verifyLineIdToken(jwt({ payload }), OPTS), null, `nonce ${JSON.stringify(nonce)}`);
  }
  assert.equal(await verifyLineIdToken(jwt(), { ...OPTS, nonce: "other" }), null);
});

test("verifyLineIdToken: null for the wrong iss", async () => {
  for (const iss of ["https://access.line.me/", "http://access.line.me", "https://evil.example", "https://access.line.me.evil.example", "", undefined, null, ["https://access.line.me"]]) {
    const payload = { ...GOOD, iss };
    if (iss === undefined) delete payload.iss;
    assert.equal(await verifyLineIdToken(jwt({ payload }), OPTS), null, `iss ${JSON.stringify(iss)}`);
  }
});

test("verifyLineIdToken: null for a missing, late or odd exp", async () => {
  for (const exp of [undefined, null, "", String(NOW_S + 3600), NaN, [NOW_S + 3600], { v: 1 }, true]) {
    const payload = { ...GOOD, exp };
    if (exp === undefined) delete payload.exp;
    assert.equal(await verifyLineIdToken(jwt({ payload }), OPTS), null, `exp ${JSON.stringify(exp)}`);
  }
});

test("verifyLineIdToken: null for an exp that is infinite (1e999 reads as Infinity)", async () => {
  const payload = JSON.stringify(GOOD).replace(/"exp":\d+/, '"exp":1e999');
  assert.ok(payload.includes("1e999"));
  assert.equal(await verifyLineIdToken(jwt({ payload }), OPTS), null);
  assert.equal(await readToken(rawToken(JSON.stringify(claims).replace(/"exp":\d+/, '"exp":1e999')), SECRET, NOW), null);
});

test("verifyLineIdToken: null for a bad signature", async () => {
  const [h, p, s] = jwt().split(".");
  assert.equal(await verifyLineIdToken(jwt({ secret: "another-secret" }), OPTS), null);
  assert.equal(await verifyLineIdToken(jwt(), { ...OPTS, secret: "another-secret" }), null);
  for (const i of [0, Math.floor(s.length / 2), s.length - 1]) {
    const flipped = s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    assert.equal(await verifyLineIdToken(`${h}.${p}.${flipped}`, OPTS), null, `signature char ${i}`);
  }
  assert.equal(await verifyLineIdToken(`${h}.${p}.${s.slice(0, -1)}`, OPTS), null);
  assert.equal(await verifyLineIdToken(`${h}.${p}.${s}A`, OPTS), null);
  assert.equal(await verifyLineIdToken(`${h}.${p}.`, OPTS), null);
  assert.equal(await verifyLineIdToken(`${h}.${p}.${"A".repeat(s.length)}`, OPTS), null);
});

test("verifyLineIdToken: null when the header or payload was changed after signing", async () => {
  const [h, p, s] = jwt().split(".");
  const swap = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  // A later exp, another account's sub, another audience, another nonce: each with the old signature.
  for (const patch of [{ exp: NOW_S + 999999 }, { sub: "Uother" }, { aud: "999" }, { nonce: "other" }, { name: "Admin" }]) {
    assert.equal(await verifyLineIdToken(`${h}.${swap({ ...GOOD, ...patch })}.${s}`, { ...OPTS, channelId: patch.aud ?? CHANNEL, nonce: patch.nonce ?? NONCE }), null, JSON.stringify(patch));
  }
  // A header swapped in with the old signature.
  assert.equal(await verifyLineIdToken(`${swap({ alg: "HS256", kid: "x" })}.${p}.${s}`, OPTS), null);
  // The signature covers "header.payload": the parts in a different order do not pass either.
  assert.equal(await verifyLineIdToken(`${p}.${h}.${s}`, OPTS), null);
});

test("verifyLineIdToken: null for anything that is not a JWT", async () => {
  const good = jwt();
  const [h, p, s] = good.split(".");
  for (const bad of [
    "", ".", "..", "...", "a.b", "a.b.c", `${good}.x`, `${h}.${p}`, `.${p}.${s}`, `${h}..${s}`, `${h}.${p}.${s}.`,
    `${h}+.${p}.${s}`, `${h}.${p}=.${s}`, "Bearer " + good, ` ${good}`, `${good} `, `${good}\n`,
    undefined, null, 0, {}, [], [good], true, "x".repeat(10000),
  ]) assert.equal(await verifyLineIdToken(bad, OPTS), null, JSON.stringify(bad)?.slice(0, 40));
  // A signed payload that is not an object.
  for (const payload of ["[]", "null", "42", '"str"', "true", "not json", ""]) {
    assert.equal(await verifyLineIdToken(jwt({ payload }), OPTS), null, `payload ${payload}`);
  }
  assert.deepEqual(await verifyLineIdToken(good, OPTS), GOOD); // control
});

test("verifyLineIdToken: null when the caller's own settings are missing, so a misconfigured Worker never passes", async () => {
  // Every one of these has the matching empty value in the token too, which must not count as a match.
  const emptyAud = jwt({ payload: { ...GOOD, aud: "" } });
  const emptyNonce = jwt({ payload: { ...GOOD, nonce: "" } });
  assert.equal(await verifyLineIdToken(emptyAud, { ...OPTS, channelId: "" }), null);
  assert.equal(await verifyLineIdToken(emptyNonce, { ...OPTS, nonce: "" }), null);
  assert.equal(await verifyLineIdToken(jwt({ secret: "" }), { ...OPTS, secret: "" }), null);
  for (const key of ["channelId", "secret", "nonce", "nowMs"]) {
    assert.equal(await verifyLineIdToken(jwt(), { ...OPTS, [key]: undefined }), null, `no ${key}`);
  }
  assert.equal(await verifyLineIdToken(jwt(), { ...OPTS, nowMs: NaN }), null);
  assert.equal(await verifyLineIdToken(jwt(), { ...OPTS, nowMs: String(NOW) }), null);
  assert.equal(await verifyLineIdToken(jwt(), undefined), null);
  assert.equal(await verifyLineIdToken(jwt(), {}), null);
});

test("verifyLineIdToken: null when sub is missing, since the account code is made from it", async () => {
  for (const sub of [undefined, null, "", 123, ["U1"], { id: "U1" }]) {
    const payload = { ...GOOD, sub };
    if (sub === undefined) delete payload.sub;
    assert.equal(await verifyLineIdToken(jwt({ payload }), OPTS), null, `sub ${JSON.stringify(sub)}`);
  }
});

test("verifyLineIdToken: the optional claims may be missing", async () => {
  const bare = { iss: GOOD.iss, sub: GOOD.sub, aud: CHANNEL, exp: NOW_S + 60, nonce: NONCE };
  assert.deepEqual(await verifyLineIdToken(jwt({ payload: bare }), OPTS), bare);
});

// ---- subHash ---------------------------------------------------------------------------------

test("subHash: stable for the same pepper, different for another pepper or another sub", async () => {
  const sub = GOOD.sub;
  const a = await subHash(sub, "pepper-one");
  assert.equal(await subHash(sub, "pepper-one"), a);
  assert.notEqual(await subHash(sub, "pepper-two"), a);
  assert.notEqual(await subHash(sub + "x", "pepper-one"), a);
  assert.notEqual(await subHash("U00000000000000000000000000000000", "pepper-one"), a);
});

test("subHash: HMAC-SHA256 keyed with the pepper, as base64url, and does not hold the sub", async () => {
  const sub = GOOD.sub, pepper = "pepper-one";
  const h = await subHash(sub, pepper);
  assert.equal(h, createHmac("sha256", pepper).update(sub).digest("base64url"));
  assert.match(h, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!h.includes(sub));
  assert.notEqual(h, createHmac("sha256", sub).update(pepper).digest("base64url")); // key and data are not swapped
  assert.notEqual(h, createHash("sha256").update(sub).digest("base64url")); // not a bare, guessable hash
});

test("subHash: refuses a missing sub or pepper instead of hashing 'undefined' for everyone", async () => {
  await assert.rejects(() => subHash(undefined, "pepper"));
  await assert.rejects(() => subHash("", "pepper"));
  await assert.rejects(() => subHash(null, "pepper"));
  await assert.rejects(() => subHash(123, "pepper"));
  await assert.rejects(() => subHash("U1", ""));
  await assert.rejects(() => subHash("U1", undefined));
});
