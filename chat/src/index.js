// The front Worker of the Taiwan chat (spec "Backend: chat/", "CORS and origin" and "Routes"). It holds no state. It
// checks where a request comes from, adds the CORS headers, and passes the request on to the room, the Durable
// Object that holds everything. When the room can't answer, the chat is "resting": 503 {"resting": true}. The rest
// of the site carries on either way.
//
// What the app calls, and what the room is asked for it (as https://room/<path>, with the same method and body):
//
//   GET  /reports?spot=<id>   ->  /r/reports?spot=<id>
//   GET  /ws                  ->  /r/ws
//   POST /auth/redeem         ->  /r/redeem
//   POST /auth/signup         ->  /r/signup
//   GET, POST /me/sessions; DELETE /me/sessions/<id>; POST /me/signout; GET /me/export; DELETE /me
//                             ->  the same path under /r (the Authorization header goes through)
//   GET  /admin/where         ->  /r/where (the room asks the coach for its line too)
//
// The AI coach's routes (AI coach spec, "Routes") go to the coach, over RPC rather than as requests (coachRoute()):
//
//   GET /coach/me; POST /coach/agree; POST /coach/reviews; GET, DELETE /coach/reviews/<id>;
//   GET, POST /coach/reviews/<id>/frames/<n>; POST /coach/reviews/<id>/send; POST /coach/reviews/<id>/report;
//   GET /admin/coach/drafts; POST /admin/coach/drafts/<id>; POST /admin/coach/settings
//                             ->  Coach.route({method, path, who, body}), once the room's whoIs has said who is calling
//
// /reports is open to every page. The rest answer only our own pages, and /auth/..., /me/..., /admin/... and
// /coach/... are never cached.
//
// The LINE sign-in (spec "Login (LINE, web flow)", steps 2 and 3) is two page navigations, and the Worker runs it:
//
//   GET  /auth/line/start?h=<SHA-256(v)>   the room stores the sign-in (/r/logins), then the browser goes to LINE
//   GET  /auth/line/callback               LINE sends the browser back here. The room hands over the sign-in
//                                          (/r/logins/take), the Worker swaps LINE's code for an ID token and checks
//                                          it, and the room stores the handoff (/r/handoffs).
//
// Both always send the browser on: to LINE, or back to APP_URL?chat with the outcome in the fragment, either
// #c=<code>&p=<pin> or #e=<what went wrong>: LINE's own error code (access_denied, say), "line" for one that doesn't
// look like a code, "start" (a bad h), "state" (an unknown, used or stale sign-in), "token" (LINE's answer didn't
// check out), "banned", or "resting" (the room couldn't answer, or is resting near the free plan's daily limits).
export { Room } from "./room.js";
// The AI coach's Durable Object (AI coach spec, "Backend"), bound as COACH in wrangler.toml.
export { Coach } from "./coach.js";
import { verifyLineIdToken } from "./auth.js";
import { FRAME_TEXT_MAX } from "./coach-rules.js";
import { SPOTS } from "./mod.js";
// One room for all of Taiwan (Bryan, Oct 21), and one coach. Every route reaches them through room(env) and coach(env),
// with their location hint.
import { coach, room } from "./stubs.js";

// How a route treats the page that calls it:
//   open     anyone may read the answer, from any page (CORS "*"), and the browser may keep it for a minute
//   socket   the WebSocket. Only our own pages may open it, because a socket is not covered by CORS
//   private  only our own pages (the origins in ALLOWED_ORIGINS) may call it, and the answer is never cached
//   login    a page navigation in the LINE sign-in, run by the Worker itself (`run`): it needs no Origin (a navigation
//            sends none), takes no CORS headers and is never cached
// Without `to`, the room path is "/r" plus the public path. A route with `coach: true` goes to the coach instead
// (coachRoute()).
//
// A review id is 22 characters of base64url, and a key frame is numbered 1 to 12.
const ID = "[A-Za-z0-9_-]{22}";
const N = "(?:[1-9]|1[0-2])";
const exact = (pattern) => new RegExp(`^${pattern}$`);
const FRAME_PATH = exact(`/coach/reviews/${ID}/frames/${N}`);
const DRAFT_PATH = exact(`/admin/coach/drafts/${ID}`);

