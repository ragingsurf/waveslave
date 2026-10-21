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
      },
    }),
  ],
  test: {
    include: ["test/**/*.spec.mjs"],
  },
});
