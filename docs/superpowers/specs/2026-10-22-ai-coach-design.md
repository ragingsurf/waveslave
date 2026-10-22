# AI surf coach (clip review) for WaveSlave: design

Date: 2026-10-22. Status: for Bryan's review.

## Goal

A coach on waveslave.tw that helps Taiwan surfers get better from their own clips. A surfer picks a short clip of themselves
from their phone and the move they want help with. The coach sends back what went well, the one main fix with the key frames
it is about, and a drill to practise. It remembers their past reviews of the same move, so it can show progress, and it gives
people a reason to come back to the site. At first Bryan approves every draft; later it can run on autopilot.

## Decisions (Bryan, in the project thread, 2026-10-22)

- **What it is:** clip review, on a **Coach** tab next to Forecast and Map.
- **First test:** the coach's feedback on Bryan's own clip (`surf-app/coach/clip-test-1/` in the project files) is the standard
  to match. The coach on the site uses the same AI model (Claude Opus 5.5) and the same kind of close-up key frames.
- **Who:** Taiwan only for now. The Coach tab shows only in developer mode (World mode, behind the PIN on the W) until Bryan
  says "go live"; then one switch shows it to everyone in Taiwan mode.
- **One coach for everyone:** no free and paid plans. Every signed-in surfer gets **2 reviews a month**.
- **Sign-in:** with LINE, the same account as the chat.
- **One move per review:** the surfer picks the move. The review covers that move only: what went well, the one main fix with
  its key frames, and one drill. A **one-line heads-up** is added only when something serious is wrong outside that move, and it
  points to a review of its own. The coach **remembers past reviews of the same move** and says how it has changed.
- **Questions with each clip,** mostly taps: the move to look at; their level, board and stance (asked once, then
  remembered); and one optional line ("anything else?"). The level sets how the coach talks.
- **The video never leaves the phone.** The phone cuts the clip into key frames, the surfer taps themselves once, the site
  follows them, and only the close-up key frames are sent. The AI reads frames, not video, so this is as accurate as uploading
  the video.
- **Marking the surfer:** one tap, then one screen with all the close-ups. They fix only a wrong one and press Send. If the
  site loses them, it asks for one more tap on that frame. As little work for surfers as possible.
- **Words the surfer sees:** "frame by frame" and "key frames", never "pictures" or "stills". The privacy note says plainly:
  "Only key frames are sent. Your video never leaves your phone." The site never claims the coach watches the whole video.
- **Bryan's review:** a Drafts list in the Coach tab, in developer mode. He can edit any line, then Approve, Redo or Reject
  with a short note. An email to the WaveSlave Gmail tells him when drafts are waiting. An Autopilot switch comes later.
- **Money:** only the credit that comes with Bryan's Claude Max plan (US$100 a month, no card on file). New reviews stop when
  the month's spend reaches **US$78**. The next US$2 finishes reviews already sent, and US$20 a month stays free for Bryan.
  An **extra budget** setting, 0 for now, lets the coach carry on past that once Bryan adds credit and names a monthly amount.
- **In review mode:** at most **10 new reviews a day**.
- **Safety:** 18+ only at first. A clip that isn't surfing is refused. One review in progress per person. A Ban button in the
  Drafts list.
- **Privacy:** key frames are deleted 30 days after the review. The written feedback stays, so the coach can track progress,
  until the surfer deletes it.
- **A surfer who leaves halfway** (to answer LINE, say) keeps their progress.

## Defaults I picked (say if you want otherwise)

- **Feedback language:** the site's language when the clip is sent, English or 中文. Drafts in 中文 come with an English copy
  for Bryan, which adds about NT$1 a review.
- **Sign-up:** someone new to WaveSlave goes through the chat's sign-up (a nickname and the house rules) plus a short coach
  agreement. One account then works for both.
- **Which month:** the 2 reviews count by calendar month in Taiwan time. A review counts when it is sent. Reviews Bryan rejects,
  reviews that fail, and reviews caught when the coach pauses for money don't count.
