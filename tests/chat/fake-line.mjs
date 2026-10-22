// A stand-in for LINE Login's two endpoints, for tests/chat/flow.test.js: under `wrangler dev` the backend's LINE_AUTH_URL and
// LINE_TOKEN_URL point here. A small HTTP server on 127.0.0.1:
//   GET  /authorize   LINE's consent screen, approved at once: back to redirect_uri with ?code=&state=, or with ?error=access_denied&state=
//                     once deny() was called (the person tapped Cancel). It first checks the parameters chat/src/index.js must send (spec
//                     "Login (LINE, web flow)", step 2): response_type code, our client_id, scope "openid profile", a state, a nonce and an
//                     S256 code_challenge.
//   POST /token       the code for an ID token (step 3.2): HS256, signed with the channel secret, for one fixed LINE account (sub) and its
//                     LINE name, carrying the nonce the authorize call brought. It first checks grant_type, client_id, client_secret,
//                     redirect_uri (the one the code was given for) and that SHA-256(code_verifier) is the code_challenge. A code works once.
// A request that doesn't check out gets 400 and is noted in .problems, which the tests check stays empty.
// Usage: const line = await startFakeLine({channelId, secret}); line.url; line.deny(); line.problems; await line.close();
//        or on its own: node tests/chat/fake-line.mjs <port> <channelId> <secret>
import http from "node:http";
import crypto from "node:crypto";

// LINE's sub is "U" and 32 hex digits. The name is one a nickname can be, so the signup sheet's prefill can be used as it is.
export const SUB = "U0123456789abcdef0123456789abcdef", NAME = "Kai 浪人";

const b64u = (x) => Buffer.from(x).toString("base64url");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("base64url");

export function startFakeLine({ channelId, secret, sub = SUB, name = NAME, port = 0 } = {}) {
  if (!channelId || !secret) throw new Error("fake LINE: channelId and secret are needed");
  const codes = new Map(), problems = [];
  let denyNext = false;
  const refuse = (res, why) => { problems.push(why); res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid_request", error_description: why })); };

  function authorize(q, res) {
    const p = Object.fromEntries(q);
    const bad = [
      p.response_type !== "code" && "response_type",
      p.client_id !== channelId && "client_id",
      !/^https?:\/\/[^/]+\/auth\/line\/callback$/.test(p.redirect_uri || "") && "redirect_uri",
      !p.state && "state",
      p.scope !== "openid profile" && "scope",
      !p.nonce && "nonce",
      !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge || "") && "code_challenge",
      p.code_challenge_method !== "S256" && "code_challenge_method",
    ].filter(Boolean);
    if (bad.length) return refuse(res, `authorize: bad ${bad.join(", ")}`);
    const back = new URL(p.redirect_uri);
    if (denyNext) {
      denyNext = false;
      back.search = new URLSearchParams({ error: "access_denied", error_description: "The user has denied the request", state: p.state }).toString();
    } else {
      const code = crypto.randomBytes(15).toString("base64url");
      codes.set(code, { nonce: p.nonce, challenge: p.code_challenge, redirect: p.redirect_uri });
      back.search = new URLSearchParams({ code, state: p.state }).toString();
    }
    res.writeHead(302, { Location: back.href }).end();
  }

  function token(form, res) {
    const p = Object.fromEntries(new URLSearchParams(form)), grant = codes.get(p.code);
    if (grant) codes.delete(p.code);
    const bad = [
      p.grant_type !== "authorization_code" && "grant_type",
      !grant && "code",
      p.client_id !== channelId && "client_id",
      p.client_secret !== secret && "client_secret",
      grant && p.redirect_uri !== grant.redirect && "redirect_uri",
      grant && sha256(p.code_verifier || "") !== grant.challenge && "code_verifier",
    ].filter(Boolean);
    if (bad.length) return refuse(res, `token: bad ${bad.join(", ")}`);
    const now = Math.floor(Date.now() / 1000);
    const head = b64u(JSON.stringify({ typ: "JWT", alg: "HS256" }));
    const claims = b64u(JSON.stringify({ iss: "https://access.line.me", sub, aud: channelId, exp: now + 3600, iat: now, nonce: grant.nonce,
      amr: ["linesso"], name, picture: "https://profile.line-scdn.net/fake-picture" }));
    const sig = crypto.createHmac("sha256", secret).update(`${head}.${claims}`).digest("base64url");
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ access_token: "fake-access-token", token_type: "Bearer",
      expires_in: 2592000, scope: "openid profile", id_token: `${head}.${claims}.${sig}` }));
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/authorize") return authorize(url.searchParams, res);
    if (req.method === "POST" && url.pathname === "/token") {
      let form = ""; req.setEncoding("utf8");
      req.on("data", (d) => { form += d; }); req.on("end", () => token(form, res));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((ok, no) => server.once("error", no).listen(port, "127.0.0.1", () => ok({
    url: `http://127.0.0.1:${server.address().port}`, problems, sub, name,
    deny() { denyNext = true; },
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [port, channelId, secret] = process.argv.slice(2);
  if (!port || !channelId || !secret) { console.error("usage: node tests/chat/fake-line.mjs <port> <channelId> <secret>"); process.exit(2); }
  startFakeLine({ port: +port, channelId, secret }).then((line) => console.log(`fake LINE at ${line.url}/authorize and ${line.url}/token`));
}
