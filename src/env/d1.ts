/**
 * The D1 handles everything else uses (design 143, decision D-123).
 *
 * `coreDb()` and `weatherDb()` read through the request's D1 session, so
 * from a replica where D-123 allows it; outside a request they are the
 * bare binding, the primary. `primaryCoreDb()` always reads the primary:
 * for Better Auth and the auth gates, which must never accept a revoked
 * session from a lagging replica. Each call decides per query, so a handle
 * built at module load (Better Auth's) still joins the request it runs in. `test/architecture/d1-access.test.ts`
 * holds every other file to these three.
 */
import { env } from "cloudflare:workers";

import { coreDbOver, primaryDb, weatherDbOver } from "../lib/sql/d1-session";

export function coreDb() {
  return coreDbOver(env.DIALED_CORE);
}

export function weatherDb() {
  return weatherDbOver(env.DIALED_WEATHER);
}

export function primaryCoreDb() {
  return primaryDb(env.DIALED_CORE);
}
