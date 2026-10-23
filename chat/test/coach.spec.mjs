// Tests for the coach object, chat/src/coach.js (docs/superpowers/specs/2026-10-22-ai-coach-design.md, "Backend"): its
// tables and their migrate(), its settings from wrangler.toml's [vars], its usage counts for the free-plan guard,
// alarmBy(), where() for /admin/where, roomStub(), and route()'s paths it doesn't serve (coach-send.spec.mjs has the
// surfer's routes). They run inside the Workers runtime (see vitest.config.mjs). Run from chat/:
// npx vitest run --no-isolate --max-workers=1 test/coach.spec.mjs
//
// Each test has a coach of its own (newCoach), with its clock at T, years ahead, so no alarm a test sets goes off by
// itself. Room's half of /admin/where, the two lines, is in mod-admin.spec.mjs.
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/coach.js";
import { HOUR, newCoach } from "./helpers.mjs";

// 12:00 UTC (20:00 in Taiwan) on a day years ahead.
const T = Date.UTC(2030, 5, 3, 12, 0);
const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const TRACE = ["fl=12f345", "h=www.cloudflare.com", "ip=203.0.113.9", "colo=NRT", "loc=JP", "tls=TLSv1.3"].join("\n") + "\n";
// Who the Worker says is calling, as whoIs gives it.
const WHO = Object.freeze({ uid: "u-1", sub_hash: "sub-1", role: "user" });

const freshCoach = (at = T) => newCoach("coach", at);

afterEach(() => {
  vi.restoreAllMocks();
});

// Answers the trace page with `answer`, and records each time it is asked. Any other fetch is refused, so a test sees
// one it didn't expect.
function mockTrace(answer = () => new Response(TRACE)) {
  const asked = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== TRACE_URL) throw new Error(`unexpected fetch of ${request.url}`);
    asked.push(request.url);
    return answer();
  });
  return asked;
}

// Runs fn(), counting the rows read and written by every SQL statement the coach runs meanwhile.
function cost(coach, fn) {
  const real = coach.sql;
  const cursors = [];
  coach.sql = {
    exec(...args) {
      const cursor = real.exec(...args);
      cursors.push(cursor);
      return cursor;
    },
  };
  try {
    const result = fn();
    const add = (key) => cursors.reduce((n, c) => n + c[key], 0);
    return { result, read: add("rowsRead"), written: add("rowsWritten") };
  } finally {
    coach.sql = real;
  }
}

const rows = (coach, query, ...binds) => coach.sql.exec(query, ...binds).toArray();

// ---- Tables -----------------------------------------------------------------------------------------------------

const TABLES = {
  reviews: [
    "id", "uid", "sub_hash", "lang", "move", "answers", "status", "attempts", "waits", "redos", "next_try", "created", "sent",
    "published", "handled_at", "waiting_since", "quota_month", "given", "checked", "hold", "model", "tok_in", "tok_out", "cost",
    "draft", "english", "final", "flags", "warnings", "redo_note", "surfer_note", "report",
  ],
  frames: ["review_id", "n", "ms", "box", "b64"],
  people: ["sub_hash", "level", "board", "stance", "agreed_ver", "agreed_at", "blocked"],
  quota: ["sub_hash", "month", "used", "sent"],
  examples: ["id", "move", "level", "draft", "bryan", "note", "review_id", "at"],
  kept_blocks: ["sub_hash", "kept_at"],
  meta: ["key", "value"],
};
const KEYS = {
  reviews: ["id"],
  frames: ["review_id", "n"],
  people: ["sub_hash"],
  quota: ["sub_hash", "month"],
  examples: ["id"],
  kept_blocks: ["sub_hash"],
  meta: ["key"],
};

