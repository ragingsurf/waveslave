# Setting up the AI coach

This is Bryan's step-by-step for switching on the WaveSlave coach, the clip review on the **Coach** tab. It takes about 30
minutes, plus the checks at the end. It costs nothing beyond your Claude Max plan: the coach runs on the plan's monthly API
credit, with no card anywhere, and the email service is free.

The coach lives in the same Cloudflare Worker as the chat, so it uses the chat's LINE sign-in and the chat's **Deploy chat**
workflow. Until the AI key below is in, the coach just says it's taking a break; without the email key it works but sends
no email. The chat carries on as normal either way. The **Coach** tab shows only in developer mode (the PIN on the W)
until you say "go live", so nothing here changes waveslave.tw for visitors. You can stop at any point and carry on later.

**What you need:** a computer with a web browser such as Chrome, your phone with LINE on it, your claude.ai account (the one
with the Max plan), the WaveSlave Gmail (waveslave050@gmail.com), your GitHub account, and your developer PIN.

**Keep the two keys private.** You'll make two keys below: the AI key and the email key. Each one is shown only once, and it
only ever goes into GitHub's secret box. So before you make each key, open GitHub's **New repository secret** page in another
tab (step 8, further down in Part 3, shows how), and paste the key straight in there. If you must hold a key for a moment,
keep it in a password manager, and delete it from there, and from anywhere else you pasted it, once it's in GitHub. Never paste
the keys into a chat with Claude, an email, a screenshot or the repo. Claude never needs them, and can't add secrets to GitHub
for you.

## How the money works

- **Where it comes from:** your Max plan comes with US$100 of API credit a month. It lands in the Claude Console shortly after
  your plan renews on the **16th**, and whatever is left expires at the next renewal. The coach's month starts on the 16th at
  08:00 Taiwan time to match.
- **What a review costs:** about US$0.12 to 0.17, a little more in 中文 (it comes with an English copy for you). The limit of
  10 new reviews a day keeps it to about US$40 to 55 a month.
- **US$78:** once the coach has spent this in a month, it takes no new reviews (surfers see "Coach is resting until 16 …").
- **US$80:** the next US$2 finishes reviews already sent, then the coach makes no more AI calls until the 16th (or until the
  1st, when the Console's own limit below is reached first).
- **The last US$20** is left over every month. Keep the WaveSlave Console organization for the coach only, so nothing else
  eats into the coach's money.
- **Extra budget: 0.** The coach never goes past US$80 a month. If you ever want more, see "Spending more later" at the end.
- **Backups:** a US$80 monthly limit on the coach's workspace in the Console (step 3), and no card, so the credit can only run
  out, never charge you. The Console's limit counts calendar months, from the 1st, so in a busy stretch it can be reached
  before the coach's own: the coach then rests until 08:00 Taiwan time on the 1st, not the 16th.

## Part 1: The AI credit and key (Claude Console)

1. **Claim the Max plan's API credit.** On a computer, open https://claude.ai in a web browser (not the app) and sign in.
   Select your name or initials at the bottom left, then **Settings**, then **Billing**.
   - Find the **API credits** section. It asks which Claude Console organization should get the credit.
   - Choose to make a **new** organization and name it `WaveSlave`. If you made a WaveSlave organization in the Console
     before, pick that one instead.
   - Accept the credit terms to link it.
   - **Pick carefully:** you can't change the linked organization yourself later (only Anthropic's support can).
   - **Don't add a card or buy credit**, anywhere in the Console, and leave **auto-reload** off. Then the credit can only run
     out, never charge.

