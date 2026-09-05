import { applyD1Migrations } from "cloudflare:test";

import { env } from "../src/env";

await applyD1Migrations(env.DIALED_CORE, env.TEST_MIGRATIONS_CORE);
await applyD1Migrations(env.DIALED_WEATHER, env.TEST_MIGRATIONS_WEATHER);
