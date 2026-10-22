# Taiwan Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free Taiwan-only community chat on waveslave.tw: one room, tap-only spot reports shown on the spot cards, private
session logs with automatic conditions that can be shared for tips, LINE sign-in to post, automatic moderation and Bryan's admin
tools. It ships switched off (`CHAT_URL` empty) until Bryan's Cloudflare and LINE setup is done.

**Architecture:**
- **Backend:** a Cloudflare Worker (`chat/src/index.js`) handles CORS, routing and LINE's token exchange. One SQLite Durable Object
  (`Room`, named `taiwan`, `locationHint: "apac-ne"`) holds all data and the WebSocket room, using the Hibernation API.
- **Shared logic:** pure modules (`mod.js`, `auth.js`) hold all normalising, validation and crypto, and are tested under plain Node.
- **Front end:** one IIFE, `web/chat.js`, loaded with `defer`. It reads the page's globals and injects its own CSS.
  `template.html` gets a mount and three one-line hooks.

**Tech Stack:**
- Backend: plain JavaScript modules on Cloudflare Workers with Durable Objects (SQLite), Web Crypto, Wrangler.
- Tests: `node --test` for the pure modules, and `@cloudflare/vitest-pool-workers` with Vitest 4 for the Worker and room.
- Front end: vanilla JS, checked with Playwright.
- CI: GitHub Actions with `cloudflare/wrangler-action`.

**Spec:** `docs/superpowers/specs/2026-10-21-taiwan-chat-design.md` (approved by Bryan, 2026-10-21). Read it first: every value
below that isn't spelled out is in the spec.

## Global Constraints

- **Repo:** all changes in `ragingsurf/waveslave`. Don't touch the forecast-vs-buoy log (`surf-app/log/`), `log*/` folders,
  `refresh.sh`'s data steps or other countries.
- **Page safety:** the page must work exactly as today when `chat.js` is missing, `CHAT_URL` is empty or the backend is down.
  `chat.js` never throws into the page.
- **No new globals:** `chat.js` declares none, apart from `window.CHAT = {spot, relang}`.
- **Escaping:** no `innerHTML` or `insertAdjacentHTML` with network data anywhere in `chat.js`, and no `data-zh` or `data-ja` on
  chat elements.
- **Languages:** every user-facing string in en, zh (Traditional, Taiwan usage) and ja.
- **Stored data:** only `sub_hash`, never the raw LINE `sub`, not even in the 10-minute `handoffs` row (ruling R22). No email, no
  picture, and no LINE name stored outside that row.
- **Versions:** pin exact npm versions released before 2026-10-07 in `chat/package.json`, with a lockfile committed.
  `compatibility_date = "2026-10-21"`.
- **Secrets:** never in the repo, the page or logs. The five Worker secrets are `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`,
  `SESSION_SECRET`, `SUB_PEPPER` and `ADMIN_CODE`.
- **Storage keys:** `waveslave-chat-token`, `waveslave-chat-v`, `waveslave-chat-seen`, `waveslave-chat-filter`, and
  `sessionStorage` `waveslave-chat-return`.
- **Comments:** plain English, with Bryan's decisions dated "(Bryan, Oct 21)", matching the repo's style.

## Review Focus

1. **Phone sleeps or switches network mid-chat.** It should reconnect quietly with no duplicate messages, because `history` and
   `msg` are merged by id. Test owner: Task 10.
2. **Travelling with the phone on another time zone.** "Today", "yesterday" and the session's conditions use Taipei time
   (`ALL.spots[id].tz` = 8), not the device's. Test owner: Task 11.
3. **The same account open in two tabs or devices.** A message, delete or ban in one shows in the other at once, and "Sign out
   everywhere" closes both. Test owner: Task 6.
4. **Messages that wreck layout.** A 500-character unbroken word, emoji-only text, or an RTL override must wrap inside the bubble
   and not reorder the name or age around it. Test owner: Task 10.
5. **Switching language with the room open.** The room redraws in the new language and keeps the typed text, the open sheet and
   the scroll position. Test owner: Task 10.

---

### Task 1: Backend scaffold and moderation functions (`mod.js`)

**Files:**
- Create: `chat/package.json`, `chat/package-lock.json`, `chat/wrangler.toml`, `chat/.gitignore` (`node_modules`, `.dev.vars`,
  `.wrangler`), `chat/blocklist.json`, `chat/src/mod.js`
- Test: `chat/test/mod.test.mjs`

