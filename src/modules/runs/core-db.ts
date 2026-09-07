import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";

/**
Stays inside this module rather than moving to db/: `src/db/` may not
import `env` (dependency-cruiser "db-imports-lib-only", and only `src/env/`
touches bindings at all), so a shared handle has nowhere to live that every
module can reach. Each module makes its own — it is one call, and lane 104
already does the same.

Drizzle handle for dialed-core, constructed per call (bindings are
request-scoped in Workers; the handle itself is cheap).
*/
export function coreDb() {
  return drizzle(env.DIALED_CORE);
}

export type CoreDb = ReturnType<typeof coreDb>;
