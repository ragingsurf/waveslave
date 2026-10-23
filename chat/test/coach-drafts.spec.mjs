// Tests for Bryan's Drafts list and his actions in chat/src/coach.js (docs/superpowers/specs/2026-10-22-ai-coach-design.md,
// "What Bryan sees", "The review", "When something goes wrong", "Backend" and "Testing", and the plan's Review Focus 4):
// GET /admin/coach/drafts, POST /admin/coach/drafts/{id} (approve, redo, reject, giveback, clear, ban, withdraw), POST
// /admin/coach/settings, and the surfer's POST /coach/reviews/{id}/report. They run inside the Workers runtime (see
// vitest.config.mjs). Run from chat/: npx vitest run test/coach-drafts.spec.mjs
//
// Each test has a coach of its own (newCoach) with its clock at T, years ahead, so no alarm a test sets goes off by
// itself. The coach is called as the Worker calls it, stub.route({method, path, who, body}), with `who` made by hand, and
// its room stub is replaced (ruling R1) by one that records each ban. Reviews are written straight into the tables, as
// the alarm would leave them. Every fetch throws, the AI's and the mail's included, and each test checks that none was
// tried and nothing was logged that it didn't expect.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGREE_VER, TEXT_FIELDS } from "../src/coach-guide.js";
import { goodReply, jpegB64 } from "./coach-fixtures.mjs";
import { DAY, HOUR, MIN, SEC, hex, newCoach } from "./helpers.mjs";

// 12:00 UTC (20:00 in Taiwan) on 3 June, years ahead. The credit month it is in started at 08:00 Taiwan on 16 May.
const T = Date.UTC(2030, 5, 3, 12, 0);
const MONTH = "2030-06"; // T's Taiwan month
const CREDIT_START = Date.UTC(2030, 4, 16);
const NEXT_CREDIT = Date.UTC(2030, 5, 16);

const FRAME = jpegB64();
const TWELVE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const OK = Object.freeze({ status: 200, json: { ok: true } });
const NOT_FOUND = Object.freeze({ status: 404, json: { error: "not_found" } });
const INVALID = Object.freeze({ status: 400, json: { error: "invalid" } });
const STATE = Object.freeze({ status: 409, json: { error: "state" } });
const ADMIN = Object.freeze({ status: 403, json: { error: "admin" } });
const BREAK = Object.freeze({ status: 503, json: { error: "break" } });

// Every fetch throws; each test checks that none was tried. console.error is recorded, and a test that expects a line
// takes it from `logged`.
let fetched;
let logged;
beforeEach(() => {
  fetched = [];
  logged = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const { url } = new Request(input, init);
    fetched.push(url);
    throw new Error(`unexpected fetch of ${url}`);
  });
  vi.spyOn(console, "error").mockImplementation((...args) => {
    logged.push(args);
  });
});

afterEach(() => {
  expect(fetched).toEqual([]);
  expect(logged).toEqual([]);
  vi.restoreAllMocks();
});

// ---- Coaches, accounts and reviews ----------------------------------------------------------------------------------

// A coach of its own with its clock at `at`, whose room stub records each ban in c.bans and answers it with c.banAnswer
// (or throws, while c.roomDown is set).
async function freshCoach(at = T) {
  const c = await newCoach("drafts", at);
  c.bans = [];
  c.banAnswer = { ok: true };
  c.roomDown = false;
  await c.inCoach((coach) => {
    coach.roomStub = () => ({
      async isBanned(sub_hash) {
        return c.bans.includes(sub_hash);
      },
      async banAccount(sub_hash) {
        if (c.roomDown) throw new Error("the room is down");
        c.bans.push(sub_hash);
        return c.banAnswer;
      },
    });
  });
  return c;
}

// Who the Worker says is calling: a new account each time, or Bryan's.
const surfer = () => ({ uid: `u-${hex(6)}`, sub_hash: `sub-${hex(8)}`, role: "user" });
const BRYAN = Object.freeze({ uid: "u-bryan", sub_hash: "sub-bryan", role: "admin" });

const ANSWERS = Object.freeze({
  move: "top_turn", move_other: "", level: "starting_turns", board: "shortboard", stance: "regular", note: "I fall off at the top",
});