**Interfaces:**
- Produces (all exported from `chat/src/mod.js`, no I/O):
  - **Constants:** `SPOTS = ["donghe","jialeshui","nanwan","jinshan","fulong","wushi","suao","hualien"]`,
    `SIZES = ["flat","knee","waist","chest","head","overhead"]`, `CONDS = ["clean","ok","choppy","blown"]`,
    `CROWDS = ["empty","few","busy","packed"]`, `BOARDS = ["short","fish","minimal","long","softtop"]`,
    `REASONS = ["spam","harass","sexual","child","other"]`.
  - **Snapshot keys:** `SNAP_KEYS` with ranges `{hs:[0,15], tp:[0,30], dp:[0,360], shs:[0,15], stp:[0,30], sdp:[0,360],
    ws:[0,120], wd:[0,360], tide:[-5,5], bhs:[0,15], btp:[0,30], bdp:[0,360]}`. Each value is optional; each has a sibling
    `<key>_t` ISO string.
  - `normalise(text: string) -> {stored: string, check: string}`
  - `blocked(check: string, list: object) -> null | {rule: string}`. Rules: `link`, `line`, `telegram`, `short`, `phone`, `scam`,
    `vape`, `slur`.
  - `checkNick(nick: string) -> {ok: true, nick: string, key: string} | {ok: false, code: "length"|"chars"|"reserved"}`
  - `validReport(o) -> {spot, size, cond, crowd, snap} | null`
  - `validSnap(o) -> object | null`
  - `validSession(o, nowMs: number) -> {spot, start, end, stars, board, note, cond} | null`. `start` and `end` are epoch ms.

- [ ] **Step 1: Scaffold.**
  - `package.json`: `"type": "module"`, scripts `"test": "node --test test/*.test.mjs && vitest run"`, `"dev": "wrangler dev"`.
  - devDependencies, pinned exact: `wrangler`, `vitest` (4.1.x) and `@cloudflare/vitest-pool-workers`, each released before
    2026-10-07.
  - `wrangler.toml` exactly as in the spec's "`wrangler.toml`" bullet.
  - Run `npm install` to write the lockfile.

- [ ] **Step 2: Write failing tests in `chat/test/mod.test.mjs`.**
  - **`normalise`:**
    - `normalise("ＬＩＮＥ").check === "line"`
    - zero-width characters inside `lin​.ee` are removed from both `stored` and `check`
    - `"‮hi"` has no U+202E in `stored`
    - `"𝐥𝐢𝐧𝐞.𝐦𝐞"` gives a `check` containing `line.me`
    - Cyrillic `"lіne.me"` (U+0456) gives `line.me`
  - **`blocked`**, with `JSON.parse(readFileSync("blocklist.json"))`:
    - `line.me/ti/g/x` → `line`, `lin.ee/abc` → `line`, `加賴 abc123` → `line`, `加LINE` → `line`
    - `t.me/x` → `telegram`, `https://bit.ly/x` → `short`, `see example.com/x` → `link`
    - `0912-345-678`, `0912 345 678`, `〇九一二三四五六七八` and `+886 912345678` → `phone`
    - `飆股`, `帶單` → `scam`; `電子煙` → `vape`
    - `幹嘛`, `樹幹`, `幹 浪超好`, `靠北今天好亂` and `Chest high at 7:30, 1.2 m @ 9 s` → `null`
  - **`checkNick`:**
    - `"Bryan"`, `"ＢＲＹＡＮ"`, `"Bryаn"` (Cyrillic а), `"Br​yan"`, `"WaveSlave官方"`, `"管理员"` and `"教練Leo"` → `reserved`
    - `"a"` → `length`; `"a<b"` → `chars`
    - `"阿凱"` → `ok`; `"Leo_88"` → `ok`
    - `checkNick("Leo").key === checkNick("ＬＥＯ").key`
  - **`validReport`:**
    - rejects spot `"pipeline"`, size `"huge"`, and a `snap` with an unknown key, a string value or a value out of range
    - accepts `{spot:"jinshan", size:"chest", cond:"clean", crowd:"few", snap:{hs:1.1, hs_t:"2026-10-21T07:00"}}`
  - **`validSession`** at `nowMs = Date.UTC(2026,9,21,4)` (12:00 Taipei):
    - accepts a start at 2026-10-19 00:00 Taipei
    - rejects 2026-10-18 23:59 Taipei, an end before the start, more than 12 hours, a future start, `stars: 0`, `stars: 2.5`, and a
      note over 300 characters

- [ ] **Step 3: Run `cd chat && node --test test/mod.test.mjs`.** Expected: FAIL, because `mod.js` exports nothing.

- [ ] **Step 4: Implement `chat/src/mod.js` and `chat/blocklist.json`.**
  - `blocklist.json` holds `{phrases: {scam:[…], vape:[…], slur:[…]}, line:[…], short:[…], allowHosts: []}` as plain strings.
    The `link`, `phone` and `telegram` patterns are regexes in code.
  - `normalise`:
    - `stored`: NFKC, then remove the spec's default-ignorable and bidi ranges.
    - `check`: `stored`, then case-fold, then the look-alike table (Cyrillic, Greek and fullwidth to Latin), then Chinese numerals
      to digits.
  - Phone matching removes spaces, `-`, `.`, `・` and `/` between digits.
  - `checkNick` allows `[\p{L}\p{N}_.-]` plus single inner spaces, 2–20 characters after normalising. The key is `check` with
    spaces removed. The reserved words are the spec's list.

