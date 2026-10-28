// A stand-in for the two services the coach's backend calls, for tests/coach/app.test.js: under `wrangler dev` the Worker's COACH_API_URL
// and COACH_MAIL_URL point here (tests/chat/servers.js, start({ai})). A small HTTP server on 127.0.0.1:
//   POST /v1/messages   Anthropic's Messages API. It answers reply(request): by default a reply that passes every check the backend makes
//                       (apiMessage(goodReply(sent, lang)) from chat/test/coach-fixtures.mjs), for the key frames the request carries
//                       (its "Key frame N (m:ss.ss)" labels) and its language (a 中文 request's schema asks for "english"). reply(request)
//                       may answer a message, sent with 200, or {status, body, headers} for anything else (a 429, a 529, an error),
//                       or a promise of either.
//   POST /emails        Resend's: the mail is noted and answered with an id.
// Every request is noted in .requests, in order, as {path, headers, body} (body parsed from JSON, or the raw text when it isn't JSON), and
// each mail also in .mails. One without the test key (x-api-key for the AI, Authorization: Bearer for mail), or an AI request without
// anthropic-version, gets the real services' 401 or 400 and is noted in .problems, which the tests check stays empty.
// Usage: const ai = await startFakeAi({reply}); ai.url; ai.requests; ai.mails; ai.problems; await ai.close();
//        or on its own: node tests/coach/fake-ai.mjs <port>
import http from "node:http";
import { apiMessage, goodReply } from "../../chat/test/coach-fixtures.mjs";

// The stand-in keys the browser tests' wrangler dev gets (tests/chat/servers.js), never real ones.
export const KEYS = { ai: "test-only-anthropic-key", mail: "test-only-resend-key" };

// The key frame numbers a Messages request carries, in its order, and its language.
export const sentOf = (body) => {
  const content = body?.messages?.[0]?.content;
  return Array.isArray(content) ? content.flatMap((b) => { const m = b?.type === "text" && /^Key frame (\d+) \(/.exec(b.text ?? ""); return m ? [+m[1]] : []; }) : [];
};
export const langOf = (body) => (body?.output_config?.format?.schema?.properties?.english ? "zh" : "en");
// What the fake AI answers unless told otherwise: a good review of the frames sent, in the request's language.
export const goodAnswer = (request) => apiMessage(goodReply(sentOf(request.body), langOf(request.body)));

export function startFakeAi({ reply = goodAnswer, port = 0 } = {}) {
  const requests = [], mails = [], problems = [];
  let mailIds = 0;
  const send = (res, status, body, headers = {}) => res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));
  // The Messages API's error shape.
  const apiError = (res, status, type, message) => send(res, status, { type: "error", error: { type, message } });

  async function messages(request, res) {
    const h = request.headers;
    if (h["x-api-key"] !== KEYS.ai) { problems.push("messages: no test key"); return apiError(res, 401, "authentication_error", "invalid x-api-key"); }
    if (!h["anthropic-version"]) { problems.push("messages: no anthropic-version"); return apiError(res, 400, "invalid_request_error", "anthropic-version: header is required"); }
    if (!request.body || typeof request.body !== "object") { problems.push("messages: the body isn't JSON"); return apiError(res, 400, "invalid_request_error", "the body isn't JSON"); }
    let answer;
    try { answer = await reply(request); } catch (e) { problems.push(`messages: reply() threw ${e && e.message}`); return apiError(res, 500, "api_error", "the fake's reply() threw"); }
    if (answer && typeof answer.status === "number") return send(res, answer.status, answer.body ?? null, answer.headers);
    return send(res, 200, answer);
  }

  function email(request, res) {
    if (request.headers.authorization !== `Bearer ${KEYS.mail}`) { problems.push("emails: no test key"); return send(res, 401, { statusCode: 401, name: "validation_error", message: "API key is invalid" }); }
    if (!request.body || typeof request.body !== "object") { problems.push("emails: the body isn't JSON"); return send(res, 422, { statusCode: 422, name: "validation_error", message: "the body isn't JSON" }); }
    mails.push(request.body);
    return send(res, 200, { id: `fake-mail-${++mailIds}` });
  }

  const server = http.createServer((req, res) => {
    let text = ""; req.setEncoding("utf8");
    req.on("data", (d) => { text += d; });
    req.on("end", () => {
      const path = new URL(req.url, "http://127.0.0.1").pathname;
      let body = text;
      try { body = JSON.parse(text); } catch (e) {}
      const request = { path, headers: req.headers, body };
      if (req.method !== "POST" || (path !== "/v1/messages" && path !== "/emails")) return res.writeHead(404).end();
      requests.push(request);
      if (path === "/emails") return email(request, res);
      messages(request, res).catch(() => { try { res.writeHead(500).end(); } catch (e) {} });
    });
  });
  return new Promise((ok, no) => server.once("error", no).listen(port, "127.0.0.1", () => ok({
    url: `http://127.0.0.1:${server.address().port}`, requests, mails, problems,
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
  })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [port] = process.argv.slice(2);
  if (!port) { console.error("usage: node tests/coach/fake-ai.mjs <port>"); process.exit(2); }
  startFakeAi({ port: +port }).then((ai) => console.log(`fake AI at ${ai.url}/v1/messages and ${ai.url}/emails`));
}