// A review written straight into the table, as the alarm leaves one: drafted by default, sent 5 hours before T, with
// goodReply() as its draft, its 12 key frames up (counted in frame_bytes) unless `frames` is false, and its count in the
// Taiwan month's quota unless `counted` is false, for an account that agreed. Any column can be set in `cols`.
async function insertReview(c, who, opts = {}) {
  const { id = hex(11), frames = true, counted = true, ...cols } = opts;
  const row = {
    id, uid: who.uid, sub_hash: who.sub_hash, lang: "en", move: "top_turn", answers: JSON.stringify(ANSWERS),
    status: "drafted", created: T - 6 * HOUR, sent: T - 5 * HOUR, quota_month: MONTH, draft: JSON.stringify(goodReply()),
    model: "coach-test-model", tok_in: 15_400, tok_out: 3_000, cost: 0.1216, ...cols,
  };
  const names = Object.keys(row);
  await c.rows(`INSERT INTO reviews (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, ...Object.values(row));
  await c.rows(
    `INSERT INTO people (sub_hash, level, board, stance, agreed_ver, agreed_at) VALUES (?, 'starting_turns', 'shortboard',
     'regular', ?, ?) ON CONFLICT (sub_hash) DO NOTHING`,
    who.sub_hash, AGREE_VER, T - DAY,
  );
  if (counted) {
    await c.rows(
      `INSERT INTO quota (sub_hash, month, used, sent) VALUES (?, ?, 1, 1)
       ON CONFLICT (sub_hash, month) DO UPDATE SET used = used + 1, sent = sent + 1`,
      who.sub_hash, MONTH,
    );
  }
  if (frames) {
    for (const n of TWELVE) {
      await c.rows(
        "INSERT INTO frames (review_id, n, ms, box, b64) VALUES (?, ?, ?, ?, ?)",
        id, n, 11_000 + 250 * (n - 1), JSON.stringify([200, 120, 360]), FRAME,
      );
    }
    await c.inCoach((coach) => coach.setMeta("frame_bytes", (coach.getMeta("frame_bytes") ?? 0) + 12 * FRAME.length));
  }
  return id;
}

// A clip the coach found isn't surfing, held for Bryan (ruling R16), as the alarm leaves it: rejected, hold 1, its
// "not_surf" warning, no flags, its key frames kept.
const insertNotSurf = (c, who, more = {}) => {
  const reply = { ...goodReply(), is_surf_clip: false };
  const warnings = JSON.stringify(["not_surf"]);
  return insertReview(c, who, { status: "rejected", hold: 1, draft: JSON.stringify(reply), warnings, ...more });
};
// A flagged clip (ruling R16): rejected, hold 1, its flags, no key frames, no draft, and the account blocked.
async function insertFlagged(c, who, flags = ["sexual"]) {
  const id = await insertReview(c, who, { status: "rejected", hold: 1, flags: JSON.stringify(flags), draft: null, frames: false });
  await c.rows("UPDATE people SET blocked = 1 WHERE sub_hash = ?", who.sub_hash);
  return id;
}

// One route, as the Worker hands it over: the body as text.
const call = (c, who, method, path, body = "") =>
  c.stub.route({ method, path, who, body: typeof body === "string" ? body : JSON.stringify(body) });
const act = (c, id, body, who = BRYAN) => call(c, who, "POST", `/admin/coach/drafts/${id}`, body);
const drafts = (c, who = BRYAN) => call(c, who, "GET", "/admin/coach/drafts");
const settings = (c, body, who = BRYAN) => call(c, who, "POST", "/admin/coach/settings", body);
const report = (c, who, id, body = {}) => call(c, who, "POST", `/coach/reviews/${id}/report`, body);
const ownerView = async (c, who, id) => (await call(c, who, "GET", `/coach/reviews/${id}`)).json;
const myReviews = async (c, who) => (await call(c, who, "GET", "/coach/me")).json.reviews;

const reviewRow = async (c, id) => (await c.rows("SELECT * FROM reviews WHERE id = ?", id))[0];
const used = async (c, who) =>
  (await c.rows("SELECT used FROM quota WHERE sub_hash = ? AND month = ?", who.sub_hash, MONTH))[0].used;
const frameCount = async (c, id) => (await c.rows("SELECT count(*) AS n FROM frames WHERE review_id = ?", id))[0].n;
const examples = (c) => c.rows("SELECT move, level, draft, bryan, note, review_id, at FROM examples ORDER BY id");
const getMeta = (c, key) => c.inCoach((coach) => coach.getMeta(key));
const setMeta = (c, key, value) => c.inCoach((coach) => coach.setMeta(key, value));
const alarmAt = (c) => c.inCoach((coach) => coach.ctx.storage.getAlarm());

// Everything the coach keeps but its usage counts, to show a refusal wrote nothing.
const snapshot = async (c) => ({
  reviews: await c.rows("SELECT * FROM reviews ORDER BY id"),
  frames: await c.rows("SELECT review_id, n FROM frames ORDER BY review_id, n"),
  people: await c.rows("SELECT * FROM people ORDER BY sub_hash"),
  quota: await c.rows("SELECT * FROM quota ORDER BY sub_hash, month"),
  examples: await c.rows("SELECT * FROM examples ORDER BY id"),
  meta: await c.rows("SELECT * FROM meta WHERE key != 'usage' ORDER BY key"),
  alarm: await alarmAt(c),
});

// Bryan's edits, one per field named, each `text`.
const editsOf = (fields, text) => Object.fromEntries(fields.map((field) => [field, text]));

// ---- Who may use them -----------------------------------------------------------------------------------------------

describe("Bryan's routes", () => {
  it("refuse anyone but the admin with 403 admin on every path, the review's owner too, and change nothing", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    const held = await insertNotSurf(c, surfer());
    const before = await snapshot(c);
    for (const who of [a, surfer(), { ...BRYAN, role: "user" }]) {
      expect(await drafts(c, who)).toEqual(ADMIN);
      for (const action of ["approve", "redo", "reject", "giveback", "clear", "ban", "withdraw"]) {
        for (const target of [id, held, hex(11)]) {
          expect(await act(c, target, { action, note: "A note" }, who), action).toEqual(ADMIN);
        }
      }
      expect(await settings(c, { autopilot: true, paused: true }, who)).toEqual(ADMIN);
      expect(await settings(c, { start_again: true, test_email: true }, who)).toEqual(ADMIN);
    }
    expect(await snapshot(c)).toEqual(before);
    expect(c.bans).toEqual([]);
  });

  it("answer 404 not_found for an unknown review, 400 invalid for a bad body, before looking at the review", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    const before = await snapshot(c);
    expect(await act(c, hex(11), { action: "approve" })).toEqual(NOT_FOUND);
    expect(await act(c, hex(11), { action: "ban" })).toEqual(NOT_FOUND);
    const bad = [
      "", "not json", "[]", "null", {}, { action: "publish" }, { action: "APPROVE" }, { action: ["approve"] },
      { action: "approve", note: 7 }, { action: "approve", note: "n".repeat(201) },
      { action: "reject", note: "x".repeat(201) }, { action: "giveback", note: "浪".repeat(201) },
      { action: "redo", edits: { progress: "Lower" }, note: "A note" },
    ];
    for (const body of bad) {
      expect(await act(c, id, body), JSON.stringify(body)).toEqual(INVALID);
      expect(await act(c, hex(11), body), JSON.stringify(body)).toEqual(INVALID);
    }
    expect(await snapshot(c)).toEqual(before);
  });
});

// ---- Approve --------------------------------------------------------------------------------------------------------

describe("Approve", () => {
  it("with edits publishes the edited text, the owner sees it checked, and the draft, edit and note become an example", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    const edits = { "main_fix.title": "  Keep your weight forward  ", progress: "Lower than last time." };
    expect(await act(c, id, { action: "approve", edits, note: " Shorter titles " })).toEqual(OK);

    const row = await reviewRow(c, id);
    expect(row).toMatchObject({ status: "published", published: T, checked: 1, next_try: null, handled_at: T });
    const want = goodReply();
    want.main_fix.title = "Keep your weight forward";
    want.progress = "Lower than last time.";
    expect(JSON.parse(row.final)).toEqual(want);
    // The draft stays as the coach wrote it.
    expect(JSON.parse(row.draft)).toEqual(goodReply());

    const view = await ownerView(c, a, id);
    expect(view.status).toBe("published");
    expect(view.review).toEqual({
      text: want, times: Object.fromEntries(TWELVE.map((n) => [n, 11_000 + 250 * (n - 1)])), checked: true,
    });
    expect((await myReviews(c, a))[0]).toMatchObject({ id, status: "ready", published: T, note: null });

    expect(await examples(c)).toEqual([{
      move: "top_turn", level: "starting_turns", draft: row.draft, bryan: row.final, note: "Shorter titles", review_id: id, at: T,
    }]);
  });

  it("without edits publishes the draft as it is, with no example", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    expect(await act(c, id, { action: "approve" })).toEqual(OK);
    const row = await reviewRow(c, id);
    expect(row).toMatchObject({ status: "published", published: T, checked: 1 });
    expect(row.final).toBe(row.draft);
    // An edit that changes nothing is no edit.
    const same = await insertReview(c, surfer());
    expect(await act(c, same, { action: "approve", edits: { "drill.title": goodReply().drill.title }, note: "Fine" })).toEqual(OK);
    expect((await reviewRow(c, same)).final).toBe((await reviewRow(c, same)).draft);
    expect(await examples(c)).toEqual([]);
    expect(await used(c, a)).toBe(1);
  });

  it("of an autopilot review (checked 0) sets checked to 1, keeps its publish time, and edits its published text", async () => {
    const c = await freshCoach();
    const a = surfer();
    const draft = JSON.stringify(goodReply());
    const id = await insertReview(c, a, { status: "published", published: T - HOUR, handled_at: T - HOUR, final: draft, checked: 0 });
    expect((await ownerView(c, a, id)).review.checked).toBe(false);
    expect(await act(c, id, { action: "approve" })).toEqual(OK);
    expect(await reviewRow(c, id)).toMatchObject({ status: "published", published: T - HOUR, checked: 1, final: draft, handled_at: T });
    expect((await ownerView(c, a, id)).review.checked).toBe(true);

    // Approving it again with an edit changes the published text, and that is an example.
    expect(await act(c, id, { action: "approve", edits: { "drill.how": "Do 20." } })).toEqual(OK);
    const row = await reviewRow(c, id);
    expect(JSON.parse(row.final).drill.how).toBe("Do 20.");
    expect(await examples(c)).toEqual([{
      move: "top_turn", level: "starting_turns", draft, bryan: row.final, note: null, review_id: id, at: T,
    }]);
  });

  it("is refused with 409 state but on a drafted or published review", async () => {
    const c = await freshCoach();
    const a = surfer();
    const ids = [
      await insertReview(c, a, { status: "uploading", sent: null, quota_month: null, draft: null, counted: false }),
      await insertReview(c, a, { status: "queued", next_try: T }),
      await insertReview(c, a, { status: "calling", next_try: T + 16 * MIN }),
      await insertReview(c, a, { status: "rejected", surfer_note: "Film closer" }),
      await insertReview(c, a, { status: "failed", given: 1 }),
      await insertNotSurf(c, a),
    ];
    const before = await snapshot(c);
    for (const id of ids) expect(await act(c, id, { action: "approve" })).toEqual(STATE);
    expect(await snapshot(c)).toEqual(before);
  });
});

describe("Bryan's edits (Review Focus 4)", () => {
  it("an empty, blank or 1,001-character edit, an unknown field or one not text is invalid, and nothing changes", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    const before = await snapshot(c);
    const bad = [
      { "went_well.title": "" }, { progress: "   \n " }, { "main_fix.why": "a".repeat(1_001) },
      { "main_fix.why": "浪".repeat(1_001) }, { "drill.how": "🌊".repeat(1_001) }, { "went_well.frame": "1" },
      { went_well: { title: "Nested" } }, { "is_surf_clip": "true" }, { english: "x" }, { "drill.title": 5 },
      { "drill.title": null }, ["went_well.title"], "Lower", 7,
    ];
    for (const edits of bad) {
      expect(await act(c, id, { action: "approve", edits }), JSON.stringify(edits)).toEqual(INVALID);
    }
    expect(await snapshot(c)).toEqual(before);
  });

  it("nine 1,000-character 中文 fields pass, length counted in characters after trimming", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer(), { lang: "zh", draft: JSON.stringify(goodReply(TWELVE, "zh")) });
    const edits = editsOf(TEXT_FIELDS, `  ${"浪".repeat(1_000)}\n`);
    expect(await act(c, id, { action: "approve", edits })).toEqual(OK);
    const final = JSON.parse((await reviewRow(c, id)).final);
    for (const [part, field] of TEXT_FIELDS.map((path) => path.split("."))) {
      expect(field === undefined ? final[part] : final[part][field]).toBe("浪".repeat(1_000));
    }
    // Characters outside the BMP count once each, though each is two UTF-16 units.
    const wave = await insertReview(c, surfer());
    expect(await act(c, wave, { action: "approve", edits: { "drill.how": "🌊".repeat(1_000) } })).toEqual(OK);
    expect(JSON.parse((await reviewRow(c, wave)).final).drill.how).toBe("🌊".repeat(1_000));
  });

  it("markup is stored and shown as the text it is", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    const markup = `<img src=x onerror="alert(1)"> & <b>bold</b>`;
    expect(await act(c, id, { action: "approve", edits: { "went_well.title": markup } })).toEqual(OK);
    expect(JSON.parse((await reviewRow(c, id)).final).went_well.title).toBe(markup);
    expect((await ownerView(c, a, id)).review.text.went_well.title).toBe(markup);
    expect(await act(c, await insertReview(c, a), { action: "approve", edits: { "drill.title": "<img src=x>" } })).toEqual(OK);
  });
});

// ---- Redo -----------------------------------------------------------------------------------------------------------

describe("Redo", () => {
  it("queues the review again, keeping its old draft, with the note kept and an example; a third is refused", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a, { attempts: 1, warnings: JSON.stringify(["unusable"]) });
    const draft = (await reviewRow(c, id)).draft;
    expect(await act(c, id, { action: "redo", note: "  Focus on the back foot " })).toEqual(OK);
    expect(await reviewRow(c, id)).toMatchObject({
      status: "queued", next_try: T, redos: 1, attempts: 0, draft, redo_note: JSON.stringify(["Focus on the back foot"]),
    });
    expect(await alarmAt(c)).toBe(T);
    expect(await examples(c)).toEqual([{
      move: "top_turn", level: "starting_turns", draft, bryan: null, note: "Focus on the back foot", review_id: id, at: T,
    }]);
    // While it is queued, it is no longer Bryan's to act on.
    expect(await act(c, id, { action: "redo", note: "Again" })).toEqual(STATE);
    // The surfer sees it still being reviewed, never the note.
    expect(await ownerView(c, a, id)).toMatchObject({ status: "queued", note: null });
    expect((await myReviews(c, a))[0]).toMatchObject({ status: "reviewing", note: null });

    // The alarm brings a new draft back; a second Redo adds its note after the first.
    c.clock.t = T + HOUR;
    await c.rows("UPDATE reviews SET status = 'drafted', next_try = NULL WHERE id = ?", id);
    expect(await act(c, id, { action: "redo", note: "Shorter drill" })).toEqual(OK);
    expect(await reviewRow(c, id)).toMatchObject({
      status: "queued", next_try: T + HOUR, redos: 2, redo_note: JSON.stringify(["Focus on the back foot", "Shorter drill"]),
    });
    expect((await examples(c)).map((e) => e.note)).toEqual(["Focus on the back foot", "Shorter drill"]);

    await c.rows("UPDATE reviews SET status = 'drafted', next_try = NULL WHERE id = ?", id);
    const before = await snapshot(c);
    expect(await act(c, id, { action: "redo", note: "One more" })).toEqual({ status: 409, json: { error: "redo_limit" } });
    expect(await snapshot(c)).toEqual(before);
    expect(await used(c, a)).toBe(1);
  });

  it("needs a note of 1 to 200 characters", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    const before = await snapshot(c);
    for (const note of [undefined, null, "", "   ", "x".repeat(201), 3]) {
      expect(await act(c, id, { action: "redo", note }), String(note)).toEqual(INVALID);
    }
    expect(await snapshot(c)).toEqual(before);
    expect(await act(c, id, { action: "redo", note: "後".repeat(200) })).toEqual(OK);
  });

  it("is refused at the money stop with 503 money, and while the coach takes a break with 503 break", async () => {
    const c = await freshCoach();
    const id = await insertReview(c, surfer());
    await setMeta(c, "spend", { start: CREDIT_START, usd: 78, reviews: 520 });
    const before = await snapshot(c);
    expect(await act(c, id, { action: "redo", note: "Back foot" })).toEqual({
      status: 503, json: { error: "money", until: NEXT_CREDIT },
    });
    expect(await snapshot(c)).toEqual(before);

    await setMeta(c, "spend", { start: CREDIT_START, usd: 12.4, reviews: 96 });
    await setMeta(c, "paused", true);
    expect(await act(c, id, { action: "redo", note: "Back foot" })).toEqual(BREAK);
    await setMeta(c, "paused", false);
    expect(await act(c, id, { action: "redo", note: "Back foot" })).toEqual(OK);
  });

  it("is refused (409 state) unless at least 8 of the review's key frames are still kept", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    await c.rows("UPDATE frames SET b64 = NULL WHERE review_id = ? AND n > 7", id);
    const before = await snapshot(c);
    expect(await act(c, id, { action: "redo", note: "Back foot" })).toEqual(STATE);
    expect(await snapshot(c)).toEqual(before);
    await c.rows("UPDATE frames SET b64 = ? WHERE review_id = ? AND n = 8", FRAME, id);
    expect(await act(c, id, { action: "redo", note: "Back foot" })).toEqual(OK);

    // An old reported review whose key frames are gone can't be redone, but can still be withdrawn.
    const old = await insertReview(c, a, {
      status: "published", published: T - 40 * DAY, final: JSON.stringify(goodReply()), frames: false,
    });
    expect(await report(c, a, old, { line: "Wrong" })).toEqual(OK);
    expect(await act(c, old, { action: "redo", note: "Look again" })).toEqual(STATE);
    expect(await reviewRow(c, old)).toMatchObject({ status: "drafted", redos: 0 });
    expect(await act(c, old, { action: "withdraw", note: "Sorry" })).toEqual(OK);
  });

  it("of a reported review lets its next approval publish the new draft", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    expect(await act(c, id, { action: "approve", edits: { "drill.title": "Bryan's drill" } })).toEqual(OK);
    expect(await report(c, a, id, { line: "The fix is wrong" })).toEqual(OK);
    expect(await act(c, id, { action: "redo", note: "Look again at the turn" })).toEqual(OK);
    const fresh = goodReply();
    fresh.drill.title = "The coach's new drill";
    await c.rows("UPDATE reviews SET status = 'drafted', next_try = NULL, draft = ? WHERE id = ?", JSON.stringify(fresh), id);
    expect(await act(c, id, { action: "approve" })).toEqual(OK);
    expect(JSON.parse((await reviewRow(c, id)).final)).toEqual(fresh);
  });
});

// ---- Reject, Give back, Clear, Ban and Withdraw ---------------------------------------------------------------------

describe("Reject", () => {
  it("gives the review back and the owner sees Bryan's note; a second is refused and gives nothing back", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    expect(await used(c, a)).toBe(1);
    expect(await act(c, id, { action: "reject", note: " We couldn't see you. Try filming closer. " })).toEqual(OK);
    expect(await reviewRow(c, id)).toMatchObject({
      status: "rejected", surfer_note: "We couldn't see you. Try filming closer.", given: 1, hold: 0, handled_at: T,
    });
    expect(await used(c, a)).toBe(0);
    expect(await ownerView(c, a, id)).toMatchObject({ status: "rejected", note: "We couldn't see you. Try filming closer." });
    expect((await myReviews(c, a))[0]).toMatchObject({ status: "not_reviewed", note: "We couldn't see you. Try filming closer." });
    expect(await act(c, id, { action: "reject", note: "Again" })).toEqual(STATE);
    expect(await used(c, a)).toBe(0);
  });

  it("needs a note, and is refused but on a drafted review", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    expect(await act(c, id, { action: "reject" })).toEqual(INVALID);
    expect(await act(c, id, { action: "reject", note: " " })).toEqual(INVALID);
    for (const more of [{ status: "published", published: T - HOUR, final: "{}" }, { status: "queued", next_try: T }]) {
      expect(await act(c, await insertReview(c, a, more), { action: "reject", note: "No" })).toEqual(STATE);
    }
    expect(await act(c, await insertNotSurf(c, a), { action: "reject", note: "No" })).toEqual(STATE);
    expect(await used(c, a)).toBe(4);
  });
});

describe("Give back", () => {
  it("on a held not-surf clip lowers used once, deletes its key frames and ends the hold; a second gets state", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertNotSurf(c, a);
    expect(await ownerView(c, a, id)).toMatchObject({ note: "not_surf" });
    expect(await used(c, a)).toBe(1);
    expect(await getMeta(c, "frame_bytes")).toBe(12 * FRAME.length);
    c.clock.t = T + MIN;
    expect(await act(c, id, { action: "giveback" })).toEqual(OK);
    expect(await reviewRow(c, id)).toMatchObject({ status: "rejected", hold: 0, given: 1, handled_at: T + MIN });
    expect(await used(c, a)).toBe(0);
    expect(await frameCount(c, id)).toBe(0);
    expect(await getMeta(c, "frame_bytes")).toBe(0);
    // The surfer is still told "We couldn't review this clip."
    expect(await ownerView(c, a, id)).toMatchObject({ status: "rejected", note: "not_surf" });
    expect((await myReviews(c, a))[0]).toMatchObject({ status: "not_reviewed", note: "not_surf" });
    expect(await act(c, id, { action: "giveback" })).toEqual(STATE);
    expect(await used(c, a)).toBe(0);
  });

  it("is refused for a flagged clip, a drafted one and a rejected one no longer held", async () => {
    const c = await freshCoach();
    const a = surfer();
    const ids = [
      await insertFlagged(c, a), await insertReview(c, a), await insertReview(c, a, { status: "rejected", surfer_note: "No" }),
    ];
    const before = await snapshot(c);
    for (const id of ids) expect(await act(c, id, { action: "giveback" })).toEqual(STATE);
    expect(await snapshot(c)).toEqual(before);
  });
});

describe("Clear", () => {
  it("lifts the account's block and every held flagged review's hold, giving nothing back", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    const first = await insertFlagged(c, a, ["refusal"]);
    const second = await insertFlagged(c, a, ["under_18"]);
    const notSurf = await insertNotSurf(c, a);
    const other = await insertFlagged(c, b);
    c.clock.t = T + MIN;
    expect(await act(c, first, { action: "clear" })).toEqual(OK);
    expect((await c.rows("SELECT blocked FROM people WHERE sub_hash = ?", a.sub_hash))[0].blocked).toBe(0);
    for (const id of [first, second]) {
      expect(await reviewRow(c, id)).toMatchObject({ status: "rejected", hold: 0, given: 0, handled_at: T + MIN });
      // The surfer is still told "We couldn't review this clip." (ruling R16).
      expect(await ownerView(c, a, id)).toMatchObject({ note: "not_surf" });
    }
    // A not-surf clip waits for Give back or Ban, and another account's block stays.
    expect(await reviewRow(c, notSurf)).toMatchObject({ hold: 1 });
    expect(await reviewRow(c, other)).toMatchObject({ hold: 1 });
    expect((await c.rows("SELECT blocked FROM people WHERE sub_hash = ?", b.sub_hash))[0].blocked).toBe(1);
    expect(await used(c, a)).toBe(3);
    expect(await act(c, first, { action: "clear" })).toEqual(STATE);
    expect(await act(c, notSurf, { action: "clear" })).toEqual(STATE);
  });
});

describe("Ban", () => {
  it("bans the LINE account in the room, then rejects its open and held reviews with their key frames, giving none back", async () => {
    const c = await freshCoach();
    const a = surfer();
    const again = { ...surfer(), sub_hash: a.sub_hash }; // the same LINE account, deleted and made again
    const b = surfer();
    const target = await insertReview(c, a);
    const queued = await insertReview(c, again, { status: "queued", next_try: T });
    const held = await insertNotSurf(c, a, { quota_month: "2030-05", counted: false });
    const published = await insertReview(c, a, { status: "published", published: T - HOUR, final: JSON.stringify(goodReply()) });
    const others = await insertReview(c, b);
    expect(await used(c, a)).toBe(3);

    c.clock.t = T + MIN;
    expect(await act(c, target, { action: "ban" })).toEqual(OK);
    expect(c.bans).toEqual([a.sub_hash]);
    for (const id of [target, queued, held]) {
      expect(await reviewRow(c, id)).toMatchObject({ status: "rejected", hold: 0, given: 0, next_try: null, handled_at: T + MIN });
      expect(await frameCount(c, id)).toBe(0);
    }
    expect(await used(c, a)).toBe(3);
    // A published review stays as it is, and so does another account's.
    expect(await reviewRow(c, published)).toMatchObject({ status: "published", handled_at: null });
    expect(await frameCount(c, published)).toBe(12);
    expect(await reviewRow(c, others)).toMatchObject({ status: "drafted" });
    expect(await getMeta(c, "frame_bytes")).toBe(2 * 12 * FRAME.length);
  });

  it("from a published review takes that one down too", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a, { status: "published", published: T - HOUR, final: JSON.stringify(goodReply()) });
    expect(await act(c, id, { action: "ban" })).toEqual(OK);
    expect(await reviewRow(c, id)).toMatchObject({ status: "rejected", hold: 0, given: 0 });
    expect(await frameCount(c, id)).toBe(0);
  });

  it("after a Redo leaves the owner's note null", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    expect(await act(c, id, { action: "redo", note: "Back foot" })).toEqual(OK);
    expect(await act(c, id, { action: "ban" })).toEqual(OK);
    expect(await ownerView(c, a, id)).toMatchObject({ status: "rejected", note: null });
    expect((await myReviews(c, a))[0]).toMatchObject({ status: "not_reviewed", note: null });
    expect(await used(c, a)).toBe(1);
  });

  it("changes nothing when the room fails (503 break, the error's name logged) or refuses an admin account (409 state)", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    await insertReview(c, a, { status: "queued", next_try: T });
    const before = await snapshot(c);
    c.roomDown = true;
    expect(await act(c, id, { action: "ban" })).toEqual(BREAK);
    expect(logged).toEqual([["coach: the room's ban failed:", "Error"]]);
    logged.length = 0;
    expect(await snapshot(c)).toEqual(before);
    c.roomDown = false;
    c.banAnswer = { error: "admin" };
    expect(await act(c, id, { action: "ban" })).toEqual(STATE);
    expect(await snapshot(c)).toEqual(before);
  });
});

describe("Withdraw", () => {
  it("takes down a published review with a note and gives it back", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a, { status: "published", published: T - HOUR, final: JSON.stringify(goodReply()), checked: 1 });
    expect(await act(c, id, { action: "withdraw" })).toEqual(INVALID);
    expect(await act(c, id, { action: "withdraw", note: "Sorry, this one was wrong." })).toEqual(OK);
    expect(await reviewRow(c, id)).toMatchObject({
      status: "rejected", surfer_note: "Sorry, this one was wrong.", given: 1, handled_at: T,
    });
    expect(await used(c, a)).toBe(0);
    expect((await ownerView(c, a, id)).review).toBeUndefined();
    expect(await act(c, id, { action: "withdraw", note: "Again" })).toEqual(STATE);
  });

  it("after a report gives the review back once", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a, { status: "published", published: T - HOUR, final: JSON.stringify(goodReply()), checked: 1 });
    expect(await report(c, a, id, { line: "This isn't my clip" })).toEqual(OK);
    expect(await act(c, id, { action: "withdraw", note: "Withdrawn after your report." })).toEqual(OK);
    expect(await reviewRow(c, id)).toMatchObject({ status: "rejected", given: 1, report: "This isn't my clip" });
    expect(await used(c, a)).toBe(0);
    expect(await act(c, id, { action: "withdraw", note: "Again" })).toEqual(STATE);
    expect(await act(c, id, { action: "reject", note: "Again" })).toEqual(STATE);
    expect(await used(c, a)).toBe(0);
  });

  it("is refused for a draft that was never published", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a);
    expect(await act(c, id, { action: "withdraw", note: "No" })).toEqual(STATE);
    expect(await reviewRow(c, id)).toMatchObject({ status: "drafted", given: 0 });
  });
});

// ---- The surfer's report --------------------------------------------------------------------------------------------

describe("Something wrong? (report)", () => {
  it("sends a published review back to Drafts marked Reported, with the surfer's line", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a, {
      status: "published", published: T - HOUR, handled_at: T - HOUR, final: JSON.stringify(goodReply()), checked: 1,
    });
    expect(await report(c, a, id, { line: "  That isn't me in key frame 3  " })).toEqual(OK);
    expect(await reviewRow(c, id)).toMatchObject({
      status: "drafted", report: "That isn't me in key frame 3", published: T - HOUR, handled_at: null,
    });
    expect((await drafts(c)).json.handled).toEqual([]);
    expect((await myReviews(c, a))[0]).toMatchObject({ status: "reviewing" });
    const { waiting } = (await drafts(c)).json;
    expect(waiting.map((r) => [r.id, r.reported, r.report])).toEqual([[id, true, "That isn't me in key frame 3"]]);
    // Reported again only once it is published again.
    expect(await report(c, a, id, { line: "Again" })).toEqual(STATE);
  });

  it("takes no line, and refuses a line over 200 characters", async () => {
    const c = await freshCoach();
    const a = surfer();
    const published = { status: "published", published: T - HOUR, final: JSON.stringify(goodReply()) };
    const id = await insertReview(c, a, published);
    for (const body of [{ line: "x".repeat(201) }, { line: 5 }, "nope", "[]"]) {
      expect(await report(c, a, id, body), JSON.stringify(body)).toEqual(INVALID);
    }
    expect(await report(c, a, id, {})).toEqual(OK);
    expect(await reviewRow(c, id)).toMatchObject({ status: "drafted", report: "" });
    expect((await drafts(c)).json.waiting[0].reported).toBe(true);
    const other = await insertReview(c, a, published);
    expect(await report(c, a, other, { line: "浪".repeat(200) })).toEqual(OK);
  });

  it("is the owner's only: another account gets not_found, and only a published review may be reported", async () => {
    const c = await freshCoach();
    const a = surfer();
    const id = await insertReview(c, a, { status: "published", published: T - HOUR, final: JSON.stringify(goodReply()) });
    const before = await snapshot(c);
    expect(await report(c, surfer(), id, { line: "Not mine" })).toEqual(NOT_FOUND);
    expect(await report(c, BRYAN, id, { line: "Bryan's" })).toEqual(NOT_FOUND);
    expect(await report(c, a, hex(11), { line: "Gone" })).toEqual(NOT_FOUND);
    expect(await snapshot(c)).toEqual(before);
    for (const more of [{}, { status: "queued", next_try: T }, { status: "rejected", surfer_note: "No" }, { status: "failed" }]) {
      expect(await report(c, a, await insertReview(c, a, more), { line: "Wrong" })).toEqual(STATE);
    }
  });
});

// ---- The Drafts list ------------------------------------------------------------------------------------------------

describe("GET /admin/coach/drafts", () => {
  it("lists drafts and held reviews waiting, oldest first, with their profile, key frame times and wait, and no frame", async () => {
    const c = await freshCoach();
    const a = surfer();
    const b = surfer();
    const newer = await insertReview(c, a, { sent: T - HOUR });
    const older = await insertReview(c, b, { sent: T - 5 * HOUR, lang: "zh", draft: JSON.stringify(goodReply(TWELVE, "zh")) });
    const notSurf = await insertNotSurf(c, surfer(), { sent: T - 3 * HOUR });
    const flagged = await insertFlagged(c, surfer());
    await c.rows("UPDATE reviews SET sent = ? WHERE id = ?", T - 2 * HOUR, flagged);
    await insertReview(c, surfer(), { status: "queued", next_try: T });
    await insertReview(c, surfer(), { status: "uploading", sent: null, quota_month: null, counted: false });

    const res = await drafts(c);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).not.toContain(FRAME.slice(0, 40));
    const { waiting } = res.json;
    expect(waiting.map((r) => r.id)).toEqual([older, notSurf, flagged, newer]);
    const first = waiting[0];
    expect(first).toMatchObject({
      id: older, uid: b.uid, sub_hash: b.sub_hash, lang: "zh", move: "top_turn", status: "drafted", answers: ANSWERS,
      draft: goodReply(TWELVE, "zh"), flags: [], warnings: [], redo_note: [], hold: 0, reported: false, report: null,
      waited_ms: 5 * HOUR, profile: { level: "starting_turns", board: "shortboard", stance: "regular", blocked: false },
      times: Object.fromEntries(TWELVE.map((n) => [n, 11_000 + 250 * (n - 1)])), have: TWELVE, cost: 0.1216,
    });
    expect(first.frames).toHaveLength(12);
    expect(first.frames[0]).toEqual({ n: 1, ms: 11_000, box: [200, 120, 360] });
    expect(waiting[1]).toMatchObject({ status: "rejected", hold: 1, flags: [], warnings: ["not_surf"], have: TWELVE });
    expect(waiting[2]).toMatchObject({ status: "rejected", hold: 1, flags: ["sexual"], have: [], frames: [], draft: null });
    expect(waiting[2].profile.blocked).toBe(true);
  });

  it("then the last 50 handled, the last handled first (handled_at): published, rejected and failed reviews", async () => {
    const c = await freshCoach();
    const a = surfer();
    const handled = [];
    // The ones started first were handled last.
    for (let k = 0; k < 53; k++) {
      const status = ["published", "rejected", "failed"][k % 3];
      const more = status === "published" ? { published: T - 2 * HOUR, final: JSON.stringify(goodReply()) } : {};
      const cols = { status, sent: T - 3 * HOUR + k * SEC, handled_at: T - k * MIN, frames: false, counted: false, ...more };
      handled.push(await insertReview(c, a, cols));
    }
    // Not handled: a draft, a clip held (handled by the alarm, but waiting for Bryan) and a reported review.
    await insertReview(c, a, { frames: false, counted: false });
    await insertNotSurf(c, a, { handled_at: T, frames: false, counted: false });
    await insertReview(c, a, { published: T - HOUR, report: "Wrong", frames: false, counted: false });
    const json = (await drafts(c)).json;
    expect(json.waiting).toHaveLength(3);
    expect(json.handled.map((r) => r.id)).toEqual(handled.slice(0, 50));
    expect(json.handled[0]).toMatchObject({ status: "published", final: goodReply(), reported: false, handled_at: T });
  });

  it("reads about as many rows as it shows, however many reviews are kept", async () => {
    const c = await freshCoach();
    const a = surfer();
    const final = JSON.stringify(goodReply());
    // 900 handled reviews, a third each published (approved without changes), rejected and failed, the ones started
    // first handled last.
    const handled = await c.inCoach((coach) => {
      const ids = [];
      for (let k = 0; k < 900; k++) {
        const status = ["published", "rejected", "failed"][k % 3];
        const id = hex(11);
        ids.push(id);
        coach.sql.exec(
          `INSERT INTO reviews (id, uid, sub_hash, lang, move, answers, status, created, sent, published, handled_at,
             draft, final, checked)
           VALUES (?, ?, ?, 'en', 'top_turn', ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          id, a.uid, a.sub_hash, JSON.stringify(ANSWERS), status, T - 2 * DAY + k, T - 2 * DAY + k,
          status === "published" ? T - DAY : null, T - k * MIN, final, status === "published" ? final : null,
        );
      }
      return ids;
    });
    await insertReview(c, a, { frames: false, counted: false });
    await insertReview(c, a, { frames: false, counted: false });
    await insertNotSurf(c, a, { frames: false, counted: false });
    // Each statement's rows read while the coach drew the list.
    const reads = await c.inCoach((coach) => {
      const real = coach.sql;
      const seen = [];
      coach.sql = {
        exec(query, ...binds) {
          const cursor = real.exec(query, ...binds);
          seen.push({ query, cursor });
          return cursor;
        },
      };
      try {
        const { json } = coach.getDrafts();
        expect(json.waiting).toHaveLength(3);
        expect(json.handled.map((r) => r.id)).toEqual(handled.slice(0, 50));
        expect(json.settings.unchanged).toEqual({ n: 20, of: 20 });
      } finally {
        coach.sql = real;
      }
      return seen.map(({ query, cursor }) => ({ query, read: cursor.rowsRead }));
    });
    // One that read every published, every rejected or every failed review would read 300 or more.
    for (const { query, read } of reads) expect(read, query).toBeLessThan(150);
  });

  it("settings: autopilot, pause, stop, the credit month's spend, and approved without changes over the last 20", async () => {
    const c = await freshCoach();
    const a = surfer();
    expect((await drafts(c)).json.settings).toEqual({
      autopilot: false, paused: false, stopped: false, spend: { usd: 0, stop: 78, reviews: 0 }, unchanged: { n: 0, of: 0 },
    });

    // 25 approved, oldest first: the 5 oldest unchanged, then in the last 20, 12 unchanged, 4 edited, 3 redone and 1
    // both. Then 2 published on autopilot that Bryan hasn't approved, a rejected one and a draft, which don't count.
    const kinds = [
      ...Array(5).fill("same"), ...Array(6).fill("same"), "edit", "redo", "same", "edit", "both", "same", "redo", "edit",
      "same", "same", "redo", "edit", "same", "same",
    ];
    expect(kinds).toHaveLength(25);
    // Started in the opposite order to the one they are approved in, so the count must go by when they were approved:
    // by the order they were started in, it would be 14 of 20.
    const ids = [];
    for (const kind of [...kinds].reverse()) {
      ids.push(await insertReview(c, a, { frames: false, counted: false, redos: kind === "redo" || kind === "both" ? 1 : 0 }));
    }
    ids.reverse(); // ids[k] is kinds[k]'s review
    for (const [k, kind] of kinds.entries()) {
      c.clock.t = T + k * SEC;
      const edits = kind === "edit" || kind === "both" ? { "drill.how": "Do 20 a day." } : undefined;
      expect(await act(c, ids[k], { action: "approve", edits })).toEqual(OK);
    }
    const draft = JSON.stringify(goodReply());
    for (let k = 0; k < 2; k++) {
      await insertReview(c, a, { status: "published", published: T, final: draft, checked: 0, frames: false, counted: false });
    }
    await insertReview(c, a, { status: "rejected", surfer_note: "No", frames: false, counted: false });
    await insertReview(c, a, { frames: false, counted: false });

    await setMeta(c, "autopilot", true);
    await setMeta(c, "paused", true);
    await setMeta(c, "stopped", true);
    await setMeta(c, "spend", { start: CREDIT_START, usd: 12.4, reviews: 96 });
    await c.inCoach((coach) => {
      coach.env = { ...coach.env, COACH_EXTRA_USD: "5" };
    });
    expect((await drafts(c)).json.settings).toEqual({
      autopilot: true, paused: true, stopped: true, spend: { usd: 12.4, stop: 83, reviews: 96 }, unchanged: { n: 12, of: 20 },
    });
  });
});