- [ ] **Step 5: Run `node --test test/mod.test.mjs`.** Expected: PASS.

- [ ] **Step 6: Commit.** `git add chat && git commit -m "Chat: backend scaffold and moderation functions"`

### Task 2: Tokens and LINE ID token checks (`auth.js`)

**Files:**
- Create: `chat/src/auth.js`
- Test: `chat/test/auth.test.mjs`

**Interfaces:**
- Produces, async where Web Crypto is:
  - `b64u(bytes: Uint8Array) -> string`
  - `unb64u(s: string) -> Uint8Array`
  - `randomB64u(n: number) -> string`
  - `sha256b64u(s: string) -> Promise<string>`
  - `hmacB64u(key: string, data: string) -> Promise<string>`
  - `sameText(a: string, b: string) -> Promise<boolean>`: constant time, compares SHA-256 digests.
  - `signToken({uid, tv, exp}, secret) -> Promise<string>`: the token is `b64u(JSON) + "." + hmac`.
  - `readToken(token, secret, nowMs) -> Promise<{uid, tv, exp} | null>`
  - `verifyLineIdToken(jwt, {channelId, secret, nonce, nowMs}) -> Promise<claims | null>`
  - `subHash(sub, pepper) -> Promise<string>`
  - `pin6() -> string`: 6 digits from `crypto.getRandomValues`.

- [ ] **Step 1: Write failing tests.**
  - **Token:**
    - round trip
    - `readToken` returns null when expired, when the payload or signature is altered, and when signed with another secret
  - **`verifyLineIdToken`,** on a token built in the test with HS256 and the secret:
    - passes with the right `iss` (`https://access.line.me`), `aud`, `nonce` and a future `exp`
    - returns null for each of: header `alg` `none`, `ES256` or `HS512`; wrong `aud`; wrong `nonce`; wrong `iss`; `exp` in the
      past; a bad signature
  - **Other helpers:**
    - `sameText("a","a") === true` and `sameText("a","b") === false`
    - `pin6()` matches `/^\d{6}$/`
    - `subHash` is stable for the same pepper and differs for another

- [ ] **Step 2: Run `node --test test/auth.test.mjs`.** Expected: FAIL.

- [ ] **Step 3: Implement with `crypto.subtle`** (global in Node 22 and in Workers). No dependencies.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Chat: session tokens and LINE ID token checks"`

### Task 3: Room storage, alarm and read paths

**Files:**
- Create: `chat/src/room.js`, `chat/src/index.js` (minimal: re-exports `Room`, plus a `fetch` that returns 404), `chat/vitest.config.mjs`
- Test: `chat/test/room.storage.test.mjs`

**Interfaces:**
- Consumes: `mod.js` constants.
- Produces, in `class Room extends DurableObject`:
  - `migrate()`: creates the spec's tables and indexes, guarded by `meta.schema_ver`, and is called in the constructor through
    `ctx.blockConcurrencyWhile`.
  - `ensureAlarm()`.
  - `alarm()`: retention, then the keepalive tick, then reschedule in `finally`.
  - `history(beforeId?: number, limit = 100) -> Msg[]`, where a public `Msg` is `{id, ts, nick, role, kind, spot, body, reply_to,
    likes}`.
  - `reportsFor(spot, nowMs) -> {reports: [{ts, size, cond, crowd}], online, last_id}`, with the 60 s memory copy.
  - `usage(kind: "req"|"read"|"write", n)`, with the counts flushed to `meta` every 100.
- Worker-to-room calls go to `https://room/<route>` on the stub, with JSON bodies. Task 4 defines the routes.

- [ ] **Step 1: Configure Vitest.**
  - `vitest.config.mjs` uses `cloudflareTest` / `defineWorkersConfig` from `@cloudflare/vitest-pool-workers` with
    `wrangler: {configPath: "./wrangler.toml"}`.
  - `vitest run --no-isolate --max-workers=1` is used for socket tests.

- [ ] **Step 2: Write failing tests.** Use `runInDurableObject` and `runDurableObjectAlarm`.
  - **Schema:** all tables exist after the first `get`, and running `migrate()` again changes nothing.
  - **Read costs**, seeded with 365 days × 100 messages and 2,000 reports:
    - `history()` returns 100 messages in ascending id order, with `cursor.rowsRead <= 110`;
    - `reportsFor("jinshan")` returns only reports from the last 4 hours, newest first, at most 20, with `rowsRead <= 20`;
    - a second call within 60 s reads 0 rows.
  - **Retention,** run with `runDurableObjectAlarm` at 19:00 UTC:
    - text and session messages older than 30 days are gone;
    - reports older than 30 days have `uid` NULL, and reports older than 365 days are gone;
    - orphaned likes and flags are gone;
    - `logins` and `handoffs` past expiry are gone, and `holds` after 180 days;
    - users not seen for 730 days are gone, with their sessions;
    - the next alarm is set.
  - **`ensureAlarm()`** sets an alarm when there is none and keeps an existing earlier one.
  - **Public frames:** `history()` messages have no `uid` key, and messages with `hidden_by` set are excluded.

