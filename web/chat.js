// The Taiwan chat on the page (docs/superpowers/specs/2026-10-21-taiwan-chat-design.md, "What you see" and "Front end"): the surfer
// reports on the "Right now" card, the floating CHAT button, and the room. Taiwan only, one room for all of it, free, and people answer
// each other (Bryan, Oct 21).
// One classic script, loaded with defer after the page's own scripts. It declares no global names: it reads the page's ALL, LANG, CUR,
// VIEW, SPT, T, countrySpots, switchSpot and setView by bare name (and WORLD, setWorld, worldLocked and wsPin for developer mode), and gives
// the page only window.CHAT = {spot, relang, dev, signIn, token}: template.html calls the first three from boot() (a spot is shown),
// setLang() (the language changed) and keepWorld() (developer mode came on or went off), and the AI coach (web/coach.js), which signs in
// through the chat, calls signIn() and token(). It brings its own <style>, so its look ships with it.
// - It never throws into the page: each way in is wrapped, and while CHAT_URL or CONTACT is empty it does nothing at all, so the page
//   works exactly as it does without it.
// - Everything from the network goes in through textContent, setAttribute or a lookup in this file's own tables, never as HTML. No chat
//   element carries data-zh or data-ja (applyLang() rewrites those as HTML); relang() redraws in the new language instead.
(() => { "use strict"; try {

// Where the backend runs: Bryan's Cloudflare Worker, on his workers.dev subdomain waveslave050 (switched on Oct 22, once his Cloudflare
// and LINE setup was done). Tests set window.__chatUrl in its place, and an empty one switches the chat off. Only a string counts, so an
// element that happens to be called __chatUrl (an id in the page makes one) can't switch the chat off or point it somewhere.
const CHAT_URL = typeof window.__chatUrl === "string" ? window.__chatUrl : "https://waveslave-chat.waveslave050.workers.dev";
// Who runs the chat, for the privacy note, takedown requests and questions. Bryan stays anonymous: the note names "WaveSlave" and the
// chat's own address (Bryan, Oct 22). The chat stays switched off while either is empty, and while CHAT_URL is. Tests set
// window.__chatContact in place of these.
const CONTACT = window.__chatContact || { name: "WaveSlave", email: "waveslave050@gmail.com" };
const PAGE = typeof ALL === "object" && !!ALL && typeof LANG === "string" && typeof CUR === "string" && typeof VIEW === "string" && typeof SPT === "function"
  && typeof countrySpots === "function" && typeof switchSpot === "function" && typeof setView === "function";
if (!/^https?:\/\/./i.test(CHAT_URL) || !CONTACT || typeof CONTACT.name !== "string" || typeof CONTACT.email !== "string" || !CONTACT.name || !CONTACT.email || !PAGE) return;
const BASE = CHAT_URL.replace(/\/+$/, "");
// Who sees it (Bryan, Oct 22): only developer mode (the page's World mode, behind the PIN on the W in the logo) until Bryan says it's ready
// for everyone; then PUBLIC goes to true. Tests set window.__chatPublic to see the chat as everyone will. While neither holds, the chat shows
// nothing (no button, no strip, no credits line) and asks the backend nothing; template.html's keepWorld() calls CHAT.dev() each time the
// mode changes. on() is read from the page's WORLD by bare name, like the rest of the page's state.
const PUBLIC = window.__chatPublic === true;
const on = () => PUBLIC || (typeof WORLD === "boolean" && WORLD);
// Tests only: window.__chatTest makes CHAT note each time the room is asked to open (CHAT._opened) and hand over the strings (CHAT._strings)
// and the conditions snapshot (CHAT._snap(id, ms)).
const TEST = window.__chatTest ? [] : null;

// What chat.js keeps on this device: the session token and the sign-in's verifier ({v, at}, and then: "coach" for a sign-in the Coach panel
// started), the newest message seen (for the button's dot) and the room's filter; and, for the length of a sign-in, the spot to come back
// to (sessionStorage).
const KEYS = { token: "waveslave-chat-token", v: "waveslave-chat-v", seen: "waveslave-chat-seen", filter: "waveslave-chat-filter", ret: "waveslave-chat-return" };
// The report and board codes, as the backend checks them (chat/src/mod.js), in the order the forms offer them.
const CODES = { size: ["flat", "knee", "waist", "chest", "head", "overhead"], cond: ["clean", "ok", "choppy", "blown"], crowd: ["empty", "few", "busy", "packed"],
  board: ["short", "fish", "minimal", "long", "softtop"], reason: ["spam", "harass", "sexual", "child", "other"] };

// A wait in seconds as the slow-down line says it: seconds under a minute, minutes under an hour, else hours (the daily limits, 5 shares
// and 20 logs a day, can mean most of a day), each rounded up, with the language's own units.
const waitIn = (s, sec, min, h) => s < 60 ? `${s}${sec}` : s < 3600 ? `${Math.ceil(s / 60)}${min}` : `${Math.ceil(s / 3600)}${h}`;
// ---- Strings: every word the chat shows, in English, 中文 (Taiwan) and 日本語. Spot names come from the page (SPT(spot, "name")).
const STR = {
  en: {
    // The "Right now" card and the button
    reportsHead: "Surfer reports · last 4 h", postReport: "+ Post a report", noReports: "No reports in the last 4 h",
    justNow: "just now", minAgo: n => `${n} min ago`, hAgo: n => `${n} h ago`,
    chat: "CHAT", online: n => `${n} online`, openChat: "Open the Taiwan chat", newMsgs: "new messages",
    // The room
    roomTitle: "TAIWAN CHAT", roomName: "台灣浪友", close: "Close", all: "All", more: "More", badge: "WaveSlave", aSurfer: "a surfer",
    rulesHead: "House rules",
    rules: ["Be kind and help each other surf better.", "No ads or selling.", "No LINE IDs, phone numbers or links.",
      "No posting other people's plates, addresses or personal details.", "13 and up. If you're under 18, your parent or guardian agrees."],
    rulesShort: "Help each other surf better. Be kind, no ads, no LINE IDs.",
    older: "Load older messages", noMsgs: "No messages here yet",
    msgDeleted: "Message deleted", earlier: "an earlier message", replyingTo: nick => `replying to ${nick}`,
    surfReport: "Surf report", sessionLog: "Session log",
    forecastSaid: (fc, buoy, at) => [fc && `Forecast said ${fc}`, buoy && `buoy ${buoy}`].filter(Boolean).join(" · ") + (at ? ` at ${at}` : ""),
    conditionsThen: "Conditions then", noConditions: "No conditions recorded", tide: "tide", buoy: "buoy",
    report: "+ Report", log: "📓 Log", say: "Say something…", send: "Send",
    lineLogin: "Log in with LINE", signInFirst: "Log in with LINE to post",
    // First sign-in
    welcome: "Welcome to the Taiwan chat", nickname: "Nickname", join: "Join",
    consent: "I'm 13 or older (under 18 with a parent's or guardian's OK), and I accept the house rules and the privacy note.",
    publicNote: "Your nickname, spot and time are public on reports and shared sessions.",
    // The message menu and the main menu
    msgMenu: "Message menu", reply: "Reply", like: "👍", flag: "Report", del: "Delete", ban: "Ban", restore: "Restore", keep: "Keep as evidence",
    reasons: { spam: "Spam or ads", harass: "Harassment", sexual: "Sexual content", child: "Child safety", other: "Something else" },
    flagged: "Thanks, it's reported.", tapAgain: "tap again to confirm", done: "Done",
    menu: "Menu", mySessions: "My sessions", changeNick: "Change nickname (once a week)", download: "Download my data",
    signOutAll: "Sign out everywhere", deleteAccount: "Delete my account", lockRoom: "Lock the room", unlockRoom: "Unlock the room",
    hiddenMsgs: n => `Hidden messages (${n})`, unban: "Unban", unbanN: n => `Unban (${n})`, adminOn: "Admin tools are on", adminNo: "That command isn't available",
    hiddenWhy: { flags: "Hidden by reports", ban: "Hidden by a ban", admin: "Hidden by you" }, noHidden: "No hidden messages", noBanned: "No one is banned",
    nickErr: { length: "2–20 characters", chars: "Only letters, digits, spaces and _ - .", reserved: "That name is reserved", taken: "That nickname is taken",
      blocked: "That nickname isn't allowed" },
    nickWait: d => `Once a week: you can change it again in ${d} ${d === 1 ? "day" : "days"}`,
    // Post a report
    postTitle: "Post a report", postSub: "What's it like right now? Takes 5 seconds.", spotHead: "Spot", sizeHead: "Size", condHead: "Conditions", crowdHead: "Crowd",
    size: { flat: "Flat", knee: "Knee", waist: "Waist", chest: "Chest", head: "Head", overhead: "Overhead" },
    sizeHigh: { flat: "Flat", knee: "Knee high", waist: "Waist high", chest: "Chest high", head: "Head high", overhead: "Overhead" },
    cond: { clean: "Clean", ok: "OK", choppy: "Choppy", blown: "Blown out" },
    crowd: { empty: "Empty", few: "Few", busy: "Busy", packed: "Packed" },
    crowdChip: { empty: "Empty", few: "Few people", busy: "Busy", packed: "Packed" },
    post: "Post", showsOn: spot => `Shows on the ${spot} card for 4 h`,
    // Log a session
    logTitle: "Log a session", logSub: "Your surf diary. Only you see it unless you share it.", spotWhen: "Spot · When",
    today: "Today", yesterday: "Yesterday", dayBefore: "The day before", start: "Start", end: "End", howWent: "How did it go", boardHead: "Board",
    board: { short: "Shortboard", fish: "Fish", minimal: "Mini-mal", long: "Longboard", softtop: "Soft-top" },
    note: "Note", notePh: "Kept nosediving on takeoff", autoAdded: "Added automatically", share: "Share to chat for tips", save: "Save",
    shareLog: "Share", unshareLog: "Unshare", noSessions: "No sessions yet",
    // When something goes wrong
    offline: "Chat is offline", retry: "Retry", resting: "Chat is resting until 08:00", loginFailed: "Couldn't sign in with LINE, try again",
    banned: "This LINE account can't post here", slowDown: s => `Slow down a little · try again in ${waitIn(s, " s", " min", " h")}`, reloadNew: "Reload for the new chat",
    locked: "The room is locked. You can still read.", failed: "That didn't go through. Try again.", gone: "That's gone already",
    blocked: { link: "Links can't be posted here. Edit it and send again.", line: "LINE IDs and invites can't be posted here. Edit it and send again.",
      phone: "Phone numbers can't be posted here. Edit it and send again.", other: "That can't be posted here. Edit it and send again." },
    pinTitle: "Almost done", pinShown: "Signed in with LINE. Go back to the WaveSlave app and enter this code:", pinBox: "Enter the code from the LINE sign-in",
    pinGo: "Sign in", pinWrong: "That code isn't right. Check it and try again.", signedIn: "Signed in with LINE", signInAgain: "Log in with LINE again first",
    posted: "Report posted", stars: n => `${n} of 5 stars`, future: "The start can't be later than now.", tooLong: "A session can be up to 12 hours.",
    saved: "Saved to your diary", savedShared: "Saved, and shared to the chat", notShared: why => `Saved to your diary, but it couldn't be shared: ${why}`,
    full: "Your diary is full (1,000 sessions). Delete one in My sessions first.", loading: "Loading…", sharedTag: "Shared",
    deleteWhat: "Your messages, shared sessions, session logs, coach reviews (with their key frames) and nickname are deleted now, on every device. Your reports stay, as “a surfer”. Copies kept as evidence of a broken rule stay for up to 180 days. This can't be undone.",
    deleted: "Your account is deleted", signedOut: "Signed out on every device",
    // The privacy note (Taiwan's Personal Data Protection Act, Article 8): short at first sign-in, in full behind More.
    privacyHead: "Privacy note", contactHead: "Contact",
    privacyShort: "To post, the chat keeps your nickname, a one-way code made from your LINE ID and what you post. Cloudflare stores it outside Taiwan, and LINE (LY Corp) handles sign-in. Posts are public. The full privacy note is under More.",
    privacy: c => [
      ["Who runs the chat", `${c.name} runs this chat. Questions and takedown requests: ${c.email}.`],
      ["Why", "Your data is used only to run the chat."],
      ["What is kept", "Your nickname, a one-way code made from your LINE ID (never the ID itself), your messages, reports and session logs, and your coach reviews with the key frames you send for them. Cloudflare also sees your IP address when you connect."],
      ["Where, and who handles it", "Cloudflare stores the chat on servers outside Taiwan. LINE (LY Corp) handles sign-in. Messages, reports and shared sessions are public, under your nickname."],
      ["How long", "Room messages and shared sessions: 30 days. Reports: 1 year, with your nickname taken off after 30 days. Private session logs: until you delete them, or after 2 years without signing in. Coach reviews: the written feedback until you delete it, or after 2 years without signing in; the key frames 30 days after the review. Cloudflare keeps recovery copies for up to 30 days. Anything hidden for child safety, and messages kept as evidence of a broken rule, are kept for 180 days."],
      ["Your rights", `"Download my data" and "Delete my account" are in the chat's menu at any time, or write to ${c.email}.`],
      ["If you don't sign in", "You can still read everything. Signing in is only for posting."]],
  },
  zh: {
    reportsHead: "浪友回報 · 4 小時內", postReport: "＋ 回報浪況", noReports: "4 小時內還沒有回報",
    justNow: "剛剛", minAgo: n => `${n} 分鐘前`, hAgo: n => `${n} 小時前`,
    chat: "聊天", online: n => `${n} 人線上`, openChat: "打開台灣浪友聊天室", newMsgs: "有新訊息",
    roomTitle: "TAIWAN CHAT", roomName: "台灣浪友", close: "關閉", all: "全部", more: "更多", badge: "WaveSlave", aSurfer: "一位浪友",
    rulesHead: "版規",
    rules: ["友善待人，互相幫忙，一起衝得更好。", "禁止廣告或推銷。", "禁止留 LINE ID、電話號碼或連結。",
      "禁止公開他人的車牌、地址或個人資料。", "年滿 13 歲才能使用；未滿 18 歲須經父母或監護人同意。"],
    rulesShort: "互相幫忙，一起衝得更好。友善交流，不打廣告、不留 LINE ID。",
    older: "載入更早的訊息", noMsgs: "這裡還沒有訊息",
    msgDeleted: "訊息已刪除", earlier: "較早的訊息", replyingTo: nick => `回覆 ${nick}`,
    surfReport: "浪況回報", sessionLog: "衝浪日誌",
    forecastSaid: (fc, buoy, at) => [fc && `預報 ${fc}`, buoy && `浮標 ${buoy}`].filter(Boolean).join(" · ") + (at ? `（${at}）` : ""),
    conditionsThen: "當時海況", noConditions: "沒有記錄到海況", tide: "潮位", buoy: "浮標",
    report: "＋ 回報", log: "📓 日誌", say: "說點什麼…", send: "送出",
    lineLogin: "使用LINE帳號登入", signInFirst: "用 LINE 登入後就能發言",
    welcome: "歡迎來到台灣浪友聊天室", nickname: "暱稱", join: "加入",
    consent: "我已年滿 13 歲（未滿 18 歲已取得父母或監護人同意），並接受版規與隱私權說明。",
    publicNote: "你的暱稱、浪點與時間會公開顯示在回報與分享的日誌上。",
    msgMenu: "訊息選單", reply: "回覆", like: "👍", flag: "檢舉", del: "刪除", ban: "停權", restore: "恢復", keep: "保留為證據",
    reasons: { spam: "垃圾訊息或廣告", harass: "騷擾", sexual: "色情內容", child: "危害兒少", other: "其他" },
    flagged: "已檢舉，謝謝你。", tapAgain: "再按一次確認", done: "完成",
    menu: "選單", mySessions: "我的日誌", changeNick: "更改暱稱（每週一次）", download: "下載我的資料",
    signOutAll: "登出所有裝置", deleteAccount: "刪除我的帳號", lockRoom: "鎖定聊天室", unlockRoom: "解除鎖定",
    hiddenMsgs: n => `被隱藏的訊息（${n}）`, unban: "解除停權", unbanN: n => `解除停權（${n}）`, adminOn: "管理工具已開啟", adminNo: "無法使用這個指令",
    hiddenWhy: { flags: "因檢舉而隱藏", ban: "因停權而隱藏", admin: "由你隱藏" }, noHidden: "沒有被隱藏的訊息", noBanned: "沒有被停權的帳號",
    nickErr: { length: "暱稱需 2–20 個字", chars: "只能用文字、數字、空格和 _ - .", reserved: "這個暱稱保留給站方", taken: "這個暱稱已經有人用了",
      blocked: "這個暱稱不能使用" },
    nickWait: d => `每週只能改一次，${d} 天後可以再改`,
    postTitle: "回報浪況", postSub: "現在浪況如何？只要 5 秒。", spotHead: "浪點", sizeHead: "浪高", condHead: "海況", crowdHead: "人潮",
    size: { flat: "平", knee: "膝", waist: "腰", chest: "胸", head: "頭", overhead: "過頭" },
    sizeHigh: { flat: "平", knee: "膝浪", waist: "腰浪", chest: "胸浪", head: "頭浪", overhead: "過頭浪" },
    cond: { clean: "乾淨", ok: "普通", choppy: "有點亂", blown: "被風吹爛" },
    crowd: { empty: "沒人", few: "少", busy: "多", packed: "爆滿" },
    crowdChip: { empty: "沒人", few: "人少", busy: "人多", packed: "爆滿" },
    post: "送出", showsOn: spot => `會在${spot}的卡片上顯示 4 小時`,
    logTitle: "記錄一次衝浪", logSub: "你的衝浪日記。除非你分享，只有你看得到。", spotWhen: "浪點 · 時間",
    today: "今天", yesterday: "昨天", dayBefore: "前天", start: "開始", end: "結束", howWent: "感覺如何", boardHead: "板子",
    board: { short: "短板", fish: "魚板", minimal: "迷你長板", long: "長板", softtop: "軟板" },
    note: "筆記", notePh: "起乘一直插頭", autoAdded: "自動加入", share: "分享到聊天室，請大家給建議", save: "儲存",
    shareLog: "分享", unshareLog: "取消分享", noSessions: "還沒有日誌",
    offline: "聊天室離線", retry: "重試", resting: "聊天室休息中，08:00 恢復", loginFailed: "無法用 LINE 登入，請再試一次",
    banned: "這個 LINE 帳號無法在這裡發言", slowDown: s => `慢一點 · ${waitIn(s, " 秒", " 分鐘", " 小時")}後再試`, reloadNew: "請重新整理以使用新版聊天室",
    locked: "聊天室已鎖定，仍可閱讀。", failed: "沒有送出，請再試一次。", gone: "已經不在了",
    blocked: { link: "這裡不能貼連結，修改後再送出。", line: "這裡不能留 LINE ID 或邀請，修改後再送出。", phone: "這裡不能留電話號碼，修改後再送出。",
      other: "這段內容不能在這裡發表，修改後再送出。" },
    pinTitle: "差一步就完成", pinShown: "已使用 LINE 登入。請回到 WaveSlave App，輸入這組代碼：", pinBox: "輸入 LINE 登入後顯示的代碼",
    pinGo: "登入", pinWrong: "代碼不正確，請確認後再試一次。", signedIn: "已用 LINE 登入", signInAgain: "請先重新用 LINE 登入",
    posted: "已送出回報", stars: n => `${n} 顆星（滿分 5 顆）`, future: "開始時間不能晚於現在。", tooLong: "一次衝浪最長 12 小時。",
    saved: "已存入你的日誌", savedShared: "已儲存，並分享到聊天室", notShared: why => `已存入你的日誌，但無法分享：${why}`,
    full: "日誌已滿（1,000 筆），請先在「我的日誌」刪除一筆。", loading: "載入中…", sharedTag: "已分享",
    deleteWhat: "你的訊息、分享的日誌、私人日誌、教練講評（連同關鍵影格）和暱稱會立即從所有裝置上刪除。你的浪況回報會保留，顯示為「一位浪友」。因違反版規而保留為證據的副本最多保存 180 天。刪除後無法復原。",
    deleted: "你的帳號已刪除", signedOut: "已登出所有裝置",
    privacyHead: "隱私權說明", contactHead: "聯絡我們",
    privacyShort: "要發言，聊天室會保存你的暱稱、由 LINE ID 單向產生的代碼，以及你發表的內容。資料由 Cloudflare 存放在台灣以外的伺服器，登入由 LINE（LY Corp）處理。發言內容是公開的。完整的隱私權說明在「更多」裡。",
    privacy: c => [
      ["誰在營運", `WaveSlave 的台灣浪友聊天室由 ${c.name} 營運。有問題或要求下架內容，請寫信到 ${c.email}。`],
      ["蒐集目的", "你的資料只用於營運聊天室。"],
      ["保存哪些資料", "你的暱稱、由 LINE ID 單向產生的代碼（不會保存 ID 本身），以及你的訊息、回報、衝浪日誌與教練講評，連同你為講評送出的關鍵影格。你連線時，Cloudflare 也會看到你的 IP 位址。"],
      ["存放地點與經手者", "聊天室的資料由 Cloudflare 存放在台灣以外的伺服器；登入由 LINE（LY Corp）處理。訊息、回報與分享的日誌會以你的暱稱公開。"],
      ["保存多久", "聊天室訊息與分享的日誌：30 天。回報：1 年，30 天後移除你的暱稱。私人日誌：保留到你刪除為止，或 2 年未登入後刪除。教練講評：文字講評保留到你刪除為止，或 2 年未登入後刪除；關鍵影格在講評後 30 天刪除。Cloudflare 的復原備份最多保留 30 天；因兒少安全而隱藏的內容，以及因違反版規而保留為證據的訊息，保留 180 天。"],
      ["你的權利", `你隨時可以在聊天室選單中使用「下載我的資料」或「刪除我的帳號」，也可以寫信到 ${c.email}。`],
      ["不登入的話", "你仍然可以閱讀所有內容，只有發言需要登入。"]],
  },
  ja: {
    reportsHead: "サーファーの報告 · 過去4時間", postReport: "＋ 波情報を投稿", noReports: "過去4時間の報告はありません",
    justNow: "たった今", minAgo: n => `${n}分前`, hAgo: n => `${n}時間前`,
    chat: "チャット", online: n => `${n}人オンライン`, openChat: "台湾チャットを開く", newMsgs: "新着メッセージあり",
    roomTitle: "TAIWAN CHAT", roomName: "台灣浪友", close: "閉じる", all: "すべて", more: "詳しく", badge: "WaveSlave", aSurfer: "サーファー",
    rulesHead: "ルール",
    rules: ["親切に。みんなで上達を助け合いましょう。", "広告・販売は禁止です。", "LINE ID・電話番号・リンクの投稿は禁止です。",
      "他人のナンバープレート・住所・個人情報の投稿は禁止です。", "13歳以上が対象です。18歳未満の方は保護者の同意が必要です。"],
    rulesShort: "みんなで上達を助け合おう。親切に、広告とLINE IDは禁止。",
    older: "以前のメッセージを読み込む", noMsgs: "ここにはまだメッセージがありません",
    msgDeleted: "メッセージは削除されました", earlier: "以前のメッセージ", replyingTo: nick => `${nick}への返信`,
    surfReport: "波情報", sessionLog: "セッション記録",
    forecastSaid: (fc, buoy, at) => [fc && `予報 ${fc}`, buoy && `ブイ ${buoy}`].filter(Boolean).join(" · ") + (at ? `（${at}）` : ""),
    conditionsThen: "当時のコンディション", noConditions: "コンディションの記録なし", tide: "潮位", buoy: "ブイ",
    report: "＋ 報告", log: "📓 記録", say: "メッセージを入力…", send: "送信",
    lineLogin: "LINEでログイン", signInFirst: "投稿するにはLINEでログインしてください",
    welcome: "台湾チャットへようこそ", nickname: "ニックネーム", join: "参加する",
    consent: "13歳以上です（18歳未満の場合は保護者の同意を得ています）。ルールと「プライバシーについて」に同意します。",
    publicNote: "ニックネーム・ポイント・時間は、報告と共有したセッションで公開されます。",
    msgMenu: "メッセージメニュー", reply: "返信", like: "👍", flag: "通報", del: "削除", ban: "利用停止", restore: "復元", keep: "証拠として保存",
    reasons: { spam: "スパム・広告", harass: "嫌がらせ", sexual: "性的な内容", child: "子どもの安全", other: "その他" },
    flagged: "通報しました。ありがとうございます。", tapAgain: "もう一度タップで確定", done: "完了",
    menu: "メニュー", mySessions: "マイセッション", changeNick: "ニックネーム変更（週1回）", download: "データをダウンロード",
    signOutAll: "すべての端末でログアウト", deleteAccount: "アカウントを削除", lockRoom: "ルームをロック", unlockRoom: "ロックを解除",
    hiddenMsgs: n => `非表示のメッセージ（${n}）`, unban: "利用停止を解除", unbanN: n => `利用停止を解除（${n}）`, adminOn: "管理ツールがオンになりました", adminNo: "このコマンドは使えません",
    hiddenWhy: { flags: "通報で非表示", ban: "利用停止で非表示", admin: "あなたが非表示にしました" }, noHidden: "非表示のメッセージはありません", noBanned: "利用停止中のアカウントはありません",
    nickErr: { length: "2〜20文字で入力してください", chars: "文字・数字・スペース・_ - . のみ使えます", reserved: "このニックネームは予約されています",
      taken: "このニックネームは使われています", blocked: "このニックネームは使えません" },
    nickWait: d => `変更は週1回です。あと${d}日で変更できます`,
    postTitle: "波情報を投稿", postSub: "今の波はどう？5秒で完了。", spotHead: "ポイント", sizeHead: "サイズ", condHead: "コンディション", crowdHead: "混雑",
    size: { flat: "フラット", knee: "ひざ", waist: "腰", chest: "胸", head: "頭", overhead: "頭オーバー" },
    sizeHigh: { flat: "フラット", knee: "ひざサイズ", waist: "腰サイズ", chest: "胸サイズ", head: "頭サイズ", overhead: "頭オーバー" },
    cond: { clean: "クリーン", ok: "まあまあ", choppy: "ザワザワ", blown: "ジャンク" },
    crowd: { empty: "貸切", few: "少ない", busy: "多い", packed: "激混み" },
    crowdChip: { empty: "貸切", few: "人少なめ", busy: "混雑", packed: "激混み" },
    post: "投稿", showsOn: spot => `${spot}のカードに4時間表示されます`,
    logTitle: "セッションを記録", logSub: "あなたのサーフ日記。共有しない限り自分だけが見られます。", spotWhen: "ポイント · 日時",
    today: "今日", yesterday: "昨日", dayBefore: "一昨日", start: "開始", end: "終了", howWent: "どうだった？", boardHead: "ボード",
    board: { short: "ショートボード", fish: "フィッシュ", minimal: "ミニマル", long: "ロングボード", softtop: "ソフトボード" },
    note: "メモ", notePh: "テイクオフでパーリングばかり", autoAdded: "自動で追加", share: "チャットに共有してアドバイスをもらう", save: "保存",
    shareLog: "共有", unshareLog: "共有をやめる", noSessions: "まだ記録はありません",
    offline: "チャットに接続できません", retry: "再試行", resting: "チャットは08:00まで休止中です", loginFailed: "LINEでログインできませんでした。もう一度お試しください",
    banned: "このLINEアカウントでは投稿できません", slowDown: s => `少しペースを落としてください · ${waitIn(s, "秒", "分", "時間")}後に再試行`, reloadNew: "新しいチャットを使うには再読み込みしてください",
    locked: "ルームはロック中です。閲覧はできます。", failed: "送信できませんでした。もう一度お試しください。", gone: "すでにありません",
    blocked: { link: "リンクは投稿できません。直してから送ってください。", line: "LINE IDや招待は投稿できません。直してから送ってください。",
      phone: "電話番号は投稿できません。直してから送ってください。", other: "この内容は投稿できません。直してから送ってください。" },
    pinTitle: "あと少しです", pinShown: "LINEでログインしました。WaveSlaveアプリに戻って、このコードを入力してください：", pinBox: "LINEログイン後に表示されたコードを入力",
    pinGo: "ログイン", pinWrong: "コードが違います。確認してもう一度お試しください。", signedIn: "LINEでログインしました", signInAgain: "もう一度LINEでログインしてください",
    posted: "波情報を投稿しました", stars: n => `星${n}つ（5段階）`, future: "開始時刻を今より後にはできません。", tooLong: "1回のセッションは最長12時間です。",
    saved: "日記に保存しました", savedShared: "保存して、チャットに共有しました", notShared: why => `日記に保存しましたが、共有できませんでした：${why}`,
    full: "日記がいっぱいです（1,000件）。先に「マイセッション」で1件削除してください。", loading: "読み込み中…", sharedTag: "共有中",
    deleteWhat: "メッセージ、共有したセッション、セッション記録、コーチのレビュー（キーフレームを含む）、ニックネームが、すべての端末から今すぐ削除されます。波情報は「サーファー」として残ります。ルール違反の証拠として保存されたコピーは最長180日間残ります。元に戻すことはできません。",
    deleted: "アカウントを削除しました", signedOut: "すべての端末でログアウトしました",
    privacyHead: "プライバシーについて", contactHead: "お問い合わせ",
    privacyShort: "投稿するには、ニックネーム、LINE IDから一方向に作ったコード、投稿内容をチャットに保存します。データはCloudflareが台湾国外に保存し、ログインはLINE（LY Corp）が扱います。投稿は公開されます。プライバシーについての全文は「詳しく」にあります。",
    privacy: c => [
      ["運営者", `WaveSlaveの台湾チャットは${c.name}が運営しています。お問い合わせ・削除のご依頼は ${c.email} まで。`],
      ["利用目的", "データはチャットの運営のためだけに使います。"],
      ["保存する情報", "ニックネーム、LINE IDから一方向に作ったコード（ID自体は保存しません）、メッセージ、報告、セッション記録、コーチのレビューと、そのために送ったキーフレーム。接続時にはCloudflareがIPアドレスを受け取ります。"],
      ["保存場所と取り扱う事業者", "チャットのデータはCloudflareが台湾国外のサーバーに保存します。ログインはLINE（LY Corp）が扱います。メッセージ・報告・共有したセッションはニックネームとともに公開されます。"],
      ["保存期間", "ルームのメッセージと共有したセッション：30日。報告：1年（30日後にニックネームを外します）。非公開のセッション記録：削除するまで、または2年間ログインがないと削除。コーチのレビュー：文章は削除するまで、または2年間ログインがないと削除。キーフレームはレビューの30日後に削除。Cloudflareの復旧用コピーは最長30日、子どもの安全のため非表示にした内容と、ルール違反の証拠として保存したメッセージは180日保存されます。"],
      ["あなたの権利", `チャットのメニューの「データをダウンロード」と「アカウントを削除」はいつでも使えます。${c.email} への連絡もできます。`],
      ["ログインしない場合", "すべて閲覧できます。ログインが必要なのは投稿だけです。"]],
  },
};
// The table's own entry, or nothing: codes and keys can come from the network, and "constructor" or "__proto__" must not find anything.
const own = (o, k) => o && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
// A string in the page's language (English where a language lacks one); an entry that is a function is called with the rest: S("online", 3).
function S(key, ...args) { const t = own(STR[LANG], key) ?? own(STR.en, key); return typeof t === "function" ? t(...args) : t; }
// A code's label in the page's language: L("cond", "ok") is "OK".
const L = (group, code) => own(S(group), code);

// Runs f and keeps any error inside the chat: the page carries on whatever happens here. An async f's failure is caught too, so it never
// reaches the page as an unhandled rejection.
const guard = f => (...a) => { try { const r = f(...a); if (r && typeof r.then === "function") r.then(null, e => console.warn("chat:", e)); return r; } catch (e) { console.warn("chat:", e); } };
// localStorage and sessionStorage can be missing or throw (a private window, blocked storage), so each read and write is wrapped.
function load(key, session) { try { return (session ? sessionStorage : localStorage).getItem(key); } catch (e) { return null; } }
function save(key, value, session) { try { const s = session ? sessionStorage : localStorage; if (value == null) s.removeItem(key); else s.setItem(key, String(value)); } catch (e) {} }
// A new element: attributes go in with setAttribute, children as nodes or as text (append makes a text node of a string), never as HTML.
function el(tag, attrs, ...kids) { const e = document.createElement(tag);
  for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  for (const c of kids.flat(Infinity)) if (c != null) e.append(c);
  return e; }

// One call to the backend: api("/reports?spot=jinshan"), or api("/me/sessions", {method: "POST", body, token}). The body goes as JSON and
// the token as a Bearer header; no cookies go with it. Resolves to the JSON answer. Rejects when the network fails, after 10 s, or with an
// Error carrying status and body when the backend says no (body.resting while the chat is resting).
async function api(path, opts = {}) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), 10e3) : 0, headers = {};
  if (opts.token) headers.Authorization = "Bearer " + opts.token;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const r = await fetch(BASE + path, { method: opts.method || "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), credentials: "omit", signal: ctl ? ctl.signal : undefined });
    let body = null; try { body = await r.json(); } catch (e) {}
    if (!r.ok) throw Object.assign(new Error("chat: the backend answered " + r.status), { status: r.status, body });
    return body;
  } finally { clearTimeout(timer); }
}

// ---- The strip and the button. /reports?spot= answers {reports, online, last_id}: the spot's reports from the last 4 hours, newest
// first, how many have the room open, and the newest message's id, which lights the button's dot until the room has shown it.
let shown = null;                   // the spot the page shows (the last CHAT.spot), whose reports the strip is for
let data = null;                    // {spot, reports} for it; null while asking, away from Taiwan, or when the backend can't be reached
let online = null, lastId = 0;      // from the newest answer; online is null when there's none to show
let asked = 0, askedAt = -Infinity; // the number of the newest question, so an answer for a spot left behind is dropped, and when it went
const TW = () => countrySpots("tw");
const inTaiwan = id => TW().includes(id);
const count = v => typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
const isReport = r => !!r && Number.isFinite(r.ts) && CODES.size.includes(r.size) && CODES.cond.includes(r.cond) && CODES.crowd.includes(r.crowd);
const seen = () => count(+load(KEYS.seen)) || 0;
// "40 min ago", "2 h ago".
function ago(ts) { const m = Math.max(0, Math.floor((Date.now() - ts)/60e3)); return m < 1 ? S("justNow") : m < 60 ? S("minAgo", m) : S("hAgo", Math.floor(m/60)); }

function ask(id) { const n = ++asked; askedAt = Date.now();
  api("/reports?spot=" + encodeURIComponent(id)).then(j => {
    if (n !== asked) return;
    if (!j || !Array.isArray(j.reports)) throw new Error("chat: no reports in the answer");
    data = { spot: id, reports: withLive(id, j.reports.filter(isReport)) }; online = count(j.online); lastId = count(j.last_id) || 0; draw();
  }).catch(guard(() => { if (n !== asked) return; data = null; online = null; lastId = 0; draw(); })); }

// The report strip, the last child of the "Right now" card (#nowReports in template.html): up to 3 chips for the spot from the last
// 4 hours, each a dot coloured by conditions (Clean green, OK amber, Choppy or Blown out red), size and conditions, then crowd and age.
// With none, the button and "No reports in the last 4 h". It stays hidden away from Taiwan, while asking, and when the backend can't be
// reached. It is drawn again each minute, asking nothing, so the ages move on and a report past 4 hours leaves (the button keeps the focus).
function drawStrip() {
  const s = document.getElementById("nowReports"); if (!s) return; const had = s.contains(document.activeElement);
  const d = on() && data && data.spot === shown && inTaiwan(shown) ? data : null;
  s.hidden = !d; s.textContent = ""; if (!d) return;
  const post = el("button", { type: "button", class: "rp-post" }, S("postReport"));
  post.addEventListener("click", guard(() => enter({ sheet: "report", spot: shown })));
  const since = Date.now() - 4 * 3600e3, chips = d.reports.filter(r => r.ts > since).slice(0, 3).map(r => el("li", { class: "rp-chip" },
    el("b", null, el("i", { class: "rp-dot", "data-cond": r.cond, "aria-hidden": "true" }), `${L("size", r.size)} · ${L("cond", r.cond)}`),
    el("span", null, `${L("crowdChip", r.crowd)} · ${ago(r.ts)}`)));
  s.append(el("div", { class: "rp-hd" }, el("span", { class: "label" }, S("reportsHead")), post),
    chips.length ? el("ul", { class: "rp-row" }, ...chips) : el("p", { class: "rp-none" }, S("noReports")));
  if (had) post.focus({ preventScroll: true });
}
setInterval(guard(() => { if (document.visibilityState !== "hidden") drawStrip(); }), 60e3);

// The CHAT button: CHAT, how many are online, and a pink dot while there's a message newer than the last one seen. The CSS shows it in
// Taiwan (html.tw, set by boot()) while the chat is on for this visitor (html.chat-on, set by showChat()), on the Forecast view only.
const dot = el("i", { class: "chatfab-dot", "aria-hidden": "true" }), word = el("b"), num = el("span", { class: "chatfab-n" });
const fab = el("button", { type: "button", class: "chatfab" }, dot, word, num);
fab.addEventListener("click", guard(() => enter({})));
function drawFab() { const lit = lastId > seen(), n = online == null ? null : S("online", online);
  word.textContent = S("chat"); num.textContent = n || ""; num.hidden = !n; dot.hidden = !lit;
  fab.setAttribute("aria-label", [S("openChat"), n, lit ? S("newMsgs") : null].filter(Boolean).join(" · ")); }

const draw = guard(() => { drawStrip(); drawFab(); });

// ---- The room: full screen above everything, the full-screen map included, with the room's socket behind it.
//   openRoom({sheet, spot, signin, privacy})  opens it, with a sheet over it when asked: the report or log form preset to a spot, a
//                                              sign-in back from LINE to finish, or the house rules and privacy note (?chat=privacy)
//   closeRoom()                                the ✕ or Escape; the socket closes with it
//   sock.send(frame)                           one frame to the room; false when the socket isn't open and greeted
//   openSheet(name, build) / closeSheet()      a bottom sheet over the room; build(state) gives {title, body} and runs again on relang()
//   HOOK                                       what the LINE sign-in and the report and log sheets plug into the room
// The socket frames are chat/src/room.js's ("The socket"): hello, older, say, like, flag, delete, nick, admin and Bryan's tools go out;
// me, history, msg, update, online, tick, error, ok and hidden come back.
const PROTO = 1;                                      // the socket protocol this file speaks (room.js PROTO)
const WS_URL = BASE.replace(/^http/i, "ws") + "/ws";
const PAGE_N = 100, OLDER_N = 50;                     // the room opens with the last 100 messages, and gives older ones 50 at a time
const DEAD_MS = 100e3;                                // no frame for this long (the room ticks every 45 s) and the socket is dead
const OPEN_MS = 12e3;                                 // a socket not open by then (a black-holed network, a captive portal) is lost
const PONG_MS = 10e3;                                 // back in the foreground, the "ping" must get an answer this soon
const AWAY_MS = 5 * 60e3;                             // in the background this long and the socket closes, until the page is back
const BACKOFF = [1e3, 2e3, 4e3, 8e3, 16e3, 30e3];     // waits between tries while the backend can't be reached
const KEEP_MSGS = 600;                                // messages kept while the room stays open and is read at its newest
const FRAME_MAX = 4096;                               // bytes in a frame; the room closes a socket that sends a bigger one
const LANGS = [["en", "English", "en"], ["zh", "中文", "zh-Hant-TW"], ["ja", "日本語", "ja"]];

// What the sign-in and the report and log sheets add (further down): login() starts LINE's sign-in, signin(s) finishes one back from
// LINE, sheet(name, spot) opens the report or log form, msg(m, mine) sees each new message, and ok and error take the room's answers to
// their frames by the frame's type (an error handler returns false to leave it to the room's own words).
const HOOK = { login: null, signin: null, sheet: null, msg: null, ok: {}, error: {} };

const R = {
  built: false, open: false, el: {},
  msgs: new Map(),    // id -> message, as the room sends it (cleaned); history and msg merge into it by id, so nothing shows twice
  gone: new Set(),    // ids deleted or hidden while we watched, for "Message deleted" on a reply to one
  nodes: new Map(),   // id -> its <article>, kept while it draws the same
  oldest: 0, start: false, older: false, // the oldest id held, whether the room has nothing older, and whether a page of older is on its way
  me: null,           // {nick, role} once the socket is signed in
  pinErr: null,       // what the code box says about the last code tried (the home-screen app's sign-in)
  pinBusy: false,     // while that code is being checked
  online: null, state: "idle", filter: "all", replyTo: null, pending: [], hidden: null, locked: null, fresh: false,
  sheet: null, pop: null, opener: null, noteT: 0, agesT: 0, longAt: 0,
};
// token: the session token the newest socket said hello with (null for a reader's). Another tab can store a new one meanwhile.
const sock = { ws: null, ready: false, tries: 0, retryT: 0, openT: 0, deadT: 0, pongT: 0, awayT: 0, held: 0, token: null,
  // One frame to the room, as JSON. Only once the room has answered hello, so a write never goes before the sign-in it needs.
  send(frame) { const ws = sock.ws; if (!ws || ws.readyState !== 1 || !sock.ready) return false;
    const text = JSON.stringify(frame); if (new TextEncoder().encode(text).length > FRAME_MAX) return false;
    try { ws.send(text); return true; } catch (e) { return false; } },
};
const isSpot = id => typeof id === "string" && inTaiwan(id);
const signedIn = () => !!load(KEYS.token);
const isAdmin = () => !!R.me && R.me.role === "admin";
// Nicknames are unique, so a message with ours is ours (the room checks again on delete).
const isMine = m => !!R.me && m.nick != null && m.nick === R.me.nick;
const spotName = id => SPT(ALL.spots[id], "name");
// "Jinshan 金山" in English, as on the cards in the mockups; the page's own name in 中文 and 日本語.
const spotFull = id => { const s = ALL.spots[id]; return LANG === "en" ? [s.name, (s.zh || {}).name].filter(Boolean).join(" ") : spotName(id); };
const fin = v => typeof v === "number" && Number.isFinite(v) ? v : null;
const CMP = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = d => { const k = CMP[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; return typeof T === "function" ? T(k) : k; };
// A time on the Taipei clock (spots carry tz = 8), and its day against today's there: Today, Yesterday, The day before, or 10/19.
const TZ = 8 * 3600e3, DAY = 864e5;
const hm = ms => new Date(ms + TZ).toISOString().slice(11, 16);
function dayOf(ms) { const d = Math.floor((Date.now() + TZ) / DAY) - Math.floor((ms + TZ) / DAY), t = new Date(ms + TZ);
  return d === 0 ? S("today") : d === 1 ? S("yesterday") : d === 2 ? S("dayBefore") : `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; }

// A message from the room as this file keeps it, or null for one it can't draw. Every field is checked here; the body's text goes in
// later as text.
function clean(m) {
  if (!m || typeof m !== "object" || !Number.isSafeInteger(m.id) || m.id < 1 || fin(m.ts) == null || !validBody(m.kind, m.body)) return null;
  if (m.kind !== "text" && !isSpot(m.spot)) return null; // a report or a session card is always about a spot
  return { id: m.id, ts: m.ts, nick: typeof m.nick === "string" ? m.nick : null, role: m.role === "admin" ? "admin" : null, kind: m.kind,
    spot: isSpot(m.spot) ? m.spot : null, body: m.body, reply_to: Number.isSafeInteger(m.reply_to) && m.reply_to > 0 ? m.reply_to : null,
    likes: count(m.likes) || 0, hidden: typeof m.hidden === "string" ? m.hidden : null };
}
function validBody(kind, b) {
  if (!b || typeof b !== "object") return false;
  if (kind === "text") return typeof b.text === "string";
  if (kind === "report") return CODES.size.includes(b.size) && CODES.cond.includes(b.cond) && CODES.crowd.includes(b.crowd) && (b.snap == null || typeof b.snap === "object");
  if (kind === "session") return fin(b.start) != null && fin(b.end) != null && Number.isInteger(b.stars) && b.stars >= 1 && b.stars <= 5
    && CODES.board.includes(b.board) && (b.note == null || typeof b.note === "string") && (b.cond == null || typeof b.cond === "object");
  return false;
}

// ---- The socket. It opens with the room and closes with it. A drop tries again after 1 s, then longer, up to 30 s; a socket not open
// after 12 s, or 100 s without a frame, counts as a drop; back in the foreground it sends "ping" (the room answers "pong" without
// waking), or starts again if the socket is still trying to open; after 5 minutes in the background it closes until the page is back.
// The room's own close codes: 4401 the account signed out everywhere or was deleted, 4403 banned, 4426 this page is too old, 4429 the
// chat is resting until 00:00 UTC (08:00 in Taiwan). Any other close is a drop, the room's 1008 included (five bad frames, or a frame
// past the 1,000 one socket may send): a new socket starts it all again.
function connect() {
  stopSocket();
  if (R.state !== "offline") setState("connecting");
  // The newest message held as this socket starts, before it brings anything: a msg can reach it ahead of its history (the room sends
  // to every open socket), and the history's gap test must not count that one as held.
  sock.held = Math.max(0, ...R.msgs.keys());
  let ws; try { ws = new WebSocket(WS_URL); } catch (e) { return lost(1006); }
  sock.ws = ws;
  sock.openT = setTimeout(guard(() => { if (ws === sock.ws && ws.readyState === 0) { stopSocket(); lost(1006); } }), OPEN_MS);
  ws.onopen = guard(() => { if (ws !== sock.ws) return; clearTimeout(sock.openT); alive(ws); const token = load(KEYS.token); sock.token = token;
    ws.send(JSON.stringify(token ? { type: "hello", v: PROTO, token } : { type: "hello", v: PROTO })); });
  ws.onmessage = guard(e => { if (ws !== sock.ws) return; alive(ws); if (typeof e.data === "string" && e.data !== "pong") onFrame(e.data); });
  ws.onclose = guard(e => { if (ws !== sock.ws) return; sock.ws = null; lost(e.code); });
}
function stopSocket() { const ws = sock.ws; sock.ws = null; sock.ready = false; R.older = false;
  for (const t of ["retryT", "openT", "deadT", "pongT"]) clearTimeout(sock[t]);
  if (ws) { ws.onopen = ws.onmessage = ws.onclose = null; try { ws.close(1000); } catch (e) {} } }
// Any frame says the socket lives: the 100 s start again.
function alive(ws) { clearTimeout(sock.deadT); clearTimeout(sock.pongT); sock.deadT = setTimeout(guard(() => { if (ws === sock.ws) connect(); }), DEAD_MS); }
function retry(ms) { clearTimeout(sock.retryT); sock.retryT = setTimeout(guard(() => { if (R.open) connect(); }), ms); }
// The socket closed, or never opened.
function lost(code) {
  sock.ready = false; R.older = false; clearTimeout(sock.openT); clearTimeout(sock.deadT); clearTimeout(sock.pongT);
  // Texts still waiting stay on the list for the next socket's history to settle (settlePending()); resting or too old, none comes soon.
  // Signed out, deleted or banned (4401, 4403), the next socket says hello as a reader, or as whoever another tab signed in as, so their
  // history can't settle them: the text goes back in the box first, before the quiet sign-out empties the list.
  if (!R.open) return;
  if (code === 4429 || code === 4426 || code === 4401 || code === 4403) restorePending(true);
  if (code === 4429) { setState("resting"); const now = Date.now(); return retry(Math.ceil((now + 1) / DAY) * DAY - now + Math.random() * 60e3); }
  if (code === 4426) return setState("update");
  if (code === 4401 || code === 4403) { if (code === 4403) note(S("banned"), true); return tokenRefused(true); }
  setState("offline"); retry(BACKOFF[Math.min(sock.tries++, BACKOFF.length - 1)]);
}
// Is the socket still there? Asked on coming back to the foreground. An open socket that doesn't answer "ping" within 10 s is replaced;
// one still trying to open is stale (the network may have changed while the page was away), so a new one starts at once.
function check() {
  const ws = sock.ws;
  if (ws && ws.readyState === 1) { try { ws.send("ping"); } catch (e) {} clearTimeout(sock.pongT); sock.pongT = setTimeout(guard(() => { if (ws === sock.ws) connect(); }), PONG_MS); }
  else if (R.state !== "update") { sock.tries = 0; connect(); }
}
function setState(s) { R.state = s; if (R.built) drawStatus(); }

function onFrame(text) {
  let f; try { f = JSON.parse(text); } catch (e) { return; }
  const on = f && typeof f === "object" ? own(ON, f.type) : null;
  if (typeof on === "function") on(f);
}
const ON = {
  // Who this socket is signed in as: after hello, after a nickname change, and after Bryan's claim. Bryan's also says
  // whether the room is locked, so his menu offers Lock or Unlock.
  me(f) {
    if (typeof f.nick !== "string") return;
    const was = R.me; R.me = { nick: f.nick, role: f.role === "admin" ? "admin" : "user" };
    R.locked = R.me.role !== "admin" ? null : typeof f.locked === "boolean" ? f.locked : R.locked;
    if (was && was.nick !== f.nick) for (const m of R.msgs.values()) if (m.nick === was.nick) m.nick = f.nick;
    if (R.sheet && R.sheet.name === "nick" && R.sheet.state.sent) { closeSheet(); note(`${S("changeNick")} · ${S("done")}`); }
    if (was && was.role !== "admin" && R.me.role === "admin") { note(S("adminOn")); sock.send({ type: "hidden_list" }); }
    drawAll();
  },
  // The last 100 messages after hello, or a page of 50 older ones (before_id). After hello it is the truth from its oldest message on:
  // a message held from before a drop that isn't in it was deleted or hidden meanwhile. Those held from before its oldest stay only when
  // they meet it. More than 100 posted while the room was shut or the socket down leaves a gap between them that nothing would fill, so
  // then they all go and scrolling up loads them again, a page at a time. How full a page is, and where it starts, are the room's own
  // (every message it sent with an id), not what's left once clean() has dropped any this file can't draw.
  history(f) {
    const sent = Array.isArray(f.messages) ? f.messages : [], list = sent.map(clean).filter(m => m && (!m.hidden || isAdmin()));
    const sentIds = sent.map(m => m && m.id).filter(id => Number.isSafeInteger(id) && id > 0);
    if (f.before_id == null) {
      const ids = new Set(list.map(m => m.id)), low = sentIds.length ? Math.min(...sentIds) : Infinity, whole = sent.length < PAGE_N;
      const gap = !whole && sock.held < low - 1;
      if (gap) { R.msgs.clear(); R.gone.clear(); }
      const heldOlder = [...R.msgs.keys()].some(id => id < low);
      for (const id of [...R.msgs.keys()]) if ((whole || id >= low) && !ids.has(id)) { reportGone(id); R.msgs.delete(id); R.gone.add(id); }
      R.start = whole || (R.start && heldOlder);
      for (const m of list) R.msgs.set(m.id, m);
      settlePending(list);
      if (R.replyTo && !R.msgs.has(R.replyTo)) { R.replyTo = null; drawReply(); } // the reply line shows what a reply would go to
      const first = R.fresh; R.fresh = false; sock.ready = true; sock.tries = 0; setState("live");
      if (isAdmin()) sock.send({ type: "hidden_list" });
      settle(); render({ toEnd: first || gap }); // the reading place went with the gap: the newest are where to be
    } else {
      R.older = false;
      for (const m of list) if (!R.msgs.has(m.id)) R.msgs.set(m.id, m);
      if (sent.length < OLDER_N) R.start = true;
      settle({ older: true }); render();
    }
    markSeen();
  },
  // A new message, or one Bryan restored (and, on his sockets only, one just hidden, marked with why).
  msg(f) {
    const m = clean(f.msg); if (!m || (m.hidden && !isAdmin())) return;
    R.msgs.set(m.id, m); R.gone.delete(m.id);
    // Only the echo of a text still waiting takes it off the list: another of ours (sent earlier, or on another screen) doesn't.
    const mine = isMine(m), p = mine && m.kind === "text" ? R.pending.findIndex(x => x.sent === m.body.text) : -1; if (p >= 0) R.pending.splice(p, 1);
    settle(); render({ toEnd: mine }); markSeen(); if (!mine) announce(m);
    if (HOOK.msg) HOOK.msg(m, mine);
  },
  // Likes changed, or a message went (deleted, or hidden for everyone but Bryan).
  update(f) {
    const id = f.id, m = Number.isSafeInteger(id) ? R.msgs.get(id) : null;
    if (f.deleted === true || f.hidden === true) { reportGone(id); R.msgs.delete(id); R.gone.add(id); if (R.replyTo === id) { R.replyTo = null; drawReply(); } }
    else if (m && count(f.likes) != null) m.likes = count(f.likes);
    else return;
    render();
  },
  online(f) { const n = count(f.online); if (n != null) { R.online = n; drawHead(); } },
  tick(f) { ON.online(f); },
  error(f) {
    const code = typeof f.code === "string" ? f.code : "invalid", about = typeof f.for === "string" ? f.for : "";
    if (code === "gone") return gone(about, f);
    const hook = own(HOOK.error, about); if (typeof hook === "function" && hook(code) !== false) return;
    if (about === "hello") { if (code === "banned") note(S("banned"), true); if (code === "auth" || code === "banned") tokenRefused(false); return; }
    if (about === "older") { R.older = false; const s = slowFor(code); if (s) setTimeout(guard(() => { if (R.built && R.el.list.scrollTop < 60) olderPage(); }), s * 1e3); return; }
    if (about === "nick" && R.sheet && R.sheet.name === "nick") { R.sheet.state.sent = false; R.sheet.state.err = nickWhy(code); return drawSheet(); }
    if (about === "say") restorePending();
    if (about === "admin") return note(S("adminNo"), true);
    if (code === "auth") return tokenRefused(true);
    note(why(code), true);
  },
  // One of Bryan's tools did its work (or a log was shared, which the sheets take). Lock and unlock reach all his screens;
  // delete comes back only for a message that was hidden already, which stays as it is.
  ok(f) {
    const about = typeof f.for === "string" ? f.for : "", hook = own(HOOK.ok, about);
    if (typeof hook === "function") return hook(f);
    const label = own({ lock: "lockRoom", unlock: "unlockRoom", ban: "ban", unban: "unban", restore: "restore", keep: "keep", delete: "del" }, about);
    if (!label) return;
    if (about === "lock" || about === "unlock") R.locked = about === "lock";
    if (about === "unban" || about === "restore" || about === "ban") sock.send({ type: "hidden_list" });
    note(`${S(label)} · ${S("done")}`);
  },
  // Bryan's hidden list: how many are hidden, the newest 100 with why, and the banned LINE accounts (the newest 100, each with the code
  // unban takes) with how many are banned in all.
  hidden(f) {
    if (!isAdmin()) return;
    const banned = (Array.isArray(f.banned) ? f.banned : []).filter(b => b && typeof b.sub_hash === "string").map(b => ({ sub_hash: b.sub_hash, nick: typeof b.nick === "string" ? b.nick : null }));
    R.hidden = { count: count(f.count) || 0, messages: (Array.isArray(f.messages) ? f.messages : []).map(m => { const c = clean(m); return c && { ...c, flags: m.flags && typeof m.flags === "object" ? m.flags : {} }; }).filter(Boolean),
      banned, bannedCount: Math.max(count(f.banned_count) ?? 0, banned.length) };
    if (R.sheet && (R.sheet.name === "hidden" || R.sheet.name === "unban")) drawSheet();
    const item = k => R.pop && R.pop.main ? R.pop.box.querySelector(`[data-k="${k}"]`) : null;
    if (item("hidden")) item("hidden").textContent = S("hiddenMsgs", R.hidden.count);
    if (item("unban")) item("unban").textContent = S("unbanN", R.hidden.bannedCount);
  },
};
// A write that lost a race (error gone): what it named is gone, or is already as it asked. The room names it (gone carries the frame's
// id, msg_id, reply_to, session_id or sub_hash), so its row is drawn as it is now: a message that isn't there to see leaves the list
// (Bryan keeps one his screen shows hidden), a reply's text goes back in the box, a log leaves My sessions, and Bryan's hidden list is
// asked for again. Then one short line, "That's gone already". It is never a bad frame, so nothing else changes.
function gone(about, f) {
  const id = Number.isSafeInteger(f.id) ? f.id : null;
  if (about === "share" || about === "unshare") return logGone(f.session_id);
  if (about === "say") { if (Number.isSafeInteger(f.reply_to)) dropMsg(f.reply_to); restorePending(); }
  else if (id && ["like", "flag", "delete", "restore", "keep"].includes(about)) {
    const m = R.msgs.get(id); if (m && !(isAdmin() && m.hidden && (about === "like" || about === "flag"))) dropMsg(id);
  }
  if (isAdmin() && ["ban", "unban", "restore", "keep"].includes(about)) sock.send({ type: "hidden_list" });
  note(S("gone"));
}
// A message that isn't there any more leaves the list, as a delete would take it.
function dropMsg(id) { reportGone(id); if (!R.msgs.delete(id)) return; R.gone.add(id); if (R.replyTo === id) { R.replyTo = null; drawReply(); } render(); }
// After merging: the oldest id held, and at most KEEP_MSGS messages, so a room left open for days drops its oldest. Only while it is
// read at its newest, though: a page of older messages scrolled up to is never cut (o.older), or "Load older messages" would ask for
// the same page for ever, and nothing goes from under someone reading far up. The cut comes once they are back at the newest.
function settle(o = {}) {
  const ids = [...R.msgs.keys()].sort((a, b) => a - b);
  if (ids.length > KEEP_MSGS && !o.older && atEnd()) { for (const id of ids.slice(0, ids.length - KEEP_MSGS)) R.msgs.delete(id); ids.splice(0, ids.length - KEEP_MSGS); R.start = false; }
  R.oldest = ids.length ? ids[0] : 0;
}
const atEnd = () => { if (!R.built) return true; const l = R.el.list; return l.scrollHeight - l.scrollTop - l.clientHeight < 80; };
// The messages seen: the CHAT button's dot stays off for them.
function markSeen() {
  if (!R.open || document.visibilityState === "hidden") return;
  const top = Math.max(0, ...R.msgs.keys());
  if (top > seen()) save(KEYS.seen, top);
  if (top > lastId) lastId = top;
}
const slowFor = code => { const m = /^slow:(\d+)$/.exec(code); return m ? Math.max(1, +m[1]) : 0; };
// What to say about a refused write.
function why(code) {
  if (code.startsWith("blocked:")) { const r = code.slice(8); return own(S("blocked"), r === "short" || r === "telegram" ? "link" : r) || S("blocked").other; }
  const s = slowFor(code); if (s) return S("slowDown", s);
  return code === "locked" ? S("locked") : code === "banned" ? S("banned") : code === "update" ? S("reloadNew") : code === "full" ? S("full") : S("failed");
}
function nickWhy(code) {
  if (code.startsWith("blocked:")) return S("nickErr").blocked;
  const s = slowFor(code); if (s) return S("nickWait", Math.ceil(s / 86400));
  return own(S("nickErr"), code.replace(/^nick:/, "")) || S("failed");
}
// The token stopped working (signed out everywhere, deleted, banned): it goes, and the bar shows the LINE button again.
function signOutQuietly() { save(KEYS.token, null); R.me = null; R.replyTo = null; R.pending = []; if (R.built) drawAll(); }
// The room refused the token this socket said hello with. It goes only while it is still the one stored, as in me(): another tab may
// have signed in since (or signed out and in again), and that tab's token must not go with it. Then this socket just starts again with
// the stored one. again: start again in either case (a hello refused leaves the socket reading on, so it needn't).
function tokenRefused(again) {
  if (load(KEYS.token) !== sock.token) return tokenMoved();
  signOutQuietly(); if (again) { sock.tries = 0; connect(); }
}
// Another tab signed in or out: the token stored isn't the one this socket said hello with, so a new socket says hello with it (and the
// bar is drawn for it). Asked on coming back to the page and when the stored token changes; false when there was nothing to do.
function tokenMoved() {
  if (!R.open || R.state === "update" || load(KEYS.token) === sock.token) return false;
  R.me = null; R.replyTo = null; sock.tries = 0; connect(); if (R.built) drawAll(); return true;
}
// A text that never made it (refused) goes back in the box, unless something new is being typed there. The room answers a socket's
// frames in turn, so a refusal is for the oldest text still waiting. all: the rest go too (the chat rests, or the page is too old).
// Returns whether it went back.
function restorePending(all) { const p = R.pending.shift(); if (all) R.pending = []; if (!p || !R.built) return false;
  const back = !R.el.input.value; if (back) R.el.input.value = p.text;
  if (p.reply && R.msgs.has(p.reply)) R.replyTo = p.reply;
  drawReply(); drawSend(); return back; }
// The texts still waiting when a socket went, dropped or replaced without a word (no frame for 100 s, no pong, the network changed):
// the next socket's history (list) settles them. One it shows as ours, posted after the text was sent, went in (each message settles one
// text); the oldest of the rest goes back in the box with a line to say so, and the list starts again empty.
function settlePending(list) {
  if (!R.pending.length) return;
  const posted = list.filter(m => isMine(m) && m.kind === "text");
  R.pending = R.pending.filter(p => { const i = posted.findIndex(m => m.id > p.after && m.body.text === p.sent); if (i >= 0) posted.splice(i, 1); return i < 0; });
  if (restorePending(true)) note(S("failed"), true);
}

// ---- Building the room (mockup 2). Built once, on first open; relang() redraws its words in place, so the box keeps what's typed.
function build() {
  if (R.built) return;
  const E = R.el, btn = (cls, label, text, act) => { const b = el("button", { type: "button", class: cls, "aria-label": label }, text); b.addEventListener("click", guard(act)); return b; };
  E.title = el("h2", { class: "cr-title", id: "chatRoomTitle" });
  E.sub = el("span", { class: "cr-sub" });
  E.menuBtn = btn("cr-ic cr-menu", null, "☰", () => openMain());
  E.menuBtn.setAttribute("aria-haspopup", "menu"); E.menuBtn.setAttribute("aria-expanded", "false");
  E.x = btn("cr-ic cr-x", null, "✕", () => closeRoom());
  E.filters = el("div", { class: "cr-filters", role: "group" });
  for (const id of ["all", ...TW()]) { const b = btn(null, null, "", () => pickFilter(id)); b.dataset.f = id; E.filters.append(b); }
  E.status = el("div", { class: "cr-status", role: "status" });
  E.pinText = el("span"); E.pinMore = btn("cr-link", null, "", () => openSheet("more", moreSheet));
  E.pin = el("div", { class: "cr-pin" }, el("p", null, "📌 ", E.pinText, " ", E.pinMore));
  E.olderBtn = btn("cr-older", null, "", () => olderPage());
  // The list itself isn't read out as it changes: it is drawn whole for each history and each language switch. A screen reader hears
  // each new message from someone else through E.heard instead (announce()).
  E.msgs = el("div", { class: "cr-msgs", role: "log", "aria-live": "off" });
  E.heard = el("p", { class: "cr-sr", "aria-live": "polite" });
  E.empty = el("p", { class: "cr-empty" });
  E.list = el("div", { class: "cr-list" }, E.pin, E.olderBtn, E.msgs, E.empty);
  E.replyText = el("span", { dir: "auto" });
  E.reply = el("div", { class: "cr-reply" }, el("span", null, "↳ "), E.replyText, btn("cr-ic cr-unreply", null, "✕", () => { R.replyTo = null; drawReply(); E.input.focus(); }));
  E.note = el("p", { class: "cr-note", role: "status" });
  E.rep = btn("cr-pill cr-rep", null, "", () => HOOK.sheet && HOOK.sheet("report", R.filter !== "all" ? R.filter : isSpot(shown) ? shown : null));
  E.log = btn("cr-pill cr-diary", null, "", () => HOOK.sheet && HOOK.sheet("log", R.filter !== "all" ? R.filter : isSpot(shown) ? shown : null));
  E.input = el("input", { class: "cr-in", type: "text", maxlength: "500", dir: "auto", enterkeyhint: "send", autocomplete: "off" });
  E.send = btn("cr-pill cr-send", null, "", () => sendText());
  E.barIn = el("div", { class: "cr-bar" }, E.rep, E.log, E.input, E.send);
  E.lineWord = el("span", { class: "cr-line-w" });
  E.line = btn("cr-line", null, [lineIcon(), el("i", { class: "cr-line-sep", "aria-hidden": "true" }), E.lineWord], () => HOOK.login && HOOK.login());
  E.barOut = el("div", { class: "cr-bar" }, E.line);
  // The home-screen app's code box (spec "Login", step 5): while a sign-in it started waits, the pin LINE showed in the other browser.
  E.pinLab = el("label", { class: "cr-lab", for: "chatPinIn" }); E.pinErr = el("p", { class: "cr-err", role: "alert" });
  E.pinIn = el("input", { class: "cr-in cr-pin-in", id: "chatPinIn", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", enterkeyhint: "go" });
  E.pinGo = btn("cr-pill cr-send", null, "", () => pinEntered());
  E.pinIn.addEventListener("keydown", guard(e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); pinEntered(); } }));
  E.pinIn.addEventListener("input", guard(() => { if (R.pinErr) { R.pinErr = null; drawBar(); } }));
  E.pinBox = el("div", { class: "cr-pinbox" }, E.pinLab, el("div", { class: "cr-bar" }, E.pinIn, E.pinGo), E.pinErr);
  E.foot = el("div", { class: "cr-foot" }, E.heard, E.reply, E.note, E.barIn, E.pinBox, E.barOut);
  E.sheetTitle = el("h2", { id: "chatSheetTitle" }); E.sheetX = btn("cr-ic cr-x", null, "✕", () => closeSheet());
  E.sheetBody = el("div", { class: "cr-sheet-b" });
  E.sheet = el("div", { class: "cr-sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "chatSheetTitle", tabindex: "-1" }, el("div", { class: "cr-sheet-hd" }, E.sheetTitle, E.sheetX), E.sheetBody);
  E.shade = el("div", { class: "cr-shade", hidden: "" }, E.sheet);
  E.shade.addEventListener("click", guard(e => { if (e.target === E.shade) closeSheet(); }));
  E.room = el("div", { class: "chatroom", role: "dialog", "aria-modal": "true", "aria-labelledby": "chatRoomTitle", tabindex: "-1", hidden: "" },
    el("div", { class: "cr-hd" }, E.title, E.sub, E.menuBtn, E.x), E.filters, E.status, E.list, E.foot, E.shade);
  E.input.addEventListener("keydown", guard(e => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); sendText(); } }));
  E.input.addEventListener("input", guard(() => { drawSend(); if (E.note.classList.contains("err")) clearNote(); }));
  E.list.addEventListener("scroll", guard(() => { if (E.list.scrollTop < 60) olderPage(); }), { passive: true });
  E.msgs.addEventListener("click", guard(e => { const b = e.target.closest(".cm-more"); if (b) openMsgMenu(+b.closest("article").dataset.id, b); }));
  // Long-press opens a message's menu too: a finger held still for half a second, or the browser's own context menu (a right-click, or
  // Android's long-press).
  let press = null; const unpress = () => { if (press) clearTimeout(press.t); press = null; };
  E.msgs.addEventListener("touchstart", guard(e => { unpress(); const a = e.target.closest("article.cm");
    if (!a || e.touches.length !== 1 || e.target.closest("button, a")) return;
    const t = e.touches[0]; press = { x: t.clientX, y: t.clientY, t: setTimeout(guard(() => { press = null; R.longAt = Date.now(); openMsgMenu(+a.dataset.id); }), 550) }; }), { passive: true });
  E.msgs.addEventListener("touchmove", guard(e => { const t = e.touches[0]; if (press && t && Math.hypot(t.clientX - press.x, t.clientY - press.y) > 10) unpress(); }), { passive: true });
  for (const t of ["touchend", "touchcancel"]) E.msgs.addEventListener(t, unpress, { passive: true });
  E.msgs.addEventListener("contextmenu", guard(e => { const a = e.target.closest("article.cm"); if (!a) return; e.preventDefault(); if (Date.now() - R.longAt > 800) openMsgMenu(+a.dataset.id); }));
  E.room.addEventListener("pointerdown", guard(e => { if (R.pop && !R.pop.box.contains(e.target) && !R.pop.anchor.contains(e.target)) closePop(); }));
  document.body.append(E.room);
  R.filter = own(Object.fromEntries(["all", ...TW()].map(id => [id, 1])), load(KEYS.filter)) ? load(KEYS.filter) : "all";
  R.built = true;
}
// LINE's own icon for its button: the white speech bubble with "LINE" in green (LINE's button guidelines).
function lineIcon() { const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), p = document.createElementNS(ns, "path"), t = document.createElementNS(ns, "text");
  svg.setAttribute("viewBox", "0 0 40 40"); svg.setAttribute("class", "cr-line-ico"); svg.setAttribute("aria-hidden", "true");
  p.setAttribute("fill", "#fff"); p.setAttribute("d", "M20 6.5C11.4 6.5 4.5 12.2 4.5 19.2c0 6.3 5.5 11.5 13 12.5.5.1 1.2.3 1.4.8.2.4.1 1.1 0 1.5l-.2 1.3c-.1.4-.3 1.5 1.3.8s8.8-5.2 12-8.9c2.2-2.4 3.3-4.9 3.3-7.5 0-7-6.9-12.7-15.4-12.7z");
  t.setAttribute("x", "20"); t.setAttribute("y", "22.6"); t.setAttribute("text-anchor", "middle"); t.setAttribute("fill", "#06C755");
  t.setAttribute("font-size", "8.2"); t.setAttribute("font-weight", "800"); t.setAttribute("font-family", "Arial, Helvetica, sans-serif"); t.textContent = "LINE";
  svg.append(p, t); return svg; }

// ---- Drawing. Each part redraws from the state; drawAll() is relang().
function drawAll() { if (!R.built) return; closePop(); drawHead(); drawFilters(); drawStatus(); drawBar(); drawReply(); render(); drawSheet(); }
function drawHead() { const E = R.el;
  E.title.textContent = S("roomTitle"); E.sub.replaceChildren(...[S("roomName"), R.online == null ? null : S("online", R.online)].filter(Boolean).map(t => el("span", null, t)));
  E.menuBtn.setAttribute("aria-label", S("menu")); E.x.setAttribute("aria-label", S("close"));
  E.filters.setAttribute("aria-label", S("spotHead"));
  E.pinText.textContent = S("rulesShort"); E.pinMore.textContent = S("more"); E.olderBtn.textContent = S("older"); E.empty.textContent = S("noMsgs"); }
function drawFilters() { for (const b of R.el.filters.children) { const id = b.dataset.f; b.textContent = id === "all" ? S("all") : spotName(id); b.setAttribute("aria-pressed", String(R.filter === id)); } }
// "Chat is offline · Retry", "Chat is resting until 08:00" or "Reload for the new chat"; nothing while it works.
function drawStatus() { const s = R.el.status; s.textContent = "";
  if (R.state === "offline") { const b = el("button", { type: "button", class: "cr-link" }, S("retry")); b.addEventListener("click", guard(() => { sock.tries = 0; connect(); })); s.append(el("span", null, S("offline")), " · ", b); }
  else if (R.state === "resting") s.append(S("resting"));
  else if (R.state === "update") { const b = el("button", { type: "button", class: "cr-link" }, S("reloadNew")); b.addEventListener("click", guard(() => location.reload())); s.append(b); }
  s.hidden = !s.firstChild; }
// Signed in: + Report, 📓 Log and the message box. Signed out: one LINE button in LINE's own style (its green, its icon, its words), with
// the code box above it while a sign-in started here waits. Nothing to draw before the room is built (a sign-in for the coach).
function drawBar() { if (!R.built) return; const E = R.el, on = signedIn();
  E.barIn.hidden = !on; E.barOut.hidden = on; E.menuBtn.hidden = false;
  E.pinBox.hidden = on || !pendingV(); E.pinLab.textContent = S("pinBox"); E.pinGo.textContent = S("pinGo"); E.pinIn.setAttribute("aria-label", S("pinBox"));
  E.pinErr.textContent = R.pinErr || ""; E.pinErr.hidden = !R.pinErr; E.pinGo.disabled = !!R.pinBusy;
  E.rep.textContent = S("report"); E.log.textContent = S("log"); E.send.textContent = S("send");
  E.input.setAttribute("placeholder", S("say")); E.input.setAttribute("aria-label", S("say")); E.lineWord.textContent = S("lineLogin"); drawSend(); }
const drawSend = () => { if (R.built) R.el.send.hidden = !R.el.input.value.trim(); };
function drawReply() { const E = R.el, p = R.replyTo && R.msgs.get(R.replyTo);
  E.reply.hidden = !p; if (p) E.replyText.textContent = S("replyingTo", p.nick ?? S("aSurfer")); E.reply.lastChild.setAttribute("aria-label", S("close")); }
// A line above the bar: what happened to the last thing sent. Errors stay until the box changes; the rest go after 5 s.
function note(text, err) { if (!R.built) return; const n = R.el.note; clearTimeout(R.noteT);
  n.textContent = text; n.classList.toggle("err", !!err); n.hidden = false; if (!err) R.noteT = setTimeout(guard(clearNote), 5e3); }
function clearNote() { clearTimeout(R.noteT); R.el.note.hidden = true; R.el.note.textContent = ""; }

// The messages for the filter, oldest first, drawn into the list. Articles that draw the same are kept, and one drawn again takes the
// focus with it when it had it, so a focused ⋯ stays focused. The reading place holds: the list stays at the bottom when it was there,
// or else keeps the top message where it was.
function render(o = {}) {
  if (!R.built) return;
  const list = R.el.list, box = R.el.msgs, end = o.toEnd || list.scrollHeight - list.scrollTop - list.clientHeight < 80, anchor = end ? null : topMessage();
  const want = [...R.msgs.values()].filter(m => R.filter === "all" || m.spot === R.filter).sort((a, b) => a.id - b.id), keep = new Set(want.map(m => m.id));
  for (const [id, n] of R.nodes) if (!keep.has(id)) { n.remove(); R.nodes.delete(id); }
  let at = box.firstElementChild;
  for (const m of want) {
    const sig = JSON.stringify([LANG, m, parentOf(m), isMine(m), isAdmin()]);
    let n = R.nodes.get(m.id);
    if (n && n._sig !== sig) { const k = msgEl(m), had = n.contains(document.activeElement); n.replaceWith(k); if (had) k.querySelector(".cm-more").focus({ preventScroll: true });
      n = k; R.nodes.set(m.id, n); if (at && !at.isConnected) at = n; }
    if (!n) { n = msgEl(m); R.nodes.set(m.id, n); box.insertBefore(n, at); }
    n._sig = sig; at = n.nextElementSibling;
  }
  R.el.olderBtn.hidden = R.start || !R.msgs.size;
  R.el.empty.hidden = !!want.length || R.state !== "live";
  if (end) list.scrollTop = list.scrollHeight;
  else if (anchor) { const n = R.nodes.get(anchor.id); if (n) list.scrollTop += n.getBoundingClientRect().top - list.getBoundingClientRect().top - anchor.off; }
}
// The first message showing under the pinned rules, and how far it is from the list's top.
function topMessage() { const top = R.el.list.getBoundingClientRect().top + R.el.pin.offsetHeight;
  for (const n of R.el.msgs.children) { const r = n.getBoundingClientRect(); if (r.bottom > top) return { id: +n.dataset.id, off: r.top - R.el.list.getBoundingClientRect().top }; }
  return null; }
// What a reply shows of the message it answers: the message itself while held, "Message deleted" when it went while we watched or should
// be among those held, or "an earlier message" when it is older than everything loaded.
function parentOf(m) { if (!m.reply_to) return null; const p = R.msgs.get(m.reply_to);
  return p ? { nick: p.nick, text: excerpt(p) } : R.gone.has(m.reply_to) || R.start || m.reply_to >= R.oldest ? "gone" : "earlier"; }
const excerpt = m => m.kind === "text" ? [...m.body.text].slice(0, 120).join("") : m.kind === "report" ? `${S("surfReport")} · ${spotName(m.spot)}` : `${S("sessionLog")} · ${spotName(m.spot)}`;

// One message: the nickname, Bryan's badge where it applies, the spot tag and the age, the ⋯ menu; the quote it replies to; the text or
// card; the 👍 count. User text goes in with dir="auto" and is isolated (CSS), so an RTL override can't turn the line around it.
function msgEl(m) {
  const head = el("div", { class: "cm-hd" }, el("b", { class: "cm-nick", dir: "auto" }, m.nick ?? S("aSurfer")),
    m.role === "admin" ? el("span", { class: "cm-badge" }, S("badge")) : null,
    el("span", { class: "cm-meta" }, m.spot ? `${spotName(m.spot)} · ` : null, el("time", { "data-ts": String(m.ts), datetime: new Date(m.ts).toISOString() }, ago(m.ts))),
    el("button", { type: "button", class: "cm-more", "aria-label": S("msgMenu"), "aria-haspopup": "menu", "aria-expanded": "false" }, "⋯"));
  const a = el("article", { class: "cm" + (m.hidden ? " cm-hidden" : "") + (isMine(m) ? " cm-mine" : ""), "data-id": String(m.id) }, head);
  if (m.hidden) a.append(el("p", { class: "cm-why" }, own(S("hiddenWhy"), m.hidden) || S("hiddenWhy").admin));
  const p = parentOf(m);
  if (p) a.append(el("p", { class: "cm-quote" }, "↳ ", typeof p === "object" ? [el("b", { dir: "auto" }, p.nick ?? S("aSurfer")), " ", el("span", { dir: "auto" }, p.text)] : S(p === "gone" ? "msgDeleted" : "earlier")));
  a.append(m.kind === "text" ? el("p", { class: "cm-text", dir: "auto" }, m.body.text) : m.kind === "report" ? reportCard(m) : sessionCard(m));
  if (m.likes > 0) a.append(el("p", { class: "cm-foot" }, `👍 ${m.likes}`));
  return a;
}
// "Surf report · Jinshan 金山 / Chest high · Clean · Few people / Forecast said 1.1 m @ 9 s, NE 6 kt · buoy 1.0 m at 07:00". The time is
// the buoy's reading's when there is one (the forecast's is only its hour), else the forecast's.
function reportCard(m) { const b = m.body, s = b.snap || {}, fc = [waves(s), wind(s)].filter(Boolean).join(", "), buoy = fin(s.bhs) == null ? null : `${s.bhs.toFixed(1)} m`;
  const time = k => typeof s[k] === "string" && /T\d\d:\d\d/.test(s[k]) ? s[k] : null, at = buoy ? time("bhs_t") : time("hs_t") || time("ws_t");
  return el("div", { class: "cm-card" }, el("div", { class: "cm-cap" }, `${S("surfReport")} · ${spotFull(m.spot)}`),
    el("div", { class: "cm-big" }, [L("sizeHigh", b.size), L("cond", b.cond), L("crowdChip", b.crowd)].join(" · ")),
    fc || buoy ? el("div", { class: "cm-sub" }, S("forecastSaid", fc, buoy, at ? at.slice(11, 16) : null)) : null); }
// "Session log · Wushi 烏石 · Today 07:00–08:30 / ★★☆☆☆ “Kept nosediving on takeoff” / Conditions then: 0.9 m @ 7 s, NE 9 kt · Mini-mal".
function sessionCard(m) { const b = m.body, cond = condLine(b.cond);
  return el("div", { class: "cm-card" }, el("div", { class: "cm-cap" }, `${S("sessionLog")} · ${spotFull(m.spot)} · ${dayOf(b.start)} ${hm(b.start)}–${hm(b.end)}`),
    el("div", { class: "cm-big" }, el("span", { class: "cm-stars", role: "img", "aria-label": `${b.stars}/5` }, "★".repeat(b.stars) + "☆".repeat(5 - b.stars)),
      b.note ? [" ", el("span", { dir: "auto" }, `“${b.note}”`)] : null),
    el("div", { class: "cm-sub" }, `${cond ? `${S("conditionsThen")}: ${cond}` : S("noConditions")} · ${L("board", b.board)}`)); }
// "0.9 m @ 7 s, NE 9 kt · tide 30 cm · buoy 0.8 m": a log's conditions, or null when none were recorded.
function condLine(c) { if (!c || typeof c !== "object") return null;
  return [[waves(c), wind(c)].filter(Boolean).join(", "), fin(c.tide) == null ? null : `${S("tide")} ${Math.round(c.tide * 100)} cm`, fin(c.bhs) == null ? null : `${S("buoy")} ${c.bhs.toFixed(1)} m`].filter(Boolean).join(" · ") || null; }
const waves = s => fin(s.hs) == null ? null : `${s.hs.toFixed(1)} m` + (fin(s.tp) == null ? "" : ` @ ${Math.round(s.tp)} s`);
const wind = s => fin(s.ws) == null ? null : (fin(s.wd) == null ? "" : compass(s.wd) + " ") + `${Math.round(s.ws)} kt`;
// A new message from someone else, read out once by a screen reader: "Kai: Any tips?", for the messages the filter shows.
function announce(m) { if (R.built && (R.filter === "all" || m.spot === R.filter)) R.el.heard.textContent = `${m.nick ?? S("aSurfer")}: ${excerpt(m)}`; }
// Every minute the ages move on, in place.
function tickAges() { for (const t of R.el.msgs.querySelectorAll("time[data-ts]")) t.textContent = ago(+t.dataset.ts); }

// ---- Filters, older pages, sending.
function pickFilter(id) { R.filter = id; save(KEYS.filter, id); drawFilters(); render({ toEnd: true }); }
// One page of 50 older messages, when the list reaches its top (or "Load older messages" is tapped). The room allows one a second.
function olderPage() { if (!R.start && !R.older && sock.ready && R.oldest > 0) R.older = sock.send({ type: "older", before_id: R.oldest }); }
// A text as the room stores it (chat/src/mod.js normalise()), to know its echo by: NFKC, so full-width punctuation such as ？ and ，
// reads as the room's ? and , ; the invisible characters gone; a tab or line break one space; trimmed.
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Noncharacter_Code_Point}\u{FFFC}]/gu, BREAKS = /[\t\n\v\f\r\u{0085}\u{2028}\u{2029}]+/gu;
const asStored = t => t.normalize("NFKC").split(BREAKS).map(p => p.replace(INVISIBLE, "").normalize("NFKC")).join(" ").trim();
// The message box: text goes as say, tagged with the filter showing (All means no tag; a reply takes its parent's tag in the room).
// Anything starting with a slash goes as admin, never as say, and isn't kept for a retry: it may be Bryan's code.
function sendText() {
  const box = R.el.input, text = box.value.trim(); if (!text) return;
  if (!signedIn()) return needSignIn();
  const admin = /^[/／]/.test(text), f = admin ? { type: "admin", code: text } : { type: "say", text, ...(R.replyTo ? { reply_to: R.replyTo } : R.filter !== "all" ? { spot: R.filter } : {}) };
  if (!sock.send(f)) return note(R.state === "resting" ? S("resting") : S("offline"), true);
  box.value = ""; clearNote(); drawSend();
  if (!admin) { R.pending.push({ text, sent: asStored(text), reply: R.replyTo, after: Math.max(0, ...R.msgs.keys()) }); R.replyTo = null; drawReply(); }
}
// A write from the menus; a reader is asked to sign in first.
function write(frame) { if (!signedIn()) { needSignIn(); return false; } const ok = sock.send(frame); if (!ok) note(S("offline"), true); return ok; }
function needSignIn() { note(S("signInFirst")); if (R.built && !R.el.barOut.hidden) { R.el.line.focus(); R.el.line.classList.remove("cr-pulse"); void R.el.line.offsetWidth; R.el.line.classList.add("cr-pulse"); } }

// ---- Menus: a small popup list (role menu) by its button, opened by tap, long-press or keyboard. Arrows move, Escape and Tab close it,
// and focus goes back to its button. An item marked confirm asks for a second tap.
function openPop(anchor, items, label, main) {
  closePop(); if (!anchor || !anchor.isConnected) return;
  const box = el("div", { class: "cr-pop", role: "menu", "aria-label": label });
  for (const it of items) {
    const b = el("button", { type: "button", role: it.check == null ? "menuitem" : "menuitemradio", class: it.danger ? "danger" : null, lang: it.lang || null, "data-k": it.key || null,
      "aria-checked": it.check == null ? null : String(it.check), tabindex: "-1" }, it.label);
    b.addEventListener("click", guard(e => { e.stopPropagation();
      if (it.confirm && !b._armed) { b._armed = true; b.textContent = `${it.label} · ${S("tapAgain")}`; return; }
      closePop(!it.keep); it.act(); }));
    box.append(b);
  }
  box.addEventListener("keydown", guard(e => { const bs = [...box.querySelectorAll("button")], i = bs.indexOf(document.activeElement);
    const go = k => { e.preventDefault(); bs[(k + bs.length) % bs.length].focus(); };
    if (e.key === "ArrowDown") go(i + 1); else if (e.key === "ArrowUp") go(i - 1); else if (e.key === "Home") go(0); else if (e.key === "End") go(bs.length - 1);
    else if (e.key === "Tab") { e.preventDefault(); closePop(true); } }));
  R.el.room.append(box); R.pop = { box, anchor, main: !!main }; anchor.setAttribute("aria-expanded", "true");
  const a = anchor.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight, vw = innerWidth, vh = innerHeight;
  box.style.left = Math.max(8, Math.min(vw - w - 8, a.right - w)) + "px";
  box.style.top = (a.bottom + 6 + h < vh - 8 ? a.bottom + 6 : Math.max(8, a.top - 6 - h)) + "px";
  const first = box.querySelector("button"); if (first) first.focus();
}
function closePop(refocus) { const p = R.pop; if (!p) return; R.pop = null; p.box.remove(); p.anchor.setAttribute("aria-expanded", "false"); if (refocus && p.anchor.isConnected) p.anchor.focus(); }
// A message's menu: Reply, 👍 and Report; Delete on your own; Bryan also gets Delete, Ban, Restore (on a hidden one) and Keep as evidence.
function openMsgMenu(id, anchor) {
  const m = R.msgs.get(id), n = R.nodes.get(id); if (!m || !n) return;
  const mine = isMine(m), admin = isAdmin(), it = [];
  if (!m.hidden) it.push({ label: S("reply"), act: () => { if (!signedIn()) return needSignIn(); R.replyTo = m.id; drawReply(); R.el.input.focus(); } },
    { label: S("like"), act: () => write({ type: "like", id: m.id }) });
  if (!mine && !m.hidden && m.role !== "admin") it.push({ label: S("flag"), keep: true, act: () => signedIn() ? flagMenu(m) : needSignIn() });
  if (mine || admin) it.push({ label: S("del"), danger: true, confirm: true, act: () => write({ type: "delete", id: m.id }) });
  if (admin && !mine && m.role !== "admin") it.push({ label: S("ban"), danger: true, confirm: true, act: () => write({ type: "ban", msg_id: m.id }) });
  if (admin && m.hidden) it.push({ label: S("restore"), act: () => write({ type: "restore", id: m.id }) });
  if (admin) it.push({ label: S("keep"), act: () => write({ type: "keep", id: m.id }) });
  openPop(anchor || n.querySelector(".cm-more"), it, S("msgMenu"));
}
// Report: why, then it goes. The room says nothing back, so nobody learns whether a flag counted.
function flagMenu(m) { const n = R.nodes.get(m.id);
  openPop(n && n.querySelector(".cm-more"), CODES.reason.map(r => ({ label: L("reasons", r), act: () => { if (write({ type: "flag", id: m.id, reason: r })) note(S("flagged")); } })), S("flag")); }
// The main menu: the language (the page's own buttons do the switch), then for a signed-in person My sessions, Change nickname, Download
// my data, Sign out everywhere (a second tap confirms) and Delete my account (a sheet says what goes first); Bryan also gets Lock or
// Unlock, whichever applies (both while the room hasn't said), Hidden messages with how many wait for him, and Unban with how many are
// banned.
function openMain() {
  const it = LANGS.filter(([l]) => langButton(l)).map(([l, name, tag]) => ({ label: name, lang: tag, check: LANG === l, act: () => pickLang(l) }));
  if (signedIn()) it.push({ label: S("mySessions"), act: () => openSheet("sessions", sessionsSheet) });
  if (signedIn() && R.me) it.push({ label: S("changeNick"), act: () => openSheet("nick", nickSheet) });
  if (signedIn()) it.push({ label: S("download"), act: guard(download) }, { label: S("signOutAll"), danger: true, confirm: true, act: guard(signOutAll) },
    { label: S("deleteAccount"), danger: true, act: () => openSheet("delete", deleteSheet) });
  if (isAdmin()) it.push(...[R.locked !== true ? { label: S("lockRoom"), act: () => write({ type: "lock" }) } : null, R.locked !== false ? { label: S("unlockRoom"), act: () => write({ type: "unlock" }) } : null,
    { label: S("hiddenMsgs", R.hidden ? R.hidden.count : "…"), key: "hidden", act: () => openSheet("hidden", hiddenSheet) },
    { label: S("unbanN", R.hidden ? R.hidden.bannedCount : "…"), key: "unban", act: () => openSheet("unban", unbanSheet) }].filter(Boolean));
  openPop(R.el.menuBtn, it, S("menu"), true);
  if (isAdmin()) sock.send({ type: "hidden_list" });
}
// The page's own language buttons do the switch, and the menu offers only the languages the page shows a button for: 日本語 is switched
// off on the site for now, in #92 (Bryan, Oct 21), its button hidden, so it is never picked here. Its strings stay, as the page's do.
function langButton(l) { const b = document.querySelector(`#lang button[data-l="${l}"]`); return b && !b.hidden && !b.closest("[hidden]") ? b : null; }
function pickLang(l) { const b = langButton(l); if (b) b.click(); }

// ---- Sheets over the room (mockups 3 to 5): a title in the LED face and a body built by build(state). A sheet keeps its state, so
// relang() can build it again in the new language with what was typed or picked; state is what it starts with. Built again, the sheet
// keeps the focus on the control that had it (each control that can be rebuilt has a data-k).
function openSheet(name, buildIt, state) { closePop(); const back = R.sheet ? R.sheet.back : document.activeElement;
  R.sheet = { name, build: buildIt, state: state || {}, back }; drawSheet(); const f = R.el.sheet.querySelector("input, button:not(.cr-x)"); (f || R.el.sheet).focus(); }
function drawSheet() { const s = R.sheet, E = R.el; if (!R.built) return; E.shade.hidden = !s; if (!s) return;
  const a = document.activeElement, k = a && E.sheet.contains(a) ? a.getAttribute("data-k") : null;
  const { title, body } = s.build(s.state); E.sheetTitle.textContent = title; E.sheetBody.replaceChildren(...[body].flat(Infinity).filter(Boolean)); E.sheetX.setAttribute("aria-label", S("close"));
  const n = k && [...E.sheetBody.querySelectorAll("[data-k]")].find(x => x.getAttribute("data-k") === k); if (n) n.focus({ preventScroll: true }); }
function closeSheet() { const s = R.sheet; if (!s) return; R.sheet = null; R.el.shade.hidden = true; R.el.sheetBody.replaceChildren();
  if (s.back && s.back.isConnected && s.back.getClientRects().length) s.back.focus(); else R.el.room.focus(); }
// More: the house rules in full, the privacy note in full, and who to contact.
function moreSheet() {
  const mail = el("a", { href: "mailto:" + CONTACT.email }, CONTACT.email);
  return { title: S("rulesHead"), body: [el("ol", { class: "cr-rules" }, S("rules").map(r => el("li", null, r))),
    el("h3", null, S("privacyHead")), S("privacy", CONTACT).map(([h, p]) => [el("h4", null, h), el("p", null, p)]),
    el("h3", null, S("contactHead")), el("p", null, CONTACT.name, el("br"), mail)] };
}
// Change nickname, once a week: the room says when the next change is due. Saving the name as it is closes the sheet and sends nothing,
// so it can't use up the week (a change of case is a change).
function nickSheet(st) {
  const box = el("input", { class: "cr-in cr-field", type: "text", maxlength: "20", dir: "auto", autocomplete: "off", "aria-label": S("nickname") });
  box.value = st.value ?? (R.me ? R.me.nick : "");
  box.addEventListener("input", guard(() => { st.value = box.value; }));
  const go = el("button", { type: "button", class: "cr-pill cr-go" }, S("save"));
  const submit = guard(() => { const nick = box.value.trim(); if (!nick || st.sent) return; if (R.me && nick === R.me.nick) return closeSheet(); st.value = box.value; st.err = null;
    if (sock.send({ type: "nick", nick })) st.sent = true; else st.err = S("offline"); drawSheet(); });
  go.addEventListener("click", submit); box.addEventListener("keydown", guard(e => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) submit(); }));
  return { title: S("changeNick"), body: [el("label", { class: "cr-lab" }, S("nickname")), box, st.err ? el("p", { class: "cr-err", role: "alert" }, st.err) : null, el("div", { class: "cr-go-row" }, go)] };
}
// Bryan's hidden messages, newest first, each with why and what it was flagged for, and Restore or Keep as evidence.
function hiddenSheet() { const h = R.hidden;
  const rows = h ? h.messages.map(m => { const flags = CODES.reason.filter(r => count(own(m.flags, r))).map(r => `${L("reasons", r)} ${count(m.flags[r])}`).join(" · ");
    const act = (label, type) => { const b = el("button", { type: "button", class: "cr-pill" }, S(label)); b.addEventListener("click", guard(() => write({ type, id: m.id }))); return b; };
    return el("div", { class: "cr-row" }, el("p", null, el("b", { dir: "auto" }, m.nick ?? S("aSurfer")), ` · ${own(S("hiddenWhy"), m.hidden) || ""}${flags ? " · " + flags : ""}`),
      el("p", { class: "cr-row-t", dir: "auto" }, excerpt(m)), el("div", { class: "cr-go-row" }, act("restore", "restore"), act("keep", "keep"))); }) : [];
  return { title: S("hiddenMsgs", h ? h.count : "…"), body: rows.length ? rows : el("p", null, h ? S("noHidden") : "…") }; }
// Bryan's Unban: the banned LINE accounts, by the nickname they had, the newest 100, under how many are banned in all.
function unbanSheet() { const h = R.hidden;
  const rows = h ? h.banned.map(b => { const go = el("button", { type: "button", class: "cr-pill" }, S("unban")); go.addEventListener("click", guard(() => write({ type: "unban", sub_hash: b.sub_hash })));
    return el("div", { class: "cr-row cr-row-1" }, el("b", { dir: "auto" }, b.nick ?? S("aSurfer")), go); }) : [];
  return { title: S("unbanN", h ? h.bannedCount : "…"), body: rows.length ? rows : el("p", null, h ? S("noBanned") : "…") }; }

// ---- Opening and closing. Escape closes the menu, then the sheet, then the room; Tab stays inside whichever is on top.
function openRoom(o = {}) {
  build();
  if (!R.open) {
    R.open = true; R.opener = document.activeElement; R.el.room.hidden = false; document.documentElement.classList.add("chat-open");
    R.fresh = true; sock.tries = 0; connect(); clearInterval(R.agesT); R.agesT = setInterval(guard(tickAges), 30e3);
    drawAll(); render({ toEnd: true }); R.el.room.focus({ preventScroll: true });
  }
  if (o.privacy) openSheet("more", moreSheet);
  if (o.signin && HOOK.signin) HOOK.signin(o.signin);
  if (o.sheet && HOOK.sheet) HOOK.sheet(o.sheet, isSpot(o.spot) ? o.spot : null);
}
function closeRoom() {
  if (!R.open) return;
  markSeen(); R.open = false; stopSocket(); clearTimeout(sock.awayT); clearInterval(R.agesT); closePop(); closeSheet();
  R.el.room.hidden = true; document.documentElement.classList.remove("chat-open"); setState("idle"); drawFab();
  const back = R.opener; R.opener = null; if (back && back.isConnected && back.getClientRects().length) back.focus();
}
addEventListener("keydown", guard(e => {
  if (!R.open) return;
  if (e.key === "Escape" && !e.isComposing) { e.preventDefault(); e.stopImmediatePropagation(); if (R.pop) closePop(true); else if (R.sheet) closeSheet(); else closeRoom(); return; }
  if (e.key !== "Tab" || R.pop) return;
  const layer = R.sheet ? R.el.sheet : R.el.room, all = [...layer.querySelectorAll("button, input, a[href], textarea, select")].filter(x => !x.disabled && x.getClientRects().length);
  if (!all.length) return;
  const i = all.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); all[all.length - 1].focus(); } else if (!e.shiftKey && (i === -1 || i === all.length - 1)) { e.preventDefault(); all[0].focus(); }
}), true);
// Back in the foreground: is the socket still there? In the background for 5 minutes: it closes until the page is back. The network
// going away drops it at once ("Chat is offline · Retry"); the network coming back, or changing, opens a new one, since the old one rarely
// survives a change of network and the browser can take minutes to notice.
document.addEventListener("visibilitychange", guard(() => {
  if (!R.open) return;
  clearTimeout(sock.awayT);
  if (document.visibilityState === "hidden") sock.awayT = setTimeout(guard(() => { if (document.visibilityState === "hidden" && R.open) { stopSocket(); setState("away"); } }), AWAY_MS);
  else { if (!tokenMoved()) check(); markSeen(); drawBar(); }
}));
// Back on the page with a sign-in for the coach still waiting and no token (the home-screen app's way: LINE finished it in Safari, which
// shows the pin), the room opens over the Coach panel for its code box.
document.addEventListener("visibilitychange", guard(() => {
  if (document.visibilityState === "visible" && !R.open && on() && pendingThen() && !signedIn()) enter({}); }));
