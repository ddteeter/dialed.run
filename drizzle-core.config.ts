import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema-core.ts",
  out: "./src/db/migrations/core",
});