// The names of the coach's own tables, leaving out SQLite's and Cloudflare's.
const ownTables = (coach) =>
  rows(coach, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    .map(({ name }) => name);

// Each index made on a table (not the ones SQLite makes for a primary key), as "col,col".
const indexes = (coach, table) =>
  rows(coach, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL", table)
    .map(({ name }) => rows(coach, "SELECT name FROM pragma_index_info(?) ORDER BY seqno", name).map((r) => r.name).join(","))
    .sort();

// A review as a start will write it: only the columns with no default.
const addReview = (coach, id, more = "") =>
  coach.sql.exec(
    `INSERT INTO reviews (id, uid, sub_hash, lang, move, answers, status, created) VALUES (?, 'u-1', 'sub-1', 'en', 'popup', '{}', ${more || "'uploading'"}, ?)`,
    id, T,
  );

describe("tables", () => {
  it("has every table with the spec's columns and keys, and schema_ver 1", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      expect(ownTables(coach)).toEqual(Object.keys(TABLES).sort());
      for (const [table, columns] of Object.entries(TABLES)) {
        expect(rows(coach, "SELECT name FROM pragma_table_info(?) ORDER BY cid", table).map((r) => r.name), table).toEqual(columns);
        expect(rows(coach, "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk", table).map((r) => r.name), table).toEqual(KEYS[table]);
      }
      expect(coach.getMeta("schema_ver")).toBe(1);
    });
  });

  it("indexes reviews on (status, next_try), (uid, created), (sub_hash, status), handled_at and the held ones' sent", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      expect(indexes(coach, "reviews")).toEqual(["handled_at", "sent", "status,next_try", "sub_hash,status", "uid,created"]);
      // The held ones' index is partial: only the clips held for Bryan are in it (ruling R16).
      const held = rows(coach, "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'reviews_held'")[0].sql;
      expect(held).toMatch(/WHERE hold = 1$/);
      for (const table of ["frames", "people", "quota", "examples", "kept_blocks", "meta"]) expect(indexes(coach, table), table).toEqual([]);
    });
  });

  it("gives a new review its counts at 0 and its lists empty, a person blocked 0, and a month's quota 0 used, 0 sent", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      addReview(coach, "r1");
      const review = rows(coach, "SELECT * FROM reviews WHERE id = 'r1'")[0];
      expect(review).toMatchObject({ attempts: 0, waits: 0, redos: 0, given: 0, checked: 0, hold: 0 });
      for (const list of ["flags", "warnings", "redo_note"]) expect(JSON.parse(review[list]), list).toEqual([]);
      for (const unset of ["next_try", "sent", "published", "handled_at", "waiting_since", "quota_month", "model", "cost", "draft", "english", "final", "surfer_note", "report"]) {
        expect(review[unset], unset).toBeNull();
      }
      coach.sql.exec("INSERT INTO people (sub_hash) VALUES ('sub-1')");
      expect(rows(coach, "SELECT blocked FROM people")).toEqual([{ blocked: 0 }]);
      coach.sql.exec("INSERT INTO quota (sub_hash, month) VALUES ('sub-1', '2030-06')");
      expect(rows(coach, "SELECT used, sent FROM quota")).toEqual([{ used: 0, sent: 0 }]);
    });
  });

  it("keeps the rules later writes rely on: one row per review, per frame and per month, the seven statuses, frames 1-12", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      addReview(coach, "r1");
      expect(() => addReview(coach, "r1")).toThrow();
      for (const status of ["uploading", "queued", "calling", "drafted", "published", "rejected", "failed"]) {
        addReview(coach, `r-${status}`, `'${status}'`);
      }
      expect(() => addReview(coach, "r-other", "'reviewing'")).toThrow();
      const frame = (n) => coach.sql.exec("INSERT INTO frames (review_id, n, ms, box, b64) VALUES ('r1', ?, 0, '[0,0,1]', NULL)", n);
      frame(1);
      frame(12);
      expect(() => frame(1)).toThrow();
      expect(() => frame(0)).toThrow();
      expect(() => frame(13)).toThrow();
      coach.sql.exec("INSERT INTO quota (sub_hash, month) VALUES ('sub-1', '2030-06')");
      expect(() => coach.sql.exec("INSERT INTO quota (sub_hash, month) VALUES ('sub-1', '2030-06')")).toThrow();
    });
  });

  it("running migrate() again changes nothing, and keeps the rows", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      addReview(coach, "r1");
      coach.setMeta("paused", true);
      const schema = () => rows(coach, "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name");
      const data = () => ({ reviews: rows(coach, "SELECT * FROM reviews"), meta: rows(coach, "SELECT * FROM meta WHERE key != 'usage' ORDER BY key") });
      const before = { schema: schema(), data: data() };
      const { written } = cost(coach, () => coach.migrate());
      expect(written).toBe(0);
      expect({ schema: schema(), data: data() }).toEqual(before);
    });
  });

  it("makes the tables all at once: when the schema_ver write fails, only meta is left, and the next migrate() makes them", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      for (const name of ownTables(coach)) coach.sql.exec(`DROP TABLE "${name}"`);
      const atFailure = {};
      coach.setMeta = (key) => {
        atFailure.tables = ownTables(coach);
        throw new Error(`${key} write failed`);
      };
      expect(() => coach.migrate()).toThrow("schema_ver write failed");
      delete coach.setMeta;
      expect(atFailure.tables).toEqual(Object.keys(TABLES).sort());
      expect(ownTables(coach)).toEqual(["meta"]);
      expect(coach.getMeta("schema_ver")).toBeNull();
      coach.migrate();
      expect(ownTables(coach)).toEqual(Object.keys(TABLES).sort());
      expect(coach.getMeta("schema_ver")).toBe(1);
    });
  });

  it("getMeta() gives back what setMeta() saved, objects included, and null for a key never set", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      expect(coach.getMeta("spend")).toBeNull();
      const spend = { start: T, usd: 12.5, reviews: 3 };
      coach.setMeta("spend", spend);
      coach.setMeta("paused", true);
      coach.setMeta("frame_bytes", 1234);
      expect(coach.getMeta("spend")).toEqual(spend);
      expect(coach.getMeta("paused")).toBe(true);
      expect(coach.getMeta("frame_bytes")).toBe(1234);
      coach.setMeta("spend", { ...spend, usd: 13 });
      expect(coach.getMeta("spend").usd).toBe(13);
      expect(rows(coach, "SELECT count(*) AS n FROM meta WHERE key = 'spend'")).toEqual([{ n: 1 }]);
    });
  });
});

