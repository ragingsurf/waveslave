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
//   GET  /admin/where         ->  /r/where
//
// /reports is open to every page. The rest answer only our own pages, and /auth/..., /me/... and /admin/... are never
// cached. The LINE sign-in routes (/auth/line/...) come with the login part of the chat.
export { Room } from "./room.js";
import { SPOTS } from "./mod.js";

// One room for all of Taiwan (Bryan, Oct 21). Every route reaches it through here: only the first call that creates
// the room places it, so a stub made without the hint could put it somewhere else.
const room = (env) => env.ROOM.getByName("taiwan", { locationHint: "apac-ne" });

// How a route treats the page that calls it:
//   open     anyone may read the answer, from any page (CORS "*"), and the browser may keep it for a minute
//   socket   the WebSocket. Only our own pages may open it, because a socket is not covered by CORS
//   private  only our own pages (the origins in ALLOWED_ORIGINS) may call it, and the answer is never cached
// Without `to`, the room path is "/r" plus the public path.
const ROUTES = [
  { path: "/reports", methods: ["GET"], kind: "open", to: "/r/reports" },
  { path: "/ws", methods: ["GET"], kind: "socket", to: "/r/ws" },
  { path: "/auth/redeem", methods: ["POST"], kind: "private", to: "/r/redeem" },
  { path: "/auth/signup", methods: ["POST"], kind: "private", to: "/r/signup" },
  { path: "/me/sessions", methods: ["GET", "POST"], kind: "private" },
  { path: /^\/me\/sessions\/[^/]+$/, methods: ["DELETE"], kind: "private" },
  { path: "/me/signout", methods: ["POST"], kind: "private" },
  { path: "/me/export", methods: ["GET"], kind: "private" },
  { path: "/me", methods: ["DELETE"], kind: "private" },
  { path: "/admin/where", methods: ["GET"], kind: "private", to: "/r/where" },
];

const PREFLIGHT = {
  "Access-Control-Allow-Methods": "GET, POST, DELETE",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "7200",
};

// Everything under these paths holds a sign-in or somebody's own data, so no answer there is ever cached, whatever
// it is (an unknown path included).
const NEVER_CACHED = /^\/(auth|me|admin)(\/|$)/;

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

// Asks the room, and answers null when it can't: the room is down, overloaded, or threw. The caller then says the chat
// is resting. Only the error's name is logged. Its message could hold part of the request (a login code, say).
async function askRoom(env, request, path, search, wholeRequest) {
  try {
    const target = `https://room${path}${search}`;
    // A WebSocket upgrade keeps all its headers: the handshake needs them, and the room reads the visitor's address
    // from CF-Connecting-IP. Everything else passes on only the two headers the room reads.
    const headers = new Headers();
    for (const name of ["Authorization", "Content-Type"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const sent = wholeRequest ? new Request(target, request) : new Request(target, { method: request.method, headers, body: request.body });
    return await room(env).fetch(sent);
  } catch (err) {
    console.error("chat: the room failed:", err?.name ?? "error");
    return null;
  }
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

  let search = url.search;
  if (route.kind === "open") {
    // The spot is checked here first, so a bad one costs the room nothing.
    const spot = url.searchParams.get("spot");
    if (!SPOTS.includes(spot)) return Response.json({ error: "spot" }, { status: 400 });
    search = `?spot=${spot}`;
  }
  const answer = await askRoom(env, request, route.to ?? `/r${url.pathname}`, search, route.kind === "socket");
  return answer ?? resting();
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
