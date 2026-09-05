import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema-weather.ts",
  out: "./src/db/migrations/weather",
});