- **Redo:** at most 2 per review, since each one costs a new AI call.
- **The surfer isn't messaged** when feedback is ready. The Coach tab shows a dot, and the review is waiting in the tab.
- **Clips:** any length from 3 seconds to 2 minutes. The filming guidelines still ask for 10 to 30 seconds.
- **Model:** Claude Opus 5.5 (`claude-opus-5-5`), kept in a setting so it can change without new code.

## Bryan to confirm in this review

1. **The day your Max plan renews each month.** Your free credit refreshes that day, so the coach counts its spending from it.
   It's on claude.ai under Settings > Billing.
2. **18+ only** for now.
3. **Someone new signs up through the chat's sign-up,** nickname and house rules included.
4. **Key frames are kept 30 days,** then deleted. The written feedback stays.

## What the surfer sees

### The Coach tab

- A third tab, **Coach** (教練), after Forecast and Map. It shows only while the coach is switched on for this visitor
  (developer mode now, everyone in Taiwan mode after "go live") and the page is on a Taiwan spot, the same rule as the chat.
- It opens a full-screen Coach panel, like the chat room. ✕ returns to Forecast.
- **Signed out:** a short line on what the coach does, an example review (Bryan's test clip, used with his OK), and "Sign in with
  LINE". After signing in, the page comes back to the Coach panel, not the chat.
- **Signed in:** "2 of 2 reviews left in November", a **New review** button, and their reviews, newest first, each showing the
  move, the date and its status (Coach is reviewing / Ready / Not reviewed).
- **First review only:** the coach agreement. It says the coach is AI, checked by a person at first; that only key frames are
  sent; who sees them; that other people in the frame should be avoided; the ocean-safety note; and a tick for "I'm 18 or
  older". It is agreed once, and its version is saved.

### New review

1. **Pick a clip:** "Choose a clip". The phone's own picker opens. On iPhone it may say "Preparing…" for a few seconds while the
   phone hands the clip over; the site shows "Getting your clip ready…".
2. **The questions:**
   - **Which move?** Pop-up, bottom turn, top turn, cutback, riding down the line, or other (with a short line).
   - **First time only, then remembered and editable:** level (first waves, riding green waves, starting to turn, turning well);
     board (shortboard, mid-length, longboard, foamie); stance (regular, goofy, not sure).
   - **Anything else?** One optional line, up to 200 characters.
3. **Find the move:** the clip plays in a small player with a slider. "Slide to your [cutback] and tap **Here**."
4. **Tap yourself:** the frame at that moment, full size, with "Tap yourself". They can pinch to zoom when they are small.
5. **Check:** one screen with all 12 close-ups in a grid (4 × 3), headed "Is this you in each key frame?". A wrong one is
   fixed by tapping it, then tapping themselves on its full frame. **+ / −** grows or shrinks every box. When the site lost
   them on a frame, that frame is already open, asking for a tap.
6. **Send:** "Send to your coach". A progress bar, then "Sent. Your feedback comes within a day." The count goes down by 1.

### The review

Shown in their language, in the Coach tab:
- the move and the date;
- **What went well:** a title and a sentence or two, with its key frame and time ("Key frame at 0:07.5");
- **The main fix:** a title, what is happening, and why it matters, with its 1 to 3 key frames and their times;
- **Your drill:** one thing to practise, on land or in the water;
- **Heads-up** (only when there is one): one line about something serious outside this move;
- **Progress** (only from their second review of a move): one or two sentences comparing it with last time;
- a line at the foot: "Reviewed by WaveSlave Coach (AI), checked by a person. Surf within your limits."

Tapping a key frame enlarges it. **Delete** removes the review and its key frames.

### When something goes wrong

| What | The surfer sees |
|---|---|
| Not signed in | "Sign in with LINE to get a review" |
| No reviews left | "You've used your 2 reviews for November. More on December 1." |
| Coach full today (10 already) | "Coach is full today. Try again tomorrow." |
| Money limit reached | "Coach is resting until 15 November." (the next credit day) |
| Coach paused by Bryan, or its key missing | "Coach is taking a break. Try again later." |
| Clip won't open on this phone | "This phone can't open that clip. Try another, or open waveslave.tw in your phone's own browser." |
| Inside LINE on Android, no picker opens | the same message, with a link that opens the page in the phone's browser |
| Clip too short or too long | "Pick a clip between 3 seconds and 2 minutes." |
| Upload fails | it retries by itself 3 times, then "Couldn't send. Tap to try again." Nothing is lost. |
| Left halfway, or the page reloaded | "Pick up where you left off?" with the clip's key frames, taps and answers still there |
| One review already on the way | "Your last review is still with the coach." (only one in progress at a time) |
| Not a surf clip | Not published. "We couldn't review this clip." Bryan sees it and may ban the account. |
| Rejected by Bryan | Bryan's short note, for example "We couldn't see you. Try filming closer." The review doesn't count. |

## What Bryan sees

### The Drafts list

- In the Coach panel, a **Drafts** section shows only when the server says the signed-in account is the admin
  (`role = "admin"`). The PIN on the W is not enough, so someone who guessed it still sees nothing.
- **Each draft shows:**
  - the move, the surfer's answers and note, their level, and how long it has waited ("waiting 5 h");
  - the key frames, each with its time;
  - the draft: what went well, the main fix, the drill, the heads-up and the progress line, each in an edit box;
  - for 中文 drafts, the English copy beside it;
  - warnings in red when the coach said it couldn't see the surfer, marked frames as unusable, or thinks it isn't a surf clip.
    A not-surf clip's frames stay hidden behind "Show anyway".
- **Actions:**
  - **Approve:** publishes it, with any edits.
  - **Redo:** with a note for the coach ("focus on the back foot"). The coach writes a new draft. At most 2 per review.
  - **Reject:** with a short note to the surfer. The review doesn't count against their 2.
  - **Ban:** rejects it and bans the LINE account, the same ban as the chat's.
- **Settings:** Autopilot on/off, Pause the coach, "Send a test email", and this month's spend ("US$12.40 of US$78, 96
  reviews").

### The email

- Sent from Resend's free service to the WaveSlave Gmail, **at most once an hour**: "WaveSlave Coach: 2 drafts waiting (oldest
  3 h)" and a link to the Drafts list. It holds no names, LINE details or frames.