// ---- Settings ---------------------------------------------------------------------------------------------------

describe("settings", () => {
  it("wrangler.toml's [vars] are the spec's, and the test secrets are set", () => {
    expect({
      COACH_PRICE_IN: env.COACH_PRICE_IN,
      COACH_PRICE_OUT: env.COACH_PRICE_OUT,
      COACH_STOP_USD: env.COACH_STOP_USD,
      COACH_HARD_USD: env.COACH_HARD_USD,
      COACH_EXTRA_USD: env.COACH_EXTRA_USD,
      COACH_CREDIT_DAY: env.COACH_CREDIT_DAY,
      COACH_MONTHLY: env.COACH_MONTHLY,
      COACH_MONTHLY_MAX: env.COACH_MONTHLY_MAX,
      COACH_DAILY: env.COACH_DAILY,
      COACH_DAILY_AUTO: env.COACH_DAILY_AUTO,
      COACH_ALERT_TO: env.COACH_ALERT_TO,
      COACH_API_URL: env.COACH_API_URL,
      COACH_MAIL_URL: env.COACH_MAIL_URL,
    }).toEqual({
      COACH_PRICE_IN: "4",
      COACH_PRICE_OUT: "20",
      COACH_STOP_USD: "78",
      COACH_HARD_USD: "80",
      COACH_EXTRA_USD: "0",
      COACH_CREDIT_DAY: "16",
      COACH_MONTHLY: "2",
      COACH_MONTHLY_MAX: "4",
      COACH_DAILY: "10",
      COACH_DAILY_AUTO: "40",
      COACH_ALERT_TO: "waveslave050@gmail.com",
      COACH_API_URL: "https://api.anthropic.com/v1/messages",
      COACH_MAIL_URL: "https://api.resend.com/emails",
    });
    // The model is named in wrangler.toml alone.
    expect(env.COACH_MODEL).toMatch(/^\S+$/);
    // The stand-ins from vitest.config.mjs, never real keys.
    expect(env.ANTHROPIC_API_KEY).toMatch(/^test-only-/);
    expect(env.RESEND_API_KEY).toMatch(/^test-only-/);
  });

  const SPEC = { priceIn: 4, priceOut: 20, stopUsd: 78, hardUsd: 80, extraUsd: 0, creditDay: 16, monthly: 2, monthlyMax: 4, daily: 10, dailyAuto: 40 };

  it("config() reads them as numbers", async () => {
    const c = await freshCoach();
    expect(await c.inCoach((coach) => coach.config())).toEqual(SPEC);
    expect(readConfig(env)).toEqual(SPEC);
  });

  it("a missing or bad value takes the spec's: a credit day is a whole day 1-31, a count whole, money 0 or more", () => {
    expect(readConfig({})).toEqual(SPEC);
    for (const day of ["", "abc", "0", "32", "15.5", "-3", "1e1", "0x10", "16 days", null]) {
      expect(readConfig({ COACH_CREDIT_DAY: day }).creditDay, String(day)).toBe(16);
    }
    expect(readConfig({ COACH_CREDIT_DAY: "1" }).creditDay).toBe(1);
    expect(readConfig({ COACH_CREDIT_DAY: "31" }).creditDay).toBe(31);
    expect(readConfig({ COACH_CREDIT_DAY: " 20 " }).creditDay).toBe(20);
    expect(readConfig({ COACH_EXTRA_USD: "10" }).extraUsd).toBe(10);
    expect(readConfig({ COACH_EXTRA_USD: "12.50" }).extraUsd).toBe(12.5);
    expect(readConfig({ COACH_EXTRA_USD: "-5" }).extraUsd).toBe(0);
    expect(readConfig({ COACH_STOP_USD: "lots" }).stopUsd).toBe(78);
    expect(readConfig({ COACH_MONTHLY: "2.5" }).monthly).toBe(2);
    expect(readConfig({ COACH_DAILY: "0" }).daily).toBe(0);
    // A test may set a number straight into env.
    expect(readConfig({ COACH_EXTRA_USD: 10, COACH_DAILY: -1 })).toMatchObject({ extraUsd: 10, daily: 10 });
  });

  it("config() reads env on every call, so a changed value counts at once", async () => {
    const c = await freshCoach();
    const day = await c.inCoach((coach) => {
      coach.env = { ...coach.env, COACH_CREDIT_DAY: "abc" };
      return coach.config().creditDay;
    });
    expect(day).toBe(16);
    expect(await c.inCoach((coach) => {
      coach.env = { ...coach.env, COACH_CREDIT_DAY: "20" };
      return coach.config().creditDay;
    })).toBe(20);
  });
});

