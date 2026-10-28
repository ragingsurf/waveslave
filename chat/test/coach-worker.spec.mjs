// Tests for the coach's routes in chat/src/index.js, the front Worker (AI coach spec, "Backend", the route table): the
// sign-in checked through the room's whoIs, the admin paths, the body caps, the hand-over to Coach.route() over RPC
// (ruling R2), CORS, no-store and 503 {error: "break"} when the room or the coach fails. They run inside the Workers
// runtime (see vitest.config.mjs). Run from chat/: npx vitest run test/coach-worker.spec.mjs
//
// The room and the coach are plain objects standing in for their stubs ({whoIs} and {route}), passed as env to the
// Worker's own fetch(), so a test sees exactly what each was asked. worker.spec.mjs covers the chat's own routes.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { FRAME_TEXT_MAX } from "../src/coach-rules.js";
import { COACH_NAME, HINT } from "../src/stubs.js";

const ORIGIN = "https://waveslave.tw";
const EVIL = "https://evil.example";
const BASE = "https://chat.example";
// A session token as the app sends it. It must never reach the coach or a log.
const TOKEN = "token-secret-123.sig-secret-456";
// A review id: 22 characters of base64url.
const ID = "Ab-_0123456789xyzXYZab";
// Who the room says is calling.
const USER = Object.freeze({ uid: "u-1", sub_hash: "sub-1", role: "user" });
const ADMIN = Object.freeze({ uid: "u-0", sub_hash: "sub-0", role: "admin" });

const header = (res, name) => res.headers.get(name);

// Stand-ins for the room and the coach. The room's whoIs answers `who` (or who(token)); the coach's route answers
// answer(args). Every stub made and every call is recorded in `seen`.
function fakes({ who = USER, answer = () => ({ status: 200, json: { ok: true } }) } = {}) {
  const seen = { stubs: [], whoIs: [], route: [] };
  const ROOM = {
    getByName(name, options) {
      seen.stubs.push({ ns: "ROOM", name, options });
      return {
        async whoIs(token) {
          seen.whoIs.push(token);
          return typeof who === "function" ? who(token) : who;
        },
      };
    },
  };
  const COACH = {
    getByName(name, options) {
      seen.stubs.push({ ns: "COACH", name, options });
      return {
        async route(args) {
          seen.route.push(structuredClone(args));
          return answer(args);
        },
      };
    },
  };
  return { seen, env: { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS, ROOM, COACH } };
}

const ctx = { waitUntil() {}, passThroughOnException() {} };

// The app's request: from ORIGIN with the token, unless told otherwise.
function call(fake, path, { method = "GET", token = TOKEN, origin = ORIGIN, body, headers = {} } = {}) {
  const request = new Request(BASE + path, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
  });
  return worker.fetch(request, fake.env, ctx);
}

// Every route, with who may use it.
const ROUTES = [
  ["GET", "/coach/me", USER],
  ["POST", "/coach/agree", USER],
  ["POST", "/coach/reviews", USER],
  ["GET", `/coach/reviews/${ID}`, USER],
  ["DELETE", `/coach/reviews/${ID}`, USER],
  ["GET", `/coach/reviews/${ID}/frames/1`, USER],
  ["POST", `/coach/reviews/${ID}/frames/12`, USER],
  ["POST", `/coach/reviews/${ID}/send`, USER],
  ["POST", `/coach/reviews/${ID}/report`, USER],
  ["GET", "/admin/coach/drafts", ADMIN],
  ["POST", `/admin/coach/drafts/${ID}`, ADMIN],
  ["POST", "/admin/coach/settings", ADMIN],
];
const ADMIN_ROUTES = ROUTES.filter(([, path]) => path.startsWith("/admin/"));

// The Worker never fetches anything itself on a coach route: every fetch throws, the AI's and the mail's included, and
// each test checks that none was tried.
let fetched;
beforeEach(() => {
  fetched = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const { url } = new Request(input, init);
    fetched.push(url);
    throw new Error(`unexpected fetch of ${url}`);
  });
});