const ROUTES = [
  { path: "/reports", methods: ["GET"], kind: "open", to: "/r/reports" },
  { path: "/ws", methods: ["GET"], kind: "socket", to: "/r/ws" },
  { path: "/auth/line/start", methods: ["GET"], kind: "login", run: lineStart },
  { path: "/auth/line/callback", methods: ["GET"], kind: "login", run: lineCallback },
  { path: "/auth/redeem", methods: ["POST"], kind: "private", to: "/r/redeem" },
  { path: "/auth/signup", methods: ["POST"], kind: "private", to: "/r/signup" },
  { path: "/me/sessions", methods: ["GET", "POST"], kind: "private" },
  { path: /^\/me\/sessions\/[^/]+$/, methods: ["DELETE"], kind: "private" },
  { path: "/me/signout", methods: ["POST"], kind: "private" },
  { path: "/me/export", methods: ["GET"], kind: "private" },
  { path: "/me", methods: ["DELETE"], kind: "private" },
  { path: "/admin/where", methods: ["GET"], kind: "private", to: "/r/where" },
  { path: "/coach/me", methods: ["GET"], kind: "private", coach: true },
  { path: "/coach/agree", methods: ["POST"], kind: "private", coach: true },
  { path: "/coach/reviews", methods: ["POST"], kind: "private", coach: true },
  { path: exact(`/coach/reviews/${ID}`), methods: ["GET", "DELETE"], kind: "private", coach: true },
  { path: FRAME_PATH, methods: ["GET", "POST"], kind: "private", coach: true },
  { path: exact(`/coach/reviews/${ID}/send`), methods: ["POST"], kind: "private", coach: true },
  { path: exact(`/coach/reviews/${ID}/report`), methods: ["POST"], kind: "private", coach: true },
  { path: "/admin/coach/drafts", methods: ["GET"], kind: "private", coach: true },
  { path: DRAFT_PATH, methods: ["POST"], kind: "private", coach: true },
  { path: "/admin/coach/settings", methods: ["POST"], kind: "private", coach: true },
];

const PREFLIGHT = {
  "Access-Control-Allow-Methods": "GET, POST, DELETE",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "7200",
};

// Everything under these paths holds a sign-in or somebody's own data, so no answer there is ever cached, whatever
// it is (an unknown path included).
const NEVER_CACHED = /^\/(auth|me|admin|coach)(\/|$)/;

const allowedOrigins = (env) =>
  String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const routeFor = (pathname) =>
  ROUTES.find((r) => (r.path instanceof RegExp ? r.path.test(pathname) : r.path === pathname)) ?? null;

const refused = () => Response.json({ error: "origin" }, { status: 403 });
const resting = () => Response.json({ resting: true }, { status: 503 });

function notAllowed(route) {
  const allow = route.kind === "private" ? [...route.methods, "OPTIONS"] : route.methods;
  return Response.json({ error: "method" }, { status: 405, headers: { Allow: allow.join(", ") } });
}

// Asks the room with the request build() makes, and answers null when it can't: the room is down, overloaded, or
// threw. The caller then says the chat is resting. Only the error's name is logged. Its message could hold part of the
// request (a login code, say).
async function askRoom(env, build) {
  try {
    return await room(env).fetch(build());
  } catch (err) {
    console.error("chat: the room failed:", err?.name ?? "error");
    return null;
  }
}

