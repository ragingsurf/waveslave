# Taiwan chat for WaveSlave: design

Date: 2026-10-21. Status: approved by Bryan (2026-10-21). Plan: `docs/superpowers/plans/2026-10-21-taiwan-chat.md`.

## Goal

A free community chat for Taiwan surfers on waveslave.tw whose job is helping people surf better: a free and better take on paid
"surf buddy" coaching channels. Surfers post quick reports on the 8 Taiwan spots, keep a surf diary that records the real
conditions of each session, and share a session to the room to get tips from other surfers.

## Decisions so far (Bryan, in the project thread, 2026-10-21)

- **Where:** Taiwan only for now, with one room for all of Taiwan.
- **Purpose:** helping people get better at surfing (advice, coaching), with spot reports in the same place.
- **Who answers:** people answer each other. There's no AI coach at launch; one can be added later on the same backend, and the
  saved session logs will be there for it to read from day one.
- **Cost to users:** free for everyone.
- **Moderation:** mostly automatic. Bryan steps in for bans.
- **Login:** sign in with LINE to post. Reading needs no login.
- **Look and flow:** the mockups in `surf-app/community/mockups/` (project files) are approved: the spot-card report strip, a
  floating CHAT button, a full-screen room, a four-tap report form, and a session log with "Share to chat for tips".
- **Backend:** Cloudflare Workers with one Durable Object. The comparison is in `surf-app/community/build-options.md`.

## Defaults I picked (say if you want otherwise)

- **Address:** the backend runs at a free `waveslave-chat.<subdomain>.workers.dev` address. waveslave.tw's DNS stays at Dynadot,
  so the live site's hosting is untouched.
- **Languages:** every button, label, rule and error comes in English, 中文 and 日本語, like the rest of the site. People write in
  whatever language they like; nothing is translated.
- **Reports are tap-only,** with no typed note, so they need no moderation.
- **Session logs** can be for today or the two days before. They stay private until shared.
- **How long things are kept:**
  - room messages and shared session cards: 30 days;
  - reports: 1 year, with the poster removed after 30 days;
  - private session logs: until their owner deletes them, or after 2 years without signing in.
- **House rules,** pinned:
  1. Be kind and help each other surf better.
  2. No ads or selling.
  3. No LINE IDs, phone numbers or links.
  4. No posting other people's plates, addresses or personal details.
  5. 13 and up. If you're under 18, your parent or guardian agrees.
- **Left out of the first version:** photos, video and private messages.
- **Bryan's admin powers** turn on once, by typing `/admin` and a long secret code in the chat from his own LINE account. His
  messages then carry a fixed "WaveSlave" badge that no nickname can copy.
- **Visitor counter:** the GoatCounter script is pinned to a fixed version with an integrity check. Sign-ins live on the
  page, and this stops a changed third-party script from reading them.

## Bryan to confirm in this review

1. Chat messages, nicknames and session logs are stored by Cloudflare on servers outside Taiwan, and LINE (LY Corp) handles
   sign-in. Plans so far said "nothing personal goes to any service". This feature has to break that, and the privacy note will
   say so.
2. The name and email to show as the person running the chat, for the privacy note, takedown requests and questions.

## What you see

Everything below shows whenever the open spot is in Taiwan: always in Taiwan mode, and in World mode while Taiwan is picked. With
another country open, none of it appears.

### Spot card

- **Report strip:** under the facts on the "Right now" card, spanning the full card width, a "Surfer reports · last 4 h" strip
  shows up to 3 report chips for the current spot, newest first.
  - Each chip has a dot coloured by conditions (Clean green, OK amber, Choppy or Blown out red), size and conditions, then crowd
    and age: "Chest · Clean / Few people · 40 min ago".
- **"＋ Post a report"** opens the chat with the report form, preset to this spot.
- **No recent reports:** the strip shows the button and "No reports in the last 4 h".
- **Chat unreachable:** the strip stays hidden. It also stays hidden until chat is switched on (see Config).

### CHAT button

- A floating amber VT323 pill at the bottom right of the Forecast view.
  - It shows a pink dot when there are messages newer than the last one you saw, and how many people have the room open.
  - It sits above the safe area and below the full-screen map.
  - It's anchored to the bottom of the screen, so the header redesign doesn't move it.
- **Bottom padding:** the page gets extra space at the bottom in Taiwan, so the button never covers the end of the credits.
- **While dragging:** the button lets touches pass through while you drag the day picker or the day chart.
- **`?chat`** in the address opens the chat straight away. The address is then tidied back to `#<spot>`.

### The room

- **Opening:** it opens full screen above everything, map included, with an amber ✕. Escape closes it, and the page behind
  doesn't scroll or pull-to-refresh.
- **Header:** "TAIWAN CHAT 台灣浪友 · N online".
- **Filters:** All, plus the 8 spots.
  - A spot filter shows that spot's reports, shared sessions and tagged messages.
  - A text message takes the filter that was selected when it was sent; All means no tag.
  - A reply takes its parent's tag.
