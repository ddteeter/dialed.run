/**
 * This module's Drizzle handle for dialed-core.
 *
 * Deliberately not shared with modules/runs: `src/db/` may not import
 * `env` (only `src/env/` touches bindings), so there is nowhere a common
 * handle could live that both modules may reach without one deep-importing
 * the other. It is one call.
 */

import { coreDb } from "../../env";

export function notificationsDb() {
  return coreDb();
}

export type NotificationsDb = ReturnType<typeof notificationsDb>;