// ---- When the alarm handles a review (ruling P39) --------------------------------------------------------------------

describe("the alarm's outcomes", () => {
  it("set handled_at when a review fails, publishes on autopilot, is skipped as banned, flagged or found not surf", async () => {
    const c = await freshCoach();
    const owners = {};
    const calling = async (name, more = {}) => {
      owners[name] = surfer();
      return insertReview(c, owners[name], { status: "calling", next_try: T + 16 * MIN, draft: null, ...more });
    };
    const ids = {
      failed: await calling("failed"),
      redoFailed: await calling("redoFailed", { redos: 1, draft: JSON.stringify(goodReply()) }),
      banned: await calling("banned"),
      flagged: await calling("flagged"),
      notSurf: await calling("notSurf"),
      published: await calling("published"),
      drafted: await calling("drafted"),
    };
    await setMeta(c, "autopilot", true);
    c.clock.t = T + MIN;
    // What the alarm does with each, as runOne() calls it once the AI has answered (or not).
    const ask = { nums: TWELVE, hadHistory: false, estIn: 20_000 };
    const answer = (reply) => ({
      reply, stop: "end_turn", usage: { input_tokens: 15_400, output_tokens: 3_000 }, model: "coach-test-model",
    });
    const headsUp = { ...goodReply(), heads_up: { text: "Bend your knees on the bottom turn too.", move: "bottom_turn" } };
    await c.inCoach((coach) => {
      const row = (id) => coach.sql.exec("SELECT * FROM reviews WHERE id = ?", id).toArray()[0];
      const now = coach.now();
      coach.gaveUp(row(ids.failed), 3);
      coach.gaveUp(row(ids.redoFailed), 3);
      coach.skipBanned(row(ids.banned));
      coach.answered(row(ids.flagged), ask, answer({ ...goodReply(), sexual_content: true }), now);
      coach.answered(row(ids.notSurf), ask, answer({ ...goodReply(), is_surf_clip: false }), now);
      coach.answered(row(ids.published), ask, answer(goodReply()), now);
      coach.answered(row(ids.drafted), ask, answer(headsUp), now);
    });
    const want = {
      failed: ["failed", T + MIN], redoFailed: ["drafted", null], banned: ["rejected", T + MIN], flagged: ["rejected", T + MIN],
      notSurf: ["rejected", T + MIN], published: ["published", T + MIN], drafted: ["drafted", null],
    };
    for (const [name, [status, handledAt]] of Object.entries(want)) {
      expect(await reviewRow(c, ids[name]), name).toMatchObject({ status, handled_at: handledAt });
    }
    // What each surfer is told: "We couldn't review this clip." for the clips that weren't, nothing for the failed one.
    const notes = {
      failed: null, banned: null, flagged: "not_surf", notSurf: "not_surf", published: null, drafted: null,
    };
    for (const [name, note] of Object.entries(notes)) {
      expect(await ownerView(c, owners[name], ids[name]), name).toMatchObject({ note });
    }
  });
});