- **Pinned house rules,** with the privacy note and contact behind a "More" link.
- **Messages,** newest at the bottom: the last 100 load on open, and older ones load in pages of 50 on scroll up. Each shows the
  nickname, Bryan's badge where it applies, the spot tag if any, and the age.
  - **Text** messages, up to 500 characters. They can reply to another message (the quote is looked up by id; a deleted original
    shows "Message deleted") and get 👍, one per person.
  - **Report cards:** "Surf report · Jinshan 金山 / Chest high · Clean · Few people", plus what the poster's app showed for the
    forecast and buoy at that hour.
  - **Shared session cards:** spot and time, stars, the note, then the conditions and board.
- **Bottom bar:** ＋ Report, 📓 Log and the message box.
  - Signed out, the bar is one LINE sign-in button in LINE's official style: the green `#06C755`, the LINE icon, and their
    wording, 使用LINE帳號登入 / Log in with LINE / LINEでログイン.
- **First sign-in:** a sheet with the short privacy notice (below), a nickname field prefilled from the LINE name, and one tick:
  "I'm 13 or older (under 18 with a parent's or guardian's OK), and I accept the house rules and the privacy note."
  - It also says: "Your nickname, spot and time are public on reports and shared sessions."
- **Message menu:** a ⋯ button on each message, which long-press also opens. It offers Reply, 👍 and Report.
  - Your own messages also get Delete.
  - Bryan also gets Delete, Ban, Restore and Keep as evidence.
- **Main menu:**
  - My sessions, Change nickname (once a week), Download my data, Sign out everywhere, Delete my account.
  - Bryan also gets Lock or unlock the room, Hidden messages (with a count waiting for him), and Unban.

### Post a report

A bottom sheet with four rows of pills:

| Row | English | 中文 | 日本語 |
|---|---|---|---|
| Spot | the 8 spots | | |
| Size | Flat, Knee, Waist, Chest, Head, Overhead | 平, 膝, 腰, 胸, 頭, 過頭 | フラット, ひざ, 腰, 胸, 頭, 頭オーバー |
| Conditions | Clean, OK, Choppy, Blown out | 乾淨, 普通, 有點亂, 被風吹爛 | クリーン, まあまあ, ザワザワ, ジャンク |
| Crowd | Empty, Few, Busy, Packed | 沒人, 少, 多, 爆滿 | 貸切, 少ない, 多い, 激混み |

"Post" puts it in the room and on the spot's card for 4 hours. It carries what the poster's app showed for that spot at that hour,
labelled "Forecast said … · buoy … at 07:00".

### Log a session

- **The sheet has:**
  - the spot;
  - the day (today, yesterday or the day before), with start and end times;
  - how it went, 1–5 stars;
  - the board: Shortboard, Fish, Mini-mal, Longboard or Soft-top;
  - a note of up to 300 characters ("Kept nosediving on takeoff").
- **Conditions are added automatically** from the page's own data for that spot, at the middle of the session: wave height, period
  and direction, wind, tide and the buoy reading.
  - Each value keeps the time of the reading it came from.
  - If there's no data for that hour, the log saves without conditions, and the card says "No conditions recorded".
- **"Share to chat for tips"** is off by default. When it's on, the log also posts as a session card, and the note goes through
  the same filters as a message.
- **My sessions** lists your logs, newest first, with their conditions. A log can be deleted, and shared or unshared later.

## Architecture

```
waveslave.tw (GitHub Pages, hosting unchanged)          Cloudflare (free plan)
 template.html ── mount + 3 hooks ──▶ web/chat.js ──HTTPS/WSS──▶ Worker "waveslave-chat" (chat/src/index.js)
                                       UI, CSS, login,             CORS, routing, LINE token exchange
                                       socket, forms                       │ every call
                                                                           ▼
                                                        Durable Object "Room", name "taiwan"
                                                        SQLite: users, subs, messages, likes, flags,
                                                        sessions, logins, handoffs, limits, holds, meta
```

### Front end

- **`web/chat.js`** is one new classic script, loaded with `defer` and copied by `build-site.sh` next to `sw.js`.
  - It has no dependencies, and is about 30–40 KB.
  - It is a single IIFE that declares no global names. It reads the page's `ALL`, `LANG`, `CUR`, `VIEW`, `SPT`, `T`,
    `countrySpots`, `switchSpot` and `setView` by bare name.
  - It exposes only `window.CHAT = {spot, relang}`.
  - It injects its own `<style>`, so its CSS and code always ship together.
