// The Taiwan chat on the page (docs/superpowers/specs/2026-10-21-taiwan-chat-design.md, "What you see" and "Front end"): the surfer
// reports on the "Right now" card, the floating CHAT button, and the way into the room. Taiwan only, one room for all of it, free, and
// people answer each other (Bryan, Oct 21).
// One classic script, loaded with defer after the page's own scripts. It declares no global names: it reads the page's ALL, LANG, CUR,
// VIEW, SPT, countrySpots, switchSpot and setView by bare name, and gives the page only window.CHAT = {spot, relang}, which template.html
// calls from boot() (a spot is shown) and setLang() (the language changed). It brings its own <style>, so its look ships with it.
// - It never throws into the page: each way in is wrapped, and while CHAT_URL or CONTACT is empty it does nothing at all, so the page
//   works exactly as it does without it.
// - Everything from the network goes in through textContent, setAttribute or a lookup in this file's own tables, never as HTML. No chat
//   element carries data-zh or data-ja (applyLang() rewrites those as HTML); relang() redraws in the new language instead.
(() => { "use strict"; try {

// Where the backend runs: https://waveslave-chat.<subdomain>.workers.dev, filled in by a small PR once Bryan's Cloudflare and LINE setup is
// done. Until then the chat shows nothing, so this can go live first (Bryan, Oct 21). Tests set window.__chatUrl.
const CHAT_URL = window.__chatUrl || "";
// Who runs the chat, for the privacy note, takedown requests and questions. Bryan sends the name and email; the chat stays switched off
// until both are here. Tests set window.__chatContact.
const CONTACT = window.__chatContact || { name: "", email: "" };
const PAGE = typeof ALL === "object" && !!ALL && typeof LANG === "string" && typeof CUR === "string" && typeof VIEW === "string" && typeof SPT === "function"
  && typeof countrySpots === "function" && typeof switchSpot === "function" && typeof setView === "function";
if (!CHAT_URL || !CONTACT || !CONTACT.name || !CONTACT.email || !PAGE) return;
const BASE = String(CHAT_URL).replace(/\/+$/, "");
// Tests only: window.__chatTest makes CHAT note each time the room is asked to open (CHAT._opened) and hand over the strings (CHAT._strings).
const TEST = window.__chatTest ? [] : null;

// What chat.js keeps on this device: the session token and the sign-in's verifier, the newest message seen (for the button's dot) and the
// room's filter; and, for the length of a sign-in, the spot to come back to (sessionStorage).
const KEYS = { token: "waveslave-chat-token", v: "waveslave-chat-v", seen: "waveslave-chat-seen", filter: "waveslave-chat-filter", ret: "waveslave-chat-return" };
// The report codes, as the backend checks them (chat/src/mod.js), in the order the form offers them.
const CODES = { size: ["flat", "knee", "waist", "chest", "head", "overhead"], cond: ["clean", "ok", "choppy", "blown"], crowd: ["empty", "few", "busy", "packed"] };

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
    msgDeleted: "Message deleted", replyingTo: nick => `replying to ${nick}`,
    surfReport: "Surf report", sessionLog: "Session log", forecastSaid: (fc, buoy, at) => `Forecast said ${fc} · buoy ${buoy} at ${at}`,
    conditionsThen: "Conditions then", noConditions: "No conditions recorded",
    report: "+ Report", log: "📓 Log", say: "Say something…", send: "Send",
    lineLogin: "Log in with LINE",
    // First sign-in
    welcome: "Welcome to the Taiwan chat", nickname: "Nickname", join: "Join",
    consent: "I'm 13 or older (under 18 with a parent's or guardian's OK), and I accept the house rules and the privacy note.",
    publicNote: "Your nickname, spot and time are public on reports and shared sessions.",
    // The message menu and the main menu
    reply: "Reply", like: "👍", flag: "Report", del: "Delete", ban: "Ban", restore: "Restore", keep: "Keep as evidence",
    reasons: { spam: "Spam or ads", harass: "Harassment", sexual: "Sexual content", child: "Child safety", other: "Something else" },
    menu: "Menu", mySessions: "My sessions", changeNick: "Change nickname (once a week)", download: "Download my data",
    signOutAll: "Sign out everywhere", deleteAccount: "Delete my account", lockRoom: "Lock the room", unlockRoom: "Unlock the room",
    hiddenMsgs: n => `Hidden messages (${n})`, unban: "Unban",
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
    banned: "This LINE account can't post here", slowDown: s => `Slow down a little · try again in ${s} s`, reloadNew: "Reload for the new chat",
    locked: "The room is locked. You can still read.",
    pinShown: code => `Signed in with LINE. Go back to the WaveSlave app and enter this code: ${code}`, pinBox: "Enter the code from the LINE sign-in",
    // The privacy note (Taiwan's Personal Data Protection Act, Article 8): short at first sign-in, in full behind More.
    privacyHead: "Privacy note", contactHead: "Contact",
    privacyShort: "To post, the chat keeps your nickname, a one-way code made from your LINE ID and what you post. Cloudflare stores it outside Taiwan, and LINE (LY Corp) handles sign-in. Posts are public. The full privacy note is under More.",
    privacy: c => [
      ["Who runs the chat", `${c.name} runs the Taiwan chat on WaveSlave. Questions and takedown requests: ${c.email}.`],
      ["Why", "Your data is used only to run the chat."],
      ["What is kept", "Your nickname, a one-way code made from your LINE ID (never the ID itself), your messages, reports and session logs. Cloudflare also sees your IP address when you connect."],
      ["Where, and who handles it", "Cloudflare stores the chat on servers outside Taiwan. LINE (LY Corp) handles sign-in. Messages, reports and shared sessions are public, under your nickname."],
      ["How long", "Room messages and shared sessions: 30 days. Reports: 1 year, with your nickname taken off after 30 days. Private session logs: until you delete them, or after 2 years without signing in. Cloudflare keeps recovery copies for up to 30 days, and anything hidden for child safety is kept for 180 days."],
      ["Your rights", `"Download my data" and "Delete my account" are in the chat's menu at any time, or write to ${c.email}.`],
      ["If you don't sign in", "You can still read everything. Signing in is only for posting."]],
  },
  zh: {
    reportsHead: "浪友回報 · 4 小時內", postReport: "＋ 回報浪況", noReports: "4 小時內還沒有回報",
    justNow: "剛剛", minAgo: n => `${n} 分鐘前`, hAgo: n => `${n} 小時前`,
    chat: "聊天", online: n => `${n} 人在線`, openChat: "打開台灣浪友聊天室", newMsgs: "有新訊息",
    roomTitle: "TAIWAN CHAT", roomName: "台灣浪友", close: "關閉", all: "全部", more: "更多", badge: "WaveSlave", aSurfer: "一位浪友",
    rulesHead: "版規",
    rules: ["友善待人，互相幫忙，一起衝得更好。", "禁止廣告或推銷。", "禁止留 LINE ID、電話號碼或連結。",
      "禁止公開他人的車牌、地址或個人資料。", "年滿 13 歲才能使用；未滿 18 歲須經父母或監護人同意。"],
    msgDeleted: "訊息已刪除", replyingTo: nick => `回覆 ${nick}`,
    surfReport: "浪況回報", sessionLog: "衝浪日誌", forecastSaid: (fc, buoy, at) => `預報 ${fc} · 浮標 ${buoy}（${at}）`,
    conditionsThen: "當時海況", noConditions: "沒有記錄到海況",
    report: "＋ 回報", log: "📓 日誌", say: "說點什麼…", send: "送出",
    lineLogin: "使用LINE帳號登入",
    welcome: "歡迎來到台灣浪友聊天室", nickname: "暱稱", join: "加入",
    consent: "我已年滿 13 歲（未滿 18 歲已取得父母或監護人同意），並接受版規與隱私權說明。",
    publicNote: "你的暱稱、浪點與時間會公開顯示在回報與分享的日誌上。",
    reply: "回覆", like: "👍", flag: "檢舉", del: "刪除", ban: "停權", restore: "恢復", keep: "保留為證據",
    reasons: { spam: "垃圾訊息或廣告", harass: "騷擾", sexual: "色情內容", child: "危害兒少", other: "其他" },
    menu: "選單", mySessions: "我的日誌", changeNick: "更改暱稱（每週一次）", download: "下載我的資料",
    signOutAll: "登出所有裝置", deleteAccount: "刪除我的帳號", lockRoom: "鎖定聊天室", unlockRoom: "解除鎖定",
    hiddenMsgs: n => `被隱藏的訊息（${n}）`, unban: "解除停權",
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
    banned: "這個 LINE 帳號無法在這裡發言", slowDown: s => `慢一點 · ${s} 秒後再試`, reloadNew: "請重新整理以使用新版聊天室",
    locked: "聊天室已鎖定，仍可閱讀。",
    pinShown: code => `已使用 LINE 登入。請回到 WaveSlave App，輸入這組代碼：${code}`, pinBox: "輸入 LINE 登入後顯示的代碼",
    privacyHead: "隱私權說明", contactHead: "聯絡我們",
    privacyShort: "要發言，聊天室會保存你的暱稱、由 LINE ID 單向產生的代碼，以及你發表的內容。資料由 Cloudflare 存放在台灣以外的伺服器，登入由 LINE（LY Corp）處理。發言內容是公開的。完整的隱私權說明在「更多」裡。",
    privacy: c => [
      ["誰在營運", `WaveSlave 的台灣浪友聊天室由 ${c.name} 營運。有問題或要求下架內容，請寫信到 ${c.email}。`],
      ["蒐集目的", "你的資料只用於營運聊天室。"],
      ["保存哪些資料", "你的暱稱、由 LINE ID 單向產生的代碼（不會保存 ID 本身），以及你的訊息、回報與衝浪日誌。你連線時，Cloudflare 也會看到你的 IP 位址。"],
      ["存放地點與經手者", "聊天室的資料由 Cloudflare 存放在台灣以外的伺服器；登入由 LINE（LY Corp）處理。訊息、回報與分享的日誌會以你的暱稱公開。"],
      ["保存多久", "聊天室訊息與分享的日誌：30 天。回報：1 年，30 天後移除你的暱稱。私人日誌：保留到你刪除為止，或 2 年未登入後刪除。Cloudflare 的復原備份最多保留 30 天；因兒少安全而隱藏的內容保留 180 天。"],
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
    msgDeleted: "メッセージは削除されました", replyingTo: nick => `${nick}への返信`,
    surfReport: "波情報", sessionLog: "セッション記録", forecastSaid: (fc, buoy, at) => `予報 ${fc} · ブイ ${buoy}（${at}）`,
    conditionsThen: "当時のコンディション", noConditions: "コンディションの記録なし",
    report: "＋ 報告", log: "📓 記録", say: "メッセージを入力…", send: "送信",
    lineLogin: "LINEでログイン",
    welcome: "台湾チャットへようこそ", nickname: "ニックネーム", join: "参加する",
    consent: "13歳以上です（18歳未満の場合は保護者の同意を得ています）。ルールとプライバシーについてに同意します。",
    publicNote: "ニックネーム・ポイント・時間は、報告と共有したセッションで公開されます。",
    reply: "返信", like: "👍", flag: "通報", del: "削除", ban: "利用停止", restore: "復元", keep: "証拠として保存",
    reasons: { spam: "スパム・広告", harass: "嫌がらせ", sexual: "性的な内容", child: "子どもの安全", other: "その他" },
    menu: "メニュー", mySessions: "マイセッション", changeNick: "ニックネーム変更（週1回）", download: "データをダウンロード",
    signOutAll: "すべての端末でログアウト", deleteAccount: "アカウントを削除", lockRoom: "ルームをロック", unlockRoom: "ロックを解除",
    hiddenMsgs: n => `非表示のメッセージ（${n}）`, unban: "利用停止を解除",
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
    banned: "このLINEアカウントでは投稿できません", slowDown: s => `少しペースを落としてください · ${s}秒後に再試行`, reloadNew: "新しいチャットを使うには再読み込みしてください",
    locked: "ルームはロック中です。閲覧はできます。",
    pinShown: code => `LINEでログインしました。WaveSlaveアプリに戻って、このコードを入力してください：${code}`, pinBox: "LINEログイン後に表示されたコードを入力",
    privacyHead: "プライバシーについて", contactHead: "お問い合わせ",
    privacyShort: "投稿するには、ニックネーム、LINE IDから一方向に作ったコード、投稿内容をチャットに保存します。データはCloudflareが台湾国外に保存し、ログインはLINE（LY Corp）が扱います。投稿は公開されます。プライバシーについての全文は「詳しく」にあります。",
    privacy: c => [
      ["運営者", `WaveSlaveの台湾チャットは${c.name}が運営しています。お問い合わせ・削除のご依頼は ${c.email} まで。`],
      ["利用目的", "データはチャットの運営のためだけに使います。"],
      ["保存する情報", "ニックネーム、LINE IDから一方向に作ったコード（ID自体は保存しません）、メッセージ、報告、セッション記録。接続時にはCloudflareがIPアドレスを受け取ります。"],
      ["保存場所と取り扱う事業者", "チャットのデータはCloudflareが台湾国外のサーバーに保存します。ログインはLINE（LY Corp）が扱います。メッセージ・報告・共有したセッションはニックネームとともに公開されます。"],
      ["保存期間", "ルームのメッセージと共有したセッション：30日。報告：1年（30日後にニックネームを外します）。非公開のセッション記録：削除するまで、または2年間ログインがないと削除。Cloudflareの復旧用コピーは最長30日、子どもの安全のため非表示にした内容は180日保存されます。"],
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

// Runs f and keeps any error inside the chat: the page carries on whatever happens here.
const guard = f => (...a) => { try { return f(...a); } catch (e) { console.warn("chat:", e); } };
// localStorage and sessionStorage can be missing or throw (a private window, blocked storage), so each read and write is wrapped.
function load(key, session) { try { return (session ? sessionStorage : localStorage).getItem(key); } catch (e) { return null; } }
function save(key, value, session) { try { const s = session ? sessionStorage : localStorage; if (value == null) s.removeItem(key); else s.setItem(key, String(value)); } catch (e) {} }
// A new element: attributes go in with setAttribute, children as nodes or as text (append makes a text node of a string), never as HTML.
function el(tag, attrs, ...kids) { const e = document.createElement(tag);
  for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  for (const c of kids) if (c != null) e.append(c);
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
const inTaiwan = id => countrySpots("tw").includes(id);
const count = v => typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
const isReport = r => !!r && Number.isFinite(r.ts) && CODES.size.includes(r.size) && CODES.cond.includes(r.cond) && CODES.crowd.includes(r.crowd);
const seen = () => count(+load(KEYS.seen)) || 0;
// "40 min ago", "2 h ago".
function ago(ts) { const m = Math.max(0, Math.floor((Date.now() - ts)/60e3)); return m < 1 ? S("justNow") : m < 60 ? S("minAgo", m) : S("hAgo", Math.floor(m/60)); }

function ask(id) { const n = ++asked; askedAt = Date.now();
  api("/reports?spot=" + encodeURIComponent(id)).then(j => {
    if (n !== asked) return;
    if (!j || !Array.isArray(j.reports)) throw new Error("chat: no reports in the answer");
    data = { spot: id, reports: j.reports.filter(isReport) }; online = count(j.online); lastId = count(j.last_id) || 0; draw();
  }).catch(guard(() => { if (n !== asked) return; data = null; online = null; lastId = 0; draw(); })); }

// The report strip, the last child of the "Right now" card (#nowReports in template.html): up to 3 chips for the spot, each a dot
// coloured by conditions (Clean green, OK amber, Choppy or Blown out red), size and conditions, then crowd and age. With none, the
// button and "No reports in the last 4 h". It stays hidden away from Taiwan, while asking, and when the backend can't be reached.
function drawStrip() {
  const s = document.getElementById("nowReports"); if (!s) return;
  const d = data && data.spot === shown && inTaiwan(shown) ? data : null;
  s.hidden = !d; s.textContent = ""; if (!d) return;
  const post = el("button", { type: "button", class: "rp-post" }, S("postReport"));
  post.addEventListener("click", guard(() => enter({ sheet: "report", spot: shown })));
  const chips = d.reports.slice(0, 3).map(r => el("li", { class: "rp-chip" },
    el("b", null, el("i", { class: "rp-dot", "data-cond": r.cond, "aria-hidden": "true" }), `${L("size", r.size)} · ${L("cond", r.cond)}`),
    el("span", null, `${L("crowdChip", r.crowd)} · ${ago(r.ts)}`)));
  s.append(el("div", { class: "rp-hd" }, el("span", { class: "label" }, S("reportsHead")), post),
    chips.length ? el("ul", { class: "rp-row" }, ...chips) : el("p", { class: "rp-none" }, S("noReports")));
}

// The CHAT button: CHAT, how many are online, and a pink dot while there's a message newer than the last one seen. The CSS shows it in
// Taiwan (html.tw, set by boot()) on the Forecast view only.
const dot = el("i", { class: "chatfab-dot", "aria-hidden": "true" }), word = el("b"), num = el("span", { class: "chatfab-n" });
const fab = el("button", { type: "button", class: "chatfab" }, dot, word, num);
fab.addEventListener("click", guard(() => enter({})));
function drawFab() { const lit = lastId > seen(), n = online == null ? null : S("online", online);
  word.textContent = S("chat"); num.textContent = n || ""; num.hidden = !n; dot.hidden = !lit;
  fab.setAttribute("aria-label", [S("openChat"), n, lit ? S("newMsgs") : null].filter(Boolean).join(" · ")); }

const draw = guard(() => { drawStrip(); drawFab(); });

// ---- The room: full screen above everything, the full-screen map included. o.sheet ("report" or "log") opens that form over it, preset
// to o.spot; o.signin is a sign-in back from LINE ({code, pin} or {error}) to finish. It isn't built yet, so nothing opens.
function openRoom(o) {}
// Every way into the room: the CHAT button, "Post a report" and a ?chat link. A link can land on the Map view; the room opens over the
// Forecast view, so closing it shows the forecast.
function enter(o) {
  if (VIEW !== "fc") setView("fc", true);
  if (TEST) TEST.push({ ...o, view: VIEW, forecast: !document.getElementById("viewFc").hidden });
  openRoom(o);
}

// ---- The look (mockups 1 and 2), in the page's own colours. The strip's "Post a report" and the button are amber LED pills, like the
// day chart's readout and the picked spot, one look in both themes.
// - The button sits at the screen's bottom right above the safe area, under the full-screen map (z-index 100) and the view switch's
//   stamp (99), and only on the Forecast view (with the map up, #viewFc is hidden). It's pinned to the screen, not to the header, so a
//   header change never moves it. In 中文 and 日本語 its word takes the body font, as "Pick your day" does (VT323 has no CJK).
// - .thru lets touches through it while a finger drags the day picker or the day chart (see below).
// - html.tw .wrap: in Taiwan the page ends 84 px lower, so the button never covers the end of the credits.
// - .chatroom: the room covers everything, the full-screen map included.
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
html.tw .chatfab{display:flex}
html.chat-open .chatfab{display:none}
html:has(#viewFc[hidden]) .chatfab{display:none}
.chatfab.thru{pointer-events:none}
.chatfab b{font:400 26px/1 VT323,var(--mono);letter-spacing:.06em;text-shadow:0 0 8px rgba(255,140,0,.7)}
html:not([lang="en"]) .chatfab b{font:700 16px/1 var(--body);letter-spacing:.04em}
.chatfab-n{font:600 12.5px/1 var(--body);color:#fff3dc;white-space:nowrap}
.chatfab-dot{flex:none;width:9px;height:9px;border-radius:50%;background:#ff3d7f;box-shadow:0 0 8px #ff3d7f}
html.tw .wrap{padding-bottom:calc(84px + env(safe-area-inset-bottom))}
.chatroom{position:fixed;inset:0;z-index:110}
`;

// ---- The page's hooks (template.html). boot() calls spot() for each spot it shows, which is also on every language change and every
// return from the map, so the spot already shown is left alone; setLang() calls relang() to redraw in the new language, asking nothing.
window.CHAT = {
  spot: guard(id => { if (id === shown) return; shown = id; data = null; if (inTaiwan(id)) ask(id); else asked++; draw(); }),
  relang: guard(() => draw()),
};
if (TEST) Object.assign(window.CHAT, { _opened: TEST, _strings: STR });

// While a finger drags the day picker, the day card or the day chart, the button lets touches through, so a drag that runs under it
// carries on.
const DRAG = "#days, #dayDet, .chart-box";
addEventListener("touchstart", guard(e => { if (e.target instanceof Element && e.target.closest(DRAG)) fab.classList.add("thru"); }), { passive: true, capture: true });
for (const t of ["touchend", "touchcancel"]) addEventListener(t, guard(e => { if (!e.touches.length) fab.classList.remove("thru"); }), { passive: true, capture: true });
// Coming back to the page asks again, at most once a minute (the backend lets the browser keep an answer that long anyway).
document.addEventListener("visibilitychange", guard(() => {
  if (document.visibilityState === "visible" && shown && inTaiwan(shown) && Date.now() - askedAt >= 60e3) ask(shown); }));

// ---- Start-up. A sign-in back from LINE (?chat#c=<code>&p=<pin>, or ?chat#e=<error>) and ?chat come out of the address at once, so the
// code never stays in it or in the history. boot() ran before this script loaded, so the spot already up is drawn here. Back from LINE,
// the page goes back to the spot it was on when it left; then the room opens.
const q = new URLSearchParams(location.search), f = new URLSearchParams(location.hash.slice(1));
const signin = f.has("e") ? { error: f.get("e") } : f.has("c") ? { code: f.get("c"), pin: f.get("p") } : null, opening = q.has("chat") || !!signin;
if (opening) { try { history.replaceState(null, "", location.pathname + "#" + CUR); } catch (e) { location.hash = CUR; } }
document.head.append(el("style", null, CSS));
document.body.append(fab);
if (signin) { const back = load(KEYS.ret, true); save(KEYS.ret, null, true); if (back && ALL.spots[back] && back !== CUR) switchSpot(back); }
window.CHAT.spot(CUR);
if (opening) enter(signin ? { signin } : {});

} catch (e) { try { console.warn("chat:", e); } catch (e2) {} } })();