addEventListener("storage", guard(e => { if (e.key === KEYS.token || e.key === null) { if (!tokenMoved() && R.built) drawBar(); } }));
addEventListener("offline", guard(() => { if (R.open && sock.ws) { stopSocket(); lost(1006); } }));
addEventListener("online", guard(() => { if (R.open && R.state !== "update") { sock.tries = 0; connect(); } }));

// Every way into the room: the CHAT button, "Post a report" and a ?chat link. A link can land on the Map view; the room opens over the
// Forecast view, so closing it shows the forecast.
function enter(o) {
  if (VIEW !== "fc") setView("fc", true);
  if (TEST) TEST.push({ ...o, view: VIEW, forecast: !document.getElementById("viewFc").hidden });
  openRoom(o);
}

// ---- Signing in with LINE (spec "Login (LINE, web flow)"). Before leaving for LINE the page makes a random 32-byte verifier v and keeps it
// in localStorage with when it was made, keeps the spot it's on (sessionStorage), and opens /auth/line/start?h=<base64url SHA-256(v)>.
// LINE sends the browser back to ?chat#c=<code>&p=<pin> (or #e=<what went wrong>), which start-up takes out of the address at once and
// hands to finishSignin():
//   - this page holds a v under 10 minutes old: POST /auth/redeem {v, code}. A known account gets its session token; a new person gets the
//     sign-up sheet, the nickname prefilled from the LINE name, and POST /auth/signup once the tick is ticked.
//   - no v, or the code was made for another one: the sign-in finished in a browser that didn't start it (the iPhone home-screen app hands
//     it to Safari). This page shows only the pin, for the app that did start it, and signs nobody in.
// The app that started it shows a code box while its v waits, and sends POST /auth/redeem {v, pin}. Three wrong pins or 10 minutes void
// the sign-in. The LINE name only prefills the box; nothing here keeps it.
// The Coach panel signs in the same way (AI coach spec, "Sign-in"): CHAT.signIn("coach") keeps then: "coach" beside v. Back from LINE that
// sign-in finishes without the room, which opens only when it needs the surfer (the sign-up sheet, the pin, an error, or the code box when
// the page comes back with the sign-in still waiting); once the token is kept, the room shuts and the Coach panel opens.
const V_MS = 10 * 60e3, CONSENT = "v1"; // how long a sign-in waits; the version of the house rules and privacy note the tick agrees to
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// This page's v while its sign-in can still finish, else null.
function pendingV() {
  try { const o = JSON.parse(load(KEYS.v) || "null"), age = o ? Date.now() - o.at : NaN;
    return o && typeof o.v === "string" && /^[A-Za-z0-9_-]{43}$/.test(o.v) && age > -60e3 && age < V_MS ? o.v : null; } catch (e) { return null; }
}
// What this page's waiting sign-in is for: "coach" when the Coach panel started it, else null. Read before v is let go.
function pendingThen() { try { const o = JSON.parse(load(KEYS.v) || "null"); return pendingV() && o.then === "coach" ? "coach" : null; } catch (e) { return null; } }
// Back from LINE (at start-up, or once developer mode comes on): a sign-in for the coach finishes without the room; any other opens it.
function arrive(o) { if (o.signin && pendingThen()) finishSignin(o.signin); else enter(o); }
// A sign-in for the coach that needs the surfer: the room opens first, over the Coach panel.
function roomFor(then) { if (then && !R.open) enter({}); }
// then: "coach" from CHAT.signIn("coach"), kept with v; nothing for the room's own LINE button.
async function login(then) {
  const subtle = window.crypto && crypto.subtle; if (!subtle) { roomFor(then); return note(S("loginFailed"), true); }
  const v = b64u(crypto.getRandomValues(new Uint8Array(32))), h = b64u(new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(v))));
  save(KEYS.v, JSON.stringify({ v, at: Date.now(), then: then === "coach" ? then : undefined })); save(KEYS.ret, CUR, true);
  if (!pendingV()) { roomFor(then); return note(S("loginFailed"), true); } // storage is refused here, so the sign-in could never finish
  R.pinErr = null; drawBar();
  location.assign(`${BASE}/auth/line/start?h=${h}`);
}
function finishSignin(s) {
  if (!s || typeof s !== "object") return;
  const then = pendingThen();
  if (typeof s.error === "string") { save(KEYS.v, null); roomFor(then); drawBar(); return note(s.error === "banned" ? S("banned") : s.error === "resting" ? S("resting") : S("loginFailed"), true); }
  const v = pendingV(), code = typeof s.code === "string" && /^[A-Za-z0-9_-]{22}$/.test(s.code) ? s.code : null, pin = typeof s.pin === "string" && /^\d{6}$/.test(s.pin) ? s.pin : null;
  if (v && code) return redeem(v, { code }, pin, then);
  roomFor(then);
  if (pin) return openSheet("pin", pinSheet, { pin });
  note(S("loginFailed"), true);
}
// What to say when a sign-in step fails.
function loginWhy(e) { const b = (e && e.body) || {};
  return b.resting ? S("resting") : b.error === "banned" ? S("banned") : !(e && e.status) ? S("offline") : S("loginFailed"); }