- **`template.html` gets only:**
  1. **Mount:** `<div id="nowReports" hidden></div>` as the last child of `section.now`, with
     `#nowReports{grid-column:1/-1}` and `#nowReports[hidden]{display:none}`.
  2. **Taiwan hook:** in the "spot picker and per-spot labels" block of `boot()`, next to the `section.spots` line, add
     `document.documentElement.classList.toggle("tw", spotCountry(SPOT)==="tw"); window.CHAT&&CHAT.spot(SPOT);`
  3. **Language hook:** `window.CHAT&&CHAT.relang()` at the end of `setLang`.
  4. **Chat-open guards:** the pull-to-refresh `touchstart` (in the "pull to refresh" block) and the map's Escape handler (next to
     `setFs`) do nothing while `html.chat-open` is set.
  5. **Script tag:** `<script src="chat.js" defer></script>` before `</body>`.
- **Start-up:**
  - `chat.js` first checks for login fragments `#c=` and `#e=`, and for `?chat`. It removes them at once with
    `history.replaceState(null, "", location.pathname + "#" + CUR)`.
  - It then calls its own `spot(CUR)`, because `boot(SPOT0)` ran before it loaded.
  - `CHAT.spot(id)` does nothing when `id` is the spot already shown, because `boot()` also runs on every language change and every
    return from the map.
  - Before leaving for LINE, it saves `CUR` in `sessionStorage` (`waveslave-chat-return`) and switches back to it on return. If
    the Map view is open when the chat opens, it calls `setView("fc", true)` first.
- **Config:** `const CHAT_URL = window.__chatUrl || ""` inside the IIFE. While it is empty the chat shows nothing at all, so the
  code can merge and go live before Bryan's setup is done. Tests set `window.__chatUrl`.
- **Live button data, without a socket:**
  - `GET /reports?spot=` returns `{reports, online, last_id}`. The pink dot shows when `last_id` is newer than the last-seen id in
    `localStorage`.
  - Both refresh on every spot change, and on `visibilitychange` at most once a minute.
  - The WebSocket opens only when the room opens. It closes when the room closes, or after 5 minutes in the background.
- **Rendering:** every value from the network goes in through `textContent`, `setAttribute` or a lookup in `chat.js`'s own
  tables. This covers nicknames, spot ids, message bodies, numbers in conditions, ids, counts and error text.
  - `chat.js` never uses `innerHTML` or `insertAdjacentHTML` with data in it.
  - No chat element carries `data-zh` or `data-ja`, because `applyLang()` rewrites those through `innerHTML`. `CHAT.relang()`
    redraws instead.
  - User text is drawn with `dir="auto"` and `unicode-bidi: isolate`.
- **Strings:** `chat.js` carries its own en/zh/ja table. Spot names come from `SPT(s, "name")`.
- **Conditions snapshot:** `chat.js` builds it from `ALL.spots[id]` at the session's middle hour, or at "now" for a report. It
  uses the same sources and unit conversions as the "Right now" card in `boot()`, and a test checks they agree.

  | Value | Today | The two days before |
  |---|---|---|
  | Waves | `hourly` rows `[t, h, p, dir, sh, sp, sdir, ww]` | `hist.wave` |
  | Wind, past hours | measured: `hist.station` + `dwind`; else model: `hist.wx` / `wx` | same |
  | Wind, future hours | `wind` | — |
  | Tide | `tides[day]`, interpolated like the page's tide reading | same |
  | Buoy | `hist.buoy` + `buoy`, on-the-hour rows | same |

  Times are Taipei clock (`YYYY-MM-DDTHH:MM`). The snapshot stores raw numbers, each with the time of its reading, plus
  `ALL.updated`.
- **Storage:** `localStorage` keys `waveslave-chat-token`, `-v` (login verifier), `-seen` and `-filter`, each wrapped in try/catch.
- **Service worker:** `sw.js` ignores cross-origin requests, so it never caches chat calls. `chat.js` is a same-origin file with
  the usual network-first caching. It is loaded only by the script tag, so offline the page simply runs without chat.

### Backend: `chat/`

**Files:**
- `chat/package.json`, with a lockfile, pinning `wrangler`, `vitest` and `@cloudflare/vitest-pool-workers`.
- `chat/wrangler.toml`.
- `chat/src/index.js`, the front Worker.
- `chat/src/room.js`, the Durable Object.
- `chat/src/mod.js`, pure functions: normalising, filters, nicknames, validation.
- `chat/src/auth.js`, pure functions: tokens, LINE ID token checks.
- `chat/blocklist.json`.
- `chat/test/`.

Everything is plain JavaScript modules.

**`wrangler.toml`:**
- `name = "waveslave-chat"`, `main = "src/index.js"`, `compatibility_date = "2026-10-21"`, `workers_dev = true`.
- `[[durable_objects.bindings]] name = "ROOM", class_name = "Room"`.
- `[[migrations]] tag = "v1", new_sqlite_classes = ["Room"]`. SQLite storage is the only kind on the free plan. Later class changes
  keep using `[[migrations]]`.
- `[vars]`:
  - `APP_URL = "https://waveslave.tw/"`
  - `ALLOWED_ORIGINS = "https://waveslave.tw"`
  - `LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize"`
  - `LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token"`
- Tests override the vars in `.dev.vars`.

