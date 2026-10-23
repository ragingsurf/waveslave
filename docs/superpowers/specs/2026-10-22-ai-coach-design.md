# AI surf coach (clip review) for WaveSlave: design

Date: 2026-10-22. Status: for Bryan's review (updated 2026-10-23 after a five-part check against the code, the research and Bryan's choices,
and with his two answers of 2026-10-23).

## Goal

A coach on waveslave.tw that helps Taiwan surfers get better from their own clips. A surfer picks a short clip of themselves
from their phone and the move they want help with. The coach sends back what went well, the one main fix with the key frames
it is about, and a drill to practise. It remembers their past reviews of the same move, so it can show progress, and it gives
people a reason to come back to the site. At first Bryan approves every draft; later it can run on autopilot.

## Decisions (Bryan, in the project thread, 2026-10-22)

- **What it is:** clip review, on a **Coach** tab next to Forecast and Map.
- **The standard:** the feedback on Bryan's own clip test. The coach on the site uses the same AI as that test (Claude Opus 5.5)
  and the same kind of close-up key frames.
- **Who:** Taiwan only for now. The Coach tab shows only in developer mode (behind the PIN on the W) until Bryan says "go live";
  then one switch shows it to everyone in Taiwan mode.
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
- **Bryan's review:** a Drafts list in the Coach tab. He can edit any line, then Approve, Redo or Reject with a short note. An
  email to the WaveSlave Gmail tells him when drafts are waiting. His fixes teach the coach. An Autopilot switch is built now
  and stays off until he turns it on; on autopilot he spot-checks and surfers can report a review.
- **Money:** only the credit that comes with Bryan's Claude Max plan (US$100 a month, no card on file). New reviews stop when
  the month's spend reaches **US$78**. The next US$2 finishes reviews already sent, and US$20 a month stays free for Bryan. An
  **extra budget** setting, 0 for now, lets the coach carry on past that once Bryan adds credit and names a monthly amount.
- **In review mode:** at most **10 new reviews a day**.
- **Safety:** 18+ only at first. A clip that isn't surfing is refused. One review in progress per person. A Ban button in the
  Drafts list.
- **Privacy:** key frames are deleted 30 days after the review. The written feedback stays, so the coach can track progress,
  until the surfer deletes it.
- **A surfer who leaves halfway** (to answer LINE, say) keeps their progress.

## Decisions (Bryan, in the project thread, 2026-10-23)

- **Credit day:** Bryan's Max plan renews on the **16th** of each month, so the coach's spending month starts on the 16th.
- **The example review:** Bryan's trial clip is the example signed-out visitors see (his face shows). It is redone as a
  one-move review first, and Bryan OKs it before it goes on the site.

## Defaults I picked (say if you want otherwise)

- **Feedback language:** the site's language when the clip is sent, English or 中文. Drafts in 中文 come with an English copy
  for Bryan, which adds about NT$1 a review.
- **Sign-up:** someone new to WaveSlave goes through the chat's sign-up (a nickname and the house rules) plus a short coach
  agreement. One account then works for both.
- **Going live:** because the coach uses the chat's sign-in, it can go live together with the chat or after it, not before.
- **How to film:** the agreed filming list sits above "Choose a clip". It is open until someone's first review, then folds to
  one line. Just reading, no extra tap.
- **Counting the 2 reviews:** by calendar month in Taiwan time. A review counts when it is sent. It is given back when Bryan
  rejects it, when it fails on our side, when it is caught by the money stop, or when Bryan withdraws it after a report. A clip
  the coach finds isn't surfing still counts, unless Bryan gives it back. Deleting a review never gives it back. However many
  are given back, one account can send at most 4 in a month.
- **At least 8 of the 12 key frames** must show the surfer.
- **Redo:** at most 2 per review, since each one costs a new AI call.
- **A draft Bryan hasn't handled in 14 days** is closed with "Sorry, we couldn't review this in time" and given back.
- **The surfer isn't messaged** when feedback is ready. The Coach tab shows a dot, and the review is waiting in the tab.
- **Clips:** any length from 3 seconds to 2 minutes. The filming list still asks for 10 to 30 seconds.
- **Emails:** besides "drafts waiting", Bryan gets an email when a review fails, when a surfer reports a review, and when the
  coach stops for money or because its key stopped working.
- **The Drafts list** only ever shows for Bryan's own LINE account, before and after go-live.
- **Who says what at the foot of a review:** "checked by a person" only on reviews Bryan approved.

## What the surfer sees

### The Coach tab

- A third tab, **Coach** (教練), after Forecast and Map. It shows only while the coach is switched on for this visitor
  (developer mode now, everyone in Taiwan mode after "go live") and the page is on a Taiwan spot, the same rule as the chat.