- Also sent when a review fails after its retries, and when the coach pauses because the money limit was reached.
- When the email key isn't set, nothing is sent and the Drafts list still works.

### Autopilot (off at launch)

When Bryan turns it on, a draft that passes every check publishes at once: a surf clip, the surfer visible, the reply complete.
It is still listed, so Bryan can check it later and edit or withdraw it. A draft that fails a check waits for Bryan as before. The
10-a-day limit no longer applies; the money limit still does.

## Architecture

```
waveslave.tw (GitHub Pages)                         Cloudflare (free plan), worker "waveslave-chat"
 template.html ─ Coach tab + panel ─▶ web/coach.js ──HTTPS──▶ Worker (chat/src/index.js): CORS, routes, who is signed in
                │                     frames, tap, check,           │ RPC: whoIs(token)          │ RPC: the coach routes
                └─ web/chat.js ◀─ sign-in hook ─┘                    ▼                            ▼
                                                     Durable Object "Room" (chat)     Durable Object "Coach", name "taiwan"
                                                                                       reviews, frames, quota, meta
                                                                                       alarm ──▶ api.anthropic.com
                                                                                             └──▶ api.resend.com (email)
```

### Front end: `web/coach.js`

- **One new classic script,** loaded with `defer`, with no dependencies. It is a single IIFE that exposes only
  `window.COACH = {dev, relang, spot}`, injects its own `<style>`, and carries its own English and 中文 strings. It reads the
  page's `WORLD`, `LANG`, `CUR`, `countrySpots` and `setView` by bare name, as chat.js does.
- **Who sees it:** `const PUBLIC = window.__coachPublic === true` (false until "go live") and `on() = PUBLIC || WORLD`, like
  chat.js. `keepWorld()` in template.html calls `COACH.dev()` next to `CHAT.dev()`. While `on()` is false the tab is hidden and
  coach.js asks the backend nothing. Going live is a one-line change: `PUBLIC` to `true`.
