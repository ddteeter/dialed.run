import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";

/**
 * Handles onto the same local D1 databases the dev server reads. Verified
 * bidirectional: rows written here are visible to `wrangler d1 execute
 * --local` and to the running dev server, and rows the dev server writes
 * (a signup, say) are readable here.
 */
export interface LocalDatabases {
  core: DrizzleD1Database;
  weather: DrizzleD1Database;
}

/**
 * Seeds e2e state by writing through Drizzle and the real schema, rather
 * than hand-written SQL that would bypass the contracts in
 * `src/lib/contracts.ts` and rot against schema changes.
 *
 * This runs in Node, NOT in the Worker — `src/env` re-exports
 * `cloudflare:workers` and cannot be imported here. `getPlatformProxy`
 * opens the bindings from `wrangler.jsonc` directly, so nothing test-only
 * is added to the deployed Worker.
 *
 * Always dispose: a leaked proxy keeps the process alive and Playwright
 * hangs after the last test.
 */
export async function withLocalDb<T>(
  fn: (db: LocalDatabases) => Promise<T>,
): Promise<T> {
  const { env, dispose } = await getPlatformProxy<Env>();
  try {
    return await fn({
      core: drizzle(env.DIALED_CORE),
      weather: drizzle(env.DIALED_WEATHER),
    });
  } finally {
    await dispose();
  }
}