- It opens a full-screen Coach panel over Forecast, like the chat room. ✕ closes it.
- **Signed out:** "Your coach breaks your clip down frame by frame: what went well, one main fix and a drill." Below it, the
  example review (Bryan's trial clip, redone as a one-move review he OKs) and "Sign in with LINE". After signing in, the page comes back to the
  Coach panel, not the chat.
- **Signed in:** "2 of 2 reviews left in November", **How to film**, a **New review** button, and their reviews, newest first,
  each showing the move, the date and its status (Coach is reviewing / Ready / Not reviewed).
- **First review only:** the coach agreement. It says:
  - the coach is AI, checked by a person at first;
  - "Only key frames are sent. Your video never leaves your phone.";
  - the key frames go to Anthropic (USA), the company that makes the AI, which doesn't train on them and deletes them within
    30 days, or keeps them up to 2 years if its safety checks flag them; and to Bryan while he checks drafts;
  - WaveSlave deletes them 30 days after the review, though copies can stay in Cloudflare's backups up to 30 more days;
  - other people may be in the background, but don't send a clip where someone else is close and clear unless they're happy
    with it;
  - surf within your limits; the coach's tips don't replace a lesson or a lifeguard;
  - and a tick: "I'm 18 or older, and the surfer in every clip I send is me."

  It is agreed once, and its version is saved.

### How to film (拍攝建議)

The agreed list, in English and 中文: one wave, start to finish (about 10 to 30 seconds); big in the frame; from the side; phone
sideways and steady; good light; normal speed, no slow motion or filters; only film people who are happy to be filmed.

### New review

1. **Pick a clip:** "Choose a clip", with "Only key frames are sent. Your video never leaves your phone." under it. The phone's
   own picker opens. On iPhone it can show "Preparing…" while the phone hands the clip over, from 10 seconds to a minute or more
   for long, 4K or slow-motion clips; the site shows "Getting your clip ready… this can take a minute."
   - In LINE on Android, a line under the button says "Nothing opens? Open in your browser", linking to the page in the phone's
     own browser. There they sign in with LINE again.
2. **The questions:**
   - **Which move?** Pop-up, bottom turn, top turn, cutback, riding down the line, or other (with a short line).
   - **First time only, then remembered and editable:** level (first waves, riding green waves, starting to turn, turning well);
     board (shortboard, mid-length, longboard, foamie); stance (regular, goofy, not sure).
   - **Anything else?** One optional line, up to 200 characters.
3. **Find the move:** the clip in a small player with a slider. "Slide to your cutback and tap **Here**."
4. **Tap yourself:** the frame at that moment, full size, with "Tap yourself". They can pinch to zoom when they're small.
5. **Check:** one screen with all 12 close-ups in a grid, headed "Is this you in each key frame?".
   - A wrong one is fixed by tapping it, then tapping themselves on its full frame. An opened frame also has "Not in this one".
   - **+ / −** makes every box bigger or smaller.
   - When the site lost them on a frame, that frame is already open, asking for a tap.
6. **Send:** "Send to your coach". A progress bar, then "Sent. Your feedback comes within a day." The count goes down by 1.

### The review

Shown in their language, in the Coach tab:
- the move and the date;
- **What went well:** a title and a sentence or two, with its key frame and time ("Key frame at 0:07.5");
- **The main fix:** a title, what is happening, and why it matters, with its 1 to 3 key frames and their times;
- **Your drill:** one thing to practise, on land or in the water;
- **Heads-up** (only when there is one): one line about something serious outside this move, with a "Get a review of your
  bottom turn" button that starts a new review with that move already picked;
- **Progress** (only from their second review of a move): one or two sentences comparing it with last time;
- at the foot: "Reviewed by WaveSlave Coach (AI), checked by a person. Surf within your limits." On autopilot it says only
  "Reviewed by WaveSlave Coach (AI). Surf within your limits."

Tapping a key frame enlarges it. **Something wrong?** sends the review back to Bryan with an optional line. **Delete** removes
the review and its key frames from WaveSlave.

### When something goes wrong

| What | The surfer sees |
|---|---|
| Not signed in | "Sign in with LINE to get a review" |
| Agreement not ticked | "The coach is for surfers 18 and over, sending clips of themselves." Send stays off. |
| No reviews left | "You've used your 2 reviews for November. More on December 1." |
| Coach full today (10 already) | "Coach is full today. Try again tomorrow." Their key frames stay on their phone for tomorrow. |
| Money limit reached | "Coach is resting until 16 November." (the next credit day) |
| Coach paused, its key not working, or the free plan busy | "Coach is taking a break. Try again later." |
| Banned account | "This account can't use the coach." |
| Clip won't open on this phone | "This phone can't open that clip. Try another, or open waveslave.tw in your phone's own browser." |
| Clip too short or too long | "Pick a clip between 3 seconds and 2 minutes. Slow-motion clips count at their slowed length." |
| Fewer than 8 key frames show them | "We need you in at least 8 key frames. Try a clip filmed closer." Nothing is used up. |
| Upload fails | it tries 3 times by itself, then "Couldn't send. Tap to try again." Nothing is lost. |
| Left halfway, or the page reloaded | "Pick up where you left off?" with their answers, and their key frames and taps if they got that far. Before the key frames are cut, it asks them to choose the same clip again and goes straight to "Find the move". **Start over** clears it. |
| One review already with the coach | "Your last review is still with the coach." |
| Not a surf clip | Not published. "We couldn't review this clip." Bryan sees it and may give it back or ban the account. |
| Rejected by Bryan | Bryan's short note, for example "We couldn't see you. Try filming closer." The review is given back. |

## What Bryan sees

### The Drafts list

- In the Coach panel, a **Drafts** section shows only when you're signed in with your own LINE account, the chat's admin. The
  PIN on the W isn't enough, so someone who guessed it still sees nothing.
- **Each draft shows:**
  - the move, the surfer's answers and note, their level, and how long it has waited ("waiting 5 h");
  - the key frames, each with its time;
  - the draft: what went well, the main fix, the drill, the heads-up and the progress line, each in an edit box;
  - for 中文 drafts, the English copy beside it;
  - warnings in red when the coach couldn't see the surfer, marked frames as unusable, thinks it isn't a surf clip, or used a
    word surfers shouldn't see (like "photo").
  - A clip the coach found isn't surfing keeps its key frames hidden behind "Show anyway". A clip the coach flagged as sexual,
    as possibly showing someone under 18, or that it declined to review shows only the warning: its key frames are deleted at
    once and that account can't send another review until you clear it or ban it.
- **Actions:**
  - **Approve:** publishes it, with any edits.
  - **Redo:** with a note for the coach ("focus on the back foot"). The coach writes a new draft. At most 2 per review.
  - **Reject:** with a short note to the surfer. The review is given back.
  - **Give back:** for a clip that wasn't surfing, if you think it was an honest mistake.
  - **Ban:** rejects it and bans the LINE account, the same ban as the chat's.
  - **Withdraw:** takes down a published review (after a report, say), with a note. It is given back.
- **Reported reviews** come back into the list marked "Reported", with the surfer's line.
- **Settings:** Autopilot on/off, Pause the coach, "Send a test email", this month's spend ("US$12.40 of US$78, 96 reviews"),
  and "Approved without changes: 14 of the last 20", which tells you when autopilot is ready.

### Your fixes teach the coach

When you approve a draft with edits, or ask for a Redo, the coach keeps the draft, your version and your note as an example
(text only, no key frames or names). Each new review of the same move takes the 3 newest examples with it, so the coach stops
making the mistakes you fix.

### The email

- Sent from Resend's free service to the WaveSlave Gmail, **at most once an hour**: "WaveSlave Coach: 2 drafts waiting (oldest
  3 h)", plus failed and reported reviews since the last one, and a link to the Drafts list. It holds no names, LINE details or
  frames.