- **Address:** coach.js uses the same backend address as chat.js. While it is empty, the coach shows nothing.
- **Versioned like chat.js:** build-site.sh writes `coach.js?v=<cksum>` into the page and copies the file next to `sw.js`.
- **template.html gets only:** the Coach tab button (`data-v="coach"`, hidden by default), the hooks `COACH.dev()`,
  `COACH.relang()` and `COACH.spot()` beside chat.js's, and the script tag. Tapping the tab opens the panel (`COACH.open()`
  through the tab handler) and doesn't change `VIEW`, so the page's Forecast/Map state and its saved view stay as they are.
- **Sign-in:** chat.js gains a small hook, `CHAT.signIn(then)` and `CHAT.token()`. `then = "coach"` makes the LINE return land
  on `APP_URL?coach` instead of `?chat`: `/auth/line/start` takes `then` (only "chat" or "coach"), the login row keeps it, and
  `backToApp()` uses it. On return, chat.js finishes the sign-in as now and then calls `COACH.open()` instead of opening the room.
- **Getting the frames:**
  - `<input type="file" accept="video/*">`, then an explicit **Start** button whose tap calls `play()` and `pause()` on a
    `<video muted playsinline>` with an object URL. iOS needs that tap to let the video load.
  - After `loadedmetadata`, check the length is 3 s to 120 s. A `<video>` error shows "This phone can't open that clip".
  - **Seeking:** for each time, register `requestVideoFrameCallback` **before** setting `currentTime`, then wait for both it and
    `seeked`, and accept the frame when `mediaTime` is within half a frame of the target. On iOS, `seeked` alone can fire before
    the new frame is drawn.
  - **Which times:** 12 key frames every 0.25 s from 1.5 s before the surfer's "Here" to 1.25 s after, moved to fit inside the
    clip; plus 4 context frames spread evenly over the rest of the clip.
  - **Drawing:** straight from the video into one reused canvas with `drawImage(video, sx, sy, sw, sh, 0, 0, w, h)`. Never draw
    a full 4K frame into a canvas; clear the canvas when done (iOS caps canvas memory). Canvas JPEGs carry no location data.
- **Finding the surfer:**
  - The box is a square, first sized at 45% of the frame's short side, moved by **+ / −**.
  - **Following them:** from the tapped frame, a small tracker walks forward and back through the 12 key frames. It matches a
    patch around the last position on grey, quarter-size frames (normalised cross-correlation) and searches a window around it.
    A match score below 0.5 marks the surfer lost on that frame.
  - The check screen is the safety net: a lost frame is opened for a tap, and the surfer can fix any other.
  - "Not visible" skips a key frame. At least 8 of the 12 must be kept.
  - The context frames are whole frames, not close-ups.
- **Frame size:** a close-up is the box's size, but at most 784 × 784, rounded down to a multiple of 28 (the AI counts image
  cost in 28-pixel tiles, so this wastes nothing). A context frame is the whole frame, 784 px on its long side. JPEG quality
  0.85, about 40–150 KB each.
- **Keeping progress:** the key frames (as JPEG blobs), taps, box sizes and answers are kept in IndexedDB, in try/catch, until
  the review is sent or deleted. This matters because developer mode reloads the page after more than a minute in the
  background. On the next visit: "Pick up where you left off?"
- **Sending:**
  1. `POST /coach/reviews` with the answers, the language, each frame's time, kind (close-up or context) and box. It returns a
     review id.
  2. `POST /coach/reviews/{id}/frames/{n}` once per frame, with the JPEG as base64 text (`Content-Type: text/plain`).
  3. `POST /coach/reviews/{id}/send`.
  - Each request has its own 60 s timeout and is tried 3 times. `GET /coach/reviews/{id}` says which frames the server already
    has, so a resumed send only sends the rest. These calls don't go through chat.js's `api()`, whose 10 s timeout is too short
    for a weak beach connection.