**Getting the room:**
- Every route goes through one helper: `env.ROOM.getByName("taiwan", {locationHint: "apac-ne"})`. No stub is ever made without the
  hint, because only the first call that creates the object places it.
- The front Worker holds no state. It handles CORS and the LINE token exchange, and passes everything else to the room.
- If a call to the room fails, it answers `503 {"resting": true}` with CORS headers.

**CORS and origin:**
- `/reports` is public: `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=60`, which lets the browser reuse it
  for a minute.
- `/auth/redeem`, `/auth/signup` and `/me/*`:
  - reflect only origins in `ALLOWED_ORIGINS`, with `Vary: Origin`, and never send `Allow-Credentials`;
  - answer `OPTIONS` with `Allow-Methods: GET, POST, DELETE`, `Allow-Headers: Authorization, Content-Type` and `Max-Age: 7200`;
  - send `Cache-Control: no-store`, as do all `/auth/*` responses.
- `GET /ws` returns 403 unless `Origin` is allowed.
- The login callback only ever redirects to `APP_URL`.

**Routes:**

| Route | What it does |
|---|---|
| `GET /reports?spot=<id>` | The spot is checked first. Returns `{reports, online, last_id}`. Each report carries only `{ts, size, cond, crowd}`. The room keeps a 60 s copy per spot in memory. |
| `GET /ws` | WebSocket upgrade, passed to the room. The token goes in the first frame, never the URL. |
| `GET /auth/line/start?h=<hash>` | See Login. |
| `GET /auth/line/callback` | See Login. |
| `POST /auth/redeem` | See Login. |
| `POST /auth/signup` | See Login. |
| `GET /me/sessions`, `POST /me/sessions`, `DELETE /me/sessions/<id>` | The signed-in user's diary. |
| `POST /me/signout` | Signs out everywhere. |
| `GET /me/export` | The user's own data as JSON. |
| `DELETE /me` | Deletes the account. |
| `GET /admin/where` | Admin only. The room fetches `https://www.cloudflare.com/cdn-cgi/trace` and returns its `colo=` line, to confirm where the room lives. |

All `/me/*` and `/admin/*` routes use `Authorization: Bearer` and run inside the room.

### Login (LINE, web flow)

1. **The app starts it.**
   - `chat.js` makes a random 32-byte verifier `v` and keeps it in `localStorage` with a timestamp.
   - It opens `/auth/line/start?h=<base64url SHA-256(v)>`.
2. **Start.**
   - The room stores a row in `logins(state PK, nonce, pkce_verifier, h, created)`, where `state` and `nonce` are 32 random bytes
     each.
   - The Worker redirects to `LINE_AUTH_URL` with `response_type=code`, `client_id`, the registered `redirect_uri`, `state`,
     `scope=openid profile`, `nonce`, `code_challenge` (S256) and `code_challenge_method=S256`.
3. **Callback.**
   - **LINE error** (`error` present): redirect to `APP_URL?chat#e=<code>`.
   - **Otherwise:**
     1. Load the `logins` row by `state` and delete it in the same step. Reject it if missing or older than 10 minutes.
     2. Exchange the code at `LINE_TOKEN_URL` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`,
        `client_secret` and `code_verifier`.
     3. Verify the ID token:
        - reject unless the header `alg` is `HS256`;
        - check the HMAC-SHA256 signature with the channel secret, using `crypto.subtle`;
        - require `iss = "https://access.line.me"`, `aud = LINE_CHANNEL_ID`, `exp > now`, and `nonce` equal to the stored one.
     4. Compute `sub_hash = HMAC-SHA256(SUB_PEPPER, sub)`. If `subs.banned` is set, redirect with `#e=banned`.
     5. Store `handoffs(code_hash PK, h, sub_hash, line_name, pin, created, tries)` for 10 minutes. `code` is 128 random bits
        and `pin` is 6 digits. LINE's raw `sub` is not stored here or anywhere else, only `sub_hash` (ruling R22).
     6. Redirect to `APP_URL?chat#c=<code>&p=<pin>`.
4. **Back in the app.**
   - `chat.js` strips the fragment at once.
   - If its stored `v` is younger than 10 minutes, it sends `POST /auth/redeem {v, code}`.
   - The room checks that SHA-256(v) equals the row's `h`. It then returns:
     - for a known user: the session token, deleting the handoff row;
     - for a new person: `{needs_signup, line_name}`, keeping the row.
5. **Login finished in a different browser.** This happens with the iPhone home-screen app, which hands the login to Safari.
   - The page there has no matching `v`. It shows: "Signed in with LINE. Go back to the WaveSlave app and enter this code:
     482913", and nothing else.
   - The home-screen app shows a code box while its `v` is pending, and sends `POST /auth/redeem {v, pin}`.
   - Three wrong pins, or 10 minutes, void the handoff.
   - This is why a link someone else built can't sign them in as you: they hold neither your `v` nor your screen.
