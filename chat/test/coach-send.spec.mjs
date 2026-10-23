// Tests for starting, uploading and sending a clip review in chat/src/coach.js (docs/superpowers/specs/2026-10-22-ai-coach-
// design.md, "Backend": the routes, the limits, the free-plan guard and the size guard; "Testing", "Starting and sending",
// "Counting", "Frames" and "Access"): GET /coach/me, POST /coach/agree, POST /coach/reviews, the key frames' upload and GET,
// send, the review's GET and DELETE, and under them stopFor(), giveBack() and dailyLimit(). They run inside the Workers
// runtime (see vitest.config.mjs). Run from chat/: npx vitest run test/coach-send.spec.mjs
//
// Each test has a coach of its own (newCoach) with its clock at T, years ahead, so no alarm a test sets goes off by
// itself. The coach is called as the Worker calls it, stub.route({method, path, who, body}), with `who` made by hand, and
// its room stub is replaced (ruling R1) by one whose isBanned reads a set. Every fetch throws, so a test sees one it
// didn't expect, and each test checks that none was tried. The Worker's own half (whoIs, CORS, the body caps) is in
// coach-worker.spec.mjs; one test here goes through the real Worker for a key frame's bytes.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { AGREE_VER } from "../src/coach-guide.js";
import { FRAME_TEXT_MAX } from "../src/coach-rules.js";
import { jpegB64 } from "./coach-fixtures.mjs";
import { HOUR, MIN, addUser, hex, newCoach, newRoom } from "./helpers.mjs";

// 12:00 UTC (20:00 in Taiwan) on 3 June, years ahead. The credit month it is in started on 16 May.
const T = Date.UTC(2030, 5, 3, 12, 0);
const TODAY = "2030-06-03"; // T's Taiwan day
const MONTH = "2030-06"; // T's Taiwan month
const NEXT_CREDIT = Date.UTC(2030, 5, 16); // 08:00 in Taiwan on the 16th

// A key frame as the phone sends it, and another one (same size, other bytes) for a re-send.
const FRAME = jpegB64();
const OTHER = jpegB64({ progressive: true, app: [120] });
const bytesOf = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
// A PNG's signature and header chunk, as base64.
const PNG = btoa("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x03\x10\x00\x00\x03\x10\x08\x02\x00\x00\x00");

const NOT_FOUND = Object.freeze({ status: 404, json: { error: "not_found" } });
const OK = Object.freeze({ status: 200, json: { ok: true } });

// Every fetch throws, the AI's and the mail's included; each test checks that none was tried.
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

// ---- Coaches, accounts and calls ------------------------------------------------------------------------------------

// A coach of its own with its clock at `at`, whose room stub answers isBanned from the set `banned` and records each
// LINE account it was asked about in `asked`.
async function freshCoach(at = T) {
  const c = await newCoach("send", at);
  const banned = new Set();
  const asked = [];
  await c.inCoach((coach) => {
    coach.roomStub = () => ({
      async isBanned(sub_hash) {
        asked.push(sub_hash);
        return banned.has(sub_hash);
      },
    });
  });
  return { ...c, banned, asked };
}

// Who the Worker says is calling: a new account each time, or Bryan's.
const surfer = () => ({ uid: `u-${hex(6)}`, sub_hash: `sub-${hex(8)}`, role: "user" });
const BRYAN = Object.freeze({ uid: "u-bryan", sub_hash: "sub-bryan", role: "admin" });

// One route, as the Worker hands it over: the body as text.
const call = (c, who, method, path, body = "") =>
  c.stub.route({ method, path, who, body: typeof body === "string" ? body : JSON.stringify(body) });

// The key frames a start lists: k of them, numbered 1..k, a quarter second apart around 0:11.
const listed = (k = 12) => Array.from({ length: k }, (_, i) => ({ n: i + 1, ms: 11_000 + 250 * i, box: [200 + 4 * i, 120, 360] }));
const START = Object.freeze({
  lang: "en", move: "top_turn", move_other: "", level: "starting_turns", board: "shortboard", stance: "regular",
  note: "I fall off at the top",
});
// What the review row keeps as its answers: all but the language, which has a column of its own.
const { lang: _lang, ...answersKept } = START;
const ANSWERS = Object.freeze(answersKept);

const path = (id, rest = "") => `/coach/reviews/${id}${rest}`;
const me = (c, who) => call(c, who, "GET", "/coach/me");
const agree = (c, who, body = { ver: AGREE_VER, adult: true }) => call(c, who, "POST", "/coach/agree", body);
const start = (c, who, more = {}) => call(c, who, "POST", "/coach/reviews", { ...START, frames: listed(), ...more });
const upload = (c, who, id, n, text = FRAME) => call(c, who, "POST", path(id, `/frames/${n}`), text);
const send = (c, who, id) => call(c, who, "POST", path(id, "/send"));
const getReview = (c, who, id) => call(c, who, "GET", path(id));
const getFrame = (c, who, id, n) => call(c, who, "GET", path(id, `/frames/${n}`));
const remove = (c, who, id) => call(c, who, "DELETE", path(id));

// A start that passes; returns the review's id.
async function begin(c, who, more = {}) {
  const res = await start(c, who, more);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json.id;
}

async function uploadAll(c, who, id, ns = listed().map((f) => f.n)) {
  for (const n of ns) expect(await upload(c, who, id, n), `frame ${n}`).toEqual(OK);
}

// A started review with every listed key frame up, ready to send.
async function ready(c, who, more = {}) {
  const id = await begin(c, who, more);
  await uploadAll(c, who, id, (more.frames ?? listed()).map((f) => f.n));
  return id;
}

// A new account's whole trip: agree, start, upload and send. Returns the review's id.
async function sendNew(c, who = surfer()) {
  expect(await agree(c, who)).toEqual(OK);
  const id = await ready(c, who);
  const res = await send(c, who, id);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return id;
}

const setMeta = (c, key, value) => c.inCoach((coach) => coach.setMeta(key, value));
const getMeta = (c, key) => c.inCoach((coach) => coach.getMeta(key));
const dropMeta = (c, key) => c.rows("DELETE FROM meta WHERE key = ?", key);
const reviewRow = async (c, id) => (await c.rows("SELECT * FROM reviews WHERE id = ?", id))[0];
const quota = (c, who) => c.rows("SELECT month, used, sent FROM quota WHERE sub_hash = ? ORDER BY month", who.sub_hash);
const alarm = (c) => c.inCoach((coach) => coach.ctx.storage.getAlarm());
// Moves a review on by hand, as the alarm or Bryan would.
const setStatus = (c, id, status, more = "") => c.rows(`UPDATE reviews SET status = ?${more} WHERE id = ?`, status, id);