- [ ] **Step 3: Run `npx vitest run test/room.storage.test.mjs`.** Expected: FAIL.

- [ ] **Step 4: Implement storage, `history`, `reportsFor`, `ensureAlarm`, `alarm` and the retention batches** (1,000 rows per
  `DELETE … WHERE rowid IN (SELECT … LIMIT 1000)`, looped).

- [ ] **Step 5: Run the tests.** Expected: PASS.

- [ ] **Step 6: Commit.** `git commit -m "Chat: room storage, retention and read paths"`

### Task 4: Front Worker: CORS, routes, `/reports`, resting

**Files:**
- Modify: `chat/src/index.js`
- Test: `chat/test/worker.test.mjs`

**Interfaces:**
- Consumes: `Room` through `room(env) = env.ROOM.getByName("taiwan", {locationHint: "apac-ne"})`, the only way a stub is made.
- Produces, as public routes, the spec's route table. Room-internal routes, all `POST` with a JSON body unless noted:
  - `/r/reports?spot=` (GET)
  - `/r/login-start {h} -> {state, nonce, challenge}`
  - `/r/login-take {state} -> {nonce, pkce_verifier, h} | {error}`
  - `/r/handoff {h, sub, line_name} -> {code, pin} | {banned: true}`
  - `/r/redeem {v, code?, pin?} -> {token} | {needs_signup, line_name} | {error}`
  - `/r/signup {v, code?, pin?, nick, consent} -> {token} | {error}`
  - `/r/me/<…>` with the `Authorization` header passed through
  - `/r/ws` (upgrade)
  - `/r/where` (GET, admin)

- [ ] **Step 1: Write failing tests** using `SELF.fetch`.
  - **`/reports`:**
    - `GET /reports?spot=jinshan` → 200, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=60`
    - `?spot=pipeline` → 400
  - **Origins:**
    - `OPTIONS /me/sessions` from `https://waveslave.tw` → 204 with the spec's Allow headers and `Vary: Origin`
    - the same from `https://evil.example` → 403
    - `GET /ws` with `Origin: https://evil.example` → 403
    - `GET /ws` with no Origin → 403
  - **No-store:** every `/auth/*` and `/me/*` response has `Cache-Control: no-store`.
  - **Resting:** a room that throws (stub replaced in the test) → `503 {"resting": true}` with CORS headers.
  - **Unknown path:** → 404 JSON.

- [ ] **Step 2: Run `npx vitest run test/worker.test.mjs`.** Expected: FAIL.

- [ ] **Step 3: Implement** CORS helpers, routing, and the try/catch wrapper around every room call.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Chat: front Worker with CORS and reports route"`

### Task 5: LINE login, handoff, pin and signup

**Files:**
- Modify: `chat/src/index.js` (`/auth/line/start`, `/auth/line/callback`, `/auth/redeem`, `/auth/signup`), `chat/src/room.js`
  (`logins`, `handoffs`, users, `subs`)
- Test: `chat/test/login.test.mjs` (LINE mocked with `fetchMock` for `LINE_TOKEN_URL`)

**Interfaces:**
- Consumes: the `auth.js` functions, and `checkNick` from `mod.js`.
- Produces:
  - `Room.userFromToken(token) -> {id, nick, role, tv} | null`. It checks the user exists, isn't banned, and `tv` matches.
  - `Room.closeUser(uid, code)`: closes every socket whose attachment `uid` matches.