6. **Signup.** `POST /auth/signup {v, code or pin, nick, consent: "v1"}` creates the user only after the tick, and records
   `consent_at` and `consent_ver`. The LINE name is used only to prefill the nickname, and is never stored.
7. **Session token.**
   - Base64url `{uid, tv, exp}` plus an HMAC-SHA256 signature with `SESSION_SECRET`, valid 180 days.
   - The room checks on every `hello` and every `/me` call that the user exists, isn't banned, and that `tv` matches.
   - "Sign out everywhere", a ban and account deletion all bump `tv`, or remove the row, and close that user's sockets.
   - `users.id` is a random UUID, never a reused row number.

### Data (room SQLite)

**Tables:**
- `users(id TEXT PK, sub_hash UNIQUE, nick, nick_key UNIQUE, role, tv, created, last_seen, nick_changed, consent_at, consent_ver)`.
  Only the hash of LINE's `sub` is kept, with no email and no picture.
- `subs(sub_hash PK, banned, deleted_at)`.
  - It outlives account deletion, so deleting an account doesn't undo a ban or reset limits.
  - Deleted, unbanned rows are kept 30 days.
- `messages(id INTEGER PK AUTOINCREMENT, ts, uid, kind ∈ text|report|session, spot, body JSON, reply_to, likes, hidden_by ∈
  null|flags|ban|admin, flag_immune)`.
  - Indexes on `(ts)`, `(spot, ts)` and `(uid, ts)`.
  - The nickname is never stored in `body`; it is joined from `users` when read.
- `likes(msg_id, uid, PRIMARY KEY(msg_id, uid)) WITHOUT ROWID`, with `messages.likes` updated alongside.
- `flags(msg_id, sub_hash, reason, ts, rejected, PRIMARY KEY(msg_id, sub_hash))`.
- `sessions(id, uid, spot, start, end, stars, board, note, cond JSON, shared_msg)`, indexed on `(uid, start)`.
- `logins`, `handoffs`: as in Login.
- **LINE's raw `sub` is never stored,** in any table, even for a moment: the room makes `sub_hash` from it and keeps only that
  (ruling R22). Schema version 1, as merged in PR #97, had a `sub` column in `handoffs`, written and never read. Version 2 drops
  it (`ALTER TABLE handoffs DROP COLUMN sub`, which keeps the rows), so LINE's raw ID is gone from every table after `migrate()`,
  in a new room and in one that version 1 made.
- `limits(key PK, n, window_end)`, keyed by `sub_hash` and kind.
- `holds(msg_id, body, uid, sub_hash, reason, ts)`, visible to Bryan only, kept 180 days (see Moderation).
- `meta(key, value)`, for: lock state, `admin_uid`, admin-claim failure counts, `next_retention`, `schema_ver` and the
  daily usage counters.

**Socket protocol:** JSON frames, at most 4 KB each. A larger frame closes the socket.
- **Client to room:**
  - `hello {v: protocolVersion, token?}`
  - `older {before_id}`
  - `say {text, spot?, reply_to?}`
  - `report {spot, size, cond, crowd, snap}`
  - `share {session_id}`, `unshare {session_id}`
  - `like {id}`, `flag {id, reason}`, `delete {id}`
  - `nick {nick}`
  - `admin {code}`
  - admin only: `ban`, `unban`, `restore`, `keep`, `lock`, `unlock`, `hidden_list`
- **Room to clients:** `history`, `msg`, `update` (likes, hide, delete), `online`, `tick`, `error {code}`.
- **Before signing in,** a socket may send only `hello` and `older`. Five bad frames close it. Each IP may hold at most 5 sockets,
  counted in memory only.
- **Frames per socket (ruling R22):** one socket may send at most 1,000 frames of any kind, refused and invalid ones included, which
  is 1% of the day's request budget (see Free-plan budget). The next one goes unanswered and closes the socket with 1008, which
  `chat.js` treats as a drop: a new socket, which counts from nothing. Bryan's sockets aren't counted.
- **Frames that reach a closed socket:** a client that sends without waiting still has frames on their way when the room closes
  its socket, for any reason (1008, 1009, 4429 or another), and the runtime still hands them to the room. A client that ignores
  the close can go on sending, with no limit, until it drops the connection itself. The room answers none of them, but counts
  each one as a room request, like any other frame (see Free-plan budget).
- **What public frames carry:** only `{id, ts, nick, role, kind, spot, body, reply_to, likes}`. Hidden messages go only to
  Bryan's sockets. No uid or LINE data is ever sent.
- **Every change is broadcast,** so a delete or hide disappears from every open screen.
- **Versions:** the room accepts the current and the previous protocol version. Anything older gets `error{code:"update"}`, shown as
  "Reload for the new chat".
- **Hibernation:** the room uses the WebSocket Hibernation API.
  - Each socket's user id, role and version live in its attachment.
  - Nothing that must outlive a request is kept only in memory. That covers logins, handoffs, limits, bans and counters.
