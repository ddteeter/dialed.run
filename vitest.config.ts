import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const coreMigrations = await readD1Migrations("src/db/migrations/core");
  const weatherMigrations = await readD1Migrations("src/db/migrations/weather");

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./test/wrangler.test.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS_CORE: coreMigrations,
            TEST_MIGRATIONS_WEATHER: weatherMigrations,
            // Stryker activates a mutant by setting this on the child
            // process, and stryker's instrumented code reads it from
            // `globalThis.process.env`. Inside the workers pool that object
            // is not the parent's environment — it is the Worker's
            // bindings, which is why every mutant otherwise survives. This
            // config file runs in Node, where the variable *is* visible, so
            // forwarding it as a binding is what carries it across.
            ...(process.env.__STRYKER_ACTIVE_MUTANT__ !== undefined && {
              __STRYKER_ACTIVE_MUTANT__: process.env.__STRYKER_ACTIVE_MUTANT__,
            }),
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: ["test/apply-migrations.ts"],
      // better-auth's dispatch floats a duplicate rejection for expected
      // auth failures (the awaited path still rejects/responds correctly —
      // covered by test/auth.test.ts). Ignore ONLY that shape.
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
    },
  };
});