afterEach(() => {
  expect(fetched).toEqual([]);
  vi.restoreAllMocks();
});

// ---- Reaching the coach --------------------------------------------------------------------------------------

describe("each coach route", () => {
  for (const [method, path, who] of ROUTES) {
    it(`hands ${method} ${path} to the coach with who the room says, and never the token`, async () => {
      const fake = fakes({ who });
      const body = method === "POST" ? JSON.stringify({ n: 3, note: "a line" }) : undefined;
      const res = await call(fake, path, { method, body, headers: body ? { "Content-Type": "application/json" } : {} });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(header(res, "Content-Type")).toMatch(/^application\/json/);
      expect(header(res, "Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(header(res, "Vary")).toMatch(/\bOrigin\b/i);
      expect(header(res, "Cache-Control")).toBe("no-store");
      expect(fake.seen.whoIs).toEqual([TOKEN]);
      expect(fake.seen.route).toEqual([{ method, path, who, body: body ?? "" }]);
      expect(JSON.stringify(fake.seen.route)).not.toContain("secret");
    });
  }

  it("makes each stub by its name, with the location hint", async () => {
    const fake = fakes();
    await call(fake, "/coach/me");
    expect(fake.seen.stubs).toEqual([
      { ns: "ROOM", name: "taiwan", options: HINT },
      { ns: "COACH", name: COACH_NAME, options: HINT },
    ]);
  });

  it("passes on only uid, sub_hash and role, and the path without its query", async () => {
    const fake = fakes({ who: { ...USER, nick: "阿凱", token: TOKEN } });
    await call(fake, "/coach/me?uid=u-9&role=admin");
    expect(fake.seen.route).toEqual([{ method: "GET", path: "/coach/me", who: USER, body: "" }]);
  });

  it("hands the coach's answer back as it is", async () => {
    const fake = fakes({ answer: () => ({ status: 409, json: { error: "in_progress" } }) });
    const res = await call(fake, "/coach/reviews", { method: "POST", body: "{}" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "in_progress" });
    expect(header(res, "Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("answers a key frame as image/jpeg, with its bytes as they are", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x00, 0xff, 0xd9]);
    const fake = fakes({ answer: () => ({ status: 200, jpeg }) });
    const res = await call(fake, `/coach/reviews/${ID}/frames/7`);
    expect(res.status).toBe(200);
    expect(header(res, "Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpeg);
    expect(header(res, "Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(header(res, "Cache-Control")).toBe("no-store");
  });

  it("takes a request with no Origin at all (not from a page) the way the chat's own routes do", async () => {
    const fake = fakes();
    const res = await call(fake, "/coach/me", { origin: null });
    expect(res.status).toBe(200);
    expect(header(res, "Access-Control-Allow-Origin")).toBeNull();
    expect(fake.seen.route.length).toBe(1);
  });
});

describe("key frames", () => {
  it("are reached with GET and with POST, for frames 1 to 12", async () => {
    for (let n = 1; n <= 12; n++) {
      for (const method of ["GET", "POST"]) {
        const fake = fakes();
        const path = `/coach/reviews/${ID}/frames/${n}`;
        const res = await call(fake, path, { method, ...(method === "POST" ? { body: "/9j/" } : {}) });
        expect(res.status, `${method} ${n}`).toBe(200);
        const body = method === "POST" ? "/9j/" : "";
        expect(fake.seen.route, `${method} ${n}`).toEqual([{ method, path, who: USER, body }]);
      }
    }
  });

  it("answer 405 to DELETE, with Allow", async () => {
    const fake = fakes();
    const res = await call(fake, `/coach/reviews/${ID}/frames/3`, { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(header(res, "Allow")).toBe("GET, POST, OPTIONS");
    expect(fake.seen.whoIs).toEqual([]);
  });
});

// ---- Sign-in -------------------------------------------------------------------------------------------------

describe("the sign-in", () => {
  it("is needed: no token is 401 {error: 'auth'}, and the room and the coach are never asked", async () => {
    const without = [{}, { Authorization: "Basic dXNlcjpwYXNz" }, { Authorization: "Bearer " }, { Authorization: TOKEN }];
    for (const headers of without) {
      const fake = fakes();
      const res = await call(fake, "/coach/me", { token: null, headers });
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(await res.json()).toEqual({ error: "auth" });
      expect(header(res, "Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(header(res, "Cache-Control")).toBe("no-store");
      expect(fake.seen.whoIs).toEqual([]);
      expect(fake.seen.route).toEqual([]);
    }
  });

  it("is refused as the room's whoIs says: auth 401, banned 403, resting 503 break", async () => {
    for (const [error, status, code] of [["auth", 401, "auth"], ["banned", 403, "banned"], ["resting", 503, "break"]]) {
      const fake = fakes({ who: { error } });
      const res = await call(fake, "/coach/reviews", { method: "POST", body: "{}" });
      expect(res.status, error).toBe(status);
      expect(await res.json(), error).toEqual({ error: code });
      expect(header(res, "Cache-Control"), error).toBe("no-store");
      expect(fake.seen.whoIs, error).toEqual([TOKEN]);
      expect(fake.seen.route, error).toEqual([]);
    }
  });
});

describe("the admin paths", () => {
  it("answer 403 {error: 'admin'} to anyone but the admin, and never reach the coach", async () => {
    for (const [method, path] of ADMIN_ROUTES) {
      const fake = fakes({ who: USER });
      const res = await call(fake, path, { method, ...(method === "POST" ? { body: '{"action":"approve"}' } : {}) });
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toEqual({ error: "admin" });
      expect(header(res, "Cache-Control"), path).toBe("no-store");
      expect(fake.seen.route, path).toEqual([]);
    }
  });

  it("let the admin use the surfer's routes too", async () => {
    const fake = fakes({ who: ADMIN });
    const res = await call(fake, `/coach/reviews/${ID}`);
    expect(res.status).toBe(200);
    expect(fake.seen.route).toEqual([{ method: "GET", path: `/coach/reviews/${ID}`, who: ADMIN, body: "" }]);
  });
});

// ---- Body caps -----------------------------------------------------------------------------------------------

describe("the body caps", () => {
  const FRAME = `/coach/reviews/${ID}/frames/4`;
  const DRAFT = `/admin/coach/drafts/${ID}`;

  // [path, who, the most bytes it takes]
  const CAPS = [
    [FRAME, USER, FRAME_TEXT_MAX],
    [DRAFT, ADMIN, 65_536],
    ["/coach/agree", USER, 16_384],
    ["/coach/reviews", USER, 16_384],
    [`/coach/reviews/${ID}/send`, USER, 16_384],
    [`/coach/reviews/${ID}/report`, USER, 16_384],
    ["/admin/coach/settings", ADMIN, 16_384],
  ];

  it("are 140 KB for a frame (143,360 bytes), 64 KB for Bryan's draft actions and 16 KB for the rest", () => {
    expect(FRAME_TEXT_MAX).toBe(143_360);
  });

  for (const [path, who, max] of CAPS) {
    it(`let ${max} bytes through to the coach on ${path}, and answer one more with 413 too_big`, async () => {
      const fits = fakes({ who });
      const body = "A".repeat(max);
      expect((await call(fits, path, { method: "POST", body })).status).toBe(200);
      expect(fits.seen.route.length).toBe(1);
      expect(fits.seen.route[0].body).toBe(body);

      const over = fakes({ who });
      const res = await call(over, path, { method: "POST", body: "A".repeat(max + 1) });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: "too_big" });
      expect(header(res, "Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(header(res, "Cache-Control")).toBe("no-store");
      expect(over.seen.route).toEqual([]);
    });
  }

  it("refuse a frame of 143,361 bytes without the coach ever hearing of it", async () => {
    const fake = fakes();
    const res = await call(fake, FRAME, { method: "POST", body: "/9j/" + "A".repeat(143_357) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_big" });
    expect(fake.seen.route).toEqual([]);
    expect(fake.seen.stubs.map((s) => s.ns)).toEqual(["ROOM"]);
  });

  it("count the bytes that come, in pieces and with no length given, not what Content-Length says", async () => {
    const piece = new TextEncoder().encode("A".repeat(16_000));
    const pieces = (n) =>
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < n; i++) controller.enqueue(piece);
          controller.close();
        },
      });
    // 9 pieces are 144,000 bytes: over a frame's cap.
    const over = fakes();
    expect((await call(over, FRAME, { method: "POST", body: pieces(9) })).status).toBe(413);
    expect(over.seen.route).toEqual([]);
    // 8 are 128,000 bytes: under it, and they reach the coach whole.
    const fits = fakes();
    expect((await call(fits, FRAME, { method: "POST", body: pieces(8) })).status).toBe(200);
    expect(fits.seen.route[0].body).toBe("A".repeat(128_000));
    // A Content-Length that says less changes nothing.
    const lies = fakes();
    const request = new Request(`${BASE}/coach/reviews`, {
      method: "POST",
      headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, "Content-Length": "2" },
      body: "A".repeat(16_385),
    });
    expect(request.headers.get("Content-Length")).toBe("2");
    const res = await worker.fetch(request, lies.env, ctx);
    expect(res.status).toBe(413);
    expect(lies.seen.route).toEqual([]);
  });

  it("stop reading at the first piece past the cap, so a body that never ends is still answered", async () => {
    const piece = new TextEncoder().encode("A".repeat(16_000));
    let pulled = 0;
    const endless = new ReadableStream({
      pull(controller) {
        pulled += 1;
        controller.enqueue(piece);
      },
    });
    const fake = fakes();
    const res = await call(fake, `/coach/reviews/${ID}/frames/9`, { method: "POST", body: endless });
    expect(res.status).toBe(413);
    expect(fake.seen.route).toEqual([]);
    // 9 pieces are the first past 143,360 bytes; the stream may have been asked for a piece or two ahead.
    expect(pulled).toBeGreaterThanOrEqual(9);
    expect(pulled).toBeLessThan(12);
  });

  it("count bytes, not characters", async () => {
    // 5,471 characters, but 16,391 bytes in UTF-8: each 中文 character is 3.
    const fake = fakes();
    const body = JSON.stringify({ note: "浪".repeat(5_460) });
    const res = await call(fake, "/coach/reviews", { method: "POST", body });
    expect(res.status).toBe(413);
    expect(fake.seen.route).toEqual([]);
  });

  it("let Bryan's approval with nine 1,000-character 中文 edits through, written either way", async () => {
    const FIELDS = ["went_well.title", "went_well.detail", "main_fix.title", "main_fix.what", "main_fix.why", "drill.title",
      "drill.how", "heads_up.text", "progress"];
    const edits = Object.fromEntries(FIELDS.map((field) => [field, "浪".repeat(1_000)]));
    const plain = JSON.stringify({ action: "approve", edits });
    // The same JSON with every 中文 character written as \uXXXX, its longest form: 6 bytes each, about 54 KB.
    const escaped = plain.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
    expect(new TextEncoder().encode(plain).length).toBeGreaterThan(16_384);
    expect(escaped.length).toBeGreaterThan(54_000);
    for (const body of [plain, escaped]) {
      const fake = fakes({ who: ADMIN });
      const res = await call(fake, DRAFT, { method: "POST", body, headers: { "Content-Type": "application/json" } });
      expect(res.status).toBe(200);
      expect(fake.seen.route).toEqual([{ method: "POST", path: DRAFT, who: ADMIN, body }]);
      expect(JSON.parse(fake.seen.route[0].body)).toEqual({ action: "approve", edits });
    }
  });
});

// ---- Failures ------------------------------------------------------------------------------------------------

describe("when the room or the coach fails", () => {
  const secret = () => new Error(`down: secret-detail-123 ${TOKEN}`);
  const stub = (method, fn) => ({ getByName: () => ({ [method]: fn }) });
  const FAILURES = {
    "the room's whoIs rejects": { ROOM: stub("whoIs", async () => { throw secret(); }) },
    "the room's whoIs throws at once": { ROOM: stub("whoIs", () => { throw secret(); }) },
    "the room can't be reached": { ROOM: { getByName: () => { throw secret(); } } },
    "the coach's route rejects": { COACH: stub("route", async () => { throw secret(); }) },
    "the coach's route throws at once": {
      COACH: stub("route", () => {
        throw new TypeError(`bad: secret-detail-123 ${TOKEN}`);
      }),
    },
    "the coach can't be reached": { COACH: { getByName: () => { throw secret(); } } },
    "the coach answers nothing": { COACH: stub("route", async () => undefined) },
  };

  for (const [how, broken] of Object.entries(FAILURES)) {
    it(`answers 503 {error: 'break'} when ${how}, and logs only the error's name`, async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const fake = fakes();
      Object.assign(fake.env, broken);
      const res = await call(fake, "/coach/reviews", { method: "POST", body: JSON.stringify({ move: "top_turn" }) });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "break" });
      expect(header(res, "Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(header(res, "Cache-Control")).toBe("no-store");
      expect(logged).toHaveBeenCalledTimes(1);
      const [line, ...rest] = logged.mock.calls[0];
      expect(line).toMatch(/^coach: /);
      expect(rest).toEqual([expect.stringMatching(/^(Error|TypeError)$/)]);
      const text = JSON.stringify(logged.mock.calls);
      expect(text).not.toContain("secret");
      expect(text).not.toContain("top_turn");
    });
  }
});

// ---- CORS, methods, paths and caching ------------------------------------------------------------------------

describe("CORS on the coach's routes", () => {
  it("answers OPTIONS /coach/reviews from the app's origin with 204, and never asks the room", async () => {
    const fake = fakes();
    const res = await call(fake, "/coach/reviews", { method: "OPTIONS", token: null });
    expect(res.status).toBe(204);
    expect(header(res, "Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(header(res, "Access-Control-Allow-Methods")).toBe("GET, POST, DELETE");
    expect(header(res, "Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
    expect(header(res, "Vary")).toMatch(/\bOrigin\b/i);
    expect(header(res, "Cache-Control")).toBe("no-store");
    expect(fake.seen.stubs).toEqual([]);
  });

  it("answers OPTIONS from another origin with 403", async () => {
    const fake = fakes();
    const res = await call(fake, "/coach/reviews", { method: "OPTIONS", token: null, origin: EVIL });
    expect(res.status).toBe(403);
    expect(header(res, "Access-Control-Allow-Origin")).toBeNull();
    expect(header(res, "Vary")).toMatch(/\bOrigin\b/i);
    expect(fake.seen.stubs).toEqual([]);
  });

  it("refuses a request from another origin before the room or the coach hears of it, token or not", async () => {
    const fake = fakes({ who: ADMIN });
    for (const [method, path] of ROUTES) {
      const post = method === "POST" ? { body: "{}", headers: { "Content-Type": "text/plain" } } : {};
      const res = await call(fake, path, { method, origin: EVIL, ...post });
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toEqual({ error: "origin" });
      expect(header(res, "Access-Control-Allow-Origin"), path).toBeNull();
    }
    expect(fake.seen.stubs).toEqual([]);
  });
});

describe("methods and paths", () => {
  it("answers 405 to a method a route doesn't take, with Allow, and never asks the room", async () => {
    const fake = fakes();
    const cases = [
      ["PUT", "/coach/me", "GET, OPTIONS"],
      ["POST", "/coach/me", "GET, OPTIONS"],
      ["GET", "/coach/agree", "POST, OPTIONS"],
      ["GET", "/coach/reviews", "POST, OPTIONS"],
      ["POST", `/coach/reviews/${ID}`, "GET, DELETE, OPTIONS"],
      ["PATCH", `/coach/reviews/${ID}`, "GET, DELETE, OPTIONS"],
      ["GET", `/coach/reviews/${ID}/send`, "POST, OPTIONS"],
      ["DELETE", `/coach/reviews/${ID}/report`, "POST, OPTIONS"],
      ["POST", "/admin/coach/drafts", "GET, OPTIONS"],
      ["GET", `/admin/coach/drafts/${ID}`, "POST, OPTIONS"],
      ["GET", "/admin/coach/settings", "POST, OPTIONS"],
    ];
    for (const [method, path, allow] of cases) {
      const res = await call(fake, path, { method });
      expect(res.status, `${method} ${path}`).toBe(405);
      expect(header(res, "Allow"), `${method} ${path}`).toBe(allow);
      expect(header(res, "Cache-Control"), `${method} ${path}`).toBe("no-store");
    }
    expect(fake.seen.stubs).toEqual([]);
  });

  it("answers 404 to a path that is no route, and never asks the room", async () => {
    const fake = fakes();
    const paths = [
      "/coach",
      "/coach/",
      "/coach/me/",
      "/coach/reviews/",
      "/coach/reviews/short",
      `/coach/reviews/${ID}x`,
      `/coach/reviews/${ID.slice(1)}`,
      `/coach/reviews/${ID.replace("-", "+")}`,
      `/coach/reviews/${ID}/`,
      `/coach/reviews/${ID}/frames`,
      `/coach/reviews/${ID}/frames/0`,
      `/coach/reviews/${ID}/frames/13`,
      `/coach/reviews/${ID}/frames/01`,
      `/coach/reviews/${ID}/frames/1/x`,
      `/coach/reviews/${ID}/nothing`,
      "/admin/coach",
      "/admin/coach/drafts/short",
      `/admin/coach/drafts/${ID}/x`,
      "/Coach/me",
    ];
    for (const path of paths) {
      const res = await call(fake, path);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not found" });
      expect(header(res, "Access-Control-Allow-Origin"), path).toBeNull();
    }
    expect(fake.seen.stubs).toEqual([]);
  });
});

describe("Cache-Control: no-store", () => {
  it("is on every coach answer, whoever made it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const asks = [
      [fakes(), "GET", "/coach/me"],
      [fakes({ answer: () => ({ status: 200, jpeg: new Uint8Array([0xff, 0xd8]) }) }), "GET", `/coach/reviews/${ID}/frames/2`],
      [fakes({ answer: () => ({ status: 404, json: { error: "not_found" } }) }), "DELETE", `/coach/reviews/${ID}`],
      [fakes({ answer: () => ({ status: 429, json: { error: "full_today" } }) }), "POST", "/coach/reviews"],
      [fakes({ who: { error: "auth" } }), "GET", "/coach/me"],
      [fakes({ who: { error: "banned" } }), "GET", "/coach/me"],
      [fakes({ who: { error: "resting" } }), "GET", "/coach/me"],
      [fakes({ who: () => { throw new Error("x"); } }), "GET", "/coach/me"],
      [fakes({ who: USER }), "GET", "/admin/coach/drafts"],
      [fakes(), "POST", "/coach/agree", "A".repeat(16_385)],
      [fakes(), "PUT", "/coach/me"],
      [fakes(), "OPTIONS", "/coach/me"],
      [fakes(), "GET", "/coach/reviews/short"],
      [fakes(), "GET", "/coach"],
      [fakes(), "GET", "/admin/coach/nothing"],
    ];
    for (const [fake, method, path, body] of asks) {
      for (const origin of [ORIGIN, EVIL, null]) {
        const res = await call(fake, path, { method, origin, ...(body ? { body } : {}) });
        expect(header(res, "Cache-Control"), `${method} ${path} from ${origin} (${res.status})`).toBe("no-store");
      }
    }
  });

  it("is not on a /coach lookalike", async () => {
    for (const path of ["/coaching", "/coach-me", "/coaches/me"]) {
      const res = await call(fakes(), path);
      expect(res.status, path).toBe(404);
      expect(header(res, "Cache-Control"), path).toBeNull();
    }
  });
});