- **Keepalive:**
  - While any socket is open, the alarm fires every 45 s and broadcasts `tick {online}`.
  - `chat.js` treats 100 s without a frame as a dead socket and reconnects.
  - On returning to the foreground it sends `ping`. The room answers through `setWebSocketAutoResponse`, without waking.
  - `online` counts only open sockets.

**Validation:** the room checks every write and stores nothing that fails.
- `spot` must be one of the 8 Taiwan ids (a constant in `mod.js`).
- Size, conditions, crowd and board must be one of their codes.
- Stars must be a whole number from 1 to 5.
- Session times:
  - `start` no earlier than 00:00 Taiwan time two days ago, and not in the future;
  - `end` after `start`, and at most 12 hours later.
- The conditions snapshot may hold at most 12 known keys, each a finite number inside a fixed range, plus ISO times.
- A flag reason must be one of spam, harass, sexual, child or other.
- Ids must exist.
- Owner checks use `WHERE id=? AND uid=?`.

**Alarm:** one alarm slot serves both the keepalive and retention.
- Every room request calls `ensureAlarm()`, which sets an alarm if none is set.
- `alarm()` runs retention once it's past `next_retention` (19:00 UTC, which is 03:00 in Taiwan), and sends a tick while sockets
  are open.
- It always reschedules itself in `finally`.
- Deletes run in batches of 1,000.

**Retention (daily):**
- delete text and session messages older than 30 days, and clear `sessions.shared_msg`;
- delete orphaned likes and flags;
- remove `uid` from reports older than 30 days, which then show as "a surfer";
- delete reports after 1 year and flags after 180 days;
- delete `logins` and `handoffs` past expiry, and `holds` after 180 days;
- delete accounts, with their logs, after 24 months without signing in.

**Deleting an account** happens in one transaction:
- delete the user's text messages and session cards, and broadcast the deletes;
- strip the uid from their reports;
- delete their likes, updating the counts, and their flags, without un-hiding anything;
- delete their sessions, limit rows and handoffs;
- close their sockets.

Only the `subs` row and any `holds` remain. Cloudflare's own point-in-time recovery keeps copies for up to 30 days; the privacy
note says so.

### Moderation (no AI, no cost)

1. **Normalise a checking copy of every message:**
   - apply NFKC, then case-fold;
   - remove every default-ignorable and direction-control character (U+00AD, U+180E, U+200B–U+200F, U+202A–U+202E, U+2060–U+2069,
     U+FEFF, variation selectors and tags), from the stored text too;
   - map look-alike Latin, Cyrillic and Greek letters to Latin using a small table;
   - before the phone and ID checks, remove separators between digits and map Chinese numerals (〇一二…九, 零) to digits.
2. **Hard block,** with a polite message in the sender's language. The text stays in their box so they can edit it. Blocked:
   - links;
   - LINE invites and IDs (`line.me`, `lin.ee`, 加賴, 加LINE, `@id` patterns);
   - `t.me`;
   - URL shorteners;
   - Taiwan phone numbers (`09xxxxxxxx`, `+886 9xxxxxxxx`);
   - investment-scam phrases (飆股, 帶單, USDT and similar);
   - e-cigarette terms;
   - a short slur list.

   The patterns live in `chat/blocklist.json`, which Bryan can edit on GitHub. Casual swearing (幹, 靠北) is not blocked, and the
   tests check 幹嘛 and 樹幹 pass.
3. **Rate limits,** stored in `limits` or counted from `messages` with the `(uid, ts)` index:
   - messages: one per 5 s and 20 per 10 minutes;
   - accounts under 24 hours old: 10 messages an hour;
   - reports: one per spot per 2 hours, 6 a day;
   - shared sessions: 5 a day;
   - private logs: 20 a day and 1,000 in total;
   - likes: 30 per 10 minutes;
   - flags: 20 a day;
   - nickname changes: one every 7 days, and a freed nickname is held for 30 days;
   - older messages: one page a second per socket.
4. **Report button:**
   - A flag counts only if the flagger's account is at least 24 hours old and has posted at least once.
   - Flags are counted per LINE account (`sub_hash`).
   - Self-flags and flags on Bryan's messages are ignored.
   - A message hides once 3 counted flags reach it.
   - The sexual and child-safety reasons hide a message on one flag, but only from accounts at least 7 days old with 5 or more
     posts, at most 3 times a day. Otherwise those flags count as one of the 3.
   - When Bryan restores a message, its flags are marked rejected and it can't be flag-hidden again. Flags from an account with 2
     rejected flags stop counting.
5. **Bryan's tools:**
   - Delete.
   - Ban: hides the user's messages from the last 24 hours, stops their flags counting, closes their sockets and blocks their LINE
     account from signing in again.
   - Unban, Restore, Lock or unlock the room.
   - Hidden messages, a list with the reason each was hidden.
   - Keep as evidence.
   - A message hidden for child safety is copied to `holds` automatically and kept 180 days, whatever else is deleted. This is
     what Taiwan's 2024 child-protection amendment asks for; a lawyer should confirm.