// Redeems a sign-in with this page's v and LINE's code, or the pin typed in the code box. Once it's answered, v is no longer kept: a new
// person's sign-up carries it in the sheet, and a sheet shut without joining means starting again. then is what the sign-in was for
// (pendingThen(), read before v went).
async function redeem(v, proof, pin, then) {
  try {
    const j = await api("/auth/redeem", { method: "POST", body: { v, ...proof } });
    if (j && typeof j.token === "string") return signedInAs(j.token, then);
    if (!j || j.needs_signup !== true) throw new Error("chat: the redeem answer has no token");
    save(KEYS.v, null); R.pinErr = null; roomFor(then); drawBar();
    openSheet("signup", signupSheet, { v, proof, then, nick: typeof j.line_name === "string" ? [...j.line_name.trim()].slice(0, 20).join("") : "" });
  } catch (e) {
    const code = e && e.body && e.body.error;
    if (code === "v" && pin) { roomFor(then); return openSheet("pin", pinSheet, { pin }); } // the code was made for another v: finished away from where it began
    if (proof.pin && code === "pin") { R.pinErr = S("pinWrong"); return drawBar(); }
    if (code === "expired" || code === "banned") save(KEYS.v, null);
    if (proof.pin) { R.pinErr = loginWhy(e); return drawBar(); }
    roomFor(then); drawBar(); note(loginWhy(e), true);
  }
}
// Signed in: the token is kept, and the socket starts again with it. A sign-in for the coach goes back to the Coach panel instead: the
// room shuts (it opened only if the sign-in needed the surfer) and the panel opens.
function signedInAs(token, then) {
  save(KEYS.token, token); save(KEYS.v, null); R.pinErr = null;
  if (R.sheet && (R.sheet.name === "signup" || R.sheet.name === "pin")) closeSheet();
  drawAll();
  if (then === "coach") { closeRoom(); if (window.COACH && typeof window.COACH.open === "function") window.COACH.open(); return; }
  note(S("signedIn"));
  if (R.open) { sock.tries = 0; connect(); }
}
// The code box: the pin, for this page's waiting sign-in. One at a time: while a pin is being checked, Sign in is off and Enter does
// nothing, so a double tap can't use up two of the three tries, or open the sign-up sheet twice.
function pinEntered() { const v = pendingV(), then = pendingThen(), pin = R.el.pinIn.value.replace(/\D/g, "");
  if (R.pinBusy) return;
  if (!v) return drawBar();
  if (!/^\d{6}$/.test(pin)) { R.pinErr = S("pinWrong"); return drawBar(); }
  R.pinErr = null; R.pinBusy = true; drawBar();
  redeem(v, { pin }, null, then).finally(guard(() => { R.pinBusy = false; drawBar(); })); }
