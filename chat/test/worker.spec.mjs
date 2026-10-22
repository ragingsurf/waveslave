// Tests for chat/src/index.js, the front Worker: the public routes, CORS and origin checks, no-store, and the
// "resting" answer when the room fails. They run inside the Workers runtime (see vitest.config.mjs). Run from
// chat/: npx vitest run test/worker.spec.mjs
//
// The file is .spec.mjs, not .test.mjs, because it imports "cloudflare:test": see the note in vitest.config.mjs.
//
// Two ways of calling the Worker:
//   SELF.fetch(...)       the Worker exactly as wrangler.toml describes it, with the real room behind it.
//   call(fake, path, ...) the Worker's own fetch() with a stand-in for the room, to see what it sends the room and
//                         how it answers when the room misbehaves.
import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { SPOTS } from "../src/mod.js";

const ORIGIN = "https://waveslave.tw";
const EVIL = "https://evil.example";
const BASE = "https://chat.example";

const header = (res, name) => res.headers.get(name);

// A stand-in for the room that records every stub the Worker asks for and every request it sends, and answers
// with answer(request). Its env is the real one's vars with ROOM replaced (plus any overrides).
function fakeRoom(answer = () => Response.json({ ok: true }), overrides = {}) {
  const seen = { stubs: [], calls: [] };
  const ROOM = {
    getByName(name, options) {
      seen.stubs.push({ name, options });
      return {
        async fetch(request) {
          seen.calls.push({
            method: request.method,
            url: request.url,
            headers: Object.fromEntries(request.headers),
            body: await request.text(),
          });
          return answer(request);
        },
      };
    },
  };
  return { seen, env: { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS, ...overrides, ROOM } };
}

const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (fake, path, init = {}) => worker.fetch(new Request(BASE + path, init), fake.env, ctx);

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- /reports ---------------------------------------------------------------------------------------------

describe("GET /reports", () => {
  // The real room, "taiwan", gets one report on Jinshan. The rows are taken out again at the end, so no other
  // test file sees them.
  const taiwan = env.ROOM.getByName("taiwan", { locationHint: "apac-ne" });
  const T = Date.now() - 5 * 60_000;
  let id;

  beforeAll(async () => {
    id = await runInDurableObject(taiwan, (room) => {
      const added = room.sql
        .exec(
          `INSERT INTO messages (ts, uid, kind, spot, body) VALUES (?, NULL, 'report', 'jinshan', ?) RETURNING id`,
          T,
          JSON.stringify({ size: "chest", cond: "clean", crowd: "few", snap: { hs: 1.2 } }),
        )
        .one().id;
      room.messagesChanged("jinshan");
      return added;
    });
  });

  afterAll(async () => {
    await runInDurableObject(taiwan, (room) => {
      room.sql.exec("DELETE FROM messages WHERE id = ?", id);
      room.messagesChanged();
    });
  });

  it("answers 200 with open CORS and a one-minute cache", async () => {
    const res = await SELF.fetch(`${BASE}/reports?spot=jinshan`);
    expect(res.status).toBe(200);
    expect(header(res, "Access-Control-Allow-Origin")).toBe("*");
    expect(header(res, "Cache-Control")).toBe("public, max-age=60");
    expect(header(res, "Content-Type")).toMatch(/^application\/json/);
  });

  it("returns the room's {reports, online, last_id}, each report with only ts, size, cond and crowd", async () => {
    const res = await SELF.fetch(`${BASE}/reports?spot=jinshan`);
    expect(await res.json()).toEqual({
      reports: [{ ts: T, size: "chest", cond: "clean", crowd: "few" }],
      online: 0,
      last_id: id,
    });
  });

  it("answers for each of the 8 spots, and gives the other spots no reports", async () => {
    for (const spot of SPOTS) {
      const res = await SELF.fetch(`${BASE}/reports?spot=${spot}`);
      expect(res.status, spot).toBe(200);
      const { reports } = await res.json();
      expect(reports.length, spot).toBe(spot === "jinshan" ? 1 : 0);
    }
  });

  it("answers 400 to a spot that isn't one of the 8, with CORS and no cache", async () => {
    for (const query of ["?spot=pipeline", "?spot=", "?spot=JINSHAN", "?spot=jinshan%20", "?spot[]=jinshan", ""]) {
      const res = await SELF.fetch(`${BASE}/reports${query}`);
      expect(res.status, query).toBe(400);
      expect(header(res, "Access-Control-Allow-Origin"), query).toBe("*");
      expect(header(res, "Cache-Control"), query).toBe("no-store");
      expect(await res.json(), query).toEqual({ error: "spot" });
    }
  });

  it("checks the spot first: a bad one never reaches the room", async () => {
    const fake = fakeRoom();
    const res = await call(fake, "/reports?spot=pipeline");
    expect(res.status).toBe(400);
    expect(fake.seen.stubs).toEqual([]);
    expect(fake.seen.calls).toEqual([]);
  });

  it("has the room refuse a bad spot too, though the Worker never sends one", async () => {
    const res = await taiwan.fetch("https://room/r/reports?spot=pipeline");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "spot" });
  });

  it("answers 405 to any other method", async () => {
    for (const method of ["POST", "DELETE", "HEAD"]) {
      const res = await SELF.fetch(`${BASE}/reports?spot=jinshan`, { method });
      expect(res.status, method).toBe(405);
      expect(header(res, "Allow"), method).toBe("GET");
    }
  });

  it("does not cache what isn't a 200", async () => {
    const fake = fakeRoom(() => Response.json({ error: "busy" }, { status: 429 }));
    const res = await call(fake, "/reports?spot=jinshan");
    expect(res.status).toBe(429);
    expect(header(res, "Access-Control-Allow-Origin")).toBe("*");
    expect(header(res, "Cache-Control")).toBe("no-store");
  });
});

