import { applyD1Migrations } from "cloudflare:test";

import { env } from "../src/env";
import { refuseLikeR2 } from "./platform/strict-r2";

await applyD1Migrations(env.DIALED_CORE, env.TEST_MIGRATIONS_CORE);
await applyD1Migrations(env.DIALED_WEATHER, env.TEST_MIGRATIONS_WEATHER);
await applyD1Migrations(env.DIALED_OPS, env.TEST_MIGRATIONS_OPS);

// Not a migration, but the same once-per-file setup: R2's refusals, which
// the local runtime does not make (`platform/strict-r2.ts`).
refuseLikeR2();
