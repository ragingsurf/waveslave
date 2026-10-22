// Tests for the LINE sign-in (spec "Login (LINE, web flow)"): /auth/line/start and /auth/line/callback in the front
// Worker, /auth/redeem and /auth/signup in the room, the handoff with its pin, and the room's userFromToken() and
// closeUser(). They run inside the Workers runtime (see vitest.config.mjs). Run from chat/:
// npx vitest run test/login.spec.mjs
//
// The file is .spec.mjs, not .test.mjs, because it imports "cloudflare:test": see the note in vitest.config.mjs.
//
// LINE's token endpoint is mocked by replacing the global fetch: the Worker runs in the same isolate as the tests, so
// its call to LINE_TOKEN_URL lands in the mock. Every test makes its own people (a fresh verifier, LINE sub and LINE
// name), so the tests can share the real "taiwan" room that the Worker always uses.
import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { b64u, hmacB64u, randomB64u, readToken, sha256b64u, signToken, subHash } from "../src/auth.js";
import { checkNick } from "../src/mod.js";

const ORIGIN = "https://waveslave.tw";
const BASE = "https://chat.example";
const CALLBACK = `${BASE}/auth/line/callback`;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const B64U_32 = /^[A-Za-z0-9_-]{43}$/;

const taiwan = env.ROOM.getByName("taiwan", { locationHint: "apac-ne" });
const inRoom = (fn) => runInDurableObject(taiwan, fn);
const rows = (room, query, ...binds) => room.sql.exec(query, ...binds).toArray();
const enc = new TextEncoder();
const realFetch = globalThis.fetch;

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

// A new person: their app's verifier v, their LINE account (sub, the way LINE writes one) and their LINE name.
const person = () => ({ v: randomB64u(32), sub: `U${hex(16)}`, name: `Kai ${hex(3)}` });

// A nickname nobody else in the room has.
const freshNick = (stem = "Leo") => `${stem}_${hex(3)}`;

// A pin that isn't `pin`.
const otherPin = (pin, k = 1) => String((Number(pin) + k) % 1_000_000).padStart(6, "0");

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- LINE, mocked -----------------------------------------------------------------------------------------

// An ID token the way LINE's token endpoint returns it: HS256, signed with the channel secret.
async function idToken(claims, { secret = env.LINE_CHANNEL_SECRET, alg = "HS256" } = {}) {
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg })));
  const body = b64u(enc.encode(JSON.stringify(claims)));
  return `${head}.${body}.${await hmacB64u(secret, `${head}.${body}`)}`;
}

const goodClaims = (who, nonce) => ({
  iss: "https://access.line.me",
  sub: who.sub,
  aud: env.LINE_CHANNEL_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  nonce,
  amr: ["linesso"],
  name: who.name,
});

// Replaces LINE's token endpoint: each exchange is recorded (its method, headers and form) and answered with
// answer(form). Any other fetch goes out as usual. A later call replaces the answer; afterEach puts fetch back.
function mockLine(answer) {
  const exchanges = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== env.LINE_TOKEN_URL) return realFetch(input, init);
    const form = Object.fromEntries(await request.formData());
    exchanges.push({ method: request.method, type: request.headers.get("Content-Type"), form });
    return answer(form);
  });
  return exchanges;
}

const lineAnswers = (token) => () =>
  Response.json({ access_token: "line-access-token", token_type: "Bearer", expires_in: 2592000, scope: "openid profile", id_token: token });

// ---- The trip to LINE and back -------------------------------------------------------------------------------

const start = (h) => SELF.fetch(`${BASE}/auth/line/start${h === undefined ? "" : `?h=${encodeURIComponent(h)}`}`, { redirect: "manual" });
const callback = (query) => SELF.fetch(`${CALLBACK}?${query}`, { redirect: "manual" });
const location = (res) => new URL(res.headers.get("Location"));

// The fragment of a redirect back to the app, as an object: {c, p} after a sign-in, {e} after a failure.
const fragment = (res) => Object.fromEntries(new URLSearchParams(location(res).hash.slice(1)));

// Starts a sign-in with h and returns LINE's address, its state and its nonce.
async function startWith(h) {
  const res = await start(h);
  expect(res.status).toBe(302);
  const to = location(res);
  return { res, to, state: to.searchParams.get("state"), nonce: to.searchParams.get("nonce") };
}

// The whole trip for `who`: the app starts with h (their own SHA-256(v) unless given), and LINE calls back with an ID
// token holding claims(nonce) (good claims for `who` unless given). Returns the callback's answer and its fragment.
async function signIn(who, { h, claims } = {}) {
  const { state, nonce } = await startWith(h ?? (await sha256b64u(who.v)));
  const exchanges = mockLine(lineAnswers(await idToken(claims ? claims(nonce) : goodClaims(who, nonce))));
  const res = await callback(`code=line-code&state=${state}`);
  return { res, state, nonce, exchanges, ...fragment(res) };
}

