import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema-ops.ts",
  out: "./src/db/migrations/ops",
});