6. **Nicknames:**
   - normalised as in step 1, from letters, digits, single inner spaces and `_ - .`, 2–20 characters;
   - unique by `nick_key`, the normalised look-alike-folded form;
   - refused if that form contains any reserved word: bryan, admin, waveslave, coach, mod, staff, 官方, 管理, 管理员, 管理員, 教練,
     教练 or 站長.
7. **Admin claim:**
   - `ADMIN_CODE` is at least 32 random characters, made by the setup guide. Elevation is off if the code is shorter.
   - `chat.js` sends any text starting with `/` or `／` as an `admin` frame, never as `say`. The room also drops any `say` that
     starts with a slash after normalising.
   - The code is compared in constant time, on SHA-256 digests.
   - The first correct claim sets `meta.admin_uid`, and claims are closed after that.
   - Three wrong tries block that account from claiming, and ten in total switch claiming off until the code is changed.
   - Bryan's account can't be flagged into hiding or banned.

### Privacy note (zh-TW, en, ja; shown at first sign-in, full text behind "More")

It covers what Taiwan's Personal Data Protection Act, Article 8, asks for:
- who runs the chat (Bryan to confirm);
- why: running the chat;
- what: nickname, a one-way code of the LINE ID, messages, reports, session logs, and IP addresses seen by Cloudflare;
- where and who:
  - Cloudflare stores it on servers outside Taiwan;
  - LINE (LY Corp) handles sign-in;
  - posts are public;
- how long: the kept times above, plus Cloudflare's 30-day recovery copies, and 180 days for content hidden for child safety;
- your rights: Download my data, Delete my account, and the contact email;
- what happens if you don't sign in: you can still read everything.

Whether a 13–17-year-old's tick counts as valid consent, and the exact rules that apply, are for a lawyer to confirm.

### Free-plan budget

These are the free-plan limits, checked 2026-10-21:
- Workers: 100,000 requests a day, counting every HTTP call and WebSocket upgrade.
- Durable Objects: 100,000 requests a day (counted here as every incoming frame, every alarm and every call from the Worker), plus
  5M rows read and 100k rows written.
- Sources: https://developers.cloudflare.com/workers/platform/pricing/ and
  https://developers.cloudflare.com/durable-objects/platform/pricing/

What each action costs:
- **Viewing a Taiwan spot:** 1 Worker request and 1 room request, at most once a minute per spot per phone, served from the room's
  60 s memory copy.
- **Opening the room:** 1 Worker request, 2 room requests and about 100 rows read. Tests assert at most 110 rows, on a database
  seeded with a year of data.
- **Keepalive:** about 1,920 room requests a day, only while someone has the room open.
- **Each message:** 1 room request and a few rows written.
- **One socket** adds at most 1,001 room requests, about 1% of the daily limit, when its client stops sending at the close, as
  `chat.js` does: its 1,000 frames and the one that closes it (Socket protocol, "Frames per socket"). Without the cap one socket
  could spend the whole day's budget on refused frames.
- **A client that ignores the close** isn't held to that. The runtime keeps handing the room its frames for as long as it keeps
  the connection open: about 4,000 a second for 45 s in a test under `wrangler dev`, enough for the day's 100,000 in about 25 s.
  Nothing in the room can stop those calls. Cloudflare bills incoming WebSocket messages as requests (20 to 1 for billing), and
  its pricing page doesn't say whether that ratio applies to the free plan's 100,000 a day, so the room counts each one as a room
  request, like every other frame. Such a client can still put the chat to rest for the day, but the chat then rests at 90% and
  says so, instead of failing with Cloudflare's errors once the daily limit is passed.

At launch (a few hundred Taiwan page views and a few hundred messages a day) that is under 5% of every limit.

The room also keeps approximate daily counts. Above 90% of any limit, it closes sockets with code 4429 and answers `{resting:
true}`. Only then does `chat.js` say "Chat is resting until 08:00" (the free limits reset at 00:00 UTC). Anything else shows
"Chat is offline · Retry". The rest of the site carries on as normal either way.

### Deploy

