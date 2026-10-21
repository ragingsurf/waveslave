# Setting up the Taiwan chat

This is Bryan's step-by-step for switching on the WaveSlave chat. It takes about 30 minutes and costs nothing: Cloudflare's
free plan needs no card, and LINE sign-in is free.

Start once Claude's chat pull request is merged: the chat code is then on the site, switched off. Nothing changes on
waveslave.tw until the very last step, so you can stop at any point and carry on later.

**What you need:** a computer, your phone with LINE on it, and your GitHub account (the one that owns `ragingsurf/waveslave`).

**Keep the secret values private.** You'll make seven values below. Keep them in a private note while you work (a password
manager is best). They only ever go into GitHub's secret boxes. Never paste them into a chat with Claude, an email, a
screenshot or the repo. Claude never needs them.

## Part 1: Cloudflare

1. **Make a free Cloudflare account.** Go to https://dash.cloudflare.com/sign-up and sign up with your email and a password. It
   asks for no card. Cloudflare then emails you a link: open it to confirm your email address.

2. **Pick the chat's web address.** In the Cloudflare dashboard, go to **Workers & Pages** (it's in the menu on the left, or open
   https://dash.cloudflare.com/?to=/:account/workers-and-pages).
   - Find **Your subdomain**. Select **Change** next to it, type `waveslave` (or something close if that's taken), and save.
   - Write the subdomain down: it's not a secret. With `waveslave`, the chat's address will be
     `https://waveslave-chat.waveslave.workers.dev`.

3. **Copy the account ID.** On the same **Workers & Pages** page, find the **Account Details** section and select the copy
   button next to **Account ID**. Paste it into your note as `CLOUDFLARE_ACCOUNT_ID`.

4. **Make the deploy key (an API token).** It lets GitHub put the chat on Cloudflare, and nothing else.
   1. Go to **Manage account** > **Account API tokens** (or open https://dash.cloudflare.com/?to=/:account/api-tokens).
   2. Select **Create Token**.
   3. Under **Permission policies**, open the **Custom** menu and select **Edit Cloudflare Workers**.
   4. Name it `WaveSlave chat deploy`.
   5. If it asks which account or zones the token may use, pick your own account. You have no websites on Cloudflare, so there
      are no zones to worry about.
   6. Select **Continue to summary**, then **Create Token**.
   7. Copy the token straight away (Cloudflare shows it only once) and paste it into your note as `CLOUDFLARE_API_TOKEN`.

## Part 2: LINE

5. **Open the LINE Developers Console.** Go to https://developers.line.biz/console/ and select **Log in to Console**. Log in with
   your LINE account: with the email and password of your LINE account, or by scanning the QR code with LINE on your phone.
   - The first time, it asks you to register as a developer: fill in **Developer name** and **Your email**, agree to the LINE
     Developers Agreement, and select **Create my account**.

6. **Make a provider.** A provider is the name people see when they sign in with LINE.
   - On the **Providers** page, select **Create** (it may say **Create a new provider**).
   - For **Provider name**, type `WaveSlave`, and select **Create**.

7. **Make a LINE Login channel.** Open the WaveSlave provider, go to its **Channels** tab and choose **LINE Login**. Fill in:

   | Field | What to put |
   |---|---|
   | **Region to provide the service** | Taiwan |
   | **Company or owner's country or region** | Taiwan (where you live) |
   | **Channel icon** | Optional. The site's `web/icon-512.png` works. |
   | **Channel name** | `WaveSlave` (LINE doesn't allow the word "LINE" in it) |
   | **Channel description** | `Sign in to post in the WaveSlave surf chat.` |
   | **App types** | **Web app** only |
   | **Email address** | Your email. LINE sends notices about the channel here. |
   | **Privacy policy URL** and **Terms of use URL** | Leave empty. |

   Tick that you agree to the LINE Developers Agreement, and select **Create**.

8. **Copy the channel ID and secret.** Open the new channel's **Basic settings** tab.
   - Copy **Channel ID** into your note as `LINE_CHANNEL_ID`.
   - Copy **Channel secret** into your note as `LINE_CHANNEL_SECRET`.
   - Leave everything else alone. Don't select **Apply** under **OpenID Connect** (the **Email address permission**): the chat
     never asks for anyone's email, so it needs no review from LINE.

## Part 3: Three random values

9. **Make three random values.** On a Mac, open the **Terminal** app (press Cmd and Space together, type `Terminal`, press
   Enter). Type this line and press Enter:

   ```
   openssl rand -base64 48
   ```

   It prints one line of 64 random letters, numbers and symbols. Run it three times (press the Up arrow, then Enter, to run it
   again), and paste each line into your note under its own name:

   | Name | What it does |
   |---|---|
   | `SESSION_SECRET` | Signs people's sign-ins. Changing it later just signs everyone out. |
   | `SUB_PEPPER` | Turns each LINE account into a one-way code, so the chat never keeps anyone's real LINE ID. **Never change this one once the chat is live:** every account would become a new one, and bans would be lost. |
   | `ADMIN_CODE` | Your one-time code to become the chat's admin. Keep it in your note until the last part of this guide. |

   On a Windows PC, ask Claude for the Windows version of this command.

## Part 4: GitHub

10. **Add the seven secrets to GitHub.** Open https://github.com/ragingsurf/waveslave. Under the repository name, select
    **Settings**. In the **Security** part of the menu on the left, select **Secrets and variables**, then **Actions**. (The
    direct link is https://github.com/ragingsurf/waveslave/settings/secrets/actions.)

    For each of the seven values, on the **Secrets** tab:
    1. Select **New repository secret**.
    2. In **Name**, type the name exactly as below, in capitals with the underscores.
    3. In **Secret**, paste the value from your note.
    4. Select **Add secret**.

    | Name | From step |
    |---|---|
    | `CLOUDFLARE_API_TOKEN` | 4 |
    | `CLOUDFLARE_ACCOUNT_ID` | 3 |
    | `LINE_CHANNEL_ID` | 8 |
    | `LINE_CHANNEL_SECRET` | 8 |
    | `SESSION_SECRET` | 9 |
    | `SUB_PEPPER` | 9 |
    | `ADMIN_CODE` | 9 |

    GitHub never shows a secret again once it's saved. If you get one wrong, select the pencil (edit) button next to it and
    paste the value again.

11. **Put the chat on Cloudflare (the first deploy).** In the repository, select **Actions**. In the menu on the left, select
    **Deploy chat**. Select **Run workflow**, check that the **Branch** menu says `main`, and select **Run workflow** again.
    - It takes a few minutes. A green tick means the chat is on Cloudflare. From now on this runs by itself whenever the chat's
      backend changes.
    - Open the finished run and its **Deploy** step: near the end it shows the chat's address,
      `https://waveslave-chat.<your subdomain>.workers.dev`.
    - If the run says "Chat not deployed" and lists missing secrets, add those (step 10) and run it again.
    - If it shows a red cross, send Claude a screenshot of the step that failed. That's safe: GitHub shows every secret in the
      log as `***`.

## Part 5: Back to LINE

12. **Tell LINE where to send people back after they sign in.** In the LINE Developers Console, open the WaveSlave provider and
    the WaveSlave channel, and go to its **LINE Login** tab. Under **Callback URL**, select **Edit**, paste this address with
    your own subdomain from step 2, and select **Update**:

    ```
    https://waveslave-chat.<your subdomain>.workers.dev/auth/line/callback
    ```

    With the subdomain `waveslave`, that's `https://waveslave-chat.waveslave.workers.dev/auth/line/callback`.

13. **Open sign-in to everyone.** A new channel starts as **Developing**, which lets only you sign in. At the top of the channel
    page, select **Developing** and confirm that you want to publish it. It then shows **Published**. (It can't be switched back
    to Developing, and doesn't need to be.)

14. **Leave email off.** Check that the **Email address permission** on the **Basic settings** tab still hasn't been applied
    for. That's how it should stay.

## Part 6: Send Claude two things

15. **Send Claude, in the project chat:**
    - **the workers.dev subdomain** from step 2 (for example `waveslave`). It's not a secret.
    - **the name and email to show as the person running the chat.** They appear in the chat's privacy note, which everyone can
      read, and are where people send questions and takedown requests. A separate email just for the chat is fine.

    Nothing else: no tokens, no secrets. Claude then makes a small pull request that switches the chat on with your address,
    name and email. Once you merge it, the site rebuilds by itself, and a few minutes later the chat shows on the Taiwan spots.

## When the chat is live

1. **Become the admin.** On waveslave.tw, open a Taiwan spot, open the chat, sign in with LINE and pick your nickname. Then
   type `/admin`, a space, and your `ADMIN_CODE` from step 9, and send it. It isn't posted to the room. This works once: your
   account becomes the admin, and your messages carry the "WaveSlave" badge. After that you can delete `ADMIN_CODE` from your
   note.
2. **Try signing in on your phone:** in Safari, in the WaveSlave app on your home screen (if you've added it), and inside LINE's
   own browser (send yourself a waveslave.tw link in LINE, for example in Keep Memo, and open it there). Tell Claude how each one
   went.

## If something goes wrong

- **You lost `ADMIN_CODE` before using it:** make a new one (step 9), replace the `ADMIN_CODE` secret in GitHub (step 10) and
  run **Deploy chat** again (step 11).
- **You think a secret has leaked:** tell Claude which one, without pasting it, and Claude will walk you through replacing it.
- **The chat says it's resting:** it has used most of the day's free Cloudflare allowance, and comes back by itself at 08:00
  Taiwan time.
  The rest of the site carries on as normal.
