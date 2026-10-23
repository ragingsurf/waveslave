// Vitest runs the Worker and room tests: the files ending in .spec.mjs. The pure-module tests (mod, auth)
// end in .test.mjs and run under plain `node --test` instead, because they need no Worker; Vitest must
// not pick them up, and `node --test` must not pick up the Worker tests (they import "cloudflare:test",
// which only exists inside the Worker runtime). So: pure modules are *.test.mjs, Worker tests are *.spec.mjs.
//
// The Worker tests run inside a local copy of the Workers runtime, with the Worker and the room exactly as
// wrangler.toml describes them. Socket tests are run with `vitest run --no-isolate --max-workers=1`.
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        // wrangler.toml asks for compatibility date 2026-10-21, but every npm package here is pinned to a
        // release from before 2026-10-07, and the local runtime that this test pool ships (workerd
        // 1.20260815) refuses any date newer than it knows. So the tests run at that runtime's own date.
        // Deploys still use wrangler.toml's date.
        compatibilityDate: "2026-08-15",
        // Stand-ins for the Worker secrets, for the tests only. The real ones are never in the repo: the deploy
        // workflow sets them, and `wrangler dev` reads its own from .dev.vars, which is not committed. ADMIN_CODE is
        // exactly 32 characters, the shortest the room takes (mod-admin.spec.mjs). The coach's two keys only stand in:
        // a test that gets as far as a call mocks the fetch to COACH_API_URL or COACH_MAIL_URL, so nothing reaches
        // Anthropic or Resend.
        bindings: {
          LINE_CHANNEL_ID: "1234567890",
          LINE_CHANNEL_SECRET: "test-only-line-channel-secret",
          SESSION_SECRET: "test-only-session-secret",
          SUB_PEPPER: "test-only-sub-pepper",
          ADMIN_CODE: "test-only-admin-code-0123456789x",
          ANTHROPIC_API_KEY: "test-only-anthropic-key",
          RESEND_API_KEY: "test-only-resend-key",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.spec.mjs"],
    // 20 s, not Vitest's 5 s: a money test with many coach calls once ran past 5 s on a loaded machine.
    testTimeout: 20000,
  },
});
