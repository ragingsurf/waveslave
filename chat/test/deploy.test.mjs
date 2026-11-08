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

// The `env:` lines of the step called `name`, as {NAME: "${{ secrets.NAME }}"}: what GitHub hands the step's script.
function stepEnv(name) {
  const lines = WORKFLOW.split("\n");
  const at = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `no step called ${name}`);
  const start = lines.findIndex((line, i) => i > at && line.trim() === "env:");
  const run = lines.findIndex((line, i) => i > at && line.trim() === "run: |");
  assert.ok(start > at && start < run, `${name} has no env: block before its run:`);
  const indent = lines[start].search(/\S/);
  const env = {};
  for (const line of lines.slice(start + 1, run)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (line.search(/\S/) <= indent) break;
    const [key, ...rest] = line.trim().split(": ");
    env[key] = rest.join(": ");
  }
  return env;
}

// Runs a step's script with the secrets in `secrets` (and no other secrets) in a scratch RUNNER_TEMP. Returns
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

// The coach's two secrets (AI coach spec, "Deploy"). They are optional: the chat deploys without them, and the coach
// then takes a break. GitHub gives a secret that isn't set as an empty string, so an empty one, or one of only spaces
// and line breaks, is left out of the file. Left out, the Worker keeps whatever it had (`wrangler deploy
// --secrets-file` keeps secrets it isn't given), and before the first key there is nothing to keep.
const CHAT_FIVE = {
  LINE_CHANNEL_ID: SET.LINE_CHANNEL_ID,
  LINE_CHANNEL_SECRET: SET.LINE_CHANNEL_SECRET,
  SESSION_SECRET: SET.SESSION_SECRET,
  SUB_PEPPER: SET.SUB_PEPPER,
  ADMIN_CODE: SET.ADMIN_CODE,
};

test("the secrets file step is given both coach secrets from GitHub, and the check is given neither", () => {
  const file = stepEnv("Write the secrets file");
  assert.equal(file.ANTHROPIC_API_KEY, "${{ secrets.ANTHROPIC_API_KEY }}");
  assert.equal(file.RESEND_API_KEY, "${{ secrets.RESEND_API_KEY }}");
  for (const name of Object.keys(CHAT_FIVE)) assert.equal(file[name], `\${{ secrets.${name} }}`, name);
  const check = stepEnv("Check the secrets are set");
  assert.deepEqual(Object.keys(check).sort(), [...NAMES].sort());
});

test("with both coach secrets empty, as GitHub gives unset ones, the file holds exactly the five chat secrets", { skip: NO_JQ }, () => {
  const { file } = runStep("Write the secrets file", { ...SET, ANTHROPIC_API_KEY: "", RESEND_API_KEY: "" });
  assert.deepEqual(JSON.parse(file), CHAT_FIVE);
});

test("a coach secret of only spaces and line breaks is left out, like an empty one", { skip: NO_JQ }, () => {
  const { file } = runStep("Write the secrets file", { ...SET, ANTHROPIC_API_KEY: " \n", RESEND_API_KEY: "\t\r\n" });
  assert.deepEqual(JSON.parse(file), CHAT_FIVE);
});

test("a coach secret goes in trimmed of the spaces and line breaks a paste brought along", { skip: NO_JQ }, () => {
  const { file } = runStep("Write the secrets file", { ...SET, ANTHROPIC_API_KEY: "  sk-ant-x \n", RESEND_API_KEY: "" });
  assert.deepEqual(JSON.parse(file), { ...CHAT_FIVE, ANTHROPIC_API_KEY: "sk-ant-x" });
});

test("with only the email key set, only it is added", { skip: NO_JQ }, () => {
  const { file } = runStep("Write the secrets file", { ...SET, ANTHROPIC_API_KEY: "", RESEND_API_KEY: "re_x\n" });
  assert.deepEqual(JSON.parse(file), { ...CHAT_FIVE, RESEND_API_KEY: "re_x" });
});

test("with both coach secrets set, both are added, symbols and all", { skip: NO_JQ }, () => {
  const keys = { ANTHROPIC_API_KEY: "sk-ant-a+b/c=d_e-f", RESEND_API_KEY: "re_a\"b\\c d" };
  const { file } = runStep("Write the secrets file", { ...SET, ...keys });
  assert.deepEqual(JSON.parse(file), { ...CHAT_FIVE, ...keys });
});

test("the check is ready with the coach secrets empty or not given at all: chat deploys never wait on the coach", { skip: NO_BASH }, () => {
  assert.equal(runStep("Check the secrets are set", { ...SET, ANTHROPIC_API_KEY: "", RESEND_API_KEY: "" }).output, "ready=true\n");
  assert.equal(runStep("Check the secrets are set", SET).output, "ready=true\n");
});