// ---- Origins -----------------------------------------------------------------------------------------------

describe("CORS and origin checks", () => {
  const preflight = (path, origin) =>
    SELF.fetch(BASE + path, {
      method: "OPTIONS",
      headers: {
        ...(origin ? { Origin: origin } : {}),
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });

  it("answers OPTIONS from the app's own origin with 204 and the spec's headers", async () => {
    const res = await preflight("/me/sessions", ORIGIN);
    expect(res.status).toBe(204);
    expect(header(res, "Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(header(res, "Access-Control-Allow-Methods")).toBe("GET, POST, DELETE");
    expect(header(res, "Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
    expect(header(res, "Access-Control-Max-Age")).toBe("7200");
    expect(header(res, "Vary")).toMatch(/\bOrigin\b/i);
    expect(header(res, "Access-Control-Allow-Credentials")).toBeNull();
    expect(await res.text()).toBe("");
  });

  it("answers OPTIONS from any other origin with 403 and no CORS headers", async () => {
    for (const origin of [EVIL, "https://waveslave.tw.evil.example", "https://evilwaveslave.tw", "http://waveslave.tw", "null"]) {
      const res = await preflight("/me/sessions", origin);
      expect(res.status, origin).toBe(403);
      expect(header(res, "Access-Control-Allow-Origin"), origin).toBeNull();
      expect(header(res, "Access-Control-Allow-Methods"), origin).toBeNull();
      expect(header(res, "Vary"), origin).toMatch(/\bOrigin\b/i);
    }
  });

  it("answers OPTIONS with no Origin at all with 403", async () => {
    const res = await preflight("/me/sessions", null);
    expect(res.status).toBe(403);
  });

  it("answers OPTIONS the same way on every route that takes CORS", async () => {
    for (const path of ["/auth/redeem", "/auth/signup", "/me", "/me/sessions", "/me/sessions/12", "/me/signout", "/me/export", "/admin/where"]) {
      expect((await preflight(path, ORIGIN)).status, path).toBe(204);
      expect((await preflight(path, EVIL)).status, path).toBe(403);
    }
  });

  it("doesn't answer OPTIONS for a path it has no route for", async () => {
    expect((await preflight("/me/nothing", ORIGIN)).status).toBe(404);
  });

  it("reads ALLOWED_ORIGINS as a comma-separated list, matching each entry exactly", async () => {
    const fake = fakeRoom(undefined, { ALLOWED_ORIGINS: "https://waveslave.tw, http://localhost:8788" });
    const ask = (origin) => call(fake, "/me/sessions", { method: "OPTIONS", headers: { Origin: origin } });
    expect((await ask("http://localhost:8788")).status).toBe(204);
    expect(header(await ask("http://localhost:8788"), "Access-Control-Allow-Origin")).toBe("http://localhost:8788");
    expect((await ask(ORIGIN)).status).toBe(204);
    expect((await ask("http://localhost:8789")).status).toBe(403);
    expect((await ask("http://localhost")).status).toBe(403);
  });

  it("allows no origin at all when ALLOWED_ORIGINS is missing or empty", async () => {
    for (const ALLOWED_ORIGINS of [undefined, "", " , "]) {
      const fake = fakeRoom(undefined, { ALLOWED_ORIGINS });
      const res = await call(fake, "/me/sessions", { method: "OPTIONS", headers: { Origin: ORIGIN } });
      expect(res.status, String(ALLOWED_ORIGINS)).toBe(403);
    }
  });

  it("reflects the origin, and Vary: Origin, on an answer to an allowed origin, and never sends credentials", async () => {
    const fake = fakeRoom();
    const res = await call(fake, "/me/sessions", { headers: { Origin: ORIGIN, Authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    expect(header(res, "Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(header(res, "Vary")).toMatch(/\bOrigin\b/i);
    expect(header(res, "Access-Control-Allow-Credentials")).toBeNull();
  });

  it("refuses a request from another origin before it reaches the room", async () => {
    // A POST with a plain-text body needs no preflight, so the browser would send it. It must change nothing.
    const fake = fakeRoom();
    const res = await call(fake, "/auth/redeem", {
      method: "POST",
      headers: { Origin: EVIL, "Content-Type": "text/plain" },
      body: JSON.stringify({ v: "x", code: "y" }),
    });
    expect(res.status).toBe(403);
    expect(header(res, "Access-Control-Allow-Origin")).toBeNull();
    expect(await res.json()).toEqual({ error: "origin" });
    expect(fake.seen.calls).toEqual([]);
  });

  it("lets a request with no Origin through (curl, a server) without CORS headers", async () => {
    const fake = fakeRoom();
    const res = await call(fake, "/me/export", { headers: { Authorization: "Bearer t" } });
    expect(res.status).toBe(200);
    expect(header(res, "Access-Control-Allow-Origin")).toBeNull();
    expect(header(res, "Vary")).toMatch(/\bOrigin\b/i);
    expect(fake.seen.calls.length).toBe(1);
  });

  it("takes CORS headers off whatever the room sent, so the Worker alone decides them", async () => {
    const fake = fakeRoom(
      () =>
        new Response("{}", {
          headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true", "Cache-Control": "public, max-age=999" },
        }),
    );
    const res = await call(fake, "/me/export");
    expect(header(res, "Access-Control-Allow-Origin")).toBeNull();
    expect(header(res, "Access-Control-Allow-Credentials")).toBeNull();
    expect(header(res, "Cache-Control")).toBe("no-store");
  });
});

describe("GET /ws", () => {
  it("answers 403 to an origin that isn't allowed", async () => {
    const res = await SELF.fetch(`${BASE}/ws`, { headers: { Origin: EVIL } });
    expect(res.status).toBe(403);
  });

  it("answers 403 to a request with no Origin", async () => {
    const res = await SELF.fetch(`${BASE}/ws`);
    expect(res.status).toBe(403);
  });

  it("answers 403 even to a proper upgrade from another origin, and never reaches the room", async () => {
    const fake = fakeRoom();
    const res = await call(fake, "/ws", { headers: { Origin: EVIL, Upgrade: "websocket", Connection: "Upgrade" } });
    expect(res.status).toBe(403);
    expect(fake.seen.calls).toEqual([]);
  });

  it("answers 426 to an allowed origin that isn't asking for a WebSocket", async () => {
    const fake = fakeRoom();
    const res = await call(fake, "/ws", { headers: { Origin: ORIGIN } });
    expect(res.status).toBe(426);
    expect(fake.seen.calls).toEqual([]);
  });

  it("passes an upgrade from an allowed origin to the room, with its headers", async () => {
    const fake = fakeRoom();
    await call(fake, "/ws", {
      headers: {
        Origin: ORIGIN,
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        "CF-Connecting-IP": "203.0.113.7",
      },
    });
    expect(fake.seen.calls.length).toBe(1);
    const sent = fake.seen.calls[0];
    expect(sent.method).toBe("GET");
    expect(sent.url).toBe("https://room/r/ws");
    expect(sent.headers["upgrade"]).toBe("websocket");
    expect(sent.headers["sec-websocket-key"]).toBe("dGhlIHNhbXBsZSBub25jZQ==");
    expect(sent.headers["origin"]).toBe(ORIGIN);
    expect(sent.headers["cf-connecting-ip"]).toBe("203.0.113.7");
  });

  it("hands back the room's 101 answer untouched, with its socket", async () => {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const fake = fakeRoom(() => new Response(null, { status: 101, webSocket: client }));
    const res = await call(fake, "/ws", { headers: { Origin: ORIGIN, Upgrade: "websocket" } });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
    res.webSocket.accept();
    res.webSocket.close();
    server.close();
  });

  it("answers 405 to any other method, once the origin is right", async () => {
    const res = await SELF.fetch(`${BASE}/ws`, { method: "POST", headers: { Origin: ORIGIN } });
    expect(res.status).toBe(405);
  });
});

// ---- No-store ----------------------------------------------------------------------------------------------

describe("Cache-Control: no-store", () => {
  const body = JSON.stringify({ v: "x" });
  const asks = [
    // The routes, from the app's origin and from no origin.
    ["POST", "/auth/redeem", ORIGIN],
    ["POST", "/auth/redeem", null],
    ["POST", "/auth/signup", ORIGIN],
    ["GET", "/me/sessions", ORIGIN],
    ["POST", "/me/sessions", ORIGIN],
    ["DELETE", "/me/sessions/3", ORIGIN],
    ["POST", "/me/signout", ORIGIN],
    ["GET", "/me/export", ORIGIN],
    ["DELETE", "/me", ORIGIN],
    ["GET", "/admin/where", null],
    // The other answers the Worker itself gives.
    ["OPTIONS", "/me/sessions", ORIGIN],
    ["OPTIONS", "/me/sessions", EVIL],
    ["GET", "/me/sessions", EVIL],
    ["GET", "/auth/redeem", ORIGIN],
    ["PUT", "/me/sessions", ORIGIN],
    // Paths that are under /auth and /me but are no route.
    ["GET", "/auth/nothing", null],
    ["POST", "/auth/nothing", ORIGIN],
    ["GET", "/me/nothing", ORIGIN],
    ["GET", "/me", ORIGIN],
  ];
  const init = (method, origin) => ({
    method,
    headers: origin ? { Origin: origin } : {},
    ...(method === "POST" ? { body } : {}),
  });

  it("is on every /auth/*, /me/* and /admin/* answer, whoever made it", async () => {
    for (const answer of [
      () => Response.json({ ok: true }),
      () => Response.json({ error: "slow:5" }, { status: 429 }),
      () => Response.json({ error: "auth" }, { status: 401 }),
      () => new Response("{}", { headers: { "Cache-Control": "public, max-age=3600" } }),
      () => {
        throw new Error("room down");
      },
    ]) {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fake = fakeRoom(answer);
      for (const [method, path, origin] of asks) {
        const res = await call(fake, path, init(method, origin));
        expect(header(res, "Cache-Control"), `${method} ${path} from ${origin} (${res.status})`).toBe("no-store");
      }
    }
  });

  it("is on the answers of the real Worker and room too", async () => {
    for (const [method, path, origin] of asks) {
      const res = await SELF.fetch(BASE + path, init(method, origin));
      expect(header(res, "Cache-Control"), `${method} ${path} from ${origin} (${res.status})`).toBe("no-store");
    }
  });

  it("is not on /auth or /me lookalikes", async () => {
    for (const path of ["/authors", "/measure", "/reports-old"]) {
      const res = await SELF.fetch(BASE + path);
      expect(res.status, path).toBe(404);
      expect(header(res, "Cache-Control"), path).toBeNull();
    }
  });
});

// ---- Resting -----------------------------------------------------------------------------------------------

describe("when the room fails", () => {
  const FAILURES = {
    "throws when asked to fetch": () => ({
      getByName: () => ({
        fetch() {
          throw new Error("room down: secret-detail-123");
        },
      }),
    }),
    "rejects": () => ({
      getByName: () => ({ fetch: async () => Promise.reject(new Error("room down: secret-detail-123")) }),
    }),
    "can't be reached at all": () => ({
      getByName() {
        throw new Error("room down: secret-detail-123");
      },
    }),
  };

  for (const [how, makeRoom] of Object.entries(FAILURES)) {
    describe(`a room that ${how}`, () => {
      const dead = () => ({ seen: { stubs: [], calls: [] }, env: { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS, ROOM: makeRoom() } });

      it("makes /reports answer 503 {resting: true} with open CORS", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call(dead(), "/reports?spot=jinshan");
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ resting: true });
        expect(header(res, "Access-Control-Allow-Origin")).toBe("*");
        expect(header(res, "Cache-Control")).toBe("no-store");
      });

      it("makes /me/* and /auth/* answer 503 {resting: true} with the reflected origin", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        for (const [method, path] of [["GET", "/me/sessions"], ["POST", "/auth/redeem"], ["POST", "/auth/signup"], ["DELETE", "/me"]]) {
          const res = await call(dead(), path, { method, headers: { Origin: ORIGIN }, ...(method === "POST" ? { body: "{}" } : {}) });
          expect(res.status, path).toBe(503);
          expect(await res.json(), path).toEqual({ resting: true });
          expect(header(res, "Access-Control-Allow-Origin"), path).toBe(ORIGIN);
          expect(header(res, "Vary"), path).toMatch(/\bOrigin\b/i);
          expect(header(res, "Cache-Control"), path).toBe("no-store");
        }
      });

      it("makes /ws answer 503 {resting: true} too", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call(dead(), "/ws", { headers: { Origin: ORIGIN, Upgrade: "websocket" } });
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ resting: true });
      });

      it("logs that it failed, but nothing the error said", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        await call(dead(), "/auth/redeem", { method: "POST", body: JSON.stringify({ v: "my-verifier", code: "my-code" }) });
        expect(logged).toHaveBeenCalled();
        const text = JSON.stringify(logged.mock.calls);
        expect(text).not.toContain("secret-detail-123");
        expect(text).not.toContain("my-verifier");
        expect(text).not.toContain("my-code");
      });
    });
  }

  it("still answers a bad spot with 400 and an unknown path with 404, not resting", async () => {
    const fake = { env: { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS, ROOM: FAILURES["can't be reached at all"]() } };
    expect((await call(fake, "/reports?spot=pipeline")).status).toBe(400);
    expect((await call(fake, "/nothing")).status).toBe(404);
  });

  it("passes on the room's own errors and its own resting answer as they are", async () => {
    const fake = fakeRoom(() => Response.json({ resting: true }, { status: 503 }));
    const res = await call(fake, "/reports?spot=jinshan");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ resting: true });
    expect(header(res, "Access-Control-Allow-Origin")).toBe("*");

    const slow = fakeRoom(() => Response.json({ error: "slow:5" }, { status: 429 }));
    const res2 = await call(slow, "/me/sessions", { method: "POST", headers: { Origin: ORIGIN }, body: "{}" });
    expect(res2.status).toBe(429);
    expect(await res2.json()).toEqual({ error: "slow:5" });
    expect(header(res2, "Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
});

// ---- Routing -----------------------------------------------------------------------------------------------

describe("routing to the room", () => {
  it("makes the stub only with getByName('taiwan', {locationHint: 'apac-ne'})", async () => {
    const fake = fakeRoom();
    await call(fake, "/reports?spot=suao");
    await call(fake, "/me/export");
    await call(fake, "/auth/redeem", { method: "POST", body: "{}" });
    expect(fake.seen.stubs).toEqual(Array(3).fill({ name: "taiwan", options: { locationHint: "apac-ne" } }));
  });

  const bearer = { Authorization: "Bearer a.b" };
  const json = { "Content-Type": "application/json" };
  const ROUTES = [
    // [what the app sends, what the room should get]
    [["GET", "/reports?spot=nanwan"], ["GET", "/r/reports?spot=nanwan"]],
    [["POST", "/auth/redeem", { v: "v1", code: "c1" }], ["POST", "/r/redeem"]],
    [["POST", "/auth/signup", { v: "v1", pin: "123456", nick: "阿凱", consent: "v1" }], ["POST", "/r/signup"]],
    [["GET", "/me/sessions", null, bearer], ["GET", "/r/me/sessions"]],
    [["POST", "/me/sessions", { spot: "jinshan", stars: 4 }, bearer], ["POST", "/r/me/sessions"]],
    [["DELETE", "/me/sessions/42", null, bearer], ["DELETE", "/r/me/sessions/42"]],
    [["POST", "/me/signout", {}, bearer], ["POST", "/r/me/signout"]],
    [["GET", "/me/export", null, bearer], ["GET", "/r/me/export"]],
    [["DELETE", "/me", null, bearer], ["DELETE", "/r/me"]],
    [["GET", "/admin/where", null, bearer], ["GET", "/r/where"]],
  ];

  for (const [[method, path, payload, extra], [roomMethod, roomPath]] of ROUTES) {
    it(`sends ${method} ${path} to the room as ${roomMethod} ${roomPath}`, async () => {
      const fake = fakeRoom();
      const res = await call(fake, path, {
        method,
        headers: { Origin: ORIGIN, ...(payload ? json : {}), ...extra, Cookie: "a=b", "X-Other": "no" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      expect(res.status).toBe(200);
      expect(fake.seen.calls.length).toBe(1);
      const sent = fake.seen.calls[0];
      expect(sent.method).toBe(roomMethod);
      expect(sent.url).toBe(`https://room${roomPath}`);
      // The body goes through as it came, and the room gets the Authorization header; it gets nothing else the
      // browser sent.
      expect(sent.body).toBe(payload ? JSON.stringify(payload) : "");
      expect(sent.headers["authorization"]).toBe(extra?.Authorization);
      expect(sent.headers["content-type"]).toBe(payload ? "application/json" : undefined);
      expect(sent.headers["cookie"]).toBeUndefined();
      expect(sent.headers["x-other"]).toBeUndefined();
    });
  }

  it("hands the room's answer back as it is", async () => {
    const fake = fakeRoom(() => Response.json({ token: "t.s" }, { status: 201 }));
    const res = await call(fake, "/auth/redeem", { method: "POST", headers: { Origin: ORIGIN }, body: "{}" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ token: "t.s" });
  });

  it("answers 405 to the wrong method on a route, with Allow, and never asks the room", async () => {
    const fake = fakeRoom();
    const cases = [
      ["GET", "/auth/redeem", "POST, OPTIONS"],
      ["PUT", "/me/sessions", "GET, POST, OPTIONS"],
      ["POST", "/me/export", "GET, OPTIONS"],
      ["GET", "/me/signout", "POST, OPTIONS"],
      ["POST", "/admin/where", "GET, OPTIONS"],
    ];
    for (const [method, path, allow] of cases) {
      const res = await call(fake, path, { method, headers: { Origin: ORIGIN } });
      expect(res.status, `${method} ${path}`).toBe(405);
      expect(header(res, "Allow"), `${method} ${path}`).toBe(allow);
    }
    expect(fake.seen.calls).toEqual([]);
  });
});

// ---- Unknown paths -----------------------------------------------------------------------------------------

describe("an unknown path", () => {
  it("answers 404 with JSON and no CORS headers", async () => {
    for (const path of ["/", "/anything", "/reports/", "/Reports?spot=jinshan", "/me/sessions/1/2", "/ws/x", "/r/reports?spot=jinshan", "/auth/line"]) {
      const res = await SELF.fetch(BASE + path);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not found" });
      expect(header(res, "Access-Control-Allow-Origin"), path).toBeNull();
    }
  });

  it("never reaches the room", async () => {
    const fake = fakeRoom();
    await call(fake, "/anything");
    await call(fake, "/r/reports?spot=jinshan");
    expect(fake.seen.stubs).toEqual([]);
  });
});