// The app's request as the room gets it, at `target`. A WebSocket upgrade keeps all its headers: the handshake needs
// them, and the room reads the visitor's address from CF-Connecting-IP. Everything else passes on only the two headers
// the room reads.
function forward(request, target, wholeRequest) {
  if (wholeRequest) return new Request(target, request);
  const headers = new Headers();
  for (const name of ["Authorization", "Content-Type"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(target, { method: request.method, headers, body: request.body });
}

// A JSON POST from the Worker itself to the room, for the sign-in steps: {status, data}, or null when the room can't
// answer, or answers {resting: true} (it rests near the free plan's daily limits). Either way the browser goes back
// to the app with #e=resting.
async function roomJson(env, path, payload) {
  const answer = await askRoom(env, () =>
    new Request(`https://room${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  if (!answer) return null;
  const data = (await answer.json().catch(() => null)) ?? {};
  return data.resting === true ? null : { status: answer.status, data };
}

// The answer to a request, before the CORS and cache headers (finish() adds those).
async function handle(route, request, env, url, from) {
  if (route.kind === "private") {
    // A page on another site gets nothing, and the room never hears of it. Refusing only to send it the CORS
    // headers would not be enough: a POST with a plain-text body needs no preflight, so the browser sends it, and
    // the room would act on it. A request with no Origin is not from a page (curl, say) and carries on.
    if (from.origin !== null && !from.ok) return refused();
    if (request.method === "OPTIONS") return from.ok ? new Response(null, { status: 204, headers: PREFLIGHT }) : refused();
  }
  if (route.kind === "socket" && !from.ok) return refused();
  if (!route.methods.includes(request.method)) return notAllowed(route);
  if (route.kind === "socket" && request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "upgrade" }, { status: 426 });
  }
  if (route.kind === "login") return route.run(env, url);
  if (route.coach) return coachRoute(request, env, url);

  let search = url.search;
  if (route.kind === "open") {
    // The spot is checked here first, so a bad one costs the room nothing.
    const spot = url.searchParams.get("spot");
    if (!SPOTS.includes(spot)) return Response.json({ error: "spot" }, { status: 400 });
    search = `?spot=${spot}`;
  }
  const target = `https://room${route.to ?? `/r${url.pathname}`}${search}`;
  const answer = await askRoom(env, () => forward(request, target, route.kind === "socket"));
  return answer ?? resting();
}

// ---- The coach -----------------------------------------------------------------------------------------------

// The most a request body may be, in bytes: a key frame's text (FRAME_TEXT_MAX); Bryan's action on a draft, whose
// edits are up to nine fields of 1,000 characters (as 中文, 27 KB in UTF-8, or 54 KB written as \u escapes); and
// everything else.
const DRAFT_BODY_MAX = 65_536;
const BODY_MAX = 16_384;

function bodyMax(pathname) {
  if (FRAME_PATH.test(pathname)) return FRAME_TEXT_MAX;
  if (DRAFT_PATH.test(pathname)) return DRAFT_BODY_MAX;
  return BODY_MAX;
}

// The token in an "Authorization: Bearer <token>" header, or null, read as the room reads it.
const bearer = (request) => /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;

const coachRefuses = (status, error) => Response.json({ error }, { status });

// The answer to a whoIs refusal: "auth" (no such sign-in, or signed out), "banned", or "resting" (the chat rests near
// the free plan's daily limits), which the coach shows as taking a break, as it does anything else the room might say.
function whoRefused(error) {
  if (error === "auth") return coachRefuses(401, "auth");
  if (error === "banned") return coachRefuses(403, "banned");
  return coachRefuses(503, "break");
}

// The request body as text, or null once it passes `max` bytes. It counts the bytes as they come, whatever
// Content-Length says, and stops reading at the first byte too many, so a body over the cap never reaches the coach.
async function readBody(request, max) {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

// A /coach/... or /admin/coach/... request, once handle() has checked its origin and method. The room's whoIs says who
// the token stands for, and only that, {uid, sub_hash, role}, goes to the coach (ruling R2): never the token, and never
// anything the surfer says about who they are. The admin paths need Bryan's account, and the coach checks again.
// The body goes on as text, capped in size but never parsed: a key frame would cost the Worker more CPU than the free
// plan gives a request. The coach answers {status, json}, or {status, jpeg} for a key frame.
//
// The room or the coach failing (down, overloaded, a throw) is 503 {error: "break"}, the coach "taking a break". Only
// the error's name is logged: its message could hold part of the request.
async function coachRoute(request, env, url) {
  const token = bearer(request);
  if (!token) return coachRefuses(401, "auth");
  let step = "the room's whoIs";
  try {
    const answer = await room(env).whoIs(token);
    if (answer?.error) return whoRefused(answer.error);
    const who = { uid: answer.uid, sub_hash: answer.sub_hash, role: answer.role };
    if (url.pathname.startsWith("/admin/coach/") && who.role !== "admin") return coachRefuses(403, "admin");
    step = "reading the body";
    const body = await readBody(request, bodyMax(url.pathname));
    if (body === null) return coachRefuses(413, "too_big");
    step = "the coach";
    const reply = await coach(env).route({ method: request.method, path: url.pathname, who, body });
    if (reply.jpeg instanceof Uint8Array) {
      return new Response(reply.jpeg, { status: reply.status, headers: { "Content-Type": "image/jpeg" } });
    }
    return Response.json(reply.json, { status: reply.status });
  } catch (err) {
    console.error(`coach: ${step} failed:`, err?.name ?? "error");
    return coachRefuses(503, "break");
  }
}

// ---- LINE sign-in --------------------------------------------------------------------------------------------

// h is the app's SHA-256(v) in base64url: 43 characters.
const H = /^[A-Za-z0-9_-]{43}$/;

// A redirect for the sign-in routes. No referrer goes with it, so neither LINE nor the page learns the address the
// browser came from (the callback's holds LINE's code).
const redirect = (to) => new Response(null, { status: 302, headers: { Location: to, "Referrer-Policy": "no-referrer" } });

// Back to the app, always APP_URL, with ?chat so the chat opens, and the outcome in the fragment, which the browser
// never sends to a server. chat.js reads it and removes it at once.
function backToApp(env, fragment) {
  const to = new URL(env.APP_URL);
  to.search = "chat";
  to.hash = fragment;
  return redirect(to.href);
}

// LINE's own error code goes back as it is when it looks like one, and as "line" when it doesn't.
const lineError = (code) => (/^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : "line");

// The callback address registered with LINE: this Worker's own /auth/line/callback.
const callbackUrl = (url) => `${url.origin}/auth/line/callback`;

// Step 2. The browser goes on to LINE_AUTH_URL with exactly the spec's parameters. Each value is percent-encoded, so
// the space in the scope is %20, as LINE's own examples write it.
async function lineStart(env, url) {
  const h = url.searchParams.get("h") ?? "";
  if (!H.test(h)) return backToApp(env, "e=start");
  const started = await roomJson(env, "/r/logins", { h });
  if (!started) return backToApp(env, "e=resting");
  if (started.status !== 200) return backToApp(env, "e=start");
  const query = {
    response_type: "code",
    client_id: env.LINE_CHANNEL_ID,
    redirect_uri: callbackUrl(url),
    state: started.data.state,
    scope: "openid profile",
    nonce: started.data.nonce,
    code_challenge: started.data.code_challenge,
    code_challenge_method: "S256",
  };
  const encoded = Object.entries(query).map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return redirect(`${env.LINE_AUTH_URL}?${encoded.join("&")}`);
}

// Step 3. LINE sends the browser back with ?code=&state= on success, or ?error= when the person cancelled or LINE
// failed.
async function lineCallback(env, url) {
  const q = url.searchParams;
  if (q.has("error")) return backToApp(env, `e=${lineError(q.get("error"))}`);
  const state = q.get("state");
  if (!state) return backToApp(env, "e=state");
  // 3.1: the sign-in this state started, taken out of the room so that it can't be used twice.
  const login = await roomJson(env, "/r/logins/take", { state });
  if (!login) return backToApp(env, "e=resting");
  if (login.status !== 200) return backToApp(env, "e=state");
  // 3.2 and 3.3: LINE's code for an ID token, and the token's checks (auth.js).
  const code = q.get("code");
  const idToken = code ? await lineIdToken(env, code, login.data.pkce_verifier, callbackUrl(url)) : null;
  const claims = idToken
    ? await verifyLineIdToken(idToken, {
        channelId: env.LINE_CHANNEL_ID,
        secret: env.LINE_CHANNEL_SECRET,
        nonce: login.data.nonce,
        nowMs: Date.now(),
      })
    : null;
  if (!claims) return backToApp(env, "e=token");
  // 3.4 and 3.5: the room makes the account code, stops a banned account, and stores the handoff. LINE's sub goes to the
  // room only to be made into the account code (sub_hash), and is never stored. The LINE name goes only into the
  // handoff, to prefill the nickname box.
  const handoff = await roomJson(env, "/r/handoffs", { h: login.data.h, sub: claims.sub, line_name: claims.name ?? null });
  if (!handoff) return backToApp(env, "e=resting");
  if (handoff.data.error === "banned") return backToApp(env, "e=banned");
  if (handoff.status !== 200) return backToApp(env, "e=token");
  // 3.6
  return backToApp(env, `c=${handoff.data.code}&p=${handoff.data.pin}`);
}

// Swaps LINE's code for its ID token at LINE_TOKEN_URL, or null. LINE's access token in the same answer is never kept.
// A failure is logged by its kind only, never with what LINE sent back.
async function lineIdToken(env, code, verifier, redirectUri) {
  try {
    const res = await fetch(env.LINE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: env.LINE_CHANNEL_ID,
        client_secret: env.LINE_CHANNEL_SECRET,
        code_verifier: verifier,
      }),
    });
    if (!res.ok) {
      console.error("chat: LINE refused the code:", res.status);
      return null;
    }
    const data = await res.json();
    return typeof data?.id_token === "string" ? data.id_token : null;
  } catch (err) {
    console.error("chat: LINE's token exchange failed:", err?.name ?? "error");
    return null;
  }
}

// Adds the CORS and cache headers. The Worker alone decides these, whatever the room put in its answer.
function finish(answer, kind, pathname, from) {
  // The socket handshake: its headers can't change, and CORS doesn't apply to it.
  if (answer.status === 101) return answer;
  const res = new Response(answer.body, answer);
  const headers = res.headers;
  headers.delete("Access-Control-Allow-Origin");
  headers.delete("Access-Control-Allow-Credentials"); // never sent: the app signs in with a token, not cookies
  if (kind === "open") {
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", res.status === 200 ? "public, max-age=60" : "no-store");
  } else if (kind === "private") {
    headers.append("Vary", "Origin");
    if (from.ok) headers.set("Access-Control-Allow-Origin", from.origin);
  }
  if (kind === "private" || NEVER_CACHED.test(pathname)) headers.set("Cache-Control", "no-store");
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = routeFor(url.pathname);
    const origin = request.headers.get("Origin");
    const from = { origin, ok: origin !== null && allowedOrigins(env).includes(origin) };
    const answer = route ? await handle(route, request, env, url, from) : Response.json({ error: "not found" }, { status: 404 });
    return finish(answer, route?.kind, url.pathname, from);
  },
};