2. **Check the credit landed.** Open https://platform.claude.com and sign in with the same account. If it shows more than one
   organization, switch to **WaveSlave**. Go to **Settings** > **Billing** (or open
   https://platform.claude.com/settings/billing). Under **Promotional credits** you should see US$100 and its expiry date.

3. **Make the coach's workspace, with its US$80 limit.**
   1. Go to **Settings** > **Workspaces** (or open https://platform.claude.com/settings/workspaces).
   2. Select **Create workspace**. Name it `WaveSlave Coach`, pick any colour, and select **Create workspace**.
   3. Back on the **Workspaces** page, select **WaveSlave Coach**. In the panel that opens, select **Spend limits**.
   4. Set the monthly spend limit to **US$80** and save. (You can also add an alert there, at US$60 say, to get an email from
      Anthropic.)

   This limit counts calendar months (it starts again on the 1st), not your plan's month. It's there to catch a mistake in
   the coach's own counter, and the coach's own limits (US$78 and US$80, counted from the 16th) usually stop it first. But a
   calendar month takes in parts of two of the coach's months, so in a busy stretch the Console limit can be reached first.
   The coach then rests until 08:00 Taiwan time on the 1st (see "If something goes wrong").

4. **Make the AI key.**
   1. Go to **Settings** > **API keys** (or open https://platform.claude.com/settings/keys) and select **Create key**.
   2. Name it `WaveSlave coach`.
   3. For the expiration, pick **Never**. (A key that expires stops the coach, and you'd get a "Coach stopped" email.)
   4. Leave **Linked account** as yourself.
   5. Set the workspace to **WaveSlave Coach**. This matters: a key that isn't in that workspace makes every review fail.
   6. Create it. The Console shows the key only once (it starts with `sk-ant-`): copy it and paste it straight into GitHub's
      **New repository secret** page as `ANTHROPIC_API_KEY` (step 8, in Part 3 below).

## Part 2: The email key (Resend)

The coach emails waveslave050@gmail.com when drafts are waiting (at most once an hour), when a review fails or is reported,
and when it stops or rests. The emails hold no names, LINE details or key frames. They come from Resend's free service, from
the address `onboarding@resend.dev`, which Resend lets you use without a website of your own, but only to send to the email
you signed up with. That's why the account must be the WaveSlave Gmail.

5. **Make a free Resend account.** Go to https://resend.com/signup and sign up with **waveslave050@gmail.com**, with a
   password or with Google using that Gmail. It asks for no card. Resend emails you a link: open it to confirm the address.
   If Resend offers to add a domain, skip it.

6. **Make the email key.**
   1. In Resend, go to **API Keys** (or open https://resend.com/api-keys) and select **Create API Key**.
   2. Name it `WaveSlave coach`.
   3. For **Permission**, pick **Sending access**. Leave **Domain** as it is.
   4. Create it. Resend shows the key only once (it starts with `re_`): copy it and paste it straight into GitHub's **New
      repository secret** page as `RESEND_API_KEY` (step 8, in Part 3 below).

7. **Keep the coach's emails out of spam.** Open Gmail as waveslave050@gmail.com on a computer.
   1. In the search box at the top, select **Show search options** (the sliders button at its right).
   2. In **From**, type `onboarding@resend.dev`.
   3. Select **Create filter**.
   4. Tick **Never send it to Spam**, and select **Create filter** again.

## Part 3: GitHub

8. **Add the two secrets to GitHub,** the same way as the chat's seven, each one while you make its key (steps 4 and 6). In
   another tab, open https://github.com/ragingsurf/waveslave/settings/secrets/actions (or: the repository's **Settings**,
   then **Secrets and variables** > **Actions** in the **Security** part of the menu). On the **Secrets** tab, for each of
   the two:
   1. Select **New repository secret**.
   2. In **Name**, type the name exactly as below.
   3. In **Secret**, paste the key you just copied: only its characters, with no space or line break at the end.
   4. Select **Add secret**.

   | Name | From step |
   |---|---|
   | `ANTHROPIC_API_KEY` | 4 |
   | `RESEND_API_KEY` | 6 |

   The chat's seven secrets stay as they are. The chat never needs these two: without them it deploys as before, and the coach
   just takes a break.

9. **Put the coach on Cloudflare (the first deploy).**
   - If Claude's coach pull request isn't merged yet: merging it runs **Deploy chat** by itself, with your two keys.
   - If it's already merged: in the repository, select **Actions**, then **Deploy chat** in the menu on the left, then **Run
     workflow**. Check that **Branch** says `main`, and select **Run workflow** again.

   A green tick means the chat and the coach are on Cloudflare. If it shows a red cross, send Claude a screenshot of the step
   that failed (that's safe: GitHub shows every secret in the log as `***`).

## Part 4: Check where the coach lives

Cloudflare puts the coach in one of its data centres the first time it's used, and it never moves. The AI only works from some
countries, so before anyone sends a real review, check that the coach landed in Japan, Korea or Taiwan. Do this right after
the first deploy, before you send any review. The check is in the Coach tab's **Drafts** list, which only you see.

10. **Sign in to the coach as the admin.** On your phone or your computer, open https://waveslave.tw:
    1. Select the **W** in the WaveSlave logo at the top and type your developer PIN. Developer mode comes on.
    2. Open a Taiwan spot and select the **Coach** tab, next to **Forecast** and **Map**.
    3. If it shows **Sign in with LINE**, select it and sign in with your own LINE account. (The coach uses the chat's
       sign-in, so if you're signed in to the chat in this browser, you're signed in here too.)

    You became the chat's admin when it went live, by sending `/admin`, a space and your `ADMIN_CODE` once in the chat. If
    you never did, do it now (step 1 of "When the chat is live" in
    [the chat guide](https://github.com/ragingsurf/waveslave/blob/main/docs/chat-setup.md)).

11. **Ask the coach where it lives.** In the Coach tab, scroll down to **Drafts**, then to its **Settings**. The last line there
    is **Where it runs**, with two lines like these (your letters may differ):

    ```
    room colo=NRT
    coach colo=KIX
    ```

    The Coach tab asks the chat's own address for them each time you open it, with the sign-in you already have. They show
    nothing secret.

12. **Read the two lines.** The three letters after `colo=` name the Cloudflare data centre, by its nearest airport.
    - **The `coach` line must be in Japan, Korea or Taiwan:** for example `NRT` (Tokyo), `KIX` (Osaka), `FUK` (Fukuoka), `OKA`
      (Okinawa), `ICN` (Seoul), `TPE` (Taipei) or `KHH` (Kaohsiung). Anything else, Hong Kong (`HKG`) included: tell Claude.
      Claude then gives the coach a new name, "taiwan-2", before launch, so it starts fresh in a new place, and you check
      again after that deploy.
    - **The `room` line** is where the chat lives. It was placed when the chat started and anywhere in north-east Asia is fine,
      so just note it down.
    - **`coach colo=?`** means the coach didn't answer. Close the Coach panel (the ✕ at its top right), wait a minute and open
      it again. If it stays `?`, tell Claude.
    - **"Where it runs: couldn't ask"** means the chat couldn't say. Close the panel and open it again in a minute. If it
      keeps saying so, tell Claude.
    - **No Drafts list at all** means you're signed in with an account that isn't the admin: go back to step 10.

## Part 5: Before go-live

Do these with developer mode on, and note how each one went. On your phone, the **Coach** tab shows on Taiwan spots once
developer mode is on, next to **Forecast** and **Map**. The **Drafts** list in it shows only when you're signed in with your
own LINE account.

Your account gets 2 reviews a month like everyone's, and can send 4 at most, counting ones given back. So send a review only
in the two checks that say **Send**. For the other clips, go as far as the "Is this you in each key frame?" screen and stop
there without sending.

The coach also takes one review per account at a time. Until a sent review's draft has been handled, a new Send is refused
with "Your last review is still with the coach." So once a draft is in **Drafts** and you've checked it, **Approve** it, or
**Reject** it with a short note, before your next Send. Approving publishes it, and it stays counted. Rejecting gives the
review back for that month, but it still counts toward the 4 sends.

- [ ] **Where the coach lives.** Step 12 showed the coach in Japan, Korea or Taiwan (after the "taiwan-2" change, if it
      needed one).
- [ ] **The test email.** In the Coach tab, open **Drafts**, then **Settings**, and select **Send a test email**. It shows
      Resend's answer. The email must reach the Gmail **inbox**, not Spam. (If Resend answers that it can only send to your own
      address, the Resend account isn't on waveslave050@gmail.com: go back to step 5.)
- [ ] **Send: your clip test through the site's coach.** Send your trial clip as a review, for the same move as the example
      review you OK'd. The draft must name the same main fix as that example, with its key frames within half a second of it.
      Once you've checked the draft, **Approve** it or **Reject** it with a short note, so the next Send isn't refused.
- [ ] **CPU time,** right after that send. In the Cloudflare dashboard, look in two places:
      - **Workers & Pages**, select **waveslave-chat**, then **Observability**;
      - the **Durable Objects** page, select the coach's namespace (**Coach**, in **waveslave-chat**), then **Observability**.

      On the **Invocations** tab (or **Events**), find:
      - a key frame upload: a `POST` to an address ending in `/frames/` and a number;
      - an alarm run: the coach's alarm, a few seconds after you pressed **Send to your coach**.

      Open each one and note its CPU time (shown as **CPU time**, `cpuTime` or `$workers.cpuTimeMs`, in milliseconds), and
      whether its outcome says **Exceeded CPU** (`exceededCpu`). Send Claude those numbers and any "Exceeded CPU" outcome,
      written down rather than as screenshots of the log; Claude checks them against Cloudflare's limits. If there are no
      logs, tell Claude, and read the numbers on your next Send instead.
- [ ] **Send: an iPhone clip from Safari.** Pick a surf clip of yourself filmed on an iPhone held upright (iPhones film in
      HEVC), and send it from Safari. It must be surfing: a clip the coach finds isn't surfing still counts. Sending at all
      shows its key frames came out at 784 × 784, because the coach refuses any other size. On the "Is this you in each key
      frame?" screen, and again in **Drafts**, check that every key frame shows you inside it, the right way up, not squashed
      or cut off. Then **Approve** or **Reject** this draft too.
- [ ] **Real phones, real clips (no sending).** On your iPhone in Safari, in the WaveSlave app on your home screen and inside
      LINE's own browser, try a 1080p clip, a 4K clip, a slow-motion clip and an HDR clip. For each, note:
      - how long the iPhone shows "Preparing…" before the site gets the clip;
      - whether the HDR key frames look washed out;
      - how well the box follows you through the three seconds around your move.
- [ ] **Your friend's Android (no sending).** In LINE's own browser and in Chrome:
      - inside LINE, does **Choose a clip** open the phone's picker at all;
      - inside LINE, does the "Nothing opens? Open in your browser" link leave LINE and open the page in the phone's own
        browser;
      - does one of your iPhone clips (send it to them first) play in Chrome on the Android.
- [ ] **Leaving and coming back.** In developer mode, if the page stays in the background for over a minute while you pick a
      clip, it reloads and loses the pick (the answers and any key frames already cut are kept). That's expected for now,
      because developer mode asks for the PIN again. It goes away at go-live.
- [ ] **Resend's free address.** Resend calls `onboarding@resend.dev` a testing address. If its emails ever stop arriving, or
      Resend starts refusing them, tell Claude: the backup is a `notify.waveslave.tw` sender, which needs two records added at
      Dynadot.

## Part 6: Tell Claude

13. **Send Claude a message in the project thread when you're done,** with:
    - the two lines from step 11;
    - the CPU times;
    - how each phone check and the test email went.

    Nothing else: no keys, no PIN, no passwords. Claude then says whether the coach is ready to go live, and once you say
    "go live", the Coach tab shows to everyone in Taiwan mode.

## If something goes wrong

- **The coach says "Coach is taking a break":** you paused it, its AI key isn't in, the key stopped working, or Cloudflare's
  free plan is busy for the day. If you got a "Coach stopped" email, check the key in the Console (step 4) and fix it, then
  open **Drafts** > **Settings** and select **Start again**.
- **The coach says "Coach is resting until 16 …":** the month's money is used. It comes back by itself on the 16th at 08:00
  Taiwan time. If the new credit lands late that day, the coach tries again every 6 hours by itself.
- **The coach says "Coach is resting until 1 …":** the Console's US$80 limit for the calendar month was reached (step 3),
  which can happen before the coach's own limits because a calendar month takes in parts of two of the coach's months. It
  comes back by itself at 08:00 Taiwan time on the 1st.
- **To switch the coach off at once:** **Pause** in **Drafts** > **Settings** stops new reviews and AI calls. To stop it from
  outside the site, select **Disable** next to the key on the Console's **API keys** page. You can **Re-enable** it later;
  if the coach tried the key while it was disabled, it stopped itself, so then also select **Start again** in **Drafts** >
  **Settings**. Deleting the GitHub secret alone doesn't take the key off Cloudflare.
- **You think a key has leaked:** **Disable** it in the Console (or, for the email key, remove it on Resend's **API Keys**
  page), make a new one (step 4 or 6), replace the secret in GitHub (step 8: select the pencil button next to it) and run
  **Deploy chat** again (step 9). Once the coach has tried a disabled AI key, it stops itself, and it stays stopped even
  after the new key is deployed, until you open **Drafts** > **Settings** and select **Start again**. Tell Claude which key
  it was, without pasting it.
- **Spending more later:** buy credit in the Console (this needs a card, so from then on it can charge), raise the workspace's
  spend limit (step 3), and tell Claude the extra monthly amount. Claude changes one setting, and the coach's two limits go up
  by that amount. Once that's deployed, reviews held at the coach's own limits move by themselves the next time the coach
  checks its queue, which is the daily clean-up at 04:00 Taiwan time at the latest; to wake it at once, open **Drafts** >
  **Settings**, select **Pause the coach**, then **Start again**. That doesn't end a rest from Anthropic's side: "Coach is
  resting until 1 …" (the Console's limit) still waits for that date, and a rest because the credit ran out lifts at its next
  6-hourly retry once the new credit is there.
- **A block that shows nowhere:** when a surfer whose clip was flagged deletes their chat account, the block on their LINE
  account is kept for 90 days, but it isn't in **Drafts** or the email, and there's no **Clear** for it. If they sign up again
  in that time, the coach tells them "This account can't use the coach." until it lapses.