// The app's calls to the room, through the Worker as the page makes them.
async function post(path, body) {
  const res = await SELF.fetch(BASE + path, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const redeem = (body) => post("/auth/redeem", body);
const signup = (body) => post("/auth/signup", body);

// A person who has signed up, with their session token and user id.
async function member(nick = freshNick()) {
  const who = person();
  const { c } = await signIn(who);
  const res = await signup({ v: who.v, code: c, nick, consent: "v1" });
  expect(res.status).toBe(200);
  return { ...who, nick, token: res.body.token, uid: (await readToken(res.body.token, env.SESSION_SECRET, Date.now())).uid };
}

const handoffByCode = (code) => sha256b64u(code).then((hash) => inRoom((room) => rows(room, "SELECT * FROM handoffs WHERE code_hash = ?", hash)[0] ?? null));
const userBySub = (sub) =>
  subHash(sub, env.SUB_PEPPER).then((hash) => inRoom((room) => rows(room, "SELECT * FROM users WHERE sub_hash = ?", hash)[0] ?? null));

// Every value in every table of the room, as text.
const everyValue = () =>
  inRoom((room) => {
    const tables = rows(room, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
    return tables.flatMap(({ name }) => rows(room, `SELECT * FROM "${name}"`).flatMap((row) => Object.values(row).map(String)));
  });

// ---- Start ---------------------------------------------------------------------------------------------------

describe("GET /auth/line/start", () => {
  it("sends the browser to LINE_AUTH_URL with exactly the spec's parameters", async () => {
    const h = await sha256b64u(randomB64u(32));
    const { res, to } = await startWith(h);
    expect(`${to.origin}${to.pathname}`).toBe(env.LINE_AUTH_URL);
    const params = Object.fromEntries(to.searchParams);
    expect(Object.keys(params).sort()).toEqual(
      ["client_id", "code_challenge", "code_challenge_method", "nonce", "redirect_uri", "response_type", "scope", "state"],
    );
    expect(params.response_type).toBe("code");
    expect(params.client_id).toBe(env.LINE_CHANNEL_ID);
    expect(params.redirect_uri).toBe(CALLBACK);
    expect(params.scope).toBe("openid profile");
    expect(params.code_challenge_method).toBe("S256");
    expect(params.state).toMatch(B64U_32);
    expect(params.nonce).toMatch(B64U_32);
    expect(params.code_challenge).toMatch(B64U_32);
    expect(new Set([params.state, params.nonce, params.code_challenge]).size).toBe(3);
    // The space in the scope is written %20, as LINE's own examples have it.
    expect(res.headers.get("Location")).toContain("scope=openid%20profile");
  });

  it("stores the sign-in in logins: its state, nonce, a PKCE verifier whose S256 is the challenge, h and the time", async () => {
    const h = await sha256b64u(randomB64u(32));
    const before = Date.now();
    const { to, state, nonce } = await startWith(h);
    const after = Date.now();
    const [row] = await inRoom((room) => rows(room, "SELECT * FROM logins WHERE state = ?", state));
    expect(row.nonce).toBe(nonce);
    expect(row.h).toBe(h);
    expect(row.pkce_verifier).toMatch(B64U_32); // 32 random bytes: 43 characters, inside PKCE's 43 to 128
    expect(await sha256b64u(row.pkce_verifier)).toBe(to.searchParams.get("code_challenge"));
    expect(row.created).toBeGreaterThanOrEqual(before);
    expect(row.created).toBeLessThanOrEqual(after);
  });

  it("makes a new state, nonce and verifier for every start, even with the same h", async () => {
    const h = await sha256b64u(randomB64u(32));
    const one = await startWith(h);
    const two = await startWith(h);
    expect(two.state).not.toBe(one.state);
    expect(two.nonce).not.toBe(one.nonce);
    expect(two.to.searchParams.get("code_challenge")).not.toBe(one.to.searchParams.get("code_challenge"));
  });

  it("sends a missing or malformed h back to the app with #e=start, and stores nothing", async () => {
    const count = () => inRoom((room) => rows(room, "SELECT count(*) AS n FROM logins")[0].n);
    const good = await sha256b64u("x");
    const before = await count();
    for (const h of [undefined, "", "abc", `${good}A`, good.slice(1), `${good.slice(1)}=`, `${good.slice(1)}+`, `${good.slice(1)}/`]) {
      const res = await start(h);
      expect(res.status, String(h)).toBe(302);
      expect(res.headers.get("Location"), String(h)).toBe(`${env.APP_URL}?chat#e=start`);
    }
    expect(await count()).toBe(before);
  });

  it("answers 405 to any other method", async () => {
    for (const method of ["POST", "DELETE"]) {
      const res = await SELF.fetch(`${BASE}/auth/line/start?h=${await sha256b64u("x")}`, { method, redirect: "manual" });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("Allow"), method).toBe("GET");
    }
  });
});

describe("the sign-in routes' headers", () => {
  it("are no-store and no-referrer, with no CORS, on every answer of start and callback", async () => {
    const who = person();
    const { res: back } = await signIn(who);
    const answers = [
      (await startWith(await sha256b64u(who.v))).res,
      await start("bad"),
      back,
      await callback("error=access_denied&state=x"),
      await callback("code=x&state=nothing"),
    ];
    for (const res of answers) {
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("need no Origin, and don't mind one from anywhere: they are page navigations", async () => {
    const res = await SELF.fetch(`${BASE}/auth/line/start?h=${await sha256b64u("x")}`, {
      redirect: "manual",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(302);
    expect(location(res).origin + location(res).pathname).toBe(env.LINE_AUTH_URL);
  });
});

// ---- Callback ------------------------------------------------------------------------------------------------

describe("GET /auth/line/callback", () => {
  it("on success, redirects to APP_URL?chat#c=<code>&p=<6 digits>, and swaps the logins row for a handoff", async () => {
    const who = person();
    const { res, state, c, p } = await signIn(who);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^https:\/\/waveslave\.tw\/\?chat#c=[A-Za-z0-9_-]{22}&p=\d{6}$/);
    expect(res.headers.get("Location").startsWith(`${env.APP_URL}?chat#`)).toBe(true);
    expect(await inRoom((room) => rows(room, "SELECT * FROM logins WHERE state = ?", state))).toEqual([]);
    const handoff = await handoffByCode(c);
    expect(handoff).toEqual({
      code_hash: await sha256b64u(c),
      h: await sha256b64u(who.v),
      sub_hash: await subHash(who.sub, env.SUB_PEPPER),
      line_name: who.name,
      pin: p,
      created: expect.any(Number),
      tries: 0,
    });
    expect(Date.now() - handoff.created).toBeLessThan(MIN);
    // The code itself is never stored, only its SHA-256; and LINE's raw sub never is, only its sub_hash (ruling R22).
    const values = await everyValue();
    expect(values).not.toContain(c);
    expect(values.filter((value) => value.includes(who.sub))).toEqual([]);
    expect(await userBySub(who.sub)).toBeNull();
  });

  it("stores LINE's raw sub nowhere when someone who has an account signs in again, by code or by pin", async () => {
    const someone = await member();
    for (const by of ["code", "pin"]) {
      const { c, p } = await signIn(someone);
      expect((await everyValue()).filter((value) => value.includes(someone.sub)), `after the callback (${by})`).toEqual([]);
      const res = await redeem(by === "code" ? { v: someone.v, code: c } : { v: someone.v, pin: p });
      expect(res.status, by).toBe(200);
      expect((await everyValue()).filter((value) => value.includes(someone.sub)), `after redeem (${by})`).toEqual([]);
    }
  });

  it("exchanges LINE's code with the spec's fields, including the PKCE verifier, at LINE_TOKEN_URL", async () => {
    const who = person();
    const { state, nonce } = await startWith(await sha256b64u(who.v));
    const [{ pkce_verifier }] = await inRoom((room) => rows(room, "SELECT pkce_verifier FROM logins WHERE state = ?", state));
    const exchanges = mockLine(lineAnswers(await idToken(goodClaims(who, nonce))));
    await callback(`code=the-code-from-line&state=${state}`);
    expect(exchanges).toEqual([
      {
        method: "POST",
        type: "application/x-www-form-urlencoded",
        form: {
          grant_type: "authorization_code",
          code: "the-code-from-line",
          redirect_uri: CALLBACK,
          client_id: env.LINE_CHANNEL_ID,
          client_secret: env.LINE_CHANNEL_SECRET,
          code_verifier: pkce_verifier,
        },
      },
    ]);
  });

  it("sends LINE's own error back to the app: ?error=ACCESS_DENIED -> #e=ACCESS_DENIED, without asking LINE", async () => {
    const { state } = await startWith(await sha256b64u(randomB64u(32)));
    const exchanges = mockLine(() => Response.json({}));
    const res = await callback(`error=ACCESS_DENIED&error_description=The+resource+owner+denied+the+request.&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`${env.APP_URL}?chat#e=ACCESS_DENIED`);
    expect(exchanges).toEqual([]);
  });

  it("passes on only an error code that looks like one; anything else becomes #e=line", async () => {
    for (const error of ["<script>alert(1)</script>", "a&c=forged", "x".repeat(65), ""]) {
      const res = await callback(`error=${encodeURIComponent(error)}&state=x`);
      expect(fragment(res), error).toEqual({ e: "line" });
    }
  });

  it("answers an unknown, missing or reused state with #e=state, and asks LINE nothing for it", async () => {
    const who = person();
    const first = await signIn(who);
    expect(first.c).toBeDefined();
    const exchanges = mockLine(lineAnswers(await idToken(goodClaims(who, first.nonce))));
    for (const query of [`code=line-code&state=${first.state}`, `code=line-code&state=${randomB64u(32)}`, "code=line-code"]) {
      const res = await callback(query);
      expect(res.status, query).toBe(302);
      expect(res.headers.get("Location"), query).toBe(`${env.APP_URL}?chat#e=state`);
    }
    expect(exchanges).toEqual([]);
  });

  it("answers a logins row older than 10 minutes with #e=state, and the row is gone after", async () => {
    const who = person();
    const { state, nonce } = await startWith(await sha256b64u(who.v));
    await inRoom((room) => room.sql.exec("UPDATE logins SET created = created - ? WHERE state = ?", 10 * MIN + 1000, state));
    const exchanges = mockLine(lineAnswers(await idToken(goodClaims(who, nonce))));
    const res = await callback(`code=line-code&state=${state}`);
    expect(fragment(res)).toEqual({ e: "state" });
    expect(exchanges).toEqual([]);
    expect(await inRoom((room) => rows(room, "SELECT * FROM logins WHERE state = ?", state))).toEqual([]);
  });

  it("answers an ID token with the wrong nonce with #e=token, and stores no handoff", async () => {
    const who = person();
    const { res } = await signIn(who, { claims: (nonce) => ({ ...goodClaims(who, nonce), nonce: `${nonce}x` }) });
    expect(res.headers.get("Location")).toBe(`${env.APP_URL}?chat#e=token`);
    const hash = await subHash(who.sub, env.SUB_PEPPER);
    expect(await inRoom((room) => rows(room, "SELECT * FROM handoffs WHERE sub_hash = ?", hash))).toEqual([]);
  });

  it("answers every other bad ID token with #e=token", async () => {
    const cases = {
      "another channel's secret": async (who, nonce) => idToken(goodClaims(who, nonce), { secret: "another-secret" }),
      "alg none": async (who, nonce) => idToken(goodClaims(who, nonce), { alg: "none" }),
      "another channel": async (who, nonce) => idToken({ ...goodClaims(who, nonce), aud: "999" }),
      "another issuer": async (who, nonce) => idToken({ ...goodClaims(who, nonce), iss: "https://evil.example" }),
      expired: async (who, nonce) => idToken({ ...goodClaims(who, nonce), exp: Math.floor(Date.now() / 1000) - 1 }),
      "no sub": async (who, nonce) => idToken({ ...goodClaims(who, nonce), sub: undefined }),
      "not a token": async () => "not.a.token",
    };
    for (const [name, make] of Object.entries(cases)) {
      const who = person();
      const { state, nonce } = await startWith(await sha256b64u(who.v));
      mockLine(lineAnswers(await make(who, nonce)));
      const res = await callback(`code=line-code&state=${state}`);
      expect(fragment(res), name).toEqual({ e: "token" });
    }
  });

  it("answers #e=token when LINE refuses the code, answers without an ID token, or can't be reached, or there is no code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const answers = {
      "LINE says 400": () => Response.json({ error: "invalid_grant" }, { status: 400 }),
      "no id_token": () => Response.json({ access_token: "x" }),
      "not JSON": () => new Response("<html>", { status: 200 }),
      unreachable: () => {
        throw new TypeError("network");
      },
    };
    for (const [name, answer] of Object.entries(answers)) {
      const { state } = await startWith(await sha256b64u(randomB64u(32)));
      mockLine(answer);
      const res = await callback(`code=line-code&state=${state}`);
      expect(fragment(res), name).toEqual({ e: "token" });
    }
    const { state } = await startWith(await sha256b64u(randomB64u(32)));
    const exchanges = mockLine(() => Response.json({}));
    expect(fragment(await callback(`state=${state}`))).toEqual({ e: "token" });
    expect(exchanges).toEqual([]);
  });

  it("logs nothing LINE sent when the exchange fails, only what kind of failure it was", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { state } = await startWith(await sha256b64u(randomB64u(32)));
    mockLine(() => Response.json({ error: "invalid_grant", error_description: "secret-looking detail" }, { status: 400 }));
    await callback(`code=code-to-keep-private&state=${state}`);
    const text = JSON.stringify(logged.mock.calls);
    expect(text).not.toContain("secret-looking detail");
    expect(text).not.toContain("code-to-keep-private");
    expect(text).not.toContain(env.LINE_CHANNEL_SECRET);
  });

  it("answers a banned LINE account with #e=banned, and stores no handoff", async () => {
    const who = person();
    const hash = await subHash(who.sub, env.SUB_PEPPER);
    await inRoom((room) => room.sql.exec("INSERT INTO subs (sub_hash, banned) VALUES (?, 1)", hash));
    const { res } = await signIn(who);
    expect(res.headers.get("Location")).toBe(`${env.APP_URL}?chat#e=banned`);
    expect(await inRoom((room) => rows(room, "SELECT * FROM handoffs WHERE sub_hash = ?", hash))).toEqual([]);
  });
});

// ---- Redeem --------------------------------------------------------------------------------------------------

describe("POST /auth/redeem", () => {
  it("for a new LINE account: {needs_signup: true, line_name}, and the handoff stays for the signup", async () => {
    const who = person();
    const { c } = await signIn(who);
    expect(await redeem({ v: who.v, code: c })).toEqual({ status: 200, body: { needs_signup: true, line_name: who.name } });
    expect(await handoffByCode(c)).not.toBeNull();
    expect(await userBySub(who.sub)).toBeNull();
  });

  it("for a known user: {token} for them, the handoff deleted, and last_seen brought up to now", async () => {
    const someone = await member();
    await inRoom((room) => room.sql.exec("UPDATE users SET last_seen = 0 WHERE id = ?", someone.uid));
    const { c } = await signIn(someone);
    const res = await redeem({ v: someone.v, code: c });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["token"]);
    const claims = await readToken(res.body.token, env.SESSION_SECRET, Date.now());
    expect(claims.uid).toBe(someone.uid);
    expect(claims.tv).toBe(0);
    // Good for 180 days.
    expect(Math.abs(claims.exp - (Date.now() + 180 * DAY))).toBeLessThan(MIN);
    expect(await handoffByCode(c)).toBeNull();
    expect(Date.now() - (await userBySub(someone.sub)).last_seen).toBeLessThan(MIN);
  });

  it("refuses a code whose handoff is over 10 minutes old (410 expired)", async () => {
    const who = person();
    const { c } = await signIn(who);
    const hash = await sha256b64u(c);
    await inRoom((room) => room.sql.exec("UPDATE handoffs SET created = created - ? WHERE code_hash = ?", 10 * MIN, hash));
    expect(await redeem({ v: who.v, code: c })).toEqual({ status: 410, body: { error: "expired" } });
  });

  it("refuses a code it never gave out (410 expired)", async () => {
    expect(await redeem({ v: randomB64u(32), code: randomB64u(16) })).toEqual({ status: 410, body: { error: "expired" } });
  });

  it("refuses a body of the wrong shape with 400 invalid", async () => {
    const v = randomB64u(32);
    const code = randomB64u(16);
    for (const body of [
      "not json",
      "[]",
      "null",
      {},
      { code },
      { v: "short", code },
      { v: 42, code },
      { v: [v], code },
      { v },
      { v, code: "short" },
      { v, code: [code] },
      { v, pin: "12345" },
      { v, pin: 123456 },
      { v, pin: "12345a" },
      { v, code, padding: "x".repeat(5000) },
    ]) {
      expect(await redeem(body), JSON.stringify(body).slice(0, 60)).toEqual({ status: 400, body: { error: "invalid" } });
    }
  });

  it("refuses an account banned since the callback (403 banned), and drops its handoff", async () => {
    const who = person();
    const { c } = await signIn(who);
    const hash = await subHash(who.sub, env.SUB_PEPPER);
    await inRoom((room) => room.sql.exec("INSERT INTO subs (sub_hash, banned) VALUES (?, 1)", hash));
    expect(await redeem({ v: who.v, code: c })).toEqual({ status: 403, body: { error: "banned" } });
    expect(await handoffByCode(c)).toBeNull();
  });
});

// ---- Signup --------------------------------------------------------------------------------------------------

describe("POST /auth/signup", () => {
  it("makes the account after the tick, keeping only the hash of the LINE account and not the LINE name", async () => {
    const who = person();
    const { c } = await signIn(who);
    expect((await redeem({ v: who.v, code: c })).body.needs_signup).toBe(true);
    const before = Date.now();
    const res = await signup({ v: who.v, code: c, nick: "阿凱", consent: "v1" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["token"]);
    const user = await userBySub(who.sub);
    expect(user).toMatchObject({
      sub_hash: await subHash(who.sub, env.SUB_PEPPER),
      nick: "阿凱",
      nick_key: checkNick("阿凱").key,
      role: "user",
      tv: 0,
      consent_ver: "v1",
    });
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (const key of ["created", "last_seen", "consent_at"]) {
      expect(user[key], key).toBeGreaterThanOrEqual(before);
      expect(user[key], key).toBeLessThanOrEqual(Date.now());
    }
    expect((await readToken(res.body.token, env.SESSION_SECRET, Date.now())).uid).toBe(user.id);
    expect(await handoffByCode(c)).toBeNull();
    // Nothing in any table holds LINE's raw sub or the LINE name any more.
    const values = await everyValue();
    expect(values.filter((value) => value.includes(who.sub))).toEqual([]);
    expect(values.filter((value) => value.includes(who.name))).toEqual([]);
    // The LINE account's own row, which outlives the account.
    const hash = user.sub_hash;
    expect(await inRoom((room) => rows(room, "SELECT * FROM subs WHERE sub_hash = ?", hash))).toEqual([{ sub_hash: hash, banned: 0, deleted_at: null }]);
  });

  it("refuses without consent \"v1\" (400 consent), and keeps the handoff", async () => {
    const who = person();
    const { c } = await signIn(who);
    for (const consent of [undefined, "", "v2", "V1", true, 1]) {
      expect(await signup({ v: who.v, code: c, nick: freshNick(), consent }), String(consent)).toEqual({ status: 400, body: { error: "consent" } });
    }
    expect(await userBySub(who.sub)).toBeNull();
    expect(await handoffByCode(c)).not.toBeNull();
  });

  it("refuses a nickname checkNick refuses, with checkNick's code, and keeps the handoff", async () => {
    const who = person();
    const { c } = await signIn(who);
    for (const [nick, code] of [["a", "length"], ["x".repeat(21), "length"], [undefined, "length"], ["Admin", "reserved"], ["ｂｒｙａｎ", "reserved"], ["a<b>", "chars"]]) {
      expect(await signup({ v: who.v, code: c, nick, consent: "v1" }), String(nick)).toEqual({ status: 400, body: { error: "nick", code } });
    }
    expect(await userBySub(who.sub)).toBeNull();
    expect(await handoffByCode(c)).not.toBeNull();
  });

  it("refuses a nickname someone has, in any case or look-alike form (400 nick, code taken)", async () => {
    const nick = freshNick("Mika");
    await member(nick);
    const who = person();
    const { c } = await signIn(who);
    for (const same of [nick, nick.toUpperCase(), ` ${nick} `]) {
      expect(await signup({ v: who.v, code: c, nick: same, consent: "v1" }), same).toEqual({ status: 400, body: { error: "nick", code: "taken" } });
    }
    expect(await userBySub(who.sub)).toBeNull();
  });

  it("signs a known user in instead of making a second account", async () => {
    const someone = await member();
    const { c } = await signIn(someone);
    const res = await signup({ v: someone.v, code: c, nick: freshNick(), consent: "v1" });
    expect(res.status).toBe(200);
    expect((await readToken(res.body.token, env.SESSION_SECRET, Date.now())).uid).toBe(someone.uid);
    const hash = await subHash(someone.sub, env.SUB_PEPPER);
    expect(await inRoom((room) => rows(room, "SELECT nick FROM users WHERE sub_hash = ?", hash))).toEqual([{ nick: someone.nick }]);
  });

  it("lets a LINE account that deleted its account sign up again, clearing the row's deleted_at but not a ban flag", async () => {
    const who = person();
    const hash = await subHash(who.sub, env.SUB_PEPPER);
    await inRoom((room) => room.sql.exec("INSERT INTO subs (sub_hash, banned, deleted_at) VALUES (?, 0, ?)", hash, Date.now() - DAY));
    const { c } = await signIn(who);
    expect((await signup({ v: who.v, code: c, nick: freshNick(), consent: "v1" })).status).toBe(200);
    expect(await inRoom((room) => rows(room, "SELECT banned, deleted_at FROM subs WHERE sub_hash = ?", hash))).toEqual([{ banned: 0, deleted_at: null }]);
  });

  it("refuses a code it never gave out, and a wrong v, like redeem", async () => {
    const who = person();
    const { c } = await signIn(who);
    expect(await signup({ v: who.v, code: randomB64u(16), nick: freshNick(), consent: "v1" })).toEqual({ status: 410, body: { error: "expired" } });
    expect(await signup({ v: randomB64u(32), code: c, nick: freshNick(), consent: "v1" })).toEqual({ status: 403, body: { error: "v" } });
    expect(await signup({ v: who.v, nick: freshNick(), consent: "v1" })).toEqual({ status: 400, body: { error: "invalid" } });
    expect(await userBySub(who.sub)).toBeNull();
  });
});

// ---- A stolen link, and the pin ------------------------------------------------------------------------------

describe("a sign-in link someone else started (spec Login step 5)", () => {
  // The attacker starts a sign-in with their own verifier vA and gets the victim to finish it with LINE. The code
  // and pin land in the victim's browser, bound to the attacker's h.
  async function stolen() {
    const attacker = person();
    const victim = person();
    const back = await signIn(victim, { h: await sha256b64u(attacker.v) });
    expect(back.c).toBeDefined();
    return { attacker, victim, ...back };
  }

  it("can't be redeemed with the victim's own v and the code: the hash doesn't match (403 v), and the handoff stays", async () => {
    const { victim, c } = await stolen();
    expect(await redeem({ v: victim.v, code: c })).toEqual({ status: 403, body: { error: "v" } });
    expect(await handoffByCode(c)).not.toBeNull();
    expect(await userBySub(victim.sub)).toBeNull();
  });

  it("gives the attacker three wrong pins, then voids the handoff, so even the right pin fails", async () => {
    const { attacker, c, p } = await stolen();
    for (let k = 1; k <= 3; k++) {
      expect(await redeem({ v: attacker.v, pin: otherPin(p, k) }), `wrong pin ${k}`).toEqual({ status: 403, body: { error: "pin" } });
    }
    expect(await redeem({ v: attacker.v, pin: p })).toEqual({ status: 410, body: { error: "expired" } });
    expect(await redeem({ v: attacker.v, code: c })).toEqual({ status: 410, body: { error: "expired" } });
    // Void means gone, and the victim's LINE name with it.
    expect(await handoffByCode(c)).toBeNull();
  });

  it("counts wrong pins sent to signup as well as to redeem", async () => {
    const { attacker, c, p } = await stolen();
    expect((await redeem({ v: attacker.v, pin: otherPin(p, 1) })).body).toEqual({ error: "pin" });
    expect((await signup({ v: attacker.v, pin: otherPin(p, 2), nick: freshNick(), consent: "v1" })).body).toEqual({ error: "pin" });
    expect((await redeem({ v: attacker.v, pin: otherPin(p, 3) })).body).toEqual({ error: "pin" });
    expect((await signup({ v: attacker.v, pin: p, nick: freshNick(), consent: "v1" })).body).toEqual({ error: "expired" });
    expect(await handoffByCode(c)).toBeNull();
  });

  it("gives three tries in all, even to guesses sent at the same moment", async () => {
    const { attacker, p } = await stolen();
    const guesses = await Promise.all(Array.from({ length: 12 }, (_, k) => redeem({ v: attacker.v, pin: otherPin(p, k + 1) })));
    const errors = guesses.map((g) => g.body.error).sort();
    expect(errors).toEqual([...Array(9).fill("expired"), ...Array(3).fill("pin")]);
  });
});

describe("the pin path (login finished in another browser)", () => {
  it("redeems {v, pin} with no code: needs_signup for a new account, then signup by pin gives a token", async () => {
    const who = person();
    const { c, p } = await signIn(who);
    expect(await redeem({ v: who.v, pin: p })).toEqual({ status: 200, body: { needs_signup: true, line_name: who.name } });
    const res = await signup({ v: who.v, pin: p, nick: freshNick(), consent: "v1" });
    expect(res.status).toBe(200);
    expect((await readToken(res.body.token, env.SESSION_SECRET, Date.now())).uid).toBe((await userBySub(who.sub)).id);
    expect(await handoffByCode(c)).toBeNull();
  });

  it("still takes the right pin after one or two wrong ones", async () => {
    const who = person();
    const { p } = await signIn(who);
    expect((await redeem({ v: who.v, pin: otherPin(p) })).body).toEqual({ error: "pin" });
    expect((await redeem({ v: who.v, pin: otherPin(p, 2) })).body).toEqual({ error: "pin" });
    expect((await redeem({ v: who.v, pin: p })).body).toEqual({ needs_signup: true, line_name: who.name });
    // The right pin used no try: signup by pin still works.
    expect((await signup({ v: who.v, pin: p, nick: freshNick(), consent: "v1" })).status).toBe(200);
  });

  it("signs a known user straight in by pin, and deletes the handoff", async () => {
    const someone = await member();
    const { c, p } = await signIn(someone);
    const res = await redeem({ v: someone.v, pin: p });
    expect(res.status).toBe(200);
    expect((await readToken(res.body.token, env.SESSION_SECRET, Date.now())).uid).toBe(someone.uid);
    expect(await handoffByCode(c)).toBeNull();
  });

  it("finds nothing for a v that started no sign-in (410 expired), and nothing after 10 minutes", async () => {
    expect(await redeem({ v: randomB64u(32), pin: "123456" })).toEqual({ status: 410, body: { error: "expired" } });
    const who = person();
    const { c, p } = await signIn(who);
    const hash = await sha256b64u(c);
    await inRoom((room) => room.sql.exec("UPDATE handoffs SET created = created - ? WHERE code_hash = ?", 10 * MIN, hash));
    expect(await redeem({ v: who.v, pin: p })).toEqual({ status: 410, body: { error: "expired" } });
  });
});

// ---- userFromToken and closeUser -----------------------------------------------------------------------------

describe("Room.userFromToken(token)", () => {
  it("gives the user's account row for a good token, with what canWrite needs", async () => {
    const someone = await member();
    const user = await inRoom((room) => room.userFromToken(someone.token));
    expect(user).toEqual({
      id: someone.uid,
      nick: someone.nick,
      nick_key: checkNick(someone.nick).key,
      role: "user",
      tv: 0,
      created: expect.any(Number),
      nick_changed: null,
      sub_hash: await subHash(someone.sub, env.SUB_PEPPER),
      banned: false,
    });
  });

  it("gives null once tv has moved on (signed out everywhere)", async () => {
    const someone = await member();
    await inRoom((room) => room.sql.exec("UPDATE users SET tv = tv + 1 WHERE id = ?", someone.uid));
    expect(await inRoom((room) => room.userFromToken(someone.token))).toBeNull();
  });

  it("gives null for a banned LINE account", async () => {
    const someone = await member();
    const hash = await subHash(someone.sub, env.SUB_PEPPER);
    await inRoom((room) => room.sql.exec("UPDATE subs SET banned = 1 WHERE sub_hash = ?", hash));
    expect(await inRoom((room) => room.userFromToken(someone.token))).toBeNull();
  });

  it("gives null when the user is gone", async () => {
    const someone = await member();
    await inRoom((room) => room.sql.exec("DELETE FROM users WHERE id = ?", someone.uid));
    expect(await inRoom((room) => room.userFromToken(someone.token))).toBeNull();
  });

  it("gives null for a token that isn't ours, has expired, or isn't a token", async () => {
    const someone = await member();
    const forged = await signToken({ uid: someone.uid, tv: 0, exp: Date.now() + DAY }, "another-secret");
    const expired = await signToken({ uid: someone.uid, tv: 0, exp: Date.now() - 1 }, env.SESSION_SECRET);
    for (const token of [forged, expired, "", "x.y", undefined, null, 42]) {
      expect(await inRoom((room) => room.userFromToken(token)), String(token)).toBeNull();
    }
  });
});

describe("Room.closeUser(uid, code)", () => {
  it("closes every socket whose attachment has that uid, with the code given, and no other", async () => {
    const stub = env.ROOM.getByName(`login-${crypto.randomUUID()}`, { locationHint: "apac-ne" });
    const closed = await runInDurableObject(stub, async (room, state) => {
      const closes = [];
      const open = (attachment, name) => {
        const [client, server] = Object.values(new WebSocketPair());
        state.acceptWebSocket(server);
        if (attachment !== undefined) server.serializeAttachment(attachment);
        client.accept();
        client.addEventListener("close", (e) => {
          closes.push([name, e.code]);
        });
        return client;
      };
      const sockets = [
        open({ uid: "u-a", role: "user", v: 1 }, "a1"),
        open({ uid: "u-a", role: "user", v: 1 }, "a2"),
        open({ uid: "u-b", role: "user", v: 1 }, "b"),
        open(undefined, "reader"),
      ];
      room.closeUser("u-a", 4001);
      await new Promise((resolve) => setTimeout(resolve, 20));
      for (const ws of sockets) ws.close(1000, "done");
      return closes.sort();
    });
    expect(closed.filter(([, code]) => code === 4001)).toEqual([["a1", 4001], ["a2", 4001]]);
  });
});

// ---- The handoff's 10 minutes -------------------------------------------------------------------------------

describe("a handoff, with its LINE name, lasts its 10 minutes and no longer", () => {
  // A weekday at 12:00 UTC, years ahead, so the daily retention (19:00 UTC) is 7 hours away.
  const T = Date.UTC(2030, 5, 3, 12, 0);
  const handoff = (room, h) =>
    room.fetch(new Request("https://room/r/handoffs", { method: "POST", body: JSON.stringify({ h, sub: `U${hex(16)}`, line_name: "Kai" }) }));

  it("brings the alarm forward to just after the handoff runs out, and the alarm deletes it", async () => {
    const stub = env.ROOM.getByName(`login-${crypto.randomUUID()}`, { locationHint: "apac-ne" });
    await runInDurableObject(stub, async (room, state) => {
      room.now = () => T;
      expect((await handoff(room, await sha256b64u("a"))).status).toBe(200);
      const due = await state.storage.getAlarm();
      expect(due).toBeGreaterThanOrEqual(T + 10 * MIN);
      expect(due).toBeLessThanOrEqual(T + 10 * MIN + 2000);
      room.now = () => due;
      await room.alarm();
      expect(rows(room, "SELECT * FROM handoffs")).toEqual([]);
      // Nothing left to wait for: back to the daily run at 19:00 UTC.
      expect(await state.storage.getAlarm()).toBe(T + 7 * HOUR);
    });
  });

  it("comes back for a later handoff after deleting an earlier one", async () => {
    const stub = env.ROOM.getByName(`login-${crypto.randomUUID()}`, { locationHint: "apac-ne" });
    await runInDurableObject(stub, async (room, state) => {
      room.now = () => T;
      await handoff(room, await sha256b64u("a"));
      room.now = () => T + 5 * MIN;
      await handoff(room, await sha256b64u("b"));
      const first = await state.storage.getAlarm();
      expect(first).toBeLessThanOrEqual(T + 10 * MIN + 2000);
      room.now = () => first;
      await room.alarm();
      expect(rows(room, "SELECT h FROM handoffs")).toEqual([{ h: await sha256b64u("b") }]);
      const second = await state.storage.getAlarm();
      expect(second).toBeGreaterThanOrEqual(T + 15 * MIN);
      expect(second).toBeLessThanOrEqual(T + 15 * MIN + 2000);
    });
  });

  it("drops an expired handoff and comes back for the next one even when the 19:00 run fails", async () => {
    // The first handoff's own alarm came late, at the daily run (alarms can), and that run fails.
    const T19 = Date.UTC(2030, 5, 3, 19, 0);
    const stub = env.ROOM.getByName(`login-${crypto.randomUUID()}`, { locationHint: "apac-ne" });
    await runInDurableObject(stub, async (room, state) => {
      room.now = () => T19 - 12 * MIN;
      await handoff(room, await sha256b64u("old"));
      room.now = () => T19 - 5 * MIN;
      await handoff(room, await sha256b64u("new"));
      room.retention = () => {
        throw new Error("retention failed");
      };
      room.now = () => T19;
      await expect(room.alarm()).rejects.toThrow("retention failed");
      expect(rows(room, "SELECT h FROM handoffs")).toEqual([{ h: await sha256b64u("new") }]);
      // Not tomorrow's run: just after the second handoff runs out.
      const next = await state.storage.getAlarm();
      expect(next).toBeGreaterThanOrEqual(T19 + 5 * MIN);
      expect(next).toBeLessThanOrEqual(T19 + 5 * MIN + 2000);
    });
  });
});

// ---- When the room can't answer --------------------------------------------------------------------------------

describe("the sign-in routes when the room can't answer", () => {
  const dead = {
    APP_URL: env.APP_URL,
    LINE_AUTH_URL: env.LINE_AUTH_URL,
    LINE_TOKEN_URL: env.LINE_TOKEN_URL,
    LINE_CHANNEL_ID: env.LINE_CHANNEL_ID,
    LINE_CHANNEL_SECRET: env.LINE_CHANNEL_SECRET,
    ROOM: {
      getByName() {
        return {
          fetch() {
            throw new Error("room down");
          },
        };
      },
    },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  it("send the browser back to the app with #e=resting, from start and from the callback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const path of [`/auth/line/start?h=${await sha256b64u("x")}`, "/auth/line/callback?code=c&state=s"]) {
      const res = await worker.fetch(new Request(BASE + path), dead, ctx);
      expect(res.status, path).toBe(302);
      expect(res.headers.get("Location"), path).toBe(`${env.APP_URL}?chat#e=resting`);
      expect(res.headers.get("Cache-Control"), path).toBe("no-store");
    }
  });

  it("send it back with #e=resting too when the room answers {resting: true}, at each of its three steps", async () => {
    const who = person();
    const nonce = randomB64u(32);
    mockLine(async () => Response.json({ id_token: await idToken(goodClaims(who, nonce)) }));
    // What the room answers at each step when it isn't resting.
    const steps = {
      "/r/logins": () => Response.json({ state: "s", nonce, code_challenge: "c" }),
      "/r/logins/take": () => Response.json({ nonce, pkce_verifier: "pv", h: "h" }),
      "/r/handoffs": () => Response.json({ code: "c", pin: "123456" }),
    };
    const start = `/auth/line/start?h=${await sha256b64u("x")}`;
    const callback = "/auth/line/callback?code=c&state=s";
    for (const [restingAt, path] of [["/r/logins", start], ["/r/logins/take", callback], ["/r/handoffs", callback]]) {
      const ROOM = {
        getByName: () => ({
          async fetch(request) {
            const at = new URL(request.url).pathname;
            return at === restingAt ? Response.json({ resting: true }, { status: 503 }) : steps[at]();
          },
        }),
      };
      const res = await worker.fetch(new Request(BASE + path), { ...dead, ROOM }, ctx);
      expect(res.status, restingAt).toBe(302);
      expect(res.headers.get("Location"), restingAt).toBe(`${env.APP_URL}?chat#e=resting`);
    }
  });
});
