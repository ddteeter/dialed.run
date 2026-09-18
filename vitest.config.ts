import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, defineProject } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

/**
 * Three projects, because three kinds of test need three runtimes.
 *
 * **`worker`** is everything that touches the platform — D1, R2, queues,
 * bindings — and runs in workerd via `@cloudflare/vitest-pool-workers`.
 * That is the whole suite's history and still most of it.
 *
 * **`ui`** is component behaviour, and runs in happy-dom. It exists because
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
 * happy-dom rather than jsdom because jsdom (still, at 30.0.1) does not
 * implement `HTMLDialogElement.showModal`/`close`, and `ui/Sheet.tsx` is
 * built on the native `<dialog>` — so on jsdom the one primitive whose
 * every line was uncovered stayed uncoverable.
 *
 * **`browser`** is a real Chromium, driven by playwright as a vitest
 * provider. It exists for one thing happy-dom structurally cannot do: run
 * code that fetches. `blur/detect.ts` loads 11 MB of MediaPipe WASM and a
 * `.tflite` model over HTTP, and happy-dom refuses to execute a fetched
 * script ("JavaScript file loading is disabled") while workerd has no DOM
 * and neither has an origin to fetch from. Vitest serves `public/` off its
 * own vite server, so `/mediapipe/wasm` resolves exactly as it does in
 * production.
 *
 * **It is vitest, which is the whole point.** Playwright's own runner is
 * invisible to stryker (`testRunner: "vitest"`), so an `e2e/` spec proves
 * the model works and kills zero mutants; 8 of the 16 survivors in
 * `detect.ts` live in code no non-browser test can reach. A vitest project
 * is mutated like any other.
 *
 * A test opts into a project by its name: `*.dom.test.tsx` for happy-dom
 * and `*.browser.test.ts` for Chromium, so files migrate one at a time
 * rather than in a big bang, and the split is visible in the filename
 * rather than in this config.
 */
const DOM_TESTS = "test/**/*.dom.test.tsx";
const BROWSER_TESTS = "test/**/*.browser.test.ts";

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
        defineProject({
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
            // Vitest's default is 5s, and that is a budget for a quiet
            // machine. The slowest harness these tests must survive is
            // stryker's: its vitest runner forces `maxWorkers: 1` and
            // `maxConcurrency: 1`, so the whole suite runs serially in one
            // thread, and the dry run it does before any mutant measured
            // 1221 tests in 2m08s — 31.8s of net test time against 96.5s of
            // harness overhead. At 5s the image tests (real encode/decode,
            // the heaviest thing the suite does) sit near the line and one
            // crosses it on almost every run: four consecutive dry runs
            // failed with exactly one `Test timed out in 5000ms`, on a
            // DIFFERENT test each time, each of which passes in about a
            // second on its own. A varying victim is the environment, not
            // the test. 20s is the value `test/closet/photos.test.ts` had
            // already reached for inline on one case; this makes it the
            // rule rather than that one file's private workaround. It
            // weakens no assertion — every test still runs and still has to
            // pass — it only moves the deadline at which we call the
            // harness wedged.
            testTimeout: 20_000,
            include: ["test/**/*.test.{ts,tsx}"],
            exclude: [DOM_TESTS, BROWSER_TESTS],
            setupFiles: ["test/apply-migrations.ts"],
          },
        }),
        defineProject({
          test: {
            name: "ui",
            testTimeout: 20_000,
            environment: "happy-dom",
            include: [DOM_TESTS],
            setupFiles: ["test/dom-setup.ts"],
          },
        }),
        defineProject({
          test: {
            name: "browser",
            testTimeout: 20_000,
            include: [BROWSER_TESTS],
            browser: {
              enabled: true,
              headless: true,
              // One instance. Firefox and WebKit would double the runtime
              // to tell us about browsers that have no Shape Detection API
              // either, and MediaPipe's WASM is the same bytes everywhere.
              instances: [{ browser: "chromium" }],
              provider: playwright(),
            },
          },
        }),
      ],
    },
  };
});