- **Drawing the review:** frames are fetched with the sign-in token into blob URLs (an `<img>` can't send the token). Every
  value from the network goes in through `textContent` or `setAttribute`, never `innerHTML`.
- **Service worker:** `sw.js` already leaves non-GET and cross-origin requests alone, so nothing of the coach is cached.

### Backend: in `chat/`, a second Durable Object class

- **Why a new class, not the chat's Room:** Room counts every request against the budget that rests the chat; its one alarm
  is taken by the chat's own jobs; and its request bodies are capped at 4 KB. A separate `Coach` object keeps the chat's
  limits and timing untouched.
- **wrangler.toml:** a `COACH` binding for class `Coach`; a migration `tag = "v2"`, `new_sqlite_classes = ["Coach"]`; and new
  `[vars]`:
  - `COACH_MODEL = "claude-opus-5-5"`;
  - prices in US$ per million tokens: `COACH_PRICE_IN = "4"`, `COACH_PRICE_OUT = "20"`;
  - `COACH_STOP_USD = "78"`, `COACH_HARD_USD = "80"`, `COACH_EXTRA_USD = "0"`;
  - `COACH_CREDIT_DAY` (the day Bryan's credit refreshes; confirmed in this review);
  - `COACH_MONTHLY = "2"`, `COACH_DAILY = "10"`;
  - `COACH_ALERT_TO = "waveslave050@gmail.com"`.
- **Placement:** `env.COACH.getByName("taiwan", {locationHint: "apac-ne"})`, like Room. `/admin/where` gains the Coach's data
  centre, because Anthropic's API doesn't serve every place (Hong Kong, for one), and the AI calls go out from where Coach runs.
- **Who is calling:** the Worker turns the Bearer token into `{uid, sub_hash, role}` with a new Room RPC method, `whoIs(token)`.
  It wraps `signedIn()`, so a deleted, banned or signed-out account is refused, and it counts the call in Room's usage meter (RPC
  calls don't pass through Room's `fetch()`, where the meter is today). The Worker passes that identity to Coach as RPC
  arguments; the surfer never supplies it.
- **Routes,** all `kind: "private"` (our own pages only, never cached; `coach` joins `NEVER_CACHED`), GET/POST/DELETE only:

  | Route | Who | What |
  |---|---|---|
  | `GET /coach/me` | signed in | reviews left, today's room, paused or resting, the saved level/board/stance, agreement version, `admin` flag, and their reviews |
  | `POST /coach/agree` | signed in | saves the coach agreement version and the 18+ tick |
  | `POST /coach/reviews` | signed in | starts a review: checks agreement, ban, pause, money, today's limit, the monthly count and one in progress |
  | `POST /coach/reviews/{id}/frames/{n}` | owner | one frame, base64 JPEG, at most 300 KB of text; only while the review is still being uploaded |
  | `POST /coach/reviews/{id}/send` | owner | needs every frame listed; counts the review, queues it, sets the alarm |
  | `GET /coach/reviews/{id}` and `/frames/{n}` | owner or admin | the review (published text only, for the owner) and its frames |
  | `DELETE /coach/reviews/{id}` | owner | deletes it and its frames |
  | `GET /admin/coach/drafts` | admin | drafts waiting, then the last 50 handled |
  | `POST /admin/coach/drafts/{id}` | admin | `approve` (with edits), `redo` (with a note), `reject` (with a note), `ban` |
  | `POST /admin/coach/settings` | admin | autopilot, pause, test email |

- **Storage (Coach's SQLite):**
  - `reviews`: id, uid, sub_hash, lang, move, answers JSON, status, attempts, redos, created, sent, published, model, tokens in
    and out, cost, draft JSON, English copy JSON, final JSON, Bryan's notes. Status: `uploading` → `queued` → `calling` →
    `drafted` → `published`, `rejected` or `failed`.
  - `frames`: review id, n, kind, time in ms, box, base64 text. One row per frame (rows are capped at 2 MB).
  - `people`: sub_hash, level, board, stance, agreement version, agreed at.
  - `quota`: sub_hash and month (`YYYY-MM`, Taiwan time) to the count used. Keyed by the LINE account's `sub_hash`, so deleting
    and remaking an account doesn't reset it, the way the chat's bans outlive deletion.
  - `meta`: the credit month's spend, autopilot, paused, last email time, today's count, and Coach's own usage counter.
- **The AI call runs in Coach's alarm,** never in the surfer's request:
  1. `send` marks the review `queued` and sets the alarm for now.
  2. The alarm takes the oldest `queued` review, or one left in `calling` for over 10 minutes (a deploy can stop work midway),
     marks it `calling` and adds 1 to its attempts.
  3. It calls the Messages API, not streaming, with a 180 s timeout, and checks the reply (below).
  4. It saves the draft as `drafted` (or `published` on autopilot when every check passes), records the tokens and cost, sends
     the email if one is due, and sets the alarm again while reviews are queued.
  5. One review per alarm run. On an error it reschedules itself with backoff (1, 5, then 30 minutes). After 3 attempts the
     review is `failed`, doesn't count, and Bryan gets an email.
  6. A review already `drafted` is never called again, because an alarm can run more than once.
  - An alarm run may take 15 minutes, and a waiting fetch keeps the object alive that long; a Worker's `waitUntil` stops at 30 s,
    and a call inside the surfer's request would die if the phone went to sleep.
- **CPU:** the Worker has 10 ms of CPU per request on the free plan; waiting on the network doesn't count. So the server never
  decodes or resizes images: frames arrive as base64 text and go into the AI request by joining strings. The Worker only checks
  the token and passes the text on. `cpuTime` is checked in the Workers logs on a real request.
- **Retention,** run by the same alarm once a day:
  - frames of published or rejected reviews: 30 days after;
  - reviews never sent: after 24 hours;
  - frames of a not-surf clip: when Bryan acts on it, or after 7 days;
  - written feedback: until the surfer deletes it or their account.
- **Size guard:** new reviews are refused ("Coach is taking a break") while Coach's database is over 800 MB. A review is about
  1–2.5 MB as base64, so 30 days of 300 reviews is about 0.75 GB at most.
- **Accounts:**
  - `DELETE /me` asks Coach to delete that account's reviews, frames and saved answers **before** Room deletes the account. The
    quota row stays.
  - `GET /me/export` includes the account's coach reviews (text, times and frame times; not the frames).
  - When Room's yearly clean-up removes an account unseen for 24 months, it tells Coach the same way.
  - The chat's ban also blocks the coach; the Drafts **Ban** button calls Room's ban.
- **Free-plan room:** at 10 reviews a day the coach adds about 300 rows written and 200 requests a day, well under the account's
  100,000 of each. Coach counts its own use and refuses new reviews at 20% of any of the account's daily limits, so it can never
  push the chat into resting.

### The AI request

- **Model:** `COACH_MODEL` (Claude Opus 5.5). `output_config: {effort: "medium"}` and a JSON-schema output format.
  `max_tokens` 16,000, leaving room for its thinking. No `temperature`, `top_p`, `top_k` or forced `tool_choice` (this model
  refuses them).
- **System prompt:** a fixed coaching guide in `chat/src/coach-guide.js`: how to coach one move; the level's tone; the main fix
  being the one that matters most; tips that point at frames; the heads-up only for something serious; drills that are safe;
  honesty when the surfer can't be seen; English or Traditional Chinese surf words (a short glossary). Bryan's clip-test review
  is one worked example.
- **User turn:** each frame labelled before it ("Key frame 4, 0:07.25"; "Context frame 2, 0:03.00, whole frame"), then the
  surfer's move, level, board, stance and note, the language, and the published text of their last 2 reviews of the same move,
  if any. For a 中文 review it asks for an English copy too.
- **Reply shape** (every field required, no extra fields):
  `is_surf_clip`, `can_see_surfer`, `unusable_frames` (frame numbers), `went_well {frame, title, detail}`,
  `main_fix {frames, title, what, why}`, `drill {title, how}`, `heads_up` (text or empty), `progress` (text or empty), and for
  中文 `english` with the same text fields. Frame numbers are an `enum` of the frames actually sent.
- **Checks in code:** `stop_reason` isn't `refusal` or `max_tokens`; every frame number refers to a frame that was sent; the main
  fix has 1 to 3 frames; `progress` is empty when there was no earlier review. The server turns frame numbers into times from the
  phone's record, so the AI can't make a time up. A reply that fails the checks counts as an attempt.
- **`metadata.user_id`:** an opaque hash of `sub_hash`, so Anthropic can spot abuse without knowing who it is.
- **Not used in this version:** the Batches API (half price, but up to 24 hours, which would eat the whole "within a day"
  promise before Bryan sees the draft) and prompt caching (at about 10 reviews a day, cache hits would be rare and writing the
  cache costs extra).
- **Cost:** about 11,000 tokens of frames and 3,000 of guide and text in, about 1,500 out plus the model's thinking. That is
  about US$0.10–0.15 a review, so US$78 is about 500–750 reviews a month. The 10-a-day limit keeps review mode under about
  US$45 a month.

### Money

- **The credit month** starts on `COACH_CREDIT_DAY` at 00:00 Taiwan time, because that's when Bryan's credit refreshes.
- **Spend** is counted per call from the reply's token counts and the prices in `[vars]`. A call that times out or is cut off
  counts at its worst case (all of `max_tokens`).
- **US$78** (`COACH_STOP_USD` + `COACH_EXTRA_USD`): new reviews are refused with "Coach is resting until <next credit day>".
- **US$80** (`COACH_HARD_USD` + `COACH_EXTRA_USD`): no more AI calls. Queued reviews wait for the next credit month and their
  surfers see "Coach is resting"; they don't count against that month's 2.
- **Backups outside the code:** a US$80 monthly limit on the Coach workspace in Bryan's Claude Console, and no card, so the
  credit can only run out, never charge.
- **Errors from Anthropic,** told apart by their code and message, not by HTTP status alone:
  - credit used up ("credit balance is too low"), workspace limit reached, or `enforced_spend_limit_reached` → the coach pauses
    for money and emails Bryan;
  - 429 or 5xx otherwise → retry with backoff;
  - any other 400 → that review fails; the coach keeps going.
- **Turning on extra budget later:** Bryan adds credit in the Console and raises the workspace limit; a one-line change sets
  `COACH_EXTRA_USD` to his amount.
- **Kill switch:** Pause in the Drafts settings stops new reviews and AI calls at once. Revoking the key in the Console stops
  everything. Deleting the GitHub secret alone doesn't remove the key from Cloudflare.

### Deploy

- The chat workflow (`.github/workflows/chat.yml`) deploys the coach with the chat, since they share the Worker.
- Two new secrets, `ANTHROPIC_API_KEY` and `RESEND_API_KEY`, go into the secrets file **only when they are non-empty** (GitHub
  gives an unset secret as an empty string). They are not added to the guard that stops a deploy when a chat secret is
  missing, so chat deploys never wait on the coach. Without `ANTHROPIC_API_KEY` the coach says "Coach is taking a break".
- `chat/test/deploy.test.mjs` pins the new rule, including the empty-string case.
- Migrations only go forward. Once `v2` has run, Coach can't be removed without a new migration that deletes it.

## Error handling

- coach.js catches its own errors and never throws into the page. The forecast works the same whether the coach works or not.
- Every failure the surfer can meet has a message in the table above. Network failures retry by themselves first.
- A sign-in that expired or was signed out: coach.js clears the token and shows "Sign in with LINE", keeping the unsent review
  in IndexedDB.
- The backend refuses, with a code coach.js turns into its message: `agree`, `banned`, `paused`, `resting`, `full_today`,
  `no_reviews_left`, `in_progress`, `too_big`, `not_uploading`, `missing_frames`, `not_found`.

## Testing

**Backend** (`@cloudflare/vitest-pool-workers`, Anthropic and Resend mocked by intercepting `fetch`, as the chat's login tests
mock LINE):
- `whoIs`: good token, deleted account, banned account, signed out everywhere; and that it counts in Room's meter.
- Starting a review refuses each case in turn: no agreement, banned, paused, resting, full today, none left this month, one in
  progress.
- The monthly count survives deleting and remaking the account. Rejected, failed and money-paused reviews don't count.
- Frames: the size cap, uploads refused after `send`, `send` refused with a frame missing, a re-sent frame replacing the old one
  while uploading.
- The alarm (`runDurableObjectAlarm`): a good reply becomes a draft with its cost; a reply failing each check counts an attempt;
  three failures become `failed` and send one email; a review left in `calling` is picked up again; a `drafted` review is never
  called twice; autopilot publishes only when every check passes.
- Money: refusing new reviews at US$78, no calls at US$80, the extra budget raising both, the credit month starting on the right
  day in Taiwan time, a cut-off call counted at its worst case, and each Anthropic error going the right way.
- The email: at most once an hour, no personal data in it, skipped without a key.
- Admin: drafts and settings refused to a non-admin even with developer mode; approve, edit, redo (at most 2), reject and ban.
- Accounts: `DELETE /me` removes coach data before the account and keeps the quota row; export includes coach reviews; the
  24-month clean-up reaches Coach.
- Retention on each schedule, and the 800 MB guard.
- Origins and CORS on the new routes; the reply shape and checks in `coach-guide.js`'s request builder.

**Front end:**
- Pure parts of coach.js under `node --test`: the frame times around "Here" at the start, middle and end of a clip; the box and
  crop sizes (multiples of 28, at most 784); the tracker on a synthetic moving patch, including losing it.
- Playwright at phone width against `wrangler dev`, with a test clip made by ffmpeg (a moving shape on a sea-coloured
  background), in English and 中文:
  - developer mode off: no Coach tab and no calls to the backend; on: the tab, sign-in returning to the Coach panel;
  - the whole flow: agreement, questions, Here, tap, check (fixing one frame, a lost frame asking for a tap), send, the review;
  - a reload halfway, then "Pick up where you left off?";
  - an upload that fails twice and then works;
  - every error message in the table;
  - an XSS check: a draft and a note holding `<img src=x onerror=alert(1)>` create no `img`.
- `tests/map/check.js` gets a coach-off case: with the backend address empty, no page error and no tab.
- All existing tests still pass.

**After the build, before go-live:**
- Bryan's trial clip (IMG_9246) through the site's coach, compared with the clip-test card.
- Real phones: Bryan's iPhone in Safari, the home-screen app and LINE (a 1080p clip, a 4K clip, a slow-motion clip, an HDR clip);
  his friend's Android in LINE and in Chrome (does the picker open; does an iPhone clip play).
- `/admin/where` shows Coach in north-east Asia, and `cpuTime` on a real send stays under the limit.
- A test email reaches the Gmail inbox, not spam.

## What Bryan sets up (a step-by-step guide comes with the PR)

1. **Claim the Max credit:** on claude.ai in a web browser, Settings > Billing > "API credits", and link a new Claude Console
   organization named WaveSlave. Don't add a card or buy credit.
2. **In the Console:** create a workspace "WaveSlave Coach", set its monthly spend limit to US$80, and create an API key in it.
3. **Resend:** sign up at resend.com with the WaveSlave Gmail (no card) and create an API key with sending access. In Gmail, add
   a filter so mail from `onboarding@resend.dev` never goes to spam.
4. **GitHub secrets:** add `ANTHROPIC_API_KEY` and `RESEND_API_KEY`, the same way as the chat's.
5. **Admin:** sign in to the chat and type `/admin <code>` once, if not done yet.
6. **Phones:** the checks listed above.

## Not verified yet (checked during the build)

- How long iPhones take on "Preparing…" for big, slow-motion and HDR clips, and whether HDR frames look washed out.
- Whether LINE's in-app browser on Android opens a file picker at all.
- Whether an iPhone (HEVC) clip plays in Chrome on the friend's Android.
- How well the tracker follows a surfer through the 3 seconds around a move, on real clips.
- Whether Resend's free sending address stays allowed for alerts to our own inbox. Its docs call it a testing address. If it
  stops, the backup is a `notify.waveslave.tw` sender with two records added at Dynadot.
- The Worker's real CPU time for a frame upload.

## Out of scope for this version

- Plans or payments for surfers.
- Messages to the surfer outside the site (LINE or push).
- Reviews of more than one move, or of the whole ride.
- Uploading video, and clips filmed in other countries' modes.
- Switching to a cheaper model (to be tried on the same clips once there are enough reviews to compare).
- Sharing a review to the chat.
