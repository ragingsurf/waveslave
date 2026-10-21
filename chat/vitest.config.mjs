// Vitest runs the Worker and room tests: the files ending in .spec.mjs. The pure-module tests (mod, auth)
// end in .test.mjs and run under plain `node --test` instead, because they need no Worker; Vitest must
// not pick them up, and `node --test` must not pick up the Worker tests (they import "cloudflare:test",
// which only exists inside the Worker runtime). So: pure modules are *.test.mjs, Worker tests are *.spec.mjs.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.mjs"],
    // There are no Worker tests yet. Delete this line when the first *.spec.mjs file is added, so that an
    // empty or mistyped include fails the run instead of passing it.
    passWithNoTests: true,
  },
});
