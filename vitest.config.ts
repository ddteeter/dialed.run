import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

/**
 * Two projects, because two kinds of test need two runtimes.
 *
 * **`worker`** is everything that touches the platform — D1, R2, queues,
 * bindings — and runs in workerd via `@cloudflare/vitest-pool-workers`.
 * That is the whole suite's history and still most of it.
 *
 * **`ui`** is component behaviour, and runs in jsdom. It exists because
 * workerd has no DOM: the worker project can only `renderToString`, which
 * gives first paint and nothing after it — no click, no state transition,
 * no effect. So the interaction rules in CLAUDE.md's "Forms use the
 * primitives" contract (`aria-disabled` rather than `disabled`, the
 * double-submit guard, error copy from the schema, nothing animating in
 * the failure path) had no test that could reach them, and neither did
 * every other component state a journey does not walk. Playwright covers
 * journeys; it is single-worker by design (D-28) and is the wrong
 * instrument for a state space.
 *
 * A test opts into jsdom by being named `*.dom.test.tsx`, so files migrate
 * one at a time rather than in a big bang, and the split is visible in the
 * filename rather than in this config.
 */
const DOM_TESTS = "test/**/*.dom.test.tsx";

export default defineConfig(async () => {
  const coreMigrations = await readD1Migrations("src/db/migrations/core");
  const weatherMigrations = await readD1Migrations("src/db/migrations/weather");

  return {
    test: {
      // better-auth's dispatch floats a duplicate rejection for expected
      // auth failures (the awaited path still rejects/responds correctly —
      // covered by test/auth.test.ts). Ignore ONLY that shape. It sits at
      // the root because vitest resolves unhandled errors against the root
      // config, not the project that raised them.
      onUnhandledError(error: unknown): boolean | undefined {
        if (
          typeof error === "object" &&
          error !== null &&
          "body" in error &&
          typeof error.body === "object" &&
          error.body !== null &&
          "code" in error.body &&
          error.body.code === "INVALID_EMAIL_OR_PASSWORD"
        ) {
          return false;
        }
        return undefined;
      },
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./test/wrangler.test.jsonc" },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS_CORE: coreMigrations,
                  TEST_MIGRATIONS_WEATHER: weatherMigrations,
                  // Stryker activates a mutant by setting this on the child
                  // process, and stryker's instrumented code reads it from
                  // `globalThis.process.env`. Inside the workers pool that
                  // object is not the parent's environment — it is the
                  // Worker's bindings, which is why every mutant otherwise
                  // survives. This config file runs in Node, where the
                  // variable *is* visible, so forwarding it as a binding is
                  // what carries it across.
                  ...(process.env.__STRYKER_ACTIVE_MUTANT__ !== undefined && {
                    __STRYKER_ACTIVE_MUTANT__:
                      process.env.__STRYKER_ACTIVE_MUTANT__,
                  }),
                },
              },
            }),
          ],
          assetsInclude: ["**/*.bin"],
          test: {
            name: "worker",
            include: ["test/**/*.test.{ts,tsx}"],
            exclude: [DOM_TESTS],
            setupFiles: ["test/apply-migrations.ts"],
          },
        },
        {
          test: {
            name: "ui",
            environment: "jsdom",
            include: [DOM_TESTS],
            setupFiles: ["test/dom-setup.ts"],
          },
        },
      ],
    },
  };
});