// The page with no v: the pin, and nothing else.
function pinSheet(st) { return { title: S("pinTitle"), body: [el("p", null, S("pinShown")), el("p", { class: "cr-pin-code" }, st.pin)] }; }
// First sign-in (mockup 3): the short privacy notice (the full one opens in place), the nickname prefilled from the LINE name, and the one
// tick; Join waits for it. What's public is said under the tick.
function signupSheet(st) {
  const nick = el("input", { class: "cr-in cr-field", id: "chatNickIn", type: "text", maxlength: "20", dir: "auto", autocomplete: "nickname", "data-k": "nick" });
  const tick = el("input", { type: "checkbox", "data-k": "consent" }), join = el("button", { type: "button", class: "cr-pill cr-go", "data-k": "join" }, S("join"));
  const can = () => !!st.tick && !!(st.nick || "").trim() && !st.sending;
  nick.value = st.nick || ""; tick.checked = !!st.tick; join.disabled = !can();
  nick.addEventListener("input", guard(() => { st.nick = nick.value; join.disabled = !can(); }));
  nick.addEventListener("keydown", guard(e => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && can()) signup(st); }));
  tick.addEventListener("change", guard(() => { st.tick = tick.checked; join.disabled = !can(); }));
  join.addEventListener("click", guard(() => signup(st)));
  const more = el("button", { type: "button", class: "cr-link", "data-k": "more" }, S("more"));
  more.addEventListener("click", guard(() => { st.more = true; drawSheet(); }));
  return { title: S("welcome"), body: [el("p", null, S("privacyShort"), st.more ? null : [" ", more]), st.more ? el("div", { class: "cr-more" }, moreSheet().body) : null,
    el("label", { class: "cr-lab cr-lab-top", for: "chatNickIn" }, S("nickname")), nick, st.err ? el("p", { class: "cr-err", role: "alert" }, st.err) : null,
    el("label", { class: "cr-tick" }, tick, el("span", null, S("consent"))), el("p", { class: "cr-fine" }, S("publicNote")), el("div", { class: "cr-go-row" }, join)] };
}
async function signup(st) {
  const nick = (st.nick || "").trim(); if (!st.tick || !nick || st.sending) return;
  st.sending = true; st.err = null; drawSheet();
  try {
    const j = await api("/auth/signup", { method: "POST", body: { v: st.v, ...st.proof, nick, consent: CONSENT } });
    if (!j || typeof j.token !== "string") throw new Error("chat: the signup answer has no token");
    signedInAs(j.token, st.then);
  } catch (e) {
    st.sending = false; const b = (e && e.body) || {};
    if (b.error === "expired" || b.error === "banned" || b.error === "v") { if (R.sheet && R.sheet.state === st) closeSheet(); return note(loginWhy(e), true); }
    st.err = b.error === "nick" ? nickWhy(typeof b.code === "string" ? b.code : "") : loginWhy(e);
    if (R.sheet && R.sheet.state === st) drawSheet();
  }
}