**`.github/workflows/chat.yml`:**
- **Triggers:** pushes to main touching `chat/**` or the workflow file, plus `workflow_dispatch`, with `concurrency: chat`.
- **Steps:**
  1. A guard step ends the job with a notice, not a failure, while `CLOUDFLARE_API_TOKEN` or any of the chat secrets is empty.
  2. `npm ci && npm test` in `chat/`.
  3. Write the secrets (`LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, `SUB_PEPPER`, `ADMIN_CODE`) to a temporary
     file.
  4. Run `cloudflare/wrangler-action` with `workingDirectory: chat` and `deploy --secrets-file`, so each deploy is one version and
     drops open sockets once. The app reconnects by itself.

**Other changes:**
- `refresh.yml` gets `paths-ignore: ["chat/**"]` on its push trigger, so backend-only commits don't rebuild the site.
- `build-site.sh` copies `web/chat.js` with the other web files.

## Error handling

- **Can't connect:**
  - "Chat is offline · Retry".
  - It retries with backoff from 1 s to 30 s, and again when the app returns to the foreground.
  - The page never waits on chat. `chat.js` catches its own errors and never throws into the page.
- **Chat resting:** the message above, only on code 4429 or `{resting: true}`.
- **Login cancelled or failed:** "Couldn't sign in with LINE, try again". Reading keeps working.
- **Login blocked:** a banned LINE account sees "This LINE account can't post here".
- **Blocked message:** it stays in the box with the reason, so it can be edited.
- **Over a rate limit:** "Slow down a little" with the wait time.
- **Expired or revoked token:** it signs out quietly and shows the LINE button.
- **Old app version:** "Reload for the new chat".
- **No forecast data for a session's hour:** "No conditions recorded".
- **Room locked:** everyone can read, but only Bryan can post.

## Testing

**Backend:**
- **Pure modules** (`mod.js`, `auth.js`) run under `node --test`. They cover:
  - normalising and each block pattern, including their zero-width, styled-letter and spaced-digit versions;
  - false positives on 幹嘛, 樹幹 and 靠北;
  - nickname folding and the reserved words;
  - token signing, expiry and `tv`;
  - ID token checks: good, wrong `alg`, wrong `aud`, wrong `nonce`, expired.
- **The Worker and room** run under `@cloudflare/vitest-pool-workers`, with LINE mocked by intercepting outbound fetch. They cover:
  - the whole login, including a stolen-link attempt (a login started with someone else's `h`), pin redeem and three wrong pins;
  - signup consent;
  - rate limits, flags, bans and ban survival through account deletion;
  - admin claim and lockout;
  - deleting an account, checking that no row with that uid is left;
  - CORS and origin checks;
  - validation rejects;
  - retention (`runDurableObjectAlarm`);
  - hibernation recovery (`evictDurableObject`);
  - the row-read limits for `history` and `/reports` on a seeded year of data.

**Front end:**
- **Playwright at phone width** against `wrangler dev` and a small fake-LINE server.
  - It covers the whole flow: read, sign in, nickname, message, report, session log with share, like, flag, delete, sign out
    everywhere.
  - It includes the home-screen pin path.
  - It runs an XSS check: posting `<img src=x onerror=alert(1)>` as a message, a nickname and a conditions value must create no
    `img`.
  - Screenshots in en, zh and ja.
- **Snapshot check:** the conditions snapshot for "now" matches the Right now card.
- **`tests/map/check.js` gets a chat-off case.** It serves the real `web/chat.js`, then checks:
  - with `CHAT_URL` empty: no page error, no button, and the strip stays hidden;
  - with an unreachable backend: the strip stays hidden and the page still draws.
- All existing unit tests still pass.

**After Bryan's setup:**
- A real phone test of LINE login in Safari, in the iPhone home-screen app and inside LINE's own browser.
- `/admin/where` should show a north-east Asia location (for example NRT, KIX, ICN, HKG or TPE).

## What Bryan sets up (a step-by-step guide comes with the PR)

1. **Cloudflare.** Make a free Cloudflare account (no card), pick the workers.dev subdomain (for example `waveslave`), and create
   an API token from the "Edit Cloudflare Workers" template. Note the account ID.
2. **LINE channel.** In the LINE Developers Console, with his LINE account:
   - create a provider, "WaveSlave";
   - create a LINE Login channel (Region Taiwan, App type Web app);
   - copy the channel ID and secret.
3. **GitHub secrets.** Add seven: the Cloudflare token and account ID, the LINE ID and secret, and three random values made with
   the guide's one-line command (`SESSION_SECRET`, `SUB_PEPPER`, `ADMIN_CODE`).
4. **First deploy.** Run the chat workflow once.
5. **LINE callback.** Back in the LINE console, set the callback URL to
   `https://waveslave-chat.<subdomain>.workers.dev/auth/line/callback`, leave email off (so no review is needed), and switch the
   channel to Published.
6. **Switch on.** A small PR sets `CHAT_URL`, and the chat goes live.
7. **Admin.** Bryan signs in and types `/admin <code>` once.

## Not verified yet (checked during the build)

- That Turnstile-free sign-up holds up against spam with LINE accounts alone. LINE accounts need a phone number, which is the
  main brake.
- How LINE's in-app browser and iOS home-screen apps handle the redirect today. The pin path covers the worst case.
- Which Cloudflare city hosts the room.
- Legal: the start dates of the 2025 privacy-law amendments and the 2024 child-protection amendment, and consent rules for
  minors. These are for a lawyer, not this build.

## Out of scope for this version

- The AI coach, photos and video, private messages, per-spot rooms and push notifications.
- Chat for other countries.
- Report counts on the spot picker or the map.
- A `chat.waveslave.tw` address, and Google or email login.