// ---- Settings -------------------------------------------------------------------------------------------------------

describe("POST /admin/coach/settings", () => {
  it("turns autopilot on and off, pauses, and Pause off brings the alarm to now", async () => {
    const c = await freshCoach();
    expect(await settings(c, { autopilot: true })).toEqual(OK);
    expect(await getMeta(c, "autopilot")).toBe(true);
    expect(await settings(c, { autopilot: false, paused: true })).toEqual(OK);
    expect(await getMeta(c, "autopilot")).toBe(false);
    expect(await getMeta(c, "paused")).toBe(true);
    expect(await alarmAt(c)).toBe(null);
    expect((await drafts(c)).json.settings).toMatchObject({ autopilot: false, paused: true });
    c.clock.t = T + MIN;
    expect(await settings(c, { paused: false })).toEqual(OK);
    expect(await getMeta(c, "paused")).toBe(false);
    expect(await alarmAt(c)).toBe(T + MIN);
  });

  it("Start again clears stopped and paused and brings the alarm to now", async () => {
    const c = await freshCoach();
    await setMeta(c, "stopped", true);
    await setMeta(c, "paused", true);
    expect(await settings(c, { start_again: true })).toEqual(OK);
    expect(await getMeta(c, "stopped")).toBe(false);
    expect(await getMeta(c, "paused")).toBe(false);
    expect(await alarmAt(c)).toBe(T);
  });

  it("refuses a body that isn't an object of those settings, each true or false, with 400 invalid", async () => {
    const c = await freshCoach();
    const before = await snapshot(c);
    for (const body of ["", "nope", "[]", "null", { autopilot: "on" }, { paused: 1 }, { start_again: null }, { pause: true },
      { autopilot: true, extra: false }]) {
      expect(await settings(c, body), JSON.stringify(body)).toEqual(INVALID);
    }
    expect(await snapshot(c)).toEqual(before);
  });
});