// ---- The user's own calls (/me, with the session token). A token the backend no longer takes (signed out everywhere, deleted, banned)
// signs out quietly, and the socket starts again as a reader's.
async function me(path, opts = {}) {
  const token = load(KEYS.token);
  if (!token) throw Object.assign(new Error("chat: signed out"), { status: 401, body: { error: "auth" } });
  try { return await api(path, { ...opts, token }); }
  catch (e) { if (e && e.status === 401) refused(token); throw e; }
}
// A token the backend answered 401 goes, but only while it is still the one kept: another tab may have signed in since. From me() and
// from the coach (CHAT.token(old)).
function refused(token) { if (!token || load(KEYS.token) !== token) return; signOutQuietly(); if (R.open) { sock.tries = 0; connect(); } }
function meWhy(e) { const b = (e && e.body) || {};
  return b.resting ? S("resting") : !(e && e.status) ? S("offline") : b.error === "auth" ? S("signInAgain") : typeof b.error === "string" ? why(b.error) : S("failed"); }
// Signed out on purpose (everywhere, or the account deleted): the room says so, and its socket starts again without the token.
function signedOut(text) { const had = signedIn(); signOutQuietly(); note(text); if (had && R.open) { sock.tries = 0; connect(); } }
async function signOutAll() {
  try { await me("/me/signout", { method: "POST" }); } catch (e) { return note(meWhy(e), true); }
  signedOut(S("signedOut"));
}
// Download my data: what the room keeps about this account, as a JSON file.
async function download() {
  let j; try { j = await me("/me/export"); } catch (e) { return note(meWhy(e), true); }
  const url = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: "application/json" })), a = el("a", { href: url, download: "waveslave-chat-data.json", hidden: "" });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60e3);
  note(`${S("download")} · ${S("done")}`);
}
// Delete my account: a sheet that says what goes, and one button.
function deleteSheet(st) {
  const go = el("button", { type: "button", class: "cr-pill cr-go cr-danger", "data-k": "delete-account" }, S("deleteAccount")); go.disabled = !!st.sending;
  go.addEventListener("click", guard(async () => {
    if (st.sending) return; st.sending = true; st.err = null; drawSheet();
    try { await me("/me", { method: "DELETE" }); }
    catch (e) { st.sending = false; st.err = meWhy(e); if (R.sheet && R.sheet.state === st) drawSheet(); return; }
    if (R.sheet && R.sheet.state === st) closeSheet();
    signedOut(S("deleted"));
  }));
  return { title: S("deleteAccount"), body: [el("p", null, S("deleteWhat")), st.err ? el("p", { class: "cr-err", role: "alert" }, st.err) : null, el("div", { class: "cr-go-row" }, go)] };
}

