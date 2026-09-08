/**
 * This module's Drizzle handle for dialed-core.
 *
 * Deliberately not shared with modules/runs: `src/db/` may not import
 * `env` (only `src/env/` touches bindings), so there is nowhere a common
 * handle could live that both modules may reach without one deep-importing
 * the other. It is one call.
 */
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";

export function notificationsDb() {
  return drizzle(env.DIALED_CORE);
}

export type NotificationsDb = ReturnType<typeof notificationsDb>;
