import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";

/**
Drizzle handle for dialed-core, constructed per call (bindings are
request-scoped in Workers; the handle itself is cheap).
*/
export function coreDb() {
  return drizzle(env.DIALED_CORE);
}

export type CoreDb = ReturnType<typeof coreDb>;