// ---- The report and log sheets (mockups 4 and 5): rows of pills, one pick each. A tap on one picks it and builds the sheet again.
//   pills(st, key, head, codes, label, o)   a row of pills under the label head; st[key] is the pick, and each pill's data-k is
//                                           "<key>:<code>". o.aria(code) names a pill whose text doesn't say it all; with no head, the
//                                           row goes under the label above it (o.under, that row's key); o.off holds the pick still.
function pills(st, key, head, codes, label, o = {}) {
  const id = "chatOpt-" + (head ? key : o.under);
  return [head ? el("div", { class: "cr-lab cr-lab-top", id }, head) : null, el("div", { class: "cr-opts", role: "group", "aria-labelledby": id }, codes.map(c => {
    const b = el("button", { type: "button", class: "cr-opt", "data-k": `${key}:${c}`, "aria-pressed": String(st[key] === c), "aria-label": o.aria ? o.aria(c) : null }, label(c));
    b.disabled = !!o.off; b.addEventListener("click", guard(() => { if (o.off) return; st[key] = c; st.err = null; drawSheet(); })); return b; }))];
}
// + Report and the strip's "Post a report": the report form, preset to a spot. Signed out, the LINE button is asked for first.
function sheet(name, spot) {
  if (!signedIn()) return needSignIn();
  const st = { spot: isSpot(spot) ? spot : isSpot(shown) ? shown : TW()[0] };
  if (name === "report") openSheet("report", reportSheet, st); else if (name === "log") openSheet("log", logSheet, st);
}
// Post a report: spot, size, conditions and crowd, four taps with the spot preset. It goes on the socket with what the page shows for that
// spot now (snapshot()); the sheet shuts when the room has it, and says why when the room refuses it. While it's on its way (st.sent,
// the spot it went for) the picks hold still, so the sheet always shows the report that was sent.
function reportSheet(st) {
  const post = el("button", { type: "button", class: "cr-pill cr-go", "data-k": "post" }, S("post")), off = { off: !!st.sent };
  post.disabled = !(st.size && st.cond && st.crowd) || !!st.sent; post.addEventListener("click", guard(() => postReport(st)));
  return { title: S("postTitle"), body: [el("p", { class: "cr-lead" }, S("postSub")),
    pills(st, "spot", S("spotHead"), TW(), spotName, off), pills(st, "size", S("sizeHead"), CODES.size, c => L("size", c), off),
    pills(st, "cond", S("condHead"), CODES.cond, c => L("cond", c), off), pills(st, "crowd", S("crowdHead"), CODES.crowd, c => L("crowd", c), off),
    st.err ? el("p", { class: "cr-err", role: "alert" }, st.err) : null,
    el("div", { class: "cr-go-row cr-go-split" }, el("span", null, S("showsOn", spotName(st.spot))), post)] };
}
function postReport(st) {
  if (st.sent || !(st.size && st.cond && st.crowd)) return;
  const snap = snapshot(st.spot, Date.now());
  if (!sock.send({ type: "report", spot: st.spot, size: st.size, cond: st.cond, crowd: st.crowd, ...(snap ? { snap } : {}) })) { st.err = R.state === "resting" ? S("resting") : S("offline"); return drawSheet(); }
  st.sent = st.spot; st.err = null; clearTimeout(st.t);
  // A socket that drops before the room answers leaves the sheet as it was, to send again.
  st.t = setTimeout(guard(() => { if (R.sheet && R.sheet.state === st && st.sent) { st.sent = false; st.err = S("failed"); drawSheet(); } }), 10e3);
  drawSheet();
}
// Log a session: the spot, the day on the Taipei clock (today, yesterday or the day before) with start and end, 1-5 stars, the board and a
// note of up to 300 characters. The conditions are added from the page's data at the session's middle, and shown before saving. "Share to
// chat for tips" starts off (Bryan, Oct 21).
const dayStart = k => (Math.floor((Date.now() + TZ) / DAY) - k) * DAY - TZ; // 00:00 in Taipei, k days ago
const md = ms => { const t = new Date(ms + TZ); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; };
const p2 = n => String(n).padStart(2, "0");
// The session's start and end in ms from the sheet's day and times ("07:00"), on the Taipei clock; an end before the start is the next day.
function logTimes(st) {
  const m = v => { const x = /^(\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?$/.exec(v || ""); return x && +x[1] < 24 && +x[2] < 60 ? (+x[1] * 60 + +x[2]) * 60e3 : null; };
  const a = m(st.start), b = m(st.end); if (a == null || b == null) return null;
  const start = dayStart(st.day) + a, end = dayStart(st.day) + b; return { start, end: end > start ? end : end + DAY };
}
function logSheet(st) {
  if (st.day == null) { // to start: today, the 90 minutes up to the last half hour
    const now = Math.floor(((Date.now() + TZ) % DAY) / 60e3), end = Math.floor(now / 30) * 30, start = Math.max(0, end - 90), at = n => `${p2(Math.floor(n / 60))}:${p2(n % 60)}`;
    Object.assign(st, { day: 0, start: at(start), end: at(Math.max(end, start + 30)), note: "", share: false });
  }
  const time = k => { const i = el("input", { class: "cr-time", type: "time", "data-k": k, "aria-label": S(k) }); i.value = st[k];
    i.addEventListener("input", guard(() => { st[k] = i.value; st.err = null; drawAuto(); })); return el("label", null, S(k), i); };
  const auto = el("p", { class: "cr-auto", "aria-live": "polite" }), drawAuto = () => { const t = logTimes(st), c = t && condLine(snapshot(st.spot, (t.start + t.end) / 2));
    auto.textContent = c ? `🌊 ${S("autoAdded")}: ${c}` : S("noConditions"); };
  drawAuto();
  const noteIn = el("input", { class: "cr-in cr-field", type: "text", maxlength: "300", dir: "auto", autocomplete: "off", "data-k": "note", placeholder: S("notePh"), "aria-label": S("note") });
  noteIn.value = st.note; noteIn.addEventListener("input", guard(() => { st.note = noteIn.value; }));
  const share = el("input", { type: "checkbox", role: "switch", "data-k": "share" }); share.checked = !!st.share;
  share.addEventListener("change", guard(() => { st.share = share.checked; }));
  const go = el("button", { type: "button", class: "cr-pill cr-go", "data-k": "save" }, S("save")); go.disabled = !st.stars || !st.board || !!st.sending;
  go.addEventListener("click", guard(() => saveLog(st)));
  return { title: S("logTitle"), body: [el("p", { class: "cr-lead" }, S("logSub")),
    pills(st, "spot", S("spotWhen"), TW(), spotName), pills(st, "day", null, [0, 1, 2], d => `${S(["today", "yesterday", "dayBefore"][d])} · ${md(dayStart(d))}`, { under: "spot" }),
    el("div", { class: "cr-times" }, time("start"), time("end")),
    pills(st, "stars", S("howWent"), [1, 2, 3, 4, 5], n => "★".repeat(n), { aria: n => S("stars", n) }), pills(st, "board", S("boardHead"), CODES.board, c => L("board", c)),
    el("div", { class: "cr-lab-top" }, noteIn), auto, st.err ? el("p", { class: "cr-err", role: "alert" }, st.err) : null,
    el("div", { class: "cr-go-row cr-go-split" }, el("label", { class: "cr-switch" }, share, el("span", null, S("share"))), go)] };
}
async function saveLog(st) {
  if (st.sending || !st.stars || !st.board) return;
  const t = logTimes(st);
  st.err = !t ? S("failed") : t.start > Date.now() ? S("future") : t.end - t.start > 12 * 3600e3 ? S("tooLong") : null;
  if (st.err) return drawSheet();
  const cond = snapshot(st.spot, (t.start + t.end) / 2);
  const body = { spot: st.spot, start: t.start, end: t.end, stars: st.stars, board: st.board, note: (st.note || "").trim(), ...(cond ? { cond } : {}), share: !!st.share };
  st.sending = true; drawSheet();
  let j; try { j = await me("/me/sessions", { method: "POST", body }); }
  catch (e) { st.sending = false; st.err = meWhy(e); if (R.sheet && R.sheet.state === st) drawSheet(); return; }
  if (R.sheet && R.sheet.state === st) closeSheet();
  // A share the room refused (a blocked note, the day's 5 shares, a locked room) still saves the log, private, to share later.
  if (j && typeof j.error === "string") note(S("notShared", why(j.error)), true); else note(body.share ? S("savedShared") : S("saved"));
}
// My sessions: the logs, newest first, with their conditions. Each can be shared or unshared (on the socket) and deleted (a second tap
// confirms). A line at the top says when a log went meanwhile.
const isLog = l => !!l && Number.isSafeInteger(l.id) && isSpot(l.spot) && fin(l.start) != null && fin(l.end) != null && Number.isInteger(l.stars) && l.stars >= 1 && l.stars <= 5
  && CODES.board.includes(l.board) && (l.note == null || typeof l.note === "string") && (l.cond == null || typeof l.cond === "object");
function sessionsSheet(st) {
  if (!st.asked) { st.asked = true;
    me("/me/sessions").then(guard(j => { st.list = (Array.isArray(j) ? j : []).filter(isLog).map(l => ({ ...l, shared: l.shared === true })); }), guard(e => { st.err = meWhy(e); }))
      .finally(guard(() => { if (R.sheet && R.sheet.state === st) drawSheet(); })); }
  const rows = (st.list || []).map(l => {
    const act = (k, label, f) => { const b = el("button", { type: "button", class: "cr-pill" + (k === "delete" ? " cr-del" : ""), "data-k": k }, label); b.disabled = !!l.busy || !!l.sharing; b.addEventListener("click", guard(f)); return b; };
    const cond = condLine(l.cond), stars = el("span", { class: "cm-stars", role: "img", "aria-label": `${l.stars}/5` }, "★".repeat(l.stars) + "☆".repeat(5 - l.stars));
    return el("div", { class: "cr-row cr-log", "data-id": String(l.id) },
      el("p", { class: "cr-log-cap" }, `${spotFull(l.spot)} · ${dayOf(l.start)} ${hm(l.start)}–${hm(l.end)}`, l.shared ? el("span", { class: "cr-tag" }, S("sharedTag")) : null),
      el("p", null, stars, l.note ? [" ", el("span", { dir: "auto" }, `“${l.note}”`)] : null),
      el("p", { class: "cr-row-t" }, `${cond ? `${S("conditionsThen")}: ${cond}` : S("noConditions")} · ${L("board", l.board)}`),
      l.err ? el("p", { class: "cr-err", role: "alert" }, l.err) : null,
      el("div", { class: "cr-go-row" }, act(l.shared ? "unshare" : "share", S(l.shared ? "unshareLog" : "shareLog"), () => shareLog(st, l)),
        act("delete", l.confirm ? `${S("del")} · ${S("tapAgain")}` : S("del"), () => l.confirm ? deleteLog(st, l) : (l.confirm = true, drawSheet()))));
  });
  return { title: S("mySessions"), body: [st.note ? el("p", { class: "cr-fine", role: "status" }, st.note) : null,
    rows.length ? rows : st.err ? el("p", { class: "cr-err", role: "alert" }, st.err) : el("p", null, st.list ? S("noSessions") : S("loading"))] };
}
// A log already deleted on another screen (404) leaves the list as if this Delete had done it, with a line to say so.
async function deleteLog(st, l) {
  l.busy = true; l.err = null; drawSheet();
  try { await me(`/me/sessions/${l.id}`, { method: "DELETE" }); st.list = st.list.filter(x => x !== l); }
  catch (e) { if (e && e.status === 404) { st.list = st.list.filter(x => x !== l); st.note = S("gone"); } else { l.busy = false; l.confirm = false; l.err = meWhy(e); } }
  if (R.sheet && R.sheet.state === st) drawSheet();
}
// Share or Unshare, on the socket. The row waits for the room's answer with a flag of its own (sharing, apart from a delete's busy), and
// a socket that drops before the answer comes leaves the row as it was after 10 s, to try again.
let shareN = 0;
function shareLog(st, l) {
  if (l.busy || l.sharing || !write({ type: l.shared ? "unshare" : "share", session_id: l.id })) return;
  l.sharing = ++shareN; l.err = null; st.note = null; clearTimeout(l.t);
  l.t = setTimeout(guard(() => { if (!l.sharing) return; l.sharing = 0; l.err = S("failed"); if (R.sheet && R.sheet.state === st) drawSheet(); }), 10e3);
  drawSheet();
}
// The room's answers to share and unshare, for the logs My sessions shows. ok names its log; an error other than gone doesn't, and the
// room answers a socket's frames in turn, so it is for the oldest share still waiting.
const sessionsState = () => R.sheet && R.sheet.name === "sessions" ? R.sheet.state : null;
function logShared(id, shared) { const st = sessionsState(), l = st && (st.list || []).find(x => x.id === id);
  if (l) { clearTimeout(l.t); l.shared = shared; l.sharing = 0; drawSheet(); } }
function shareRefused(code) { const st = sessionsState(), l = st && (st.list || []).filter(x => x.sharing).sort((a, b) => a.sharing - b.sharing)[0];
  if (!l || code === "auth") return false; clearTimeout(l.t); l.sharing = 0; l.err = why(code); drawSheet(); return true; }
// A log the room has no more of (deleted on another screen) leaves My sessions, and a line at the top says so.
function logGone(id) { const st = sessionsState(), l = st && (st.list || []).find(x => x.id === id);
  if (!l) return note(S("gone"));
  clearTimeout(l.t); st.list = st.list.filter(x => x !== l); st.note = S("gone"); drawSheet(); }
// The room's answers to a report: the sheet shuts when the report comes back on the socket, or says why it was refused.
function reportRefused(code) { const s = R.sheet;
  if (!s || s.name !== "report" || !s.state.sent || code === "auth") return false;
  clearTimeout(s.state.t); s.state.sent = false; s.state.err = why(code); drawSheet(); return true; }
function newMessage(m, mine) {
  if (m.kind !== "report") return;
  liveReport(m);
  const s = R.sheet; if (mine && s && s.name === "report" && s.state.sent && m.spot === s.state.sent) { clearTimeout(s.state.t); closeSheet(); note(S("posted")); }
}
// A report seen on the socket goes on its spot's strip at once. /reports may be answered from the browser's minute-long copy for a while
// after, so ask() puts back any of these the answer doesn't have yet (withLive()), for 2 minutes: after that an answer without it is the
// room's word that it went (deleted while the room was shut, with no socket to say so). A report deleted or hidden while the page watches
// (update, a gone answer, a history without it, or one Bryan's socket gets marked hidden) is kept here marked gone instead, so it leaves
// the strip at once and stays off it when that copy still has it. One Bryan restores comes back.
const live = [];
const sameReport = (a, b) => a.ts === b.ts && a.size === b.size && a.cond === b.cond && a.crowd === b.crowd;
function liveEntry(m) { let r = live.find(x => x.id === m.id);
  if (!r) { r = { id: m.id, spot: m.spot, ts: m.ts, size: m.body.size, cond: m.body.cond, crowd: m.body.crowd, gone: false, at: Date.now() }; live.push(r); if (live.length > 50) live.shift(); }
  return r; }
function liveReport(m) { const r = liveEntry(m); r.gone = !!m.hidden; r.at = Date.now(); restrip(r.spot); }
// Message id went (deleted or hidden): if it was a report, it leaves the strip. Asked before the message leaves R.msgs.
function reportGone(id) { const m = R.msgs.get(id), r = live.find(x => x.id === id) || (m && m.kind === "report" ? liveEntry(m) : null);
  if (r) { r.gone = true; restrip(r.spot); } }
function restrip(spot) { if (data && data.spot === spot) { data.reports = withLive(spot, data.reports); draw(); } }
function withLive(spot, reports) {
  const now = Date.now(), here = live.filter(r => r.spot === spot), kept = reports.filter(x => !here.some(r => r.gone && sameReport(x, r)));
  const add = here.filter(r => !r.gone && r.ts > now - 4 * 3600e3 && now - r.at < 120e3 && !kept.some(x => sameReport(x, r))).map(({ ts, size, cond, crowd }) => ({ ts, size, cond, crowd }));
  return add.length ? kept.concat(add).sort((a, b) => b.ts - a.ts) : kept;
}
Object.assign(HOOK, { login: guard(login), signin: guard(finishSignin), sheet: guard(sheet), msg: guard(newMessage),
  ok: { share: f => logShared(f.session_id, true), unshare: f => logShared(f.session_id, false) }, error: { report: reportRefused, share: shareRefused, unshare: shareRefused } });

// ---- The conditions snapshot (spec "Front end", Conditions snapshot): what the page's own data says for a spot at a moment, as raw
// numbers, each with the Taipei clock time of the reading it came from ("<key>_t"), plus ALL.updated. A report takes now; a session log
// the middle of the session.
//   Waves     hs, tp, dp and the swell part shs, stp, sdp: the model's row for that hour, from hourly (today on) or hist.wave (the days
//             before)
//   Wind      ws, wd. Up to now: the station's latest reading (hist.station and dwind), or with none the model's row for that hour
//             (hist.wx and wx). Later: the CWA forecast (wind), its nearest within 3 hours, as the page's windAt() takes it.
//   Tide      tide: tides[day], interpolated at that minute as the page's tide reading is
//   Buoy      bhs, btp, bdp: the latest on-the-hour reading (hist.buoy and buoy)
// Now (a report, or any moment within a minute of the clock) reads the buoy and the station as the Right now card does (template.html
// boot(), "right now": DATA.buoy's and DATA.dwind's last rows): buoy's latest row with a height and dwind's latest with a speed, up to
// now and however old, so a report carries what the card shows even when the next refresh is late. A buoy gone quiet shows "–" on the
// card and gives none here, though hist.buoy still has its older rows. Any other moment, a session's, takes a measured reading only up
// to 3 hours before it, so an hour long past or still to come never picks up an unrelated one. The conversions are those of boot()'s
// Right now block: periods ×1.3, heights in metres and wind in knots as the data has them, and the tide in metres to the centimetre the
// card shows.
// A value that's missing, or outside the range the backend takes (chat/src/mod.js SNAP_KEYS), is left out, never sent as null: the room
// refuses a snapshot with either. null when nothing is known. Times are never written with toISOString(), whose milliseconds the room
// refuses, and never on the device's clock.
const HOUR = 3600e3, MEASURED = 3 * HOUR, NOW_SPAN = 60e3; // a session's measured readings go back 3 hours; "now" is within a minute
const BUOY_P = 1.3; // template.html boot(): "const BUOY_P = 1.3", the period every buoy and forecast row is shown with
const SNAP_RANGE = { hs: [0, 15], tp: [0, 30], dp: [0, 360], shs: [0, 15], stp: [0, 30], sdp: [0, 360], ws: [0, 120], wd: [0, 360], tide: [-5, 5], bhs: [0, 15], btp: [0, 30], bdp: [0, 360] };
const SNAP_TIME = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?Z?$/; // mod.js ISO_TIME
// template.html boot(): tp, "YYYY-MM-DDTHH:MM" on the Taipei clock (every time in the data) to ms.
const tp = s => Date.UTC(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10), +s.slice(11,13)||0, +s.slice(14,16)||0) - 8*3600e3;
const taipei = ms => { const d = new Date(ms + TZ); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const rowsOf = (...lists) => lists.flatMap(l => Array.isArray(l) ? l.filter(r => Array.isArray(r) && typeof r[0] === "string" && SNAP_TIME.test(r[0])) : []);
// template.html boot(): tideEv and tideAt(), the cosine between highs and lows, in cm. Tide times are on the spot's own clock (tz 8 here).
function tideAt(s, t) {
  const off = ((fin(s.tz) ?? 8) - 8) * HOUR, ev = Object.entries(s.tides && typeof s.tides === "object" ? s.tides : {})
    .flatMap(([d, evs]) => Array.isArray(evs) ? evs.filter(e => Array.isArray(e) && typeof e[0] === "string" && fin(e[2]) != null).map(e => ({ t: tp(d + "T" + e[0]) - off, cm: e[2] })) : [])
    .filter(e => fin(e.t) != null).sort((a, b) => a.t - b.t);
  for (let i = 0; i < ev.length - 1; i++) { const a = ev[i], b = ev[i+1];
    if (t >= a.t && t <= b.t) { const f = (t-a.t)/(b.t-a.t); return a.cm+(b.cm-a.cm)*(1-Math.cos(Math.PI*f))/2; } }
  return null;
}
function snapshot(id, ms) {
  const s = isSpot(id) ? own(ALL.spots, id) : null; if (!s || fin(ms) == null) return null;
  const H = s.hist && typeof s.hist === "object" ? s.hist : {}, hour = Math.floor(ms / HOUR) * HOUR, out = {};
  const clock = Date.now(), now = Math.abs(ms - clock) < NOW_SPAN, since = now ? -Infinity : ms - MEASURED;
  const put = (key, v, t) => { const r = SNAP_RANGE[key]; if (fin(v) != null && v >= r[0] && v <= r[1]) { out[key] = v; out[key + "_t"] = t; } };
  const period = p => fin(p) == null ? null : p * BUOY_P;
  const atHour = list => list.find(r => tp(r[0]) === hour);
  const latest = (list, ok) => { let best = null, bt = -Infinity; for (const r of list) { const t = tp(r[0]); if (t <= ms && t > since && t > bt && ok(r, t)) { best = r; bt = t; } } return best; };
  const w = atHour(rowsOf(H.wave, s.hourly));
  if (w) { put("hs", w[1], w[0]); put("tp", period(w[2]), w[0]); put("dp", w[3], w[0]); put("shs", w[4], w[0]); put("stp", period(w[5]), w[0]); put("sdp", w[6], w[0]); }
  if (now || ms <= clock) {
    const st = latest(now ? rowsOf(s.dwind) : rowsOf(H.station, s.dwind), r => fin(r[1]) != null), m = st ? null : atHour(rowsOf(H.wx, s.wx).filter(r => fin(r[4]) != null));
    if (st) { put("ws", st[1], st[0]); put("wd", st[2], st[0]); } else if (m) { put("ws", m[4], m[0]); put("wd", m[5], m[0]); }
  } else {
    let f = null, fd = Infinity; for (const r of rowsOf(s.wind)) { const d = Math.abs(tp(r[0]) - ms); if (fin(r[1]) != null && d < fd) { f = r; fd = d; } }
    if (f && fd <= 3 * HOUR) { put("ws", f[1], f[0]); put("wd", f[2], f[0]); }
  }
  const cm = tideAt(s, ms); if (fin(cm) != null) put("tide", Math.round(cm) / 100, taipei(ms));
  // Now: the card's row, buoy's latest with a height. Otherwise template.html boot()'s bObs, the on-the-hour rows with a height.
  const b = now ? latest(rowsOf(s.buoy), r => fin(r[1]) != null) : latest(rowsOf(H.buoy, s.buoy), (r, t) => t % HOUR === 0 && fin(r[1]) != null);
  if (b) { put("bhs", b[1], b[0]); put("btp", period(b[2]), b[0]); put("bdp", b[3], b[0]); }
  if (!Object.keys(out).length) return null;
  if (typeof ALL.updated === "string" && ALL.updated.length <= 24 && SNAP_TIME.test(ALL.updated)) out.updated = ALL.updated;
  return out;
}

// ---- The look (mockups 1 and 2), in the page's own colours. The strip's "Post a report" and the button are amber LED pills, like the
// day chart's readout and the picked spot, one look in both themes.
// - The button sits at the screen's bottom right above the safe area, under the full-screen map (z-index 100) and the view switch's
//   stamp (99), and only on the Forecast view (with the map up, #viewFc is hidden). It's pinned to the screen, not to the header, so a
//   header change never moves it. In 中文 and 日本語 its word takes the body font, as "Pick your day" does (VT323 has no CJK). It hides
//   under the room and the Coach panel (html.chat-open, html.coach-open): the rule that shows it is html:where(.tw.chat-on), so that
//   those two, after it, outrank it.
// - .thru lets touches through it while a finger drags the day picker or the day chart (see below).
// - html.tw.chat-on .wrap: in Taiwan, with the chat on, the page ends 84 px lower, so the button never covers the end of the credits.
// - .chatroom: the room covers everything, the full-screen map included, and the page behind it doesn't scroll. Its title, its ✕ and
//   the picked filter are in the page's LED amber (--led-amb, darker in the light theme); + Report is the strip's amber pill. When a sign-in
//   for the coach needs it, it opens over the Coach panel (z-index 110 too, and maybe later in the page), so with html.coach-open it's 111.
// - Nicknames and message text are isolated from the line around them, and break anywhere when they have to, so no message can push the
//   room sideways or turn the name and age around.
const CSS = `
#nowReports{display:grid;gap:9px;padding-top:16px;border-top:1px dashed var(--line)}
#nowReports .rp-hd{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
#nowReports .rp-post{flex:none;cursor:pointer;padding:5px 10px;border-radius:99px;border:1.5px solid #ffb347;background:#0a0f12;color:#ffb347;font:600 12.5px/1.2 var(--body);white-space:nowrap;text-shadow:0 0 6px rgba(255,140,0,.45)}
#nowReports .rp-row{display:flex;gap:9px;margin:0;padding:0;list-style:none;overflow-x:auto;scrollbar-width:none}
#nowReports .rp-row::-webkit-scrollbar{display:none}
#nowReports .rp-chip{flex:none;display:grid;gap:3px;padding:8px 12px 9px 11px;border:1px solid var(--line);border-radius:14px;white-space:nowrap}
#nowReports .rp-chip b{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:600;line-height:1.2}
#nowReports .rp-chip span{font-size:12.5px;line-height:1.2;color:var(--muted)}
#nowReports .rp-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--muted)}
#nowReports .rp-dot[data-cond="clean"]{background:var(--good)}
#nowReports .rp-dot[data-cond="ok"]{background:var(--fair)}
#nowReports .rp-dot[data-cond="choppy"],#nowReports .rp-dot[data-cond="blown"]{background:var(--bad)}
#nowReports .rp-none{margin:0;font-size:13px;color:var(--muted)}
.chatfab{position:fixed;right:calc(14px + env(safe-area-inset-right));bottom:calc(18px + env(safe-area-inset-bottom));z-index:90;display:none;align-items:center;gap:9px;height:46px;padding:0 18px 0 19px;border-radius:99px;border:1.5px solid #ffb347;background:#140e05;color:#ffb347;cursor:pointer;-webkit-tap-highlight-color:transparent;box-shadow:0 0 16px rgba(255,140,0,.4),0 6px 18px rgba(0,0,0,.45)}
html:where(.tw.chat-on) .chatfab{display:flex}
html.chat-open .chatfab{display:none}
html.coach-open .chatfab{display:none}
html:has(#viewFc[hidden]) .chatfab{display:none}
.chatfab.thru{pointer-events:none}
.chatfab b{font:400 26px/1 VT323,var(--mono);letter-spacing:.06em;text-shadow:0 0 8px rgba(255,140,0,.7)}
html:not([lang="en"]) .chatfab b{font:700 16px/1 var(--body);letter-spacing:.04em}
.chatfab-n{font:600 12.5px/1 var(--body);color:#fff3dc;white-space:nowrap}
.chatfab-dot{flex:none;width:9px;height:9px;border-radius:50%;background:#ff3d7f;box-shadow:0 0 8px #ff3d7f}
html.tw.chat-on .wrap{padding-bottom:calc(84px + env(safe-area-inset-bottom))}
html.chat-open,html.chat-open body{overflow:hidden}
.chatroom{position:fixed;inset:0;z-index:110;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:15px/1.45 var(--body);overscroll-behavior:contain;outline:none;-webkit-text-size-adjust:100%}
.chatroom[hidden],.chatroom [hidden]{display:none!important}
html.coach-open .chatroom{z-index:111}
.chatroom button{font-family:var(--body);-webkit-tap-highlight-color:transparent}
.chatroom>.cr-hd,.chatroom>.cr-filters,.chatroom>.cr-status,.chatroom>.cr-list,.chatroom>.cr-foot{width:100%;max-width:760px;margin-inline:auto}
.cr-hd{flex:none;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) 12px calc(16px + env(safe-area-inset-left));border-bottom:1px solid var(--line)}
.cr-title{margin:0;flex:none;font:400 31px/1 VT323,var(--mono);letter-spacing:.07em;color:var(--led-amb);text-shadow:0 0 calc(10px*var(--led-glow)) rgba(255,170,40,.65);white-space:nowrap}
/* The room's name over its online count, one per line, so the count still shows at 390 px beside the menu button. */
.cr-sub{flex:1;min-width:0;font-size:12.5px;line-height:1.25;color:var(--muted)}
.cr-sub span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cr-ic{flex:none;width:36px;height:36px;padding:0;display:grid;place-items:center;border-radius:50%;border:1.5px solid var(--line);background:none;color:var(--muted);font-size:16px;line-height:1;cursor:pointer}
.cr-x{border-color:var(--led-amb);color:var(--led-amb);font-weight:700}
.cr-filters{flex:none;display:flex;gap:8px;padding:10px 16px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--line)}
.cr-filters::-webkit-scrollbar{display:none}
.cr-filters button{flex:none;padding:4px 13px;border-radius:99px;border:1px solid var(--line);background:none;color:var(--muted);font-size:13px;font-weight:500;line-height:1.35;white-space:nowrap;cursor:pointer}
.cr-filters button[aria-pressed="true"]{border:1.5px solid var(--led-amb);padding:3.5px 12.5px;color:var(--led-amb)}
.cr-status{flex:none;padding:8px 16px;text-align:center;font-size:13.5px;background:var(--panel);border-bottom:1px solid var(--line)}
.cr-link{padding:0;border:0;background:none;color:var(--led-amb);font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.cr-list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;overflow-anchor:none;padding:0 16px 10px}
.cr-pin{position:sticky;top:0;z-index:1;margin:0 -16px 4px;padding:10px 16px 6px;background:var(--bg)}
.cr-pin p{margin:0;padding:9px 13px;border-radius:14px;background:var(--panel);font-size:13px;line-height:1.45;color:var(--muted)}
.cr-older{display:block;margin:4px auto 8px;padding:5px 14px;border-radius:99px;border:1px solid var(--line);background:none;color:var(--muted);font-size:12.5px;cursor:pointer}
.cr-empty{margin:28px 0;text-align:center;font-size:13.5px;color:var(--muted)}
.cm{padding:7px 0;min-width:0;-webkit-touch-callout:none}
.cm-hd{display:flex;align-items:baseline;gap:8px;min-width:0;direction:ltr}
.cm-nick{min-width:0;font-size:14px;font-weight:700;unicode-bidi:isolate;overflow-wrap:anywhere}
.cm-badge{flex:none;align-self:center;padding:1px 7px;border-radius:99px;background:#ffb347;color:#140e05;font-size:11px;font-weight:700;line-height:1.5;letter-spacing:.02em}
.cm-meta{flex:none;font-size:12px;color:var(--muted);white-space:nowrap;unicode-bidi:isolate}
.cm-more{flex:none;margin-left:auto;align-self:center;width:30px;height:24px;padding:0;border:0;border-radius:8px;background:none;color:var(--muted);font-size:17px;line-height:1;cursor:pointer}
.cm-more[aria-expanded="true"],.cm-more:hover{background:var(--panel)}
.cm-text{margin:2px 0 0;font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;unicode-bidi:isolate}
.cm-quote{margin:2px 0 0;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-quote b,.cm-quote span{unicode-bidi:isolate}
.cm-card{margin-top:5px;padding:10px 13px 11px;border:1px solid var(--line);border-radius:14px;background:var(--panel);min-width:0}
.cm-cap{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);overflow-wrap:anywhere}
.cm-big{margin-top:3px;font-size:16px;font-weight:600;line-height:1.3;overflow-wrap:anywhere;unicode-bidi:isolate}
.cm-big span{unicode-bidi:isolate}
.cm-sub{margin-top:4px;font-size:12.5px;line-height:1.4;color:var(--muted);overflow-wrap:anywhere}
.cm-foot{margin:2px 0 0;font-size:12.5px;color:var(--muted)}
.cm-why{margin:2px 0 0;font-size:12px;font-weight:600;color:var(--bad)}
.cm-hidden>:not(.cm-hd):not(.cm-why){opacity:.55}
.cr-foot{flex:none;padding:10px calc(16px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));border-top:1px solid var(--line);background:var(--bg)}
.cr-reply{display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:13px;color:var(--muted);min-width:0}
.cr-reply span:nth-child(2){flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:isolate}
.cr-reply .cr-ic{width:26px;height:26px;font-size:12px}
.cr-note{margin:0 0 8px;font-size:13px;line-height:1.4;color:var(--ink)}
.cr-note.err{color:var(--bad)}
.cr-bar{display:flex;align-items:center;gap:8px;min-width:0}
.cr-pill{flex:none;height:38px;padding:0 14px;border-radius:99px;border:1.5px solid var(--line);background:none;color:var(--ink);font-size:13.5px;font-weight:600;line-height:1;white-space:nowrap;cursor:pointer}
.cr-rep{border-color:#ffb347;background:#0a0f12;color:#ffb347;text-shadow:0 0 6px rgba(255,140,0,.45)}
.cr-send{border-color:var(--led-amb);color:var(--led-amb)}
.cr-in{flex:1;min-width:0;height:42px;padding:0 16px;border-radius:99px;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);font:15px var(--body);outline-offset:1px}
.cr-in::placeholder{color:var(--muted)}
.cr-line{flex:1;display:flex;align-items:center;height:46px;padding:0;border:0;border-radius:10px;background:#06C755;color:#fff;font-size:15px;font-weight:700;cursor:pointer}
.cr-line:hover{background:#05b34c}.cr-line:active{background:#048b3b}
.cr-line-ico{flex:none;width:30px;height:30px;margin:0 8px 0 10px}
.cr-line-sep{flex:none;align-self:stretch;width:1px;margin:8px 0;background:rgba(0,0,0,.12)}
.cr-line-w{flex:1;padding:0 12px;text-align:center}
.cr-pulse{animation:crpulse .9s 2}
@keyframes crpulse{50%{box-shadow:0 0 0 5px rgba(6,199,85,.35)}}
.cr-pop{position:fixed;z-index:5;min-width:184px;max-width:270px;padding:6px;border-radius:14px;border:1px solid var(--line);background:var(--panel);box-shadow:0 12px 32px rgba(0,0,0,.35)}
.cr-pop button{display:block;width:100%;padding:9px 12px;border:0;border-radius:9px;background:none;color:var(--ink);font-size:14.5px;font-weight:500;text-align:left;cursor:pointer}
.cr-pop button:hover,.cr-pop button:focus{background:var(--line);outline:none}
.cr-pop button:focus-visible{outline:2px solid var(--led-amb);outline-offset:-2px}
.cr-pop [aria-checked="true"]::after{content:"  ✓";color:var(--led-amb)}
.cr-pop .danger{color:var(--bad)}
.cr-shade{position:absolute;inset:0;z-index:4;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.5)}
.cr-sheet{width:100%;max-width:760px;max-height:88%;overflow-y:auto;overscroll-behavior:contain;padding:20px calc(16px + env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));border-radius:24px 24px 0 0;border:1px solid var(--line);border-bottom:0;background:var(--panel);outline:none}
.cr-sheet-hd{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.cr-sheet-hd h2{flex:1;margin:0;font:400 31px/1 VT323,var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--led-amb);text-shadow:0 0 calc(10px*var(--led-glow)) rgba(255,170,40,.65)}
html:not([lang="en"]) .cr-sheet-hd h2{font:700 21px/1.25 var(--body);letter-spacing:.02em}
.cr-sheet-b{font-size:14px;line-height:1.5}
.cr-sheet-b h3{margin:16px 0 4px;font-size:15px}
.cr-sheet-b h4{margin:10px 0 1px;font-size:13px;color:var(--muted);font-weight:600}
.cr-sheet-b p{margin:0 0 6px;overflow-wrap:anywhere}
.cr-sheet-b a{color:var(--sea)}
.cr-rules{margin:0;padding-left:20px}
.cr-lab{display:block;margin-bottom:6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.cr-field{width:100%;flex:none;background:var(--bg)}
.cr-err{margin:8px 0 0;color:var(--bad);font-size:13px}
.cr-go-row{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.cr-go{border:0;background:#ffb347;color:#140e05;padding:0 22px}
.cr-row{padding:10px 0;border-top:1px solid var(--line)}
.cr-row-1{display:flex;align-items:center;justify-content:space-between;gap:10px}
.cr-row-t{color:var(--muted)}
.cr-row .cr-go-row{margin-top:6px}
.cr-lead{color:var(--muted)}
.cr-lab-top{margin-top:16px}
.cr-opts{display:flex;flex-wrap:wrap;gap:8px}
.cr-opts+.cr-opts{margin-top:8px}
.cr-opt{padding:7px 15px;border-radius:99px;border:1.5px solid var(--line);background:none;color:var(--sea);font-size:14.5px;font-weight:600;line-height:1.3;cursor:pointer}
.cr-opt[aria-pressed="true"]{border-color:var(--led-amb);color:var(--led-amb);box-shadow:0 0 8px rgba(255,140,0,.25)}
.cr-times{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:10px}
.cr-times label{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.cr-time{height:38px;padding:0 10px;border-radius:12px;border:1.5px solid var(--line);background:var(--bg);color:var(--ink);font:15px var(--body)}
.cr-sheet-b .cr-auto{margin:12px 0 0;padding:10px 13px;border-radius:14px;background:var(--bg);font-size:13px;line-height:1.45;color:var(--muted)}
.cr-go:disabled{opacity:.45;cursor:default}
.cr-go-split{justify-content:space-between;align-items:center}
.cr-go-split>span{min-width:0;font-size:13px;color:var(--muted)}
.cr-switch{display:flex;align-items:center;gap:10px;min-width:0;font-size:14px}
.cr-switch input,.cr-tick input{flex:none;width:20px;height:20px;margin:0;accent-color:#ffb347}
.cr-tick{display:flex;gap:10px;align-items:flex-start;margin:14px 0 6px;font-size:13.5px;line-height:1.45}
.cr-tick input{margin-top:1px}
.cr-sheet-b .cr-fine{font-size:12.5px;color:var(--muted)}
.cr-more{margin:4px 0 8px;padding:2px 13px 8px;border-radius:14px;background:var(--bg)}
.cr-danger{background:var(--bad);color:#fff}
.cr-del{color:var(--bad)}
.cr-tag{margin-left:8px;padding:1px 8px;border-radius:99px;border:1px solid var(--led-amb);color:var(--led-amb);font-size:11px;font-weight:700;white-space:nowrap}
.cr-log-cap{font-weight:600}
.cr-sheet-b .cr-pin-code{margin:18px 0 6px;font:400 56px/1 VT323,var(--mono);letter-spacing:.2em;text-align:center;color:var(--led-amb);text-shadow:0 0 calc(10px*var(--led-glow)) rgba(255,170,40,.65)}
.cr-pinbox{margin:0 0 10px}
.cr-pin-in{letter-spacing:.2em}
.cr-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`;

// ---- The page's hooks (template.html). boot() calls spot() for each spot it shows, which is also on every language change and every
// return from the map, so the spot already shown is left alone; setLang() calls relang() to redraw in the new language, asking nothing.
window.CHAT = {
  spot: guard(id => { if (id === shown) return; shown = id; data = null; if (inTaiwan(id) && on()) ask(id); else asked++; draw(); }),
  relang: guard(() => { draw(); drawAll(); }),
  dev: guard(() => showChat()),
  // The coach's hooks (web/coach.js), which signs in through the chat: signIn("coach") is the Coach panel's Sign in with LINE, back to the
  // panel; token() is the session token or null, and token(old), for the token that just got a 401, signs out quietly and answers null.
  signIn: guard(then => { if (on()) login(then === "coach" ? then : null); }),
  token: guard(old => { refused(old); return load(KEYS.token); }),
};
if (TEST) Object.assign(window.CHAT, { _opened: TEST, _strings: STR, _snap: snapshot });

// While a finger drags the day picker, the day card or the day chart, the button lets touches through, so a drag that runs under it
// carries on.
const DRAG = "#days, #dayDet, .chart-box";
addEventListener("touchstart", guard(e => { if (e.target instanceof Element && e.target.closest(DRAG)) fab.classList.add("thru"); }), { passive: true, capture: true });
for (const t of ["touchend", "touchcancel"]) addEventListener(t, guard(e => { if (!e.touches.length) fab.classList.remove("thru"); }), { passive: true, capture: true });
// Coming back to the page asks again, at most once a minute (the backend lets the browser keep an answer that long anyway).
document.addEventListener("visibilitychange", guard(() => {
  if (document.visibilityState === "visible" && on() && shown && inTaiwan(shown) && Date.now() - askedAt >= 60e3) ask(shown); }));

// ---- Start-up. A sign-in back from LINE (?chat#c=<code>&p=<pin>, or ?chat#e=<error>), ?chat and ?chat=privacy (the credits' Privacy
// link) come out of the address at once, so the code never stays in it or in the history. boot() ran before this script loaded, so the
// spot already up is drawn here. Back from LINE, the page goes back to the spot it was on when it left; then the room opens. The credits'
// chat line (#chatCredits) shows while the chat is on for this visitor.
// While it's developer mode only, a sign-in back from LINE finds developer mode off (the page forgets the PIN when it's left for LINE), so
// the PIN box comes up first and the room opens once the PIN is in; cancelled, the sign-in is dropped. A plain ?chat link does nothing then.
const q = new URLSearchParams(location.search), f = new URLSearchParams(location.hash.slice(1));
const signin = f.has("e") ? { error: f.get("e") } : f.has("c") ? { code: f.get("c"), pin: f.get("p") } : null, opening = q.has("chat") || !!signin;
if (opening) { try { history.replaceState(null, "", location.pathname + "#" + CUR); } catch (e) { location.hash = CUR; } }
document.head.append(el("style", null, CSS));
document.body.append(fab);
const credits = document.getElementById("chatCredits");
let waiting = null; // a sign-in back from LINE, waiting for developer mode to come on
let wasOn = on();    // whether the chat was on for this visitor when last looked at; CHAT.spot() has already asked for the spot up
// Developer mode came on or went off (CHAT.dev), or start-up: the button, strip and credits line follow. Coming on, the strip asks for the
// spot shown and a sign-in waiting for developer mode goes on; going off, the room closes with its socket and an answer still on its way
// is dropped.
function showChat() {
  const now = on(), turned = now !== wasOn; wasOn = now;
  document.documentElement.classList.toggle("chat-on", now); if (credits) credits.hidden = !now;
  if (now) { if (turned && shown && inTaiwan(shown)) ask(shown); if (waiting) { const o = waiting; waiting = null; arrive(o); } }
  else if (turned) { closeRoom(); asked++; data = null; online = null; lastId = 0; }
  draw();
}
// The credits' Privacy link opens the note in place, not by loading the whole page again. One listener on the document, never on the
// link itself, since applyLang() writes the credits' HTML anew; a click meant for a new tab or window goes on as a link.
document.addEventListener("click", guard(e => { const a = e.target instanceof Element ? e.target.closest('a[href="?chat=privacy"]') : null;
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); enter({ privacy: true }); }));
if (signin) { const back = load(KEYS.ret, true); save(KEYS.ret, null, true); if (back && own(ALL.spots, back) && inTaiwan(back) && back !== CUR) switchSpot(back); }
window.CHAT.spot(CUR);
showChat();
if (opening && on()) arrive(signin ? { signin } : q.get("chat") === "privacy" ? { privacy: true } : {});
else if (signin && typeof setWorld === "function") {
  waiting = { signin };
  if (typeof worldLocked === "function" && worldLocked() && typeof wsPin === "function") wsPin(guard(() => setWorld(true)), guard(() => { waiting = null; }));
  else setWorld(true);
}

} catch (e) { try { console.warn("chat:", e); } catch (e2) {} } })();