// ---- Routes, where() and the room ---------------------------------------------------------------------------------

describe("route()", () => {
  it("answers 404 not_found for a path or method it doesn't serve", async () => {
    const c = await freshCoach();
    const asks = [
      { method: "GET", path: "/coach/reviews/AAAAAAAAAAAAAAAAAAAAAA/report", who: WHO, body: "" },
      { method: "POST", path: "/admin/coach/drafts", who: { ...WHO, role: "admin" }, body: "{}" },
      { method: "DELETE", path: "/admin/coach/drafts/AAAAAAAAAAAAAAAAAAAAAA", who: { ...WHO, role: "admin" }, body: "" },
      { method: "GET", path: "/admin/coach/settings", who: { ...WHO, role: "admin" }, body: "" },
      { method: "GET", path: "/admin/coach/nothing", who: { ...WHO, role: "admin" }, body: "" },
      { method: "PUT", path: "/coach/me", who: WHO, body: "" },
      { method: "GET", path: "/nowhere", who: WHO, body: "" },
    ];
    for (const ask of asks) expect(await c.stub.route(ask), `${ask.method} ${ask.path}`).toEqual({ status: 404, json: { error: "not_found" } });
  });

  it("answers 401 auth when who isn't an account, before looking at the path", async () => {
    const c = await freshCoach();
    for (const who of [undefined, null, {}, { uid: "u-1" }, { sub_hash: "sub-1" }, { uid: 1, sub_hash: "sub-1" }]) {
      expect(await c.stub.route({ method: "GET", path: "/coach/me", who, body: "" }), JSON.stringify(who)).toEqual({ status: 401, json: { error: "auth" } });
    }
    expect(await c.rows("SELECT count(*) AS n FROM people")).toEqual([{ n: 0 }]);
  });
});

describe("where()", () => {
  it("answers the colo= line of Cloudflare's trace, as the coach's own data centre serves it", async () => {
    const c = await freshCoach();
    const asked = mockTrace();
    expect(await c.stub.where()).toBe("colo=NRT");
    expect(asked).toEqual([TRACE_URL]);
  });

  it("answers colo=? when the trace can't be read or has no colo= line, logging only the error's name", async () => {
    const c = await freshCoach();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const answer of [() => new Response("oops", { status: 500 }), () => new Response("fl=1\nh=x\n"), () => Promise.reject(new TypeError("network, key abc"))]) {
      const asked = mockTrace(answer);
      expect(await c.stub.where()).toBe("colo=?");
      expect(asked).toHaveLength(1);
      vi.mocked(globalThis.fetch).mockRestore();
    }
    expect(logged.mock.calls).toEqual([["coach: the trace failed:", "TypeError"]]);
  });
});

describe("roomStub()", () => {
  it("reaches the taiwan room through stubs.js", async () => {
    const c = await freshCoach();
    const asked = await c.inCoach((coach) => {
      const seen = [];
      coach.env = { ...coach.env, ROOM: { getByName: (name, options) => (seen.push({ name, options }), { stub: name }) } };
      expect(coach.roomStub()).toEqual({ stub: "taiwan" });
      return seen;
    });
    expect(asked).toEqual([{ name: "taiwan", options: { locationHint: "apac-ne" } }]);
  });
});