- [ ] **Step 1: Write failing tests.**
  - **Start:** `/auth/line/start?h=<sha(v)>` → 302 to `LINE_AUTH_URL` with every parameter from the spec's Login step 2, a
    stored `logins` row, and `scope=openid profile`.
  - **Callback, happy path:** a mocked token response with an ID token signed by the test secret →
    302 to `APP_URL?chat#c=<code>&p=<6 digits>`. The `logins` row is gone, a `handoffs` row exists, and no `users` row exists yet.
  - **Callback, errors:**
    - `?error=ACCESS_DENIED&state=…` → 302 to `APP_URL?chat#e=ACCESS_DENIED`
    - an unknown or reused `state` → `#e=state`
    - a `logins` row older than 10 minutes → `#e=state`
    - an ID token with the wrong nonce → `#e=token`
  - **Redeem:**
    - `/auth/redeem {v, code}` for a new sub → `{needs_signup: true, line_name}`, and the handoff is kept
    - then `/auth/signup {v, code, nick: "阿凱", consent: "v1"}` → `{token}`; the user row has `consent_ver "v1"` and `sub_hash`
      set, and nothing in any table equals the raw `sub`
    - for an existing user, `/auth/redeem` → `{token}`, and the handoff is deleted
  - **Stolen link:** the attacker starts with `h = sha(vA)` and the victim finishes the callback. Redeeming with the victim's
    `vV` and the code fails (the hash doesn't match). The attacker redeeming with `vA` and three wrong pins → `error: "pin"`
    three times, then the handoff is void, so even the right pin fails.
  - **Pin path:** `/auth/redeem {v: vA, pin: <right pin>}` with no code succeeds.
  - **Signup rules:** without `consent: "v1"` → error; with a nick that `checkNick` rejects → `{error: "nick", code}`; a taken
    nick → `{error: "nick", code: "taken"}`.
  - **Bans:** a sub whose `subs.banned = 1` → the callback redirects with `#e=banned`.

- [ ] **Step 2: Run `npx vitest run test/login.test.mjs`.** Expected: FAIL.

- [ ] **Step 3: Implement the spec's Login steps 1–7 exactly.** The handoff is valid for 10 minutes and voided after 3 wrong pins.
  `code` is stored as `sha256b64u(code)`.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Chat: LINE login with bound handoff, pin and signup"`

### Task 6: Socket protocol, limits and keepalive

**Files:**
- Modify: `chat/src/room.js`
- Test: `chat/test/socket.test.mjs` (run with `--no-isolate --max-workers=1`)

**Interfaces:**
- Consumes: `userFromToken`, plus `normalise`, `blocked`, `validReport`, `validSnap` and `checkNick` from `mod.js`.
- Produces:
  - **Frames:** the spec's frame list, with `PROTO = 1`.
  - **`error` codes:** `auth`, `blocked:<rule>`, `slow:<seconds>`, `invalid`, `locked`, `update`, `banned`, `size`.
  - `canWrite(user, kind) -> null | errorCode`: the one gate, used by both the socket and `/me`.

- [ ] **Step 1: Write failing tests**, with two signed-in sockets and one reader.
  - **Reading:** `hello` without a token → `history`, and the reader can't `say` (`error auth`).
  - **Saying:** `say` → `msg` broadcast to all three, with `nick`, no `uid`, and the `spot` tag taken from the frame.
  - **Size and bad frames:** a frame over 4 KB closes the socket. Five bad frames close the socket.
  - **Blocks and limits:**
    - `say "加LINE abc"` → `error blocked:line`, nothing stored
    - a second `say` within 5 s → `error slow:…`
    - the 11th message within an hour from an account under 24 h old → `slow`
  - **Reports:** `report` with valid codes → a `msg` of kind `report`, which then shows in `reportsFor`. A second report on the
    same spot within 2 h → `slow`.
  - **Likes:** `like` twice from one user → `likes` stays 1. The 31st like within 10 minutes → `slow`.
  - **Delete:**
    - a user can delete only their own message, and everyone gets an `update {id, deleted}`
    - a reply whose parent is deleted gets `reply_to` kept, and the client shows "Message deleted"
  - **Slash text:** `say "/admin x"` → dropped with `error invalid`, never broadcast.
  - **Versions:** `hello` with `v: 0` → `error update`.
  - **Same account twice (Review Focus 3):** user A on two sockets; a message from socket 1 reaches socket 2. Signing out
    everywhere (`/me/signout`) closes both, and a reconnect with the old token → `error auth`.
  - **Per-IP cap:** the 6th socket from one `CF-Connecting-IP` is refused.
  - **Nickname changes:** a second `nick` change within 7 days → `slow`. A freed nickname can't be taken by another account for
    30 days.
  - **Keepalive:** with a socket open, `runDurableObjectAlarm` broadcasts `tick {online: 3}`. With none open, no tick is
    rescheduled. A `ping` text gets `pong` through the auto-response.
  - **Hibernation:** after `evictDurableObject`, the open sockets still post with the right user (attachment restored).

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement** `acceptWebSocket`, the attachments, `webSocketMessage` dispatch through `canWrite`, the limits in
  `limits` or counted with the `(uid, ts)` index, the broadcasts and `setWebSocketAutoResponse`.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Chat: socket protocol, limits and keepalive"`

### Task 7: Flags, admin claim and Bryan's tools

**Files:**
- Modify: `chat/src/room.js`
- Test: `chat/test/mod-admin.test.mjs`

**Interfaces:**
- Consumes: Task 6's socket helpers and `sameText` from `auth.js`.
- Produces:
  - **Admin frames:** `admin {code}`, `ban {msg_id}`, `unban {sub_hash}`, `restore {id}`, `keep {id}`, `lock`, `unlock`,
    `hidden_list`.
  - `hidden` is sent to admin sockets only. `msg.role === "admin"` is set server-side.

- [ ] **Step 1: Write failing tests.**
  - **Three flags hide a message:** flags from 3 accounts that are each over 24 h old with a post → `hidden_by "flags"` and an
    `update hide` to readers. The admin socket still gets the message, marked hidden.
  - **Flags that don't count:**
    - two flags from the same `sub_hash` (account deleted and signed up again) count once
    - self-flags and flags on admin messages are ignored
  - **One-flag hides:**
    - `sexual` from an account 7 days old with 5 posts hides on 1 flag, and a 4th such hide that day counts as a normal flag
    - `child` hides on 1 flag and copies a row to `holds`
  - **Restore:** `restore` sets `flag_immune`; later flags don't hide it, and its flaggers get `rejected`. An account with 2
    rejected flags no longer counts.
  - **Admin claim:**
    - with a 32-character `ADMIN_CODE`, the right code sets `meta.admin_uid`, and a second account's right code is refused
    - 3 wrong tries block that account; 10 in total switch claiming off
    - an `ADMIN_CODE` under 32 characters means every claim is refused
  - **Ban:**
    - hides the user's last 24 h of messages (`hidden_by "ban"`), sets `subs.banned`, and closes their sockets
    - a later `/auth/line/callback` for that sub → `#e=banned`
    - `DELETE /me` by the banned user keeps `subs.banned`
  - **Unban, lock, unlock:** `unban` clears it. `lock` → others get `error locked`, while admin and account deletion still work.
    `unlock` reverses it.
  - **Keep:** `keep` copies to `holds`. `hidden_list` returns the reason for each hidden message.
  - **Where:** `GET /admin/where` with Bryan's token returns a `colo=` line, and with anyone else's returns 403.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement the spec's Moderation steps 4, 5 and 7.**

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Chat: flags, admin claim and moderation tools"`

### Task 8: `/me` routes, account deletion and the resting guard

**Files:**
- Modify: `chat/src/room.js`, `chat/src/index.js`
- Test: `chat/test/me.test.mjs`

**Interfaces:**
- Consumes: `validSession`, `canWrite` and `userFromToken`.
- Produces:
  - `GET /me/sessions -> [{id, spot, start, end, stars, board, note, cond, shared}]`, newest first.
  - `POST /me/sessions {…, share: bool} -> {id, shared_msg?}`.
  - `share` and `unshare` frames (Task 6) reuse the same code.
  - `GET /me/export` returns JSON `{nick, created, messages, reports, sessions}`.
  - The `4429` close code, and `{resting: true}`.

- [ ] **Step 1: Write failing tests.**
  - **Sessions:**
    - `POST /me/sessions` with a valid body and `share: false` → stored, with nothing broadcast
    - with `share: true` → a `session` `msg` broadcast, with the note passed through `normalise`/`blocked` (a blocked note →
      `error blocked:…`, and the log is still saved private)
    - the 21st private log in a day → 429 `slow`
    - `DELETE /me/sessions/<other user's id>` → 404
  - **Export:** contains the user's rows and nobody else's.
  - **`DELETE /me`:**
    - in one transaction, removes the user's text and session messages (broadcasting deletes), likes (counts updated), flags,
      sessions, limits and handoffs, and strips the uid from their reports
    - afterwards, a scan of every table finds no row with that uid
    - `subs` keeps a row with `deleted_at`, and `holds` rows stay
  - **Resting:** with the usage counter set to 90% of 100k requests, a new socket gets close code 4429 and `/reports` returns
    `{resting: true}`.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run `cd chat && npm test`** (all backend tests). Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Chat: diary routes, export, account deletion and resting guard"`

### Task 9: Page hooks, `chat.js` shell, report strip and CHAT button

**Files:**
- Create: `web/chat.js`
- Modify:
  - `template.html`: the mount as the last child of `section.now`; the Taiwan hook in the "spot picker and per-spot labels" block
    of `boot()`, next to the `section.spots` line; `window.CHAT&&CHAT.relang()` at the end of `setLang`; the chat-open guards in
    the pull-to-refresh `touchstart` and the map's Escape `keydown`; `<script src="chat.js" defer></script>` before `</body>`.
  - `build-site.sh`: add `"$HERE/web/chat.js"` to the `cp` line.
  - `tests/map/check.js`: add the `chatOff` checks.
- Test: `tests/chat/shell.test.js` (Playwright on a page built with `tests/map/tool.py`)

**Interfaces:**
- Consumes: the page globals `ALL`, `LANG`, `CUR`, `VIEW`, `SPT`, `countrySpots`, `switchSpot` and `setView`.
- Produces: `window.CHAT = {spot(id), relang()}`, plus internal `api(path, opts)` and `S(key)` (string lookup by `LANG`), used by
  Tasks 10–11.

- [ ] **Step 1: Write failing tests** (`node tests/chat/shell.test.js <page.html>`), routing `**/chat.js` to `web/chat.js`.
  - **Chat off:** with no `__chatUrl`, there's no page error, no `.chatfab`, and `#nowReports` is still `hidden`.
  - **Chat on, a Taiwan spot:** with `__chatUrl` pointing at a route that serves `/reports` with 2 reports, `online: 3` and
    `last_id: 9`:
    - the strip shows 2 chips in the order given, with dot colours from conditions;
    - "Post a report" is present;
    - the button reads "CHAT" and "3 online", with a pink dot while `waveslave-chat-seen` < 9.
  - **One fetch per spot:** switching spot fetches `/reports` once per new spot. Switching language, or going to the map and back,
    refetches nothing.
  - **World mode:** switching to Japan hides the button and the strip, and switching back to Taiwan shows them.
  - **Unreachable backend:** the strip stays hidden and the page draws.
  - **Taps pass through:** while a touch drag is in progress on `#days`, the button has `pointer-events: none`.
  - **`?chat` deep link:** with a Map view saved, the address is replaced by `#<spot>`, and the room's open hook is called once
    the Forecast view is up.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement the `chat.js` shell.**
  - IIFE and `CHAT_URL`.
  - The en/zh/ja table, holding all strings from the spec's "What you see".
  - The pinned house rules and the full privacy note from the spec's "Privacy note" section, in all three languages, with the
    operator's name and email as `CONTACT` constants. They stay placeholders until Bryan sends them, and the chat can't be switched
    on while they are empty.
  - Injected CSS: the spec's look, the existing tokens, the mockup measurements, `html.tw .wrap` padding, and z-index 110 for the
    room.
  - The strip and button (button visibility via `html.tw` and `VIEW === "fc"`), the fetch on `visibilitychange` at most once a
    minute, and start-up as in the spec's "Start-up" bullet.
  - The template hooks exactly as the spec's list.

- [ ] **Step 4: Run the tests**, plus `python3 -m unittest discover -s tests` and `node tests/map/check.js <page> /tmp/o checks`.
  Expected: all PASS.

- [ ] **Step 5: Commit.** `git commit -m "Chat: page hooks, report strip and chat button"`

### Task 10: The room on the page

**Files:**
- Modify: `web/chat.js`
- Test: `tests/chat/room.test.js` (Playwright against `wrangler dev` started by the test, with `.dev.vars` setting
  `ALLOWED_ORIGINS` to the local page origin, served by `python3 -m http.server`)

**Interfaces:**
- Consumes: the Task 9 internals and the Task 6 frames.
- Produces: `openRoom({sheet?: "report"|"log", spot?})`, `closeRoom()` and the socket client `sock.send(frame)`, used by Task 11.

- [ ] **Step 1: Write failing tests.**
  - **Opening:**
    - the room opens full screen above the map's z-index, and sets `html.chat-open`
    - pull-to-refresh and Escape-to-map do nothing while it's open, and Escape closes the room
  - **Reading:** a reader sees `history` with no LINE button blocking it. Filters show the right messages.
  - **Escaping:** posting `<img src=x onerror=alert(1)>` as text from a second, signed-in context makes no `img` element and fires
    no dialog.
  - **Reconnect (Review Focus 1):** dropping the socket (`context.setOffline(true)` then `false`) → reconnects within 30 s and
    shows each message once.
  - **Dead socket:** 100 s with no frame (fake timers) → reconnect.
  - **Layout (Review Focus 4):** a 500-character unbroken string, emoji-only text and `‮abc` keep the bubble within 390 px,
    and the nickname and age stay in order.
  - **Language switch (Review Focus 5):** with typed text in the box and the room scrolled up, switching to 中文 redraws the
    labels and keeps the text and the scroll position.
  - **Message menu:** the ⋯ button opens Reply, 👍 and Report, by keyboard too. Reply quotes the parent, and a deleted parent
    shows "Message deleted".
  - **Older messages:** scrolling to the top loads one older page of 50.
  - **Badge:** Bryan's messages show the fixed WaveSlave badge, and no other message does.
  - **Resting and offline:** a `4429` close shows "Chat is resting until 08:00"; a plain drop shows "Chat is offline · Retry".

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement the room UI and socket client.**
  - Backoff from 1 s to 30 s; `ping` on `visibilitychange`; close after 5 minutes hidden.
  - Merge messages by id.
  - Rendering through `textContent`, with `dir="auto"`.
  - Menus, filters, the 7-day nickname change, and paging.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Chat: the room on the page"`

### Task 11: Sign-in, report and session sheets, and the conditions snapshot

**Files:**
- Modify: `web/chat.js`
- Create: `tests/chat/fake-line.mjs`, a small HTTP server implementing `authorize` (auto-approve, redirect with `code`) and
  `token` (an HS256 ID token for a fixed `sub`, with the given nonce)
- Test: `tests/chat/flow.test.js`, `tests/chat/snapshot.test.js`

**Interfaces:**
- Consumes: Task 5's routes, Task 8's `/me` routes, and Task 10's `openRoom`.
- Produces: `snapshot(id: string, ms: number) -> object | null` inside `chat.js`, exposed for tests as `window.CHAT._snap` only
  when `window.__chatTest` is set.

- [ ] **Step 1: Write failing tests.**
  - **Flow** (`flow.test.js`, with `wrangler dev` vars pointing `LINE_AUTH_URL` and `LINE_TOKEN_URL` at the fake LINE, and
    `APP_URL` at the local page):
    - the sign-in button uses LINE's official style (`#06C755`, the LINE icon, and the spec's wording in each language)
    - tap "Log in with LINE", come back, and the fragment is gone from `location.href` at once
    - the signup sheet shows the nickname prefilled with the fake LINE name and the tick text from the spec; signing up enters
      the room
    - post a message; post a report (it shows in the room and in the strip without waiting for a refetch)
    - log a session with share on (a session card appears with stars, note, conditions and board); unshare it (the card is gone)
    - My sessions lists it; Download my data returns JSON with it
    - Sign out everywhere shows the LINE button again
    - Delete my account removes their messages from a second context's screen
  - **Pin path:** with `localStorage` cleared before the return, the page shows the "enter this code" screen. A second context
    holding `v` enters the pin and is signed in.
  - **Snapshot** (`snapshot.test.js`, on a built page):
    - for each Taiwan spot, `CHAT._snap(id, now)` agrees with the Right now card's height, period, wind and tide as rendered (same
      rounding)
    - for a time two days ago it uses `hist`, and every value carries a `_t` time
    - for an hour with no data it returns null
  - **Time zone (Review Focus 2):** run with the browser time zone set to `America/Los_Angeles`. The session sheet's "Today"
    is Taipei's date, and the snapshot hour is the Taipei hour.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement.**
  - The login client (`v`, `#c`/`#p`/`#e` handling with `replaceState` first, redeem, the pin screen and box, signup).
  - The report sheet and session sheet (the spec's pills and labels).
  - `snapshot()` with the spec's source table and the same conversions as `boot()`'s Right now block. Factor any shared
    conversion by calling the page's own helper if it is top-level; otherwise copy it with a comment naming the source line.
  - My sessions, export, delete, and sign out everywhere.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Chat: LINE sign-in, report and session sheets"`

### Task 12: Deploy workflow, site build and setup guide

**Files:**
- Create: `.github/workflows/chat.yml`, `docs/chat-setup.md`
- Modify:
  - `.github/workflows/refresh.yml`: add `paths-ignore: ["chat/**"]` under `push`.
  - `web/head.html`: pin GoatCounter to its versioned `count.vN.js` with `integrity` and `crossorigin="anonymous"`, using the hash
    GoatCounter publishes.
  - `template.html`: add the credits line "Chat: Cloudflare, LINE" and the privacy note link.
- Test: `actionlint`, if available; otherwise `python3 -c "import yaml…"` parses both workflows. A dry run:
  `cd chat && npx wrangler deploy --dry-run --outdir /tmp/chat-dist` succeeds.

- [ ] **Step 1: Write `chat.yml`** exactly as the spec's Deploy section:
  - the guard step, `npm ci && npm test`, the secrets file written with `umask 077`, then `wrangler-action` with
    `workingDirectory: chat` and `command: deploy --secrets-file …`, then removing the file;
  - `concurrency: chat`.

- [ ] **Step 2: Write `docs/chat-setup.md`.** It's Bryan's step-by-step for the spec's 7 setup steps, in plain words:
  - the exact menu names in Cloudflare and the LINE console;
  - `openssl rand -base64 48` for the three random secrets;
  - the callback URL pattern;
  - "send Claude the subdomain when done".

  Copy it to `/mnt/project-files/surf-app/community/setup-guide.md`.

- [ ] **Step 3: Verify.**
  - Both workflows parse, and the dry-run deploy builds.
  - `sh build-site.sh` (or `tests/map/tool.py`'s build) puts `chat.js` next to `index.html`.
  - On the built page, GoatCounter still loads, with the integrity check passing (Playwright, network allowed).

- [ ] **Step 4: Commit.** `git commit -m "Chat: deploy workflow, site build and setup guide"`

### Task 13: Verify

- [ ] **Step 1: Run every test.** `cd chat && npm test`; `python3 -m unittest discover -s tests -v`;
  `node --test tests/map/mapmath.test.js`; `node tests/map/check.js <page> /tmp/o checks` (upright and `land`); and
  `node tests/chat/*.test.js`. Expected: all PASS.
- [ ] **Step 2: Phone screenshots.** At 390×844, dark and light, in en, zh and ja, take shots of the spot card strip, the room, the
  sign-in sheet, the report sheet and the session sheet. Put them in `/mnt/project-files/surf-app/community/screens/`.
- [ ] **Step 3: Compare with main.** With `CHAT_URL` empty, every non-chat screenshot from `tests/map/check.js shots` matches
  main's.

### Task 14: Review and PR

- [ ] **Step 1: Fresh review.** A fresh reviewer on the whole diff against the spec, with a security pass on Tasks 5–8 and
  `chat.js` rendering. Fix what it finds.
- [ ] **Step 2: Open the pull request** "Taiwan chat (switched off until setup)". Subscribe to its activity, drive CI green, and
  send Bryan the setup guide.