// Everything the coach keeps but its usage counts, to show a refusal wrote nothing.
const snapshot = async (c) => ({
  reviews: await c.rows("SELECT * FROM reviews ORDER BY id"),
  frames: await c.rows("SELECT * FROM frames ORDER BY review_id, n"),
  people: await c.rows("SELECT * FROM people ORDER BY sub_hash"),
  quota: await c.rows("SELECT * FROM quota ORDER BY sub_hash, month"),
  meta: await c.rows("SELECT * FROM meta WHERE key != 'usage' ORDER BY key"),
  alarm: await alarm(c),
});

// A review written straight into the table, in any state, with its 12 key frames up (and counted in frame_bytes) unless
// `frames` is false.
async function insertReview(c, who, { id = hex(11), status = "queued", created = T, frames = true, ...cols } = {}) {
  const row = {
    id, uid: who.uid, sub_hash: who.sub_hash, lang: "en", move: "cutback", answers: JSON.stringify(ANSWERS), status, created,
    ...cols,
  };
  const names = Object.keys(row);
  await c.rows(`INSERT INTO reviews (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, ...Object.values(row));
  if (frames) {
    for (const f of listed()) {
      await c.rows("INSERT INTO frames (review_id, n, ms, box, b64) VALUES (?, ?, ?, ?, ?)", id, f.n, f.ms, JSON.stringify(f.box), FRAME);
    }
    await c.inCoach((coach) => coach.setMeta("frame_bytes", (coach.getMeta("frame_bytes") ?? 0) + 12 * FRAME.length));
  }
  return id;
}

// ---- The whole trip -------------------------------------------------------------------------------------------------

describe("starting, uploading and sending", () => {
  it("agree, start with 12 key frames, upload all 12 and send: queued, counted, 1 left, and the alarm set for now", async () => {
    const c = await freshCoach();
    const a = surfer();
    expect(await me(c, a)).toEqual({
      status: 200,
      json: {
        left: 2, sent_left: 4, monthly: 2, month: MONTH, next_month: Date.UTC(2030, 5, 30, 16), full_today: false, stop: null,
        profile: null, agreed: false, admin: false, blocked: false, reviews: [], account: a.uid,
      },
    });
    // account is the chat account's uid (ruling P51): never the LINE sub's hash.
    expect(JSON.stringify((await me(c, a)).json)).not.toContain(a.sub_hash);
    expect(await agree(c, a)).toEqual(OK);
    expect(await c.rows("SELECT * FROM people")).toEqual([
      { sub_hash: a.sub_hash, level: null, board: null, stance: null, agreed_ver: AGREE_VER, agreed_at: T, blocked: 0 },
    ]);

    const res = await start(c, a);
    expect(res.status).toBe(200);
    expect(Object.keys(res.json)).toEqual(["id"]);
    const { id } = res.json;
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(c.asked).toEqual([a.sub_hash]);
    const row = await reviewRow(c, id);
    expect(row).toMatchObject({
      uid: a.uid, sub_hash: a.sub_hash, lang: "en", move: "top_turn", status: "uploading", created: T, sent: null, next_try: null,
      quota_month: null, given: 0,
    });
    expect(JSON.parse(row.answers)).toEqual(ANSWERS);
    expect(await c.rows("SELECT n, ms, box, b64 FROM frames WHERE review_id = ? ORDER BY n", id)).toEqual(
      listed().map((f) => ({ n: f.n, ms: f.ms, box: JSON.stringify(f.box), b64: null })),
    );
    // Still uploading: not in the list yet, nothing counted, and the answers are kept for next time.
    expect((await me(c, a)).json).toMatchObject({
      left: 2, reviews: [], agreed: true, profile: { level: "starting_turns", board: "shortboard", stance: "regular" },
    });
    expect(await getReview(c, a, id)).toEqual({
      status: 200, json: { id, status: "uploading", move: "top_turn", move_other: "", created: T, have: [], note: null },
    });

    await uploadAll(c, a, id);
    expect((await getReview(c, a, id)).json.have).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(await getMeta(c, "frame_bytes")).toBe(12 * FRAME.length);
    expect(await alarm(c)).toBeNull();

    c.clock.t = T + MIN;
    expect(await send(c, a, id)).toEqual({ status: 200, json: { ok: true, left: 1 } });
    expect(await reviewRow(c, id)).toMatchObject({ status: "queued", sent: T + MIN, next_try: T + MIN, quota_month: MONTH, given: 0 });
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
    expect(await getMeta(c, "today")).toEqual({ day: TODAY, n: 1 });
    expect(await alarm(c)).toBe(T + MIN);
    expect((await me(c, a)).json).toMatchObject({
      left: 1, sent_left: 3, full_today: false,
      reviews: [{ id, move: "top_turn", created: T, status: "reviewing", published: null, note: null }],
    });

    // Its key frame comes back as the JPEG's bytes, which the Worker answers as image/jpeg.
    const frame = await getFrame(c, a, id, 5);
    expect(frame.status).toBe(200);
    expect(frame.jpeg).toBeInstanceOf(Uint8Array);
    expect(frame.jpeg).toEqual(bytesOf(FRAME));
    expect(frame.json).toBeUndefined();
  });

  it("saves the answers' other line and note as given, and a later start's level, board and stance as the profile", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    const id = await begin(c, a, { lang: "zh", move: "other", move_other: "大浪的起乘", note: "  我常常太晚站起來  ", level: "first_waves", board: "foamie", stance: "goofy" });
    const row = await reviewRow(c, id);
    expect(row).toMatchObject({ lang: "zh", move: "other" });
    expect(JSON.parse(row.answers)).toEqual({ move: "other", move_other: "大浪的起乘", level: "first_waves", board: "foamie", stance: "goofy", note: "我常常太晚站起來" });
    expect((await me(c, a)).json.profile).toEqual({ level: "first_waves", board: "foamie", stance: "goofy" });
    // The note and the other line may be left out.
    const id2 = await begin(c, a, { note: undefined, move_other: undefined, level: "turning_well" });
    expect(JSON.parse((await reviewRow(c, id2)).answers)).toMatchObject({ move_other: "", note: "", level: "turning_well" });
    expect((await me(c, a)).json.profile).toEqual({ level: "turning_well", board: "shortboard", stance: "regular" });
  });
});

// ---- POST /coach/agree ----------------------------------------------------------------------------------------------

describe("POST /coach/agree", () => {
  it("needs this version and the 18+ tick: anything else is 403 agree with nothing saved", async () => {
    const c = await freshCoach();
    const a = surfer();
    for (const body of [{ ver: "c0", adult: true }, { ver: AGREE_VER }, { ver: AGREE_VER, adult: "true" }, { ver: AGREE_VER, adult: false }, {}, "not json"]) {
      expect(await agree(c, a, body), JSON.stringify(body)).toEqual({ status: 403, json: { error: "agree" } });
    }
    expect(await c.rows("SELECT * FROM people")).toEqual([]);
    expect(await agree(c, a)).toEqual(OK);
    expect((await me(c, a)).json.agreed).toBe(true);
  });

  it("an account that agreed to an older version hasn't agreed, and its start gets agree; agreeing again saves the new one", async () => {
    const c = await freshCoach();
    const a = surfer();
    await c.rows("INSERT INTO people (sub_hash, agreed_ver, agreed_at) VALUES (?, 'c0', ?)", a.sub_hash, T - HOUR);
    expect((await me(c, a)).json.agreed).toBe(false);
    expect(await start(c, a)).toEqual({ status: 403, json: { error: "agree" } });
    // Asked nothing of the room: the agreement is checked first.
    expect(c.asked).toEqual([]);
    c.clock.t = T + MIN;
    expect(await agree(c, a)).toEqual(OK);
    expect(await c.rows("SELECT agreed_ver, agreed_at FROM people")).toEqual([{ agreed_ver: AGREE_VER, agreed_at: T + MIN }]);
    await begin(c, a);
  });
});

// ---- Refusing a start -----------------------------------------------------------------------------------------------

describe("POST /coach/reviews", () => {
  it("refuses for each reason in turn, in order, writing nothing; another tab's upload survives, and a start that passes ends it", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    // Tab 1's review, with three key frames up.
    const tab1 = await begin(c, a);
    await uploadAll(c, a, tab1, [1, 2, 3]);
    // Every reason at once; each step lifts one.
    await c.rows("UPDATE people SET agreed_ver = 'c0', blocked = 1 WHERE sub_hash = ?", a.sub_hash);
    c.banned.add(a.sub_hash);
    await setMeta(c, "paused", true);
    await setMeta(c, "rest", { kind: "credit", until: NEXT_CREDIT, probe_at: T + 6 * HOUR });
    const open = await insertReview(c, a, { status: "queued", created: T - HOUR, sent: T - HOUR, quota_month: MONTH, frames: false });
    await setMeta(c, "today", { day: TODAY, n: 10 });
    await c.rows("INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, 2, 2)", a.sub_hash, MONTH);
    const steps = [
      [403, "agree", () => c.rows("UPDATE people SET agreed_ver = ? WHERE sub_hash = ?", AGREE_VER, a.sub_hash)],
      [403, "banned", () => c.banned.delete(a.sub_hash)],
      [403, "blocked", () => c.rows("UPDATE people SET blocked = 0 WHERE sub_hash = ?", a.sub_hash)],
      [503, "break", () => setMeta(c, "paused", false)],
      [503, "money", () => dropMeta(c, "rest")],
      [409, "in_progress", () => setStatus(c, open, "published", ", published = " + T)],
      [429, "full_today", () => setMeta(c, "today", { day: TODAY, n: 9 })],
      [429, "no_reviews_left", () => c.rows("UPDATE quota SET used = 0, sent = 4 WHERE sub_hash = ?", a.sub_hash)],
      [429, "no_reviews_left", () => c.rows("UPDATE quota SET used = 1, sent = 3 WHERE sub_hash = ?", a.sub_hash)],
    ];
    for (const [status, error, lift] of steps) {
      const before = await snapshot(c);
      const json = error === "money" ? { error, until: NEXT_CREDIT } : { error };
      // Too few frames and a bad move too, which are checked last.
      expect(await start(c, a, { frames: listed(7), move: "kickflip" }), error).toEqual({ status, json });
      expect(await snapshot(c), error).toEqual(before);
      await lift();
    }
    const before = await snapshot(c);
    expect(await start(c, a, { frames: listed(7), move: "kickflip" })).toEqual({ status: 400, json: { error: "too_few_frames" } });
    expect(await start(c, a, { move: "kickflip" })).toEqual({ status: 400, json: { error: "invalid" } });
    expect(await snapshot(c)).toEqual(before);
    // Tab 1's upload is still there, as it was.
    expect((await getReview(c, a, tab1)).json).toMatchObject({ status: "uploading", have: [1, 2, 3] });

    // The start that passes deletes it and its key frames.
    const tab2 = await begin(c, a);
    expect(await getReview(c, a, tab1)).toEqual(NOT_FOUND);
    expect(await upload(c, a, tab1, 4)).toEqual(NOT_FOUND);
    expect(await c.rows("SELECT count(*) AS n FROM frames WHERE review_id = ?", tab1)).toEqual([{ n: 0 }]);
    expect(await getMeta(c, "frame_bytes")).toBe(0);
    expect((await getReview(c, a, tab2)).json).toMatchObject({ status: "uploading", have: [] });
    // The published one is kept.
    expect((await reviewRow(c, open)).status).toBe("published");
  });

  it("ends only the account's own upload: another account's survives", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    await agree(c, a);
    await agree(c, b);
    const theirs = await begin(c, b);
    await uploadAll(c, b, theirs, [1, 2]);
    const mine = await begin(c, a);
    await begin(c, a);
    expect(await getReview(c, a, mine)).toEqual(NOT_FOUND);
    expect((await getReview(c, b, theirs)).json).toMatchObject({ status: "uploading", have: [1, 2] });
    expect(await getMeta(c, "frame_bytes")).toBe(2 * FRAME.length);
  });

  it("an account with no agreement row gets agree; a banned one banned, before blocked", async () => {
    const c = await freshCoach();
    const a = surfer();
    expect(await start(c, a)).toEqual({ status: 403, json: { error: "agree" } });
    await agree(c, a);
    c.banned.add(a.sub_hash);
    expect(await start(c, a)).toEqual({ status: 403, json: { error: "banned" } });
    expect(c.asked).toEqual([a.sub_hash]);
    expect(await c.rows("SELECT count(*) AS n FROM reviews")).toEqual([{ n: 0 }]);
  });

  it("in_progress for a review queued, calling or drafted; not for one published, rejected or failed", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    const id = await insertReview(c, a, { status: "queued" });
    for (const status of ["queued", "calling", "drafted"]) {
      await setStatus(c, id, status);
      expect(await start(c, a), status).toEqual({ status: 409, json: { error: "in_progress" } });
    }
    for (const status of ["published", "rejected", "failed"]) {
      await setStatus(c, id, status);
      await begin(c, a);
    }
    // Someone else's open review is no reason.
    const b = surfer();
    await agree(c, b);
    await insertReview(c, surfer(), { status: "drafted" });
    await begin(c, b);
  });

  it("too_few_frames: fewer than 8 listed, a number outside 1-12, or one listed twice", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    const eight = listed(8);
    const bad = [
      listed(7), [], "every one", null,
      [...eight.slice(1), { ...eight[0], n: 0 }],
      [...eight.slice(1), { ...eight[0], n: 13 }],
      [...eight.slice(1), { ...eight[0], n: 2 }],
      [...eight.slice(1), { ...eight[0], n: "1" }],
      [...eight.slice(1), { ...eight[0], n: 1.5 }],
      [...eight.slice(1), "a frame"],
    ];
    const before = await snapshot(c);
    for (const frames of bad) {
      expect(await start(c, a, { frames }), JSON.stringify(frames)).toEqual({ status: 400, json: { error: "too_few_frames" } });
    }
    expect(await snapshot(c)).toEqual(before);
    // 8 pass, in any order and any numbers 1-12.
    const id = await begin(c, a, { frames: [12, 3, 5, 1, 9, 10, 7, 2].map((n, i) => ({ n, ms: 1000 * i, box: [0, 0, 100] })) });
    expect(await c.rows("SELECT n FROM frames WHERE review_id = ? ORDER BY n", id)).toEqual([1, 2, 3, 5, 7, 9, 10, 12].map((n) => ({ n })));
  });

  it("invalid: an unknown move, level, board, stance or language, a note over 200 or move_other over 60 characters, a bad box or time, or a body that isn't JSON", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    const withFrame = (change) => ({ frames: listed().map((f, i) => (i === 4 ? { ...f, ...change } : f)) });
    const bad = [
      { move: "kickflip" }, { move: undefined }, { level: "pro" }, { level: undefined }, { board: "sup" }, { stance: "switch" },
      { lang: "ja" }, { lang: undefined }, { note: "x".repeat(201) }, { note: "浪".repeat(201) }, { note: 5 },
      { move: "other", move_other: "x".repeat(61) }, { move_other: ["x"] },
      withFrame({ box: [1, 2] }), withFrame({ box: [1, 2, 3, 4] }), withFrame({ box: [-1, 2, 3] }), withFrame({ box: [1, 8193, 3] }),
      withFrame({ box: [1, 2, 0] }), withFrame({ box: [1, 2, 8193] }), withFrame({ box: [1.5, 2, 3] }), withFrame({ box: ["1", 2, 3] }),
      withFrame({ box: { x: 1, y: 2, side: 3 } }), withFrame({ box: undefined }), withFrame({ ms: -1 }), withFrame({ ms: 1.5 }),
      withFrame({ ms: "100" }), withFrame({ ms: undefined }),
    ];
    const before = await snapshot(c);
    for (const more of bad) {
      expect(await start(c, a, more), JSON.stringify(more)).toEqual({ status: 400, json: { error: "invalid" } });
    }
    for (const body of ["not json", "[1, 2]", "null", ""]) {
      expect(await call(c, a, "POST", "/coach/reviews", body), body).toEqual({ status: 400, json: { error: "invalid" } });
    }
    expect(await snapshot(c)).toEqual(before);
    // The edges pass.
    for (const more of [
      { note: "x".repeat(200) }, { note: "浪".repeat(200) }, { move: "other", move_other: "x".repeat(60) },
      withFrame({ box: [0, 0, 1] }), withFrame({ box: [8192, 8192, 8192] }), withFrame({ ms: 0 }),
    ]) {
      expect((await start(c, a, more)).status, JSON.stringify(more).slice(0, 80)).toBe(200);
    }
  });
});

// ---- stopFor --------------------------------------------------------------------------------------------------------

describe("stopFor()", () => {
  it("is break while paused or stopped, without a key, from 8% of a daily limit, or over 700 MB of key frames or a 950 MB database", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      const BREAK = { kind: "break" };
      expect(coach.stopFor(T)).toBeNull();
      for (const key of ["paused", "stopped"]) {
        coach.setMeta(key, true);
        expect(coach.stopFor(T), key).toEqual(BREAK);
        coach.setMeta(key, false);
        expect(coach.stopFor(T), key).toBeNull();
      }
      const real = coach.env;
      for (const key of ["", "   ", undefined]) {
        coach.env = { ...real, ANTHROPIC_API_KEY: key };
        expect(coach.stopFor(T), JSON.stringify(key)).toEqual(BREAK);
      }
      coach.env = real;
      expect(coach.stopFor(T)).toBeNull();
      // The usage guard: 8% of 100,000 requests, 5,000,000 rows read and 100,000 rows written, today (UTC).
      coach.usage("req", 0);
      coach.used.req = 7_999;
      expect(coach.stopFor(T)).toBeNull();
      coach.used.req = 8_000;
      expect(coach.stopFor(T)).toEqual(BREAK);
      coach.used.req = 0;
      // Reading meta while it checks adds a row or two, so the rows are tried a little below and at the line.
      coach.used.read = 399_900;
      expect(coach.stopFor(T)).toBeNull();
      coach.used.read = 400_000;
      expect(coach.stopFor(T)).toEqual(BREAK);
      coach.used.read = 0;
      coach.used.write = 7_900;
      expect(coach.stopFor(T)).toBeNull();
      coach.used.write = 8_000;
      expect(coach.stopFor(T)).toEqual(BREAK);
      coach.used.write = 0;
      // The size guard.
      coach.setMeta("frame_bytes", 700_000_000);
      expect(coach.stopFor(T)).toBeNull();
      coach.setMeta("frame_bytes", 700_000_001);
      expect(coach.stopFor(T)).toEqual(BREAK);
      coach.setMeta("frame_bytes", 0);
      // The runtime gives the database's size, so the backstop can work at all.
      expect(coach.sql.databaseSize).toBeGreaterThan(0);
      const sql = coach.sql;
      for (const [size, stop] of [[950_000_000, null], [950_000_001, BREAK]]) {
        coach.sql = { exec: (...args) => sql.exec(...args), databaseSize: size };
        expect(coach.stopFor(T), String(size)).toEqual(stop);
      }
      coach.sql = sql;
      expect(coach.stopFor(T)).toBeNull();
    });
  });

  it("is money until the rest's end while a rest holds, and until the next credit day once the credit month's spend reaches US$78 + extra", async () => {
    const c = await freshCoach();
    await c.inCoach((coach) => {
      coach.setMeta("rest", { kind: "limit", until: Date.UTC(2030, 6, 1), probe_at: null });
      expect(coach.stopFor(T)).toEqual({ kind: "money", until: Date.UTC(2030, 6, 1) });
      // A break says more than money.
      coach.setMeta("paused", true);
      expect(coach.stopFor(T)).toEqual({ kind: "break" });
      coach.setMeta("paused", false);
      coach.sql.exec("DELETE FROM meta WHERE key = 'rest'");
      expect(coach.stopFor(T)).toBeNull();

      const start = Date.UTC(2030, 4, 16); // the credit month T is in
      coach.setMeta("spend", { start, usd: 77.99, reviews: 520 });
      expect(coach.stopFor(T)).toBeNull();
      coach.setMeta("spend", { start, usd: 78, reviews: 521 });
      expect(coach.stopFor(T)).toEqual({ kind: "money", until: NEXT_CREDIT });
      // COACH_EXTRA_USD raises the line.
      const real = coach.env;
      coach.env = { ...real, COACH_EXTRA_USD: "10" };
      expect(coach.stopFor(T)).toBeNull();
      coach.setMeta("spend", { start, usd: 88, reviews: 590 });
      expect(coach.stopFor(T)).toEqual({ kind: "money", until: NEXT_CREDIT });
      coach.env = real;
      // Spend from an earlier credit month isn't this month's.
      coach.setMeta("spend", { start: Date.UTC(2030, 3, 16), usd: 90, reviews: 600 });
      expect(coach.stopFor(T)).toBeNull();
      // On the 16th at 08:00 in Taiwan the month's spend starts again.
      coach.setMeta("spend", { start, usd: 78, reviews: 521 });
      expect(coach.stopFor(NEXT_CREDIT - 1)).toEqual({ kind: "money", until: NEXT_CREDIT });
      expect(coach.stopFor(NEXT_CREDIT)).toBeNull();
    });
  });

  it("with ANTHROPIC_API_KEY empty, /coach/me says break, a start gets break, and nothing is fetched", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    await c.inCoach((coach) => {
      coach.env = { ...coach.env, ANTHROPIC_API_KEY: "" };
    });
    expect((await me(c, a)).json.stop).toEqual({ kind: "break" });
    expect(await start(c, a)).toEqual({ status: 503, json: { error: "break" } });
    expect(await c.rows("SELECT count(*) AS n FROM reviews")).toEqual([{ n: 0 }]);
    // fetched is checked empty after each test.
  });

  it("/coach/me shows a pause as break and a rest as money with its end", async () => {
    const c = await freshCoach();
    const a = surfer();
    await setMeta(c, "paused", true);
    expect((await me(c, a)).json.stop).toEqual({ kind: "break" });
    await setMeta(c, "paused", false);
    await setMeta(c, "rest", { kind: "credit", until: NEXT_CREDIT, probe_at: T + HOUR });
    expect((await me(c, a)).json.stop).toEqual({ kind: "money", until: NEXT_CREDIT });
  });
});

// ---- Today's limit --------------------------------------------------------------------------------------------------

describe("today's limit", () => {
  it("takes 10 a Taiwan day: the 11th start gets full_today; on autopilot the 11th passes and the 41st gets full_today", async () => {
    const c = await freshCoach();
    for (let i = 0; i < 10; i++) await sendNew(c);
    expect(await getMeta(c, "today")).toEqual({ day: TODAY, n: 10 });
    expect(await c.inCoach((coach) => coach.dailyLimit())).toBe(10);
    const k = surfer();
    await agree(c, k);
    expect(await start(c, k)).toEqual({ status: 429, json: { error: "full_today" } });
    expect((await me(c, k)).json.full_today).toBe(true);

    await setMeta(c, "autopilot", true);
    expect(await c.inCoach((coach) => coach.dailyLimit())).toBe(40);
    expect((await me(c, k)).json.full_today).toBe(false);
    const eleventh = await ready(c, k);
    expect(await send(c, k, eleventh)).toEqual({ status: 200, json: { ok: true, left: 1 } });
    expect(await getMeta(c, "today")).toEqual({ day: TODAY, n: 11 });

    await setMeta(c, "today", { day: TODAY, n: 40 });
    const l = surfer();
    await agree(c, l);
    expect(await start(c, l)).toEqual({ status: 429, json: { error: "full_today" } });
    // Until 00:00 in Taiwan (16:00 UTC), when a new day starts at 0.
    c.clock.t = Date.UTC(2030, 5, 3, 15, 59, 59, 999);
    expect(await start(c, l)).toEqual({ status: 429, json: { error: "full_today" } });
    c.clock.t = Date.UTC(2030, 5, 3, 16, 0);
    expect((await me(c, l)).json.full_today).toBe(false);
    const id = await ready(c, l);
    expect((await send(c, l, id)).status).toBe(200);
    expect(await getMeta(c, "today")).toEqual({ day: "2030-06-04", n: 1 });
  });

  it("send checks today's limit again: of two reviews started at 9 sent today, the second send gets full_today and writes nothing", async () => {
    const c = await freshCoach();
    await setMeta(c, "today", { day: TODAY, n: 9 });
    const a = surfer();
    const b = surfer();
    await agree(c, a);
    await agree(c, b);
    const ida = await ready(c, a);
    const idb = await ready(c, b);
    expect((await send(c, a, ida)).status).toBe(200);
    const before = await snapshot(c);
    expect(await send(c, b, idb)).toEqual({ status: 429, json: { error: "full_today" } });
    expect(await snapshot(c)).toEqual(before);
    expect((await reviewRow(c, idb)).status).toBe("uploading");
    expect(await quota(c, b)).toEqual([]);
  });

  it("two sends at once with 9 sent today: exactly one takes the 10th place", async () => {
    const c = await freshCoach();
    await setMeta(c, "today", { day: TODAY, n: 9 });
    const people = [surfer(), surfer()];
    const ids = [];
    for (const who of people) {
      await agree(c, who);
      ids.push(await ready(c, who));
    }
    const answers = await Promise.all(people.map((who, i) => send(c, who, ids[i])));
    expect(answers.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(answers.find((r) => r.status === 429).json).toEqual({ error: "full_today" });
    expect(await getMeta(c, "today")).toEqual({ day: TODAY, n: 10 });
    expect(await c.rows("SELECT status, count(*) AS n FROM reviews GROUP BY status ORDER BY status")).toEqual([
      { status: "queued", n: 1 }, { status: "uploading", n: 1 },
    ]);
    expect(await c.rows("SELECT used, sent FROM quota")).toEqual([{ used: 1, sent: 1 }]);
  });
});

// ---- The month's count ----------------------------------------------------------------------------------------------

describe("the month's count", () => {
  it("survives deleting and remaking the account: the same LINE account with a new uid has none left", async () => {
    const c = await freshCoach();
    const a = surfer();
    const first = await sendNew(c, a);
    await setStatus(c, first, "published", `, published = ${T}`);
    const second = await ready(c, a);
    expect((await send(c, a, second)).json).toEqual({ ok: true, left: 0 });
    await setStatus(c, second, "published", `, published = ${T}`);
    expect((await me(c, a)).json).toMatchObject({ left: 0, sent_left: 2 });
    // The account goes, as forget() will take it (its reviews and its people row), and comes back with a new uid.
    for (const { id } of await c.rows("SELECT id FROM reviews")) expect(await remove(c, a, id)).toEqual(OK);
    await c.rows("DELETE FROM people WHERE sub_hash = ?", a.sub_hash);
    const again = { ...surfer(), sub_hash: a.sub_hash };
    expect((await me(c, again)).json).toMatchObject({ left: 0, sent_left: 2, agreed: false, reviews: [] });
    await agree(c, again);
    expect(await start(c, again)).toEqual({ status: 429, json: { error: "no_reviews_left" } });
    expect(await quota(c, again)).toEqual([{ month: MONTH, used: 2, sent: 2 }]);
  });

  it("DELETE of a queued and of a published review leaves the count as it was", async () => {
    const c = await freshCoach();
    const a = surfer();
    const queued = await sendNew(c, a);
    expect(await remove(c, a, queued)).toEqual(OK);
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
    const published = await ready(c, a);
    expect((await send(c, a, published)).json).toEqual({ ok: true, left: 0 });
    await setStatus(c, published, "published", `, published = ${T}`);
    expect(await remove(c, a, published)).toEqual(OK);
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 2, sent: 2 }]);
    expect((await me(c, a)).json).toMatchObject({ left: 0, reviews: [] });
  });

  it("giveBack() gives a review's count back once, to the month it was sent in, never below 0, and never lowers sent", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await sendNew(c, a);
    await setStatus(c, id, "rejected");
    expect(await c.inCoach((coach) => coach.giveBack(id))).toBe(true);
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 0, sent: 1 }]);
    expect((await reviewRow(c, id)).given).toBe(1);
    expect(await c.inCoach((coach) => coach.giveBack(id))).toBe(false);
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 0, sent: 1 }]);
    // In the month it was sent in, whatever month it is now.
    const id2 = await ready(c, a);
    await send(c, a, id2);
    await setStatus(c, id2, "failed");
    c.clock.t = Date.UTC(2030, 6, 2);
    expect(await c.inCoach((coach) => coach.giveBack(id2))).toBe(true);
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 0, sent: 2 }]);
    // Never below 0.
    const b = surfer();
    c.clock.t = T;
    const id3 = await sendNew(c, b);
    await c.rows("UPDATE quota SET used = 0 WHERE sub_hash = ?", b.sub_hash);
    expect(await c.inCoach((coach) => coach.giveBack(id3))).toBe(true);
    expect(await quota(c, b)).toEqual([{ month: MONTH, used: 0, sent: 1 }]);
    // Nothing to give back for a review never sent, or one that isn't there.
    await setStatus(c, id3, "rejected");
    const unsent = await begin(c, b);
    expect(await c.inCoach((coach) => coach.giveBack(unsent))).toBe(false);
    expect((await reviewRow(c, unsent)).given).toBe(0);
    expect(await c.inCoach((coach) => coach.giveBack("no-such-review"))).toBe(false);
  });

  it("after three give-backs, the 5th review of a month gets no_reviews_left: an account sends 4 at most", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    for (let i = 1; i <= 4; i++) {
      const id = await ready(c, a);
      expect((await send(c, a, id)).json, `send ${i}`).toEqual({ ok: true, left: i < 4 ? 1 : 0 });
      if (i < 4) {
        await setStatus(c, id, "rejected");
        expect(await c.inCoach((coach) => coach.giveBack(id))).toBe(true);
      } else {
        await setStatus(c, id, "published", `, published = ${T}`);
      }
    }
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 4 }]);
    expect((await me(c, a)).json).toMatchObject({ left: 0, sent_left: 0 });
    expect(await start(c, a)).toEqual({ status: 429, json: { error: "no_reviews_left" } });
    // A 5th already started, with every key frame up (written by hand, as no start gets through now), can't be sent.
    const fifth = await insertReview(c, a, { status: "uploading" });
    const before = await snapshot(c);
    expect(await send(c, a, fifth)).toEqual({ status: 429, json: { error: "no_reviews_left" } });
    expect(await snapshot(c)).toEqual(before);
  });

  it("send checks the count and stopFor again, and writes nothing when either refuses", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    const id = await ready(c, a);
    const refused = async (answer, change, undo) => {
      await change();
      const before = await snapshot(c);
      expect(await send(c, a, id)).toEqual(answer);
      expect(await snapshot(c)).toEqual(before);
      await undo();
    };
    await refused(
      { status: 429, json: { error: "no_reviews_left" } },
      () => c.rows("INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, 2, 2)", a.sub_hash, MONTH),
      () => c.rows("DELETE FROM quota"),
    );
    await refused(
      { status: 429, json: { error: "no_reviews_left" } },
      () => c.rows("INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, 0, 4)", a.sub_hash, MONTH),
      () => c.rows("DELETE FROM quota"),
    );
    await refused({ status: 503, json: { error: "break" } }, () => setMeta(c, "paused", true), () => setMeta(c, "paused", false));
    await refused(
      { status: 503, json: { error: "money", until: NEXT_CREDIT } },
      () => setMeta(c, "spend", { start: Date.UTC(2030, 4, 16), usd: 79, reviews: 530 }),
      () => dropMeta(c, "spend"),
    );
    await refused({ status: 429, json: { error: "full_today" } }, () => setMeta(c, "today", { day: TODAY, n: 10 }), () => dropMeta(c, "today"));
    expect(await send(c, a, id)).toEqual({ status: 200, json: { ok: true, left: 1 } });
  });

  it("Review Focus 3: started at 23:59 on 31 October in Taiwan and sent at 00:01 on 1 November, it counts in November", async () => {
    const c = await freshCoach(Date.UTC(2030, 9, 31, 15, 59));
    const a = surfer();
    await agree(c, a);
    await c.rows("INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, '2030-10', 1, 1)", a.sub_hash);
    expect((await me(c, a)).json).toMatchObject({ month: "2030-10", next_month: Date.UTC(2030, 9, 31, 16), left: 1 });
    const id = await ready(c, a);
    c.clock.t = Date.UTC(2030, 9, 31, 16, 1);
    expect(await send(c, a, id)).toEqual({ status: 200, json: { ok: true, left: 1 } });
    expect((await reviewRow(c, id)).quota_month).toBe("2030-11");
    expect(await quota(c, a)).toEqual([{ month: "2030-10", used: 1, sent: 1 }, { month: "2030-11", used: 1, sent: 1 }]);
    expect(await getMeta(c, "today")).toEqual({ day: "2030-11-01", n: 1 });
    expect((await me(c, a)).json).toMatchObject({ month: "2030-11", next_month: Date.UTC(2030, 10, 30, 16), left: 1, sent_left: 3 });
  });
});

// ---- Key frames -----------------------------------------------------------------------------------------------------

describe("key frames", () => {
  it("refuses one that isn't listed, holds a quote, isn't base64, is a PNG, is 2576 px or is over 140 KB, keeping what was there", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    const id = await begin(c, a, { frames: listed(8) });
    await upload(c, a, id, 2);
    const before = await snapshot(c);
    const BAD = { status: 400, json: { error: "bad_frame" } };
    expect(await upload(c, a, id, 9)).toEqual(BAD);
    expect(await upload(c, a, id, 12)).toEqual(BAD);
    for (const text of [JSON.stringify(FRAME), `"${FRAME.slice(2)}`, `${FRAME.slice(0, -4)}"AA=`, PNG, jpegB64({ w: 2576, h: 2576 }), jpegB64({ w: 2576, h: 1449 }), "", "%%%%"]) {
      expect(await upload(c, a, id, 1, text), text.slice(0, 24)).toEqual(BAD);
      expect(await upload(c, a, id, 2, text), text.slice(0, 24)).toEqual(BAD);
    }
    expect(await upload(c, a, id, 1, "A".repeat(FRAME_TEXT_MAX + 4))).toEqual({ status: 413, json: { error: "too_big" } });
    expect(await snapshot(c)).toEqual(before);
    // Once sent, no more.
    await uploadAll(c, a, id, [1, 3, 4, 5, 6, 7, 8]);
    expect((await send(c, a, id)).status).toBe(200);
    const sent = await snapshot(c);
    expect(await upload(c, a, id, 1, OTHER)).toEqual({ status: 409, json: { error: "not_uploading" } });
    expect(await snapshot(c)).toEqual(sent);
  });

  it("a re-sent key frame replaces the old one: one row with the new text, and frame_bytes follows", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    const id = await begin(c, a);
    expect(await upload(c, a, id, 3, FRAME)).toEqual(OK);
    expect(await upload(c, a, id, 3, OTHER)).toEqual(OK);
    expect(await c.rows("SELECT n, b64 FROM frames WHERE review_id = ? AND b64 IS NOT NULL", id)).toEqual([{ n: 3, b64: OTHER }]);
    expect(await getMeta(c, "frame_bytes")).toBe(OTHER.length);
    expect(await upload(c, a, id, 4, FRAME)).toEqual(OK);
    expect(await upload(c, a, id, 3, FRAME)).toEqual(OK);
    expect(await getMeta(c, "frame_bytes")).toBe(2 * FRAME.length);
    expect(await c.rows("SELECT count(*) AS n FROM frames WHERE review_id = ?", id)).toEqual([{ n: 12 }]);
    expect((await getFrame(c, a, id, 3)).jpeg).toEqual(bytesOf(FRAME));
  });

  it("send with a key frame missing gets missing_frames and counts nothing", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    const id = await begin(c, a);
    await uploadAll(c, a, id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
    const before = await snapshot(c);
    expect(await send(c, a, id)).toEqual({ status: 409, json: { error: "missing_frames" } });
    expect(await snapshot(c)).toEqual(before);
    expect(await getFrame(c, a, id, 11)).toEqual(NOT_FOUND);
    await upload(c, a, id, 11);
    expect((await send(c, a, id)).status).toBe(200);
    // A second send finds it no longer uploading, and counts nothing more.
    expect(await send(c, a, id)).toEqual({ status: 409, json: { error: "not_uploading" } });
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
  });

  it("a review that isn't there gets not_found on every route", async () => {
    const c = await freshCoach();
    const a = surfer();
    await agree(c, a);
    const id = "A".repeat(22);
    for (const answer of [await getReview(c, a, id), await getFrame(c, a, id, 1), await upload(c, a, id, 1), await send(c, a, id), await remove(c, a, id)]) {
      expect(answer).toEqual(NOT_FOUND);
    }
    // Nor does anything that doesn't look like a review's path.
    for (const [method, p] of [["GET", "/coach/reviews/short"], ["GET", path(id, "/frames/13")], ["GET", path(id, "/frames/0")], ["PUT", path(id)], ["GET", "/coach/agree"], ["GET", "/coach/me/"]]) {
      expect(await call(c, a, method, p), `${method} ${p}`).toEqual(NOT_FOUND);
    }
  });
});

// ---- Who sees what --------------------------------------------------------------------------------------------------

describe("access", () => {
  it("another account gets 404 for someone else's review, key frame, upload, send and DELETE, and nothing changes", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    await agree(c, a);
    await agree(c, b);
    const id = await ready(c, a);
    const before = await snapshot(c);
    expect(await getReview(c, b, id)).toEqual(NOT_FOUND);
    expect(await getFrame(c, b, id, 1)).toEqual(NOT_FOUND);
    expect(await upload(c, b, id, 1, OTHER)).toEqual(NOT_FOUND);
    expect(await send(c, b, id)).toEqual(NOT_FOUND);
    expect(await remove(c, b, id)).toEqual(NOT_FOUND);
    // The same LINE account under another uid is another account too.
    const sameLine = { ...surfer(), sub_hash: a.sub_hash };
    expect(await getReview(c, sameLine, id)).toEqual(NOT_FOUND);
    // Bryan sees it and its key frames, but it isn't his to upload, send or delete.
    expect((await getReview(c, BRYAN, id)).status).toBe(200);
    expect((await getFrame(c, BRYAN, id, 1)).jpeg).toEqual(bytesOf(FRAME));
    expect(await upload(c, BRYAN, id, 1, OTHER)).toEqual(NOT_FOUND);
    expect(await send(c, BRYAN, id)).toEqual(NOT_FOUND);
    expect(await remove(c, BRYAN, id)).toEqual(NOT_FOUND);
    expect(await snapshot(c)).toEqual(before);
    // And b's list doesn't hold it once sent.
    expect((await send(c, a, id)).status).toBe(200);
    expect((await me(c, b)).json.reviews).toEqual([]);
    expect((await me(c, BRYAN)).json).toMatchObject({ admin: true, reviews: [] });
  });

  it("the owner never gets the draft, English copy, flags, Redo notes or cost, nor the review before it is published; the admin gets them all", async () => {
    const c = await freshCoach();
    const a = surfer();
    const draft = { went_well: { frame: 3, title: "Low over the board", detail: "Knees bent." }, progress: "" };
    const english = { went_well: { title: "Low and over the board" } };
    const id = await insertReview(c, a, {
      status: "drafted", created: T - 2 * HOUR, sent: T - 2 * HOUR, quota_month: MONTH, next_try: T - 2 * HOUR, attempts: 1, redos: 1,
      model: "the-model", tok_in: 15_000, tok_out: 2_500, cost: 0.11, draft: JSON.stringify(draft), english: JSON.stringify(english),
      flags: JSON.stringify(["cant_see"]), warnings: JSON.stringify(["words"]), redo_note: JSON.stringify(["focus on the back foot"]),
    });
    const owner = await getReview(c, a, id);
    expect(owner).toEqual({
      status: 200,
      json: {
        id, status: "drafted", move: "cutback", move_other: "", created: T - 2 * HOUR, have: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        note: null,
      },
    });
    const admin = await getReview(c, BRYAN, id);
    expect(admin.status).toBe(200);
    expect(admin.json).toMatchObject({
      id, uid: a.uid, sub_hash: a.sub_hash, status: "drafted", move: "cutback", lang: "en", answers: ANSWERS, attempts: 1, redos: 1,
      sent: T - 2 * HOUR, quota_month: MONTH, model: "the-model", tok_in: 15_000, tok_out: 2_500, cost: 0.11, draft, english,
      flags: ["cant_see"], warnings: ["words"], redo_note: ["focus on the back foot"], final: null, checked: 0, hold: 0, given: 0,
      have: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      frames: listed().map((f) => ({ n: f.n, ms: f.ms, box: f.box })),
    });
    const columns = (await c.rows("SELECT name FROM pragma_table_info('reviews')")).map((r) => r.name);
    for (const column of columns) expect(Object.hasOwn(admin.json, column), column).toBe(true);
    expect(JSON.stringify(admin.json)).not.toContain(FRAME.slice(0, 40));

    // Published: the owner gets the published text, its key frames' times and whether Bryan checked it, and still none of
    // the rest.
    const final = { ...draft, went_well: { ...draft.went_well, title: "Low and over the board" } };
    await c.rows("UPDATE reviews SET status = 'published', published = ?, final = ?, checked = 1 WHERE id = ?", T - HOUR, JSON.stringify(final), id);
    const published = (await getReview(c, a, id)).json;
    expect(published).toEqual({
      id, status: "published", move: "cutback", move_other: "", created: T - 2 * HOUR, have: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      note: null,
      review: { text: final, times: Object.fromEntries(listed().map((f) => [f.n, f.ms])), checked: true },
    });
    for (const word of ["Low over the board", "english", "flags", "redo", "cost", "the-model", "back foot", "words"]) {
      expect(JSON.stringify(published), word).not.toContain(word);
    }
    await c.rows("UPDATE reviews SET checked = 0 WHERE id = ?", id);
    expect((await getReview(c, a, id)).json.review.checked).toBe(false);
  });

  it("/coach/me lists the account's own reviews newest first, leaves out the one uploading, puts the status in the surfer's words, and gives the note", async () => {
    const c = await freshCoach();
    const a = surfer();
    const at = (h) => T - h * HOUR;
    const ids = {};
    for (const [name, status, h, more] of [
      ["queued", "queued", 1, {}],
      ["calling", "calling", 2, {}],
      ["drafted", "drafted", 3, {}],
      ["published", "published", 4, { published: at(3.5) }],
      ["rejected", "rejected", 5, { surfer_note: "We couldn't see you. Try filming closer." }],
      ["not_surf", "rejected", 6, { hold: 1 }],
      ["failed", "failed", 7, {}],
      ["uploading", "uploading", 0, {}],
    ]) {
      ids[name] = await insertReview(c, a, { status, created: at(h), frames: false, ...more });
    }
    await insertReview(c, surfer(), { status: "published", created: at(0.5), frames: false, published: at(0.2) });
    expect((await me(c, a)).json.reviews).toEqual([
      { id: ids.queued, move: "cutback", move_other: "", created: at(1), status: "reviewing", published: null, note: null },
      { id: ids.calling, move: "cutback", move_other: "", created: at(2), status: "reviewing", published: null, note: null },
      { id: ids.drafted, move: "cutback", move_other: "", created: at(3), status: "reviewing", published: null, note: null },
      { id: ids.published, move: "cutback", move_other: "", created: at(4), status: "ready", published: at(3.5), note: null },
      {
        id: ids.rejected, move: "cutback", move_other: "", created: at(5), status: "not_reviewed", published: null,
        note: "We couldn't see you. Try filming closer.",
      },
      { id: ids.not_surf, move: "cutback", move_other: "", created: at(6), status: "not_reviewed", published: null, note: "not_surf" },
      // Failed on our side, and given back: the page says so, and that it doesn't count.
      { id: ids.failed, move: "cutback", move_other: "", created: at(7), status: "not_reviewed", published: null, note: "failed" },
    ]);
    expect((await getReview(c, a, ids.not_surf)).json).toMatchObject({ status: "rejected", note: "not_surf" });
    expect((await getReview(c, a, ids.rejected)).json.note).toBe("We couldn't see you. Try filming closer.");
    expect((await getReview(c, a, ids.failed)).json.note).toBe("failed");
  });

  it("gives an \"other\" move's own name as the surfer wrote it (move_other), in /coach/me and the review's GET", async () => {
    const c = await freshCoach();
    const a = surfer();
    const answers = JSON.stringify({ ...ANSWERS, move: "other", move_other: "Air reverse" });
    const id = await insertReview(c, a, { move: "other", answers, status: "published", published: T, frames: false });
    expect((await me(c, a)).json.reviews).toEqual([
      { id, move: "other", move_other: "Air reverse", created: T, status: "ready", published: T, note: null },
    ]);
    expect((await getReview(c, a, id)).json).toMatchObject({ move: "other", move_other: "Air reverse" });
  });
});

// ---- DELETE ---------------------------------------------------------------------------------------------------------

describe("DELETE /coach/reviews/{id}", () => {
  it("removes the review and its key frames in any state, lowers frame_bytes, and gives nothing back", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    const queued = await sendNew(c, a);
    await agree(c, b);
    const theirs = await ready(c, b);
    expect(await getMeta(c, "frame_bytes")).toBe(24 * FRAME.length);
    expect(await remove(c, a, queued)).toEqual(OK);
    expect(await c.rows("SELECT count(*) AS n FROM frames WHERE review_id = ?", queued)).toEqual([{ n: 0 }]);
    expect(await reviewRow(c, queued)).toBeUndefined();
    expect(await getMeta(c, "frame_bytes")).toBe(12 * FRAME.length);
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
    expect(await getReview(c, a, queued)).toEqual(NOT_FOUND);
    expect(await remove(c, a, queued)).toEqual(NOT_FOUND);
    // The other account's is untouched.
    expect((await getReview(c, b, theirs)).json.have).toHaveLength(12);
    for (const status of ["uploading", "calling", "drafted", "published", "rejected", "failed"]) {
      const id = await insertReview(c, a, { status, sent: T, quota_month: MONTH });
      expect(await remove(c, a, id), status).toEqual(OK);
      expect(await reviewRow(c, id), status).toBeUndefined();
      expect(await c.rows("SELECT count(*) AS n FROM frames WHERE review_id = ?", id), status).toEqual([{ n: 0 }]);
      expect(await getMeta(c, "frame_bytes"), status).toBe(12 * FRAME.length);
    }
    expect(await quota(c, a)).toEqual([{ month: MONTH, used: 1, sent: 1 }]);
  });
});

// ---- Through the Worker ---------------------------------------------------------------------------------------------

describe("through the Worker", () => {
  it("a key frame's GET with a signed-in token, through the room's whoIs and the coach over RPC, arrives as image/jpeg with the same bytes", async () => {
    const r = await newRoom("coach-send", T);
    const user = await addUser(r);
    const c = await freshCoach();
    const who = { uid: user.id, sub_hash: user.sub, role: "user" };
    await agree(c, who);
    const id = await ready(c, who);
    const fakeEnv = { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS, ROOM: { getByName: () => r.stub }, COACH: { getByName: () => c.stub } };
    const request = new Request(`https://chat.example${path(id, "/frames/7")}`, {
      headers: { Origin: "https://waveslave.tw", Authorization: `Bearer ${user.token}` },
    });
    const res = await worker.fetch(request, fakeEnv, { waitUntil() {}, passThroughOnException() {} });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytesOf(FRAME));
  });
});
