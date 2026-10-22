// Tests for the two shell steps of .github/workflows/chat.yml that handle the Worker secrets: the check that they are
// set, and the secrets file the deploy reads. Each step's `run:` script is taken out of the workflow file as it is and
// run with bash, so the test covers what GitHub runs. They run under plain `node --test`, and need bash and jq (both
// on GitHub's runners). On a machine without one of them the tests that need it are skipped, so a local `npm test`
// stays green. Run from chat/: node --test test/deploy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// false when the command answers --version, else why the tests that need it are skipped.
const lacks = (command) => {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return false;
  } catch {
    return `${command} is not on PATH`;
  }
};
// The check step needs only bash; the secrets file step needs jq as well.
const NO_BASH = lacks("bash");
const NO_JQ = NO_BASH || lacks("jq");

const WORKFLOW = readFileSync(new URL("../../.github/workflows/chat.yml", import.meta.url), "utf8");
const NAMES = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "LINE_CHANNEL_ID", "LINE_CHANNEL_SECRET", "SESSION_SECRET", "SUB_PEPPER", "ADMIN_CODE"];
const SET = {
  CLOUDFLARE_API_TOKEN: "cf-token",
  CLOUDFLARE_ACCOUNT_ID: "cf-account",
  LINE_CHANNEL_ID: "2001234567",
  LINE_CHANNEL_SECRET: "line-secret",
  SESSION_SECRET: "session-secret",
  SUB_PEPPER: "sub-pepper",
  ADMIN_CODE: "admin-code-of-at-least-32-characters",
};

// The `run: |` script of the step called `name`: the lines under `run:` that are indented more than it.
function script(name) {
  const lines = WORKFLOW.split("\n");
  const at = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `no step called ${name}`);
  const run = lines.findIndex((line, i) => i > at && line.trim() === "run: |");
  const indent = lines[run].search(/\S/);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= indent) break;
    body.push(line);
  }
  return body.join("\n");
}

// Runs a step's script with the secrets in `secrets` (and no others of the seven) in a scratch RUNNER_TEMP. Returns
// what it wrote to GITHUB_OUTPUT and the secrets file, when there is one.
function runStep(name, secrets) {
  const dir = mkdtempSync(join(tmpdir(), "chat-deploy-"));
  try {
    const given = Object.entries(secrets).filter(([, value]) => value !== undefined);
    const env = { PATH: process.env.PATH, RUNNER_TEMP: dir, GITHUB_OUTPUT: join(dir, "output"), ...Object.fromEntries(given) };
    const stdout = execFileSync("bash", ["-e", "-c", script(name)], { env, encoding: "utf8" });
    const read = (file) => {
      try {
        return readFileSync(join(dir, file), "utf8");
      } catch {
        return null;
      }
    };
    return { stdout, output: read("output"), file: read("chat-secrets.json") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the secrets file holds the five Worker secrets with no space or line break at either end", { skip: NO_JQ }, () => {
  const pasted = {
    ...SET,
    LINE_CHANNEL_ID: "2001234567\n",
    LINE_CHANNEL_SECRET: "  line-secret \r\n",
    SESSION_SECRET: "\tsession-secret",
    ADMIN_CODE: "admin-code-of-at-least-32-characters \n\n",
  };
  const { file } = runStep("Write the secrets file", pasted);
  assert.deepEqual(JSON.parse(file), {
    LINE_CHANNEL_ID: SET.LINE_CHANNEL_ID,
    LINE_CHANNEL_SECRET: SET.LINE_CHANNEL_SECRET,
    SESSION_SECRET: SET.SESSION_SECRET,
    SUB_PEPPER: SET.SUB_PEPPER,
    ADMIN_CODE: SET.ADMIN_CODE,
  });
});

test("the secrets file keeps a value as it is when nothing is around it, symbols and all", { skip: NO_JQ }, () => {
  const symbols = { ...SET, SESSION_SECRET: "a+b/c=d\"e\\f g", SUB_PEPPER: "0123456789/+=" };
  const { file } = runStep("Write the secrets file", symbols);
  const saved = JSON.parse(file);
  assert.equal(saved.SESSION_SECRET, symbols.SESSION_SECRET);
  assert.equal(saved.SUB_PEPPER, symbols.SUB_PEPPER);
});

test("the check is ready when all seven secrets are set", { skip: NO_BASH }, () => {
  const { output } = runStep("Check the secrets are set", SET);
  assert.equal(output, "ready=true\n");
});

test("the check counts a secret that is missing, empty or only spaces and line breaks as missing", { skip: NO_BASH }, () => {
  const { output, stdout } = runStep("Check the secrets are set", { ...SET, SUB_PEPPER: undefined, ADMIN_CODE: "", LINE_CHANNEL_ID: " \n" });
  assert.equal(output, "ready=false\n");
  assert.match(stdout, /Missing secrets: LINE_CHANNEL_ID SUB_PEPPER ADMIN_CODE\./);
});

test("the check names every secret the deploy needs", { skip: NO_BASH }, () => {
  for (const name of NAMES) {
    const { output, stdout } = runStep("Check the secrets are set", { ...SET, [name]: "" });
    assert.equal(output, "ready=false\n", name);
    assert.match(stdout, new RegExp(`Missing secrets: ${name}\\.`));
  }
});
