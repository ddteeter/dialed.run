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
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: ["test/apply-migrations.ts"],
    },
  };
});