// ---- Usage ------------------------------------------------------------------------------------------------------

const savedUsage = (coach) => {
  const row = rows(coach, "SELECT value FROM meta WHERE key = 'usage'")[0];
  return row === undefined ? undefined : JSON.parse(row.value);
};

describe("usage()", () => {
  it("counts each route() and where() call as a request, and the rows all() reads and writes", async () => {
    const c = await freshCoach();
    const before = await c.inCoach((coach) => coach.usage("req", 0));
    await c.stub.route({ method: "GET", path: "/coach/me", who: WHO, body: "" });
    mockTrace();
    await c.stub.where();
    await c.inCoach((coach) => {
      expect(coach.usage("req", 0).req - before.req).toBe(2);
      const start = coach.usage("req", 0);
      const added = cost(coach, () => coach.all("INSERT INTO examples (move, draft, at) VALUES ('popup', '{}', ?)", T));
      const read = cost(coach, () => coach.one("SELECT * FROM examples"));
      const end = coach.usage("req", 0);
      expect(end.write - start.write).toBe(added.written);
      expect(end.read - start.read).toBe(added.read + read.read);
      expect(added.written).toBeGreaterThan(0);
      expect(read.read).toBeGreaterThan(0);
      expect(() => coach.usage("bytes", 1)).toThrow();
    });
  });

  it("saves today's counts to meta on the first request, then after 100 requests or 30 s, whichever comes first", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      coach.used = null; // as a new copy of the coach would start
      coach.usage("req", 1);
      expect(savedUsage(coach)).toMatchObject({ day: "2030-06-03", req: 1, at: T });
      // 99 more in the same moment stay in memory; the 100th since that save writes them all.
      for (let i = 0; i < 99; i++) coach.usage("req", 1);
      expect(savedUsage(coach).req).toBe(1);
      expect(coach.usage("req", 1).req).toBe(101);
      expect(savedUsage(coach).req).toBe(101);
      // Fewer than 100 requests, but 30 s after the last save.
      c.clock.t = T + 29_999;
      coach.usage("req", 1);
      expect(savedUsage(coach).req).toBe(101);
      c.clock.t = T + 30_000;
      coach.usage("req", 1);
      expect(savedUsage(coach)).toMatchObject({ req: 103, at: T + 30_000 });
      // Reading the totals saves nothing.
      c.clock.t = T + 90_000;
      expect(coach.usage("req", 0).req).toBe(103);
      expect(savedUsage(coach).at).toBe(T + 30_000);
    });
  });

  it("counts by the UTC day, as Cloudflare's limits do: at 07:59 in Taiwan it is still yesterday, at 08:00 it starts at zero", async () => {
    const c = await freshCoach(Date.UTC(2030, 5, 3, 23, 59));
    await c.inCoach((coach) => {
      for (let i = 0; i < 5; i++) coach.usage("req", 1);
      expect(coach.usage("req", 0).day).toBe("2030-06-03");
      c.clock.t = Date.UTC(2030, 5, 4, 0, 0);
      expect(coach.usage("req", 0)).toMatchObject({ day: "2030-06-04", req: 0, read: 0 });
      coach.usage("req", 1);
      expect(savedUsage(coach)).toMatchObject({ day: "2030-06-04", req: 1, read: 0 });
    });
  });

  it("a new copy of the coach goes on from the saved counts", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      coach.used = null;
      for (let i = 0; i < 10; i++) coach.usage("req", 1);
      c.clock.t = T + 30_000;
      coach.usage("req", 1);
    });
    await evictDurableObject(c.stub);
    await c.inCoach((coach) => {
      coach.now = () => T + 31_000;
      expect(coach.usage("req", 0).req).toBe(11);
    });
  });
});

// ---- The alarm --------------------------------------------------------------------------------------------------

describe("alarmBy()", () => {
  it("sets the alarm when none is set, brings it forward, and never pushes it back", async () => {
    const c = await freshCoach();
    await c.inCoach(async (coach) => {
      expect(await coach.ctx.storage.getAlarm()).toBeNull();
      await coach.alarmBy(T + 2 * HOUR);
      expect(await coach.ctx.storage.getAlarm()).toBe(T + 2 * HOUR);
      await coach.alarmBy(T + 3 * HOUR);
      expect(await coach.ctx.storage.getAlarm()).toBe(T + 2 * HOUR);
      await coach.alarmBy(T + HOUR);
      expect(await coach.ctx.storage.getAlarm()).toBe(T + HOUR);
      await coach.ctx.storage.deleteAlarm();
    });
  });
});