- "Coach stopped" (its key or model setting stopped working) and "Coach resting" (money limit) are sent at once, at most once a
  day each. At most 20 emails a day in all.
- When the email key isn't set, nothing is sent and the Drafts list still works.

### Autopilot (off until you turn it on)

A draft publishes at once only when it passes every check: a surf clip, the surfer visible, at most 4 key frames unusable,
nothing flagged, no heads-up, no word surfers shouldn't see, and for 中文 its English copy. Anything else waits for you as
before. Published reviews stay in the list so you can spot-check, edit or withdraw them, and surfers can report them. The
10-a-day limit becomes 40 a day; the money limit still applies.

## Architecture

```
waveslave.tw (GitHub Pages)                        Cloudflare (free plan), worker "waveslave-chat"
 template.html ─ Coach tab ─▶ web/coach.js ──HTTPS──▶ Worker (chat/src/index.js): CORS, routes, coachRoute()
                               frames, tap,                  │ RPC whoIs(token)            │ RPC: the coach calls
       web/chat.js ◀─ sign-in hook ─┘                         ▼                             ▼
                                                 Durable Object "Room" (chat)  ◀─ RPC ─▶ Durable Object "Coach", name "taiwan"
                                                 whoIs, banAccount, isBanned    forget,    (chat/src/coach.js)
                                                                                exportFor  reviews, frames, quota, meta
                                                                                           alarm ──▶ api.anthropic.com
                                                                                                 └──▶ api.resend.com
```

### Front end: `web/coach.js`

- **One new classic script,** loaded with `defer`, with no dependencies. It is a single IIFE that exposes only
  `window.COACH = {dev, relang, spot, open}`, injects its own `<style>`, and carries its own English and 中文 strings. It reads
  the page's `WORLD`, `LANG`, `CUR`, `VIEW`, `countrySpots` and `setView` by bare name, as chat.js does.
- **Who sees it:** `const PUBLIC = window.__coachPublic === true` (false until "go live") and
  `on() = PUBLIC || (typeof WORLD === "boolean" && WORLD)`, like chat.js. While `on()` is false, or `window.CHAT` is missing,
  the tab stays hidden and coach.js asks the backend nothing. Going live is a one-line change, `PUBLIC` to `true`, made with or
  after chat.js's own.
- **Address:** worked out as chat.js does: `typeof window.__chatUrl === "string" ? window.__chatUrl :
  "https://waveslave-chat.waveslave050.workers.dev"`. An empty string switches the coach off.
- **Start-up:** `boot()` runs before deferred scripts, so coach.js calls its own `spot(CUR)` and `dev()` when it loads.
- **Versioned like chat.js:** build-site.sh writes `coach.js?v=<cksum>` into the page and copies the file next to `sw.js`.
  `tests/test_build_site.py` learns the second address.
- **template.html gets:**
  1. the Coach tab button, `data-v="coach"`, hidden by default;
  2. in the tab handler, `if (b.dataset.v === "coach") { window.COACH && COACH.open(); return; }` before `pressOnly`, so the
     Forecast/Map pill and the saved view (`waveslave-view`) don't change;
  3. `COACH.dev()` in `keepWorld()`, `COACH.relang()` in `setLang`, and `COACH.spot(SPOT)` in `boot()`, each beside chat.js's
     hook and guarded the same way;
  4. the pull-to-refresh, Escape and `.chatfab` rules that check `html.chat-open` also check `html.coach-open`, which coach.js
     sets while its panel is open;
  5. `<script src="coach.js" defer></script>` **before** chat.js's tag, so `COACH` exists when chat.js finishes a sign-in.
- **Opening:** `COACH.open()` calls `setView("fc", true)` first when the map is showing (as chat.js's room does), then shows the
  panel and sets `html.coach-open`. ✕ closes it.
- **Sign-in:** chat.js gains `CHAT.signIn(then)` and `CHAT.token()`. `CHAT.signIn("coach")` saves `{v, at, then}` in its
  `waveslave-chat-v` key and starts the LINE sign-in as today; the server is unchanged and still returns to `?chat`. On return,
  chat.js reads `then` before clearing the key. It opens the chat room only when it needs the surfer: the sign-up sheet, the
  6-digit code box (the home-screen app's path) or an error. Once a token is saved it closes the room and calls `COACH.open()`.
  The code-box path reads `then` the same way.
- **Getting the frames:**
  - `<input type="file" accept="video/*">` into a `<video muted playsinline>` with an object URL. The surfer's first tap on the
    questions screen calls `play()` then `pause()` on it, which iOS needs before the site can read the clip; there is no extra
    Start button. If the clip is still loading on the next screen, it shows "Getting your clip ready…".
  - After `loadedmetadata`, check the length is 3 s to 120 s. A `<video>` error shows "This phone can't open that clip".
  - **Which times:** 12 key frames every 0.25 s from 1.5 s before "Here" to 1.25 s after, moved to fit inside the clip and made
    distinct. Nothing else leaves the phone: every frame sent is a close-up the surfer saw on the check screen.
  - **Seeking:** for each time, set `currentTime` and wait for `seeked`, then for a `requestVideoFrameCallback` for at most
    0.5 s (registered before the seek); if it doesn't come, draw after one more animation frame. On iOS `seeked` can fire before
    the new frame is drawn, and the frame callback never fires when the frame didn't change.
  - **Drawing:** straight from the video into one reused canvas with `drawImage(video, sx, sy, sw, sh, 0, 0, 784, 784)`. A full
    4K frame is never drawn into a canvas, and the canvas is cleared when done (iOS caps canvas memory). Canvas JPEGs carry no
    location data.
- **Finding the surfer:**
  - The box is a square, first one third of the frame's short side (360 px on a 1080 px frame, as in the clip test), changed by
    **+ / −**.
  - **Following them:** from the tapped frame, a small tracker walks forward and back through the 12 key frames. It matches a
    patch around the last position on grey, quarter-size frames (normalised cross-correlation) within a search window. A match
    score below 0.5 marks the surfer lost on that frame.
  - The check screen is the safety net: a lost frame opens for a tap, and the surfer can fix any other or mark it "Not in this
    one". At least 8 of the 12 must be kept.
- **Frame files:** every close-up is 784 × 784, enlarged from the box when the box is smaller, as the clip test's were. 784 is a
  multiple of 28, the tile the AI counts cost in, so it costs 784 tokens. JPEG quality starts at 0.85 and steps down by 0.1 until
  the file is at most 100 KB.
- **Keeping progress:** the answers as they're given, then the key frames (as blobs), taps and box size, are kept in IndexedDB,
  in try/catch, until the review is sent or deleted. Developer mode reloads the page after more than a minute in the background,
  so this matters. When IndexedDB isn't available (private browsing), the review can still be sent, just not resumed.
- **Sending:**
  1. `POST /coach/reviews` with the answers, the language, and each kept frame's number (1–12), time in ms and box. It returns
     a review id.
  2. `POST /coach/reviews/{id}/frames/{n}` once per frame, with the JPEG as base64 text (`Content-Type: text/plain`).
  3. `POST /coach/reviews/{id}/send`.
  - Each request has its own 60 s timeout and is tried 3 times. `GET /coach/reviews/{id}` says which frames the server already
    has, so a resumed send only sends the rest; a review the server no longer has is started again without asking. These calls
    don't use chat.js's `api()`, whose 10 s timeout is too short for a weak beach connection.
- **Drawing the review:** frames are fetched with the sign-in token into blob URLs (an `<img>` can't send the token). Every
  value from the network goes in through `textContent` or `setAttribute`, never `innerHTML`, and no coach element carries
  `data-zh` (the page's `applyLang()` rewrites those through `innerHTML`).
- **Times** show as m:ss.s ("0:07.5") to surfers and m:ss.ss in the AI request.
- **Service worker:** `sw.js` already leaves non-GET and cross-origin requests alone, so nothing of the coach is cached.
- **chat.js's texts:** its delete-account warning and privacy note ("What is kept", "How long") add coach reviews and key frames,
  in every language it carries.

### Backend: in `chat/`, a second Durable Object class

- **Why a new class, not the chat's Room:** Room counts every request against the budget that rests the chat; its one alarm is
  taken by the chat's own jobs; and its request bodies are capped at 4 KB.
- **Files:** `chat/src/coach.js` exports `class Coach extends DurableObject`; `chat/src/coach-guide.js` holds the coaching guide,
  the reply schema, the request builder and the reply checks, as pure functions; index.js adds `export { Coach } from
  "./coach.js"` and a `coach(env)` helper, `env.COACH.getByName("taiwan", {locationHint: "apac-ne"})`.
- **wrangler.toml:** a `COACH` binding for class `Coach`; a migration `tag = "v2"`, `new_sqlite_classes = ["Coach"]`; and new
  `[vars]`:
  - `COACH_MODEL = "claude-opus-5-5"`; prices in US$ per million tokens, `COACH_PRICE_IN = "4"`, `COACH_PRICE_OUT = "20"`;
  - `COACH_STOP_USD = "78"`, `COACH_HARD_USD = "80"`, `COACH_EXTRA_USD = "0"`;
  - `COACH_CREDIT_DAY = "16"` (Bryan's Max plan renews on the 16th);
  - `COACH_MONTHLY = "2"`, `COACH_MONTHLY_MAX = "4"`, `COACH_DAILY = "10"`, `COACH_DAILY_AUTO = "40"`;
  - `COACH_ALERT_TO = "waveslave050@gmail.com"`.
- **Placement:** `/admin/where` answers two lines, `room colo=…` and `coach colo=…` (mod-admin.spec.mjs is updated). Hints are a
  best effort and an object never moves, and Anthropic's API isn't offered everywhere (Hong Kong, for one). So right after the
  first deploy, before any real review, Bryan's check of `/admin/where` must show Coach in Japan, Korea or Taiwan; if not, the
  name changes to "taiwan-2" before launch.
- **New Room RPC methods** (Room already `extends DurableObject`):
  - `whoIs(token)` → `{uid, sub_hash, role}` or `{error: "auth" | "banned" | "resting"}`. It wraps `signedIn()`, so a deleted,
    banned or signed-out account is refused. It counts itself in Room's usage meter (RPC calls skip Room's `fetch()`, where the
    meter is today), and it answers `resting` while the chat rests, except for the admin, so Bryan's Pause always works.
  - `banAccount(sub_hash)`: what the chat's ban does once it has found the author, without needing a message: `subs.banned = 1`
    (inserting the row if missing), `tv + 1`, close that account's sockets with 4403, and hide its last 24 hours of messages. It
    refuses an admin account. Coach bans show in the chat's Unban list.
  - `isBanned(sub_hash)` → boolean, asked by the alarm before each AI call.
- **Routes:** ROUTES entries for `/coach/…` and `/admin/coach/…` carry `coach: true`, are `kind: "private"` (our own pages only)
  and are never cached (`coach` joins `NEVER_CACHED`). GET, POST and DELETE only. `handle()` runs the origin and method checks,
  then `coachRoute(request, env, url)`: it calls `whoIs`, then the Coach RPC, in try/catch, and answers 503 `{error: "break"}`
  when either fails. The Worker passes the identity to Coach as RPC arguments; the surfer never supplies it. Admin routes check
  `role === "admin"` in the Worker and again in Coach.

  | Route | Who | What |
  |---|---|---|
  | `GET /coach/me` | signed in | reviews left, today's room, `break` or `money` with its date, saved level/board/stance, agreement version, `admin`, and their reviews |
  | `POST /coach/agree` | signed in | saves the coach agreement version; refused without the 18+ tick |
  | `POST /coach/reviews` | signed in | starts a review (8–12 frames listed, numbers 1–12); checks agreement, ban, block, pause, money, usage guard, today's limit and the month's count. Deletes their own review still uploading, if any |
  | `POST /coach/reviews/{id}/frames/{n}` | owner | one listed frame, only while uploading; checked (below); at most 140 KB of text |
  | `POST /coach/reviews/{id}/send` | owner | needs every listed frame; checks today's limit and the month's count again; counts it, queues it, sets the alarm |
  | `GET /coach/reviews/{id}` and `/frames/{n}` | owner or admin | the owner gets status and published text only; the admin gets everything |
  | `POST /coach/reviews/{id}/report` | owner | a published review goes back to Drafts marked "Reported", with an optional line |
  | `DELETE /coach/reviews/{id}` | owner | deletes it and its frames in any status; never gives the count back |
  | `GET /admin/coach/drafts` | admin | drafts and reported reviews waiting, then the last 50 handled |
  | `POST /admin/coach/drafts/{id}` | admin | `approve` (with edits), `redo` (with a note), `reject` (with a note), `giveback`, `clear` (lifts a block), `ban`, `withdraw` |
  | `POST /admin/coach/settings` | admin | autopilot, pause, test email |

  Another account asking for a review that isn't theirs gets `not_found`, the same as a review that doesn't exist.
- **Frame checks** (in Coach, which has room for the CPU): base64 characters only; it decodes to a JPEG (starts `/9j/`); its
  header says 784 × 784. Anything else is refused with `bad_frame`.
- **Storage (Coach's SQLite):**
  - `reviews`: id, uid, sub_hash, lang, move, answers JSON, status, attempts, redos, `next_try` (ms), created, sent, published,
    model, tokens in and out, cost, draft JSON, English copy JSON, final JSON, flags, Bryan's notes, report line.
  - Status: `uploading` → `queued` → `calling` → `drafted` → `published`, `rejected` or `failed`; `drafted` → `queued` on Redo;
    `published` → `drafted` on a report; `published` → `rejected` on Withdraw. "In progress" means `queued`, `calling` or
    `drafted`.
  - `frames`: review id, n (1–12), time in ms, box, base64 text. One row per frame (rows are capped at 2 MB).
  - `people`: sub_hash, level, board, stance, agreement version, agreed at, blocked (after a flag, until Bryan clears it).
  - `quota`: sub_hash and month (`YYYY-MM`, Taiwan time) to the count used and the count sent. Keyed by the LINE account's
    `sub_hash`, so deleting and remaking an account inside a month doesn't reset it.
  - `examples`: move, level, draft text, Bryan's version, his note, review id. Text only.
  - `meta`: the credit month's spend, autopilot, paused, `resting_until`, last email times and the day's email count, today's
    review count, stored frame bytes, the next retention time, and Coach's own usage counter.
- **The AI call runs in Coach's alarm,** never in the surfer's request:
  1. `send` marks the review `queued` with `next_try = now`.
  2. The alarm takes the oldest `queued` review whose `next_try` has come, or one left in `calling` for over 16 minutes (a
     deploy can stop work midway), marks it `calling` and asks Room `isBanned` first.
  3. It calls the Messages API, not streaming, with a 10-minute timeout. Each call is for one (review, redo number); its result
     is saved only if the review is still `calling` for that redo number, so an alarm that runs twice never saves or pays twice.
     A call that finishes after its review was deleted saves nothing but still adds its cost to the month.
  4. It saves the draft as `drafted` (or `published` on autopilot when every check passes), records the tokens and cost, and
     sends an email if one is due.
  5. A bad reply, a timeout or a 5xx counts as an attempt: attempt 2 waits 1 minute, attempt 3 waits 5. After the 3rd the review
     is `failed`, is given back, and goes in the next email. A 429 or 529 doesn't count as an attempt: it waits for `retry-after`
     or 30 minutes, at most 12 times, then counts as one.
  6. Redo sets the review back to `queued` with redos + 1 and attempts 0, and keeps the old draft. If the redo fails, the review
     goes back to `drafted` with the old draft and a red "Redo failed" line; it doesn't fail.
  7. One review per alarm run. Coach's one alarm is always the earliest of: now, if a review is queued and due; the next
     `next_try`; a `calling` review's 16-minute mark; the next daily clean-up (04:00 Taiwan). Like Room's `alarmBy()`, every
     call only brings the alarm forward, never pushes it back.
  - Why the alarm: an alarm run may take 15 minutes and a waiting fetch keeps the object alive that long; a Worker's `waitUntil`
    stops at 30 s; a call inside the surfer's request would die if the phone went to sleep.
- **CPU:** the Worker has 10 ms of CPU per request on the free plan; waiting on the network doesn't count. So the Worker never
  parses or decodes a frame: it checks the token and passes the text on. Coach (30 s of CPU per call, by Cloudflare's table)
  checks frames and builds the AI request with `JSON.stringify`. `cpuTime` is checked in the Workers logs for a real frame upload
  and a real alarm run.
- **Daily clean-up** (04:00 Taiwan):
  - frames of published or rejected reviews: 30 days after;
  - frames of failed reviews: 7 days after;
  - frames of a clip found not to be surfing: when Bryan acts on it, or after 7 days;
  - frames of a flagged clip (sexual, possibly under 18, or declined): deleted at once, not by the clean-up;
  - reviews never sent: 2 hours after they were started;
  - drafts waiting 14 days: closed with "Sorry, we couldn't review this in time" and given back;
  - drafts and Bryan's notes of rejected reviews: 30 days after;
  - `quota` rows of past months;
  - written feedback of published reviews: kept until the surfer deletes it or their account.
- **Size guard:** new reviews are refused ("taking a break") while the stored frame bytes pass 700 MB, with Coach's
  `databaseSize` over 950 MB as a backstop (freed pages aren't always handed back). A review is at most about 1.6 MB as base64
  (12 frames of up to 100 KB), so 30 days of 300 reviews is about 0.5 GB.
- **Free-plan room:** a review costs about 110 Durable Object requests (12 frames up, then fetched by the owner and by Bryan,
  each with a `whoIs`) and about 30 rows written; 10 a day is about 1,100 requests. Room rests the chat at 90% of its own count,
  so Coach refuses new reviews ("taking a break") at 8% of any of the account's daily limits by its own count, reset at 00:00 UTC
  as Cloudflare's are.
- **Accounts:**
  - Room's `DELETE /me` awaits `Coach.forget(uid, sub_hash)` before deleting the account. If that throws, it answers 503
    `{error: "coach"}` and deletes nothing, and it reads the account again after the await. `forget` deletes the account's
    reviews, frames, examples and saved answers, and keeps the current month's quota row.
  - `GET /me/export` awaits `Coach.exportFor(uid)` and adds `coach: [...]` (text, times and frame times; not the frames).
  - Room's daily clean-up of accounts unseen for 24 months first awaits `Coach.forget` for them, and deletes only those Coach
    confirmed; the rest wait for the next day.
  - The chat's ban also blocks the coach, and Drafts **Ban** calls `banAccount`, then rejects every open review of that account
    and deletes their frames.

### The AI request

- **Call:** `fetch` to `https://api.anthropic.com/v1/messages` with `x-api-key`, `anthropic-version: 2026-10-21` and
  `content-type: application/json`.
- **Model:** `COACH_MODEL`. `output_config: {effort: "medium", format: {type: "json_schema", schema}}`. `max_tokens` 16,000,
  leaving room for its thinking. No `temperature`, `top_p`, `top_k` or forced `tool_choice` (all refused). No server-side
  `fallbacks`, so every call is priced at the model in `COACH_MODEL`; spend uses the model named in the reply.
- **Coaching guide** (the system prompt, in `coach-guide.js`):
  - coach one move; the main fix is the one that matters most; tips point at key frames; the level sets the tone; drills are
    safe;
  - comment only on the marked surfer, never on anyone else; say so honestly when the surfer can't be seen;
  - the heads-up only for something serious, naming the move for its own review;
  - words: "key frame" (關鍵影格) and "frame by frame" (逐格); refer to moments as "key frame at 0:07.5"; never picture, photo,
    image, still, snapshot or screenshot (照片, 圖片, 相片, 截圖, 靜態畫面), and never say it watched the video or the whole ride;
  - a short English and Traditional Chinese surf glossary;
  - one worked example: Bryan's clip test redone in the one-move shape for his last turn (about 0:12), which Bryan OKs before
    the guide is written.
- **User turn:** each frame labelled before it ("Key frame 4 (0:07.25)"), then the surfer's move, level, board, stance and note,
  the language, the published text of their last 2 reviews of the same move (if any), and the 3 newest of Bryan's examples for
  that move. For a 中文 review it asks for an English copy too.
- **Reply shape** (every field required, no extra fields): `is_surf_clip`, `can_see_surfer`, `sexual_content`,
  `surfer_looks_under_18`, `unusable_frames`, `went_well {frame, title, detail}`, `main_fix {frames, title, what, why}`,
  `drill {title, how}`, `heads_up {text, move}` (both empty when there is none), `progress` (text or empty), and for 中文
  `english` with the same text fields. Frame numbers are an `enum` of the frames actually sent; `move` is an `enum` of the moves.
- **Checks in code:**
  - `stop_reason` isn't `max_tokens`;
  - every frame number is one that was sent; the main fix has 1 to 3 frames;
  - `progress` is empty when there was no earlier review of that move;
  - a 中文 reply has `english`;
  - no surfer-facing text holds one of the words above (a red warning in Drafts; on autopilot it waits for Bryan).
  - The server turns frame numbers into times from the phone's record, so the AI can't make a time up. A reply that fails a check
    counts as an attempt.
- **Flags:** a `refusal`, or `sexual_content` or `surfer_looks_under_18` true, is never retried or published: the frames are
  deleted at once, the review counts, the account is blocked from new reviews until Bryan clears or bans it, and Bryan sees the
  warning.
- **`metadata.user_id`:** an opaque hash of `sub_hash`, never `sub_hash` itself, so Anthropic can spot abuse without knowing who
  it is.
- **Not used in this version:** the Batches API (half price, but up to 24 hours, which could use up the whole "within a day"
  promise before Bryan sees the draft) and prompt caching (at about 10 reviews a day, hits would be rare and writing the cache
  costs extra).
- **Cost:** about 9,400 tokens of key frames and about 6,000 of guide, examples and text in, about 1,500 out plus the model's
  thinking. That is about US$0.12–0.17 a review (a little more for 中文 with its English copy), so US$78 is about 450–650
  reviews. The 10-a-day limit keeps review mode at about US$40–55 a month at most, a little more with Redo. A call that is cut
  off counts at its worst case, about US$0.38. The real numbers come from Bryan's clip test before go-live.

### Money

- **The credit month** starts on `COACH_CREDIT_DAY` (the 16th) at 08:00 Taiwan time (00:00 UTC), shortly after the plan payment, when the
  new credit lands. In a month without that day, it starts on the month's last day.
- **Spend** is counted per call from the reply's token counts and the prices in `[vars]`. A call that times out or is cut off
  counts at its worst case (all of `max_tokens`).
- **US$78** (`COACH_STOP_USD` + `COACH_EXTRA_USD`): new reviews and Redo are refused with "Coach is resting until <next credit
  day>".
- **US$80** (`COACH_HARD_USD` + `COACH_EXTRA_USD`): no more AI calls. Queued reviews go back to `queued` without using an attempt,
  wait for the next credit month, and are given back to the month they were sent in.
- **Errors from Anthropic,** sorted by `error.type` and message, not by HTTP status alone:
  - `authentication_error`, `permission_error` or `not_found_error` (a revoked key, or a wrong `COACH_MODEL`) → the coach pauses
    itself ("taking a break"), reviews stay queued without using attempts, and Bryan gets one "Coach stopped" email;
  - `billing_error`, or a message containing "credit balance is too low" → money rest: `resting_until` the next credit day, and
    the alarm tries one queued review every 6 hours, ending the rest early on a success;
  - an `invalid_request_error` saying a workspace or API usage limit is reached, or a `rate_limit_error` with
    `enforced_spend_limit_reached` → money rest until 08:00 Taiwan on the 1st of next month (the Console limit counts calendar
    months in UTC);
  - any other 429, a 500 or a 529 → the wait in step 5 above;
  - any other 400, or a 413 → that review fails.
- **Backups outside the code:** a US$80 monthly limit on the Coach workspace in Bryan's Claude Console (it counts calendar months,
  so it only catches a bug in the coach's own counter), and no card, so the credit can only run out, never charge.
- **Turning on extra budget later:** Bryan adds credit in the Console and raises the workspace limit; a one-line change sets
  `COACH_EXTRA_USD` to his amount.
- **Kill switch:** Pause in the Drafts settings stops new reviews and AI calls at once. Revoking the key in the Console stops
  everything. Deleting the GitHub secret alone doesn't remove the key from Cloudflare (`wrangler deploy --secrets-file` keeps
  secrets it isn't given).

### The email

- `POST https://api.resend.com/emails` with `Authorization: Bearer <RESEND_API_KEY>` and `User-Agent: waveslave-coach/1` (Resend
  refuses requests without one, and a Worker's `fetch` sends none). From `WaveSlave Coach <onboarding@resend.dev>` to
  `COACH_ALERT_TO`.
- "Send a test email" shows Resend's answer in Settings, which would also show its "only to your own address" message.

### Deploy

- The chat workflow (`.github/workflows/chat.yml`) deploys the coach with the chat, since they share the Worker.
- Two new secrets, `ANTHROPIC_API_KEY` and `RESEND_API_KEY`, go into the secrets file **only when they are non-empty** (GitHub
  gives an unset secret as an empty string). They are not added to the guard that stops a deploy when a chat secret is missing,
  so chat deploys never wait on the coach. Without `ANTHROPIC_API_KEY` the coach says "taking a break".
- `chat/test/deploy.test.mjs` pins the new rule, with the empty-string case GitHub actually produces.
- Migrations only go forward. Once `v2` has run, Coach can't be removed without a new migration that deletes it.

## Error handling

- coach.js catches its own errors and never throws into the page. The forecast works the same whether the coach works or not.
- The backend refuses with a code coach.js turns into the messages in the table above: `agree`, `banned`, `blocked`, `break`,
  `money` (with `until`), `full_today`, `no_reviews_left`, `in_progress`, `too_few_frames`, `bad_frame`, `too_big`,
  `not_uploading`, `missing_frames`, `not_found`. `bad_frame`, `too_big`, `not_uploading` and `missing_frames` are retried once by
  themselves, then show "Couldn't send. Tap to try again."
- A sign-in that expired or was signed out: coach.js clears the token and shows "Sign in with LINE", keeping the unsent review
  in IndexedDB.

## Testing

**Backend** (`@cloudflare/vitest-pool-workers`; Anthropic and Resend mocked by intercepting `fetch`, as the chat's login tests
mock LINE; `runDurableObjectAlarm` for the alarm):
- **Room's new methods:** `whoIs` for a good token, a deleted, banned and signed-out account, while the chat rests (refused,
  except the admin), and that it counts in Room's meter; `banAccount` on a coach-only account (no messages), and refused for the
  admin; `isBanned`.
- **Access:** another account gets `not_found` for someone else's review, frames, report and DELETE; the owner gets no draft text
  before Approve; an admin gets everything; drafts and settings are refused to a non-admin.
- **Starting and sending:** each refusal in turn (agreement, ban, block, pause, money, usage guard, full today, none left, the
  4-a-month cap, too few frames); `send` checks today's limit and the count again; starting a new review deletes the person's
  own one still uploading; two Sends at once can't both pass the 10th place.
- **Counting:** the count survives deleting and remaking the account inside a month; it is given back for reject, failure,
  money stop, give back, withdraw and the 14-day close, and not for not-surf, flags or delete.
- **Frames:** an unlisted `n`, a frame after `send`, a frame holding `"`, a PNG, a 2576 px JPEG and one over 140 KB are refused;
  `send` with a frame missing is refused; a re-sent frame replaces the old one while uploading.
- **The alarm:** a good reply becomes a draft with its cost; a reply failing each check counts an attempt; three failures become
  `failed`, are given back and go in one email; a 429/529 waits without using attempts; a `calling` review over 16 minutes is
  picked up again; a result for an old redo number isn't saved; Redo calls once, and keeps the old draft if it fails; a banned
  account's queued review is skipped; a refusal and each flag delete the frames, block the account and never retry; autopilot
  publishes only when every check passes; the alarm only moves forward and the daily clean-up keeps running with nothing queued.
- **The request:** `JSON.stringify` builds it; it holds only the same account's last 2 published reviews of that move and the
  3 newest examples of that move; `metadata.user_id` is never `sub_hash`; the version header is sent; a 中文 reply without
  `english` fails; the banned words are caught in English and 中文.
- **Money:** refusing new reviews and Redo at US$78, no calls at US$80, extra budget raising both, the credit month starting at
  08:00 Taiwan on the right day (including a short month), a cut-off call counted at its worst case, and each Anthropic error
  going its own way.
- **The email:** at most once an hour, the "stopped" and "resting" emails at once but once a day, at most 20 a day, no personal
  data, the User-Agent sent, skipped without a key.
- **Examples:** an edited approval and a Redo become examples; "approved without changes" counts right.
- **Accounts:** `DELETE /me` removes coach data before the account and keeps the month's quota row; a Coach failure stops the
  delete with 503; export includes coach reviews; the 24-month clean-up reaches Coach first.
- **Clean-up and guards:** each schedule in the daily clean-up; the 700 MB guard and the usage guard at 8%.
- **Routes:** origins and CORS on the new routes; `/admin/where` shows both objects; `deploy.test.mjs` with empty secrets.

**Front end:**
- **Pure parts of coach.js** under `node --test`: the frame times around "Here" at the start, middle and end of a clip, made
  distinct; the box sizes; the JPEG quality steps; the tracker on a synthetic moving patch, including losing it.
- **Playwright at phone width** against `wrangler dev`, with a test clip made by ffmpeg (a moving shape on a sea-coloured
  background), in English and 中文:
  - developer mode off: no Coach tab and no calls to the backend; on: the tab, and tapping it leaves the Forecast/Map pill and the
    saved view alone;
  - sign-in from Coach returning to the Coach panel, both by the direct return and by the 6-digit code;
  - the whole flow: agreement, questions (the first tap readying the clip), Here, tap, check (fixing one frame, a lost frame
    asking for a tap, "Not in this one", fewer than 8), send, the review with its heads-up button;
  - a reload during the slider and after the key frames, then "Pick up where you left off?", and Start over;
  - IndexedDB that throws: the review still sends;
  - an upload that fails twice and then works;
  - every error message in the table; the LINE-on-Android line for a LINE Android user agent;
  - with the Coach panel open, pull-to-refresh, Escape and the CHAT button do nothing;
  - an XSS check: a draft and a note holding `<img src=x onerror=alert(1)>` create no `img`.
- `tests/map/check.js` gets a coach-off case: with the backend address empty, no page error and no tab.
- `tests/test_build_site.py` covers `coach.js?v=`.
- All existing tests still pass.

**After the build, before go-live:**
- Bryan's clip test through the site's coach. It must name the same main fix as the OK'd one-move example, with key frames
  within 0.5 s of it.
- Real phones: Bryan's iPhone in Safari, the home-screen app and LINE (a 1080p clip, a 4K clip, a slow-motion clip, an HDR clip);
  his friend's Android in LINE and in Chrome (does the picker open; does an iPhone clip play).
- `/admin/where` shows Coach in Japan, Korea or Taiwan, and `cpuTime` stays under the limits for a frame upload and an alarm run.
- A test email reaches the Gmail inbox, not spam.

## What Bryan sets up (a step-by-step guide comes with the PR)

1. **Claim the Max credit:** on claude.ai in a web browser, Settings > Billing > "API credits", and link a new Claude Console
   organization named WaveSlave. Don't add a card or buy credit, so the credit can only run out, never charge.
2. **In the Console:** create a workspace "WaveSlave Coach", set its monthly spend limit to US$80, and create an API key in it.
   Use that organization for nothing else, because every key in it spends the same credit.
3. **Resend:** sign up at resend.com with the WaveSlave Gmail (no card) and create an API key with sending access. In Gmail, add
   a filter so mail from `onboarding@resend.dev` never goes to spam.
4. **GitHub secrets:** add `ANTHROPIC_API_KEY` and `RESEND_API_KEY`, the same way as the chat's.
5. **Admin:** sign in to the chat and type `/admin <code>` once, if not done yet.
6. **After the first deploy:** check `/admin/where` (the guide shows how), then the phone checks above.

## Not verified yet (checked during the build)

- How long iPhones take on "Preparing…" for big, slow-motion and HDR clips, and whether HDR frames look washed out.
- Whether LINE's in-app browser on Android opens a file picker at all.
- Whether an iPhone (HEVC) clip plays in Chrome on the friend's Android.
- How well the tracker follows a surfer through the 3 seconds around a move, on real clips.
- In developer mode, a pick that keeps the page in the background over a minute reloads it and loses the pick (only answers and
  cut key frames are kept). This goes away at go-live.
- Whether Resend's free sending address stays allowed for alerts to our own inbox; its docs call it a testing address. If it
  stops, the backup is a `notify.waveslave.tw` sender with two records added at Dynadot.
- The real CPU time of a frame upload and an alarm run.

## Out of scope for this version

- Plans or payments for surfers.
- Messages to the surfer outside the site (LINE or push).
- Reviews of more than one move, or of the whole ride.
- Uploading video.
- The coach for countries other than Taiwan.
- Switching to a cheaper model (to be tried on the same clips once there are enough reviews to compare).
- Sharing a review to the chat.
