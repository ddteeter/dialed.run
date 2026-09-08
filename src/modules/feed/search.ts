/**
 * Username search: prefix match on `user_profiles.display_name`, public
 * profiles only (all profiles are public at MVP — see design doc). No
 * index (design doc "Contract touches"): a `LIKE 'prefix%'` full scan of
 * user_profiles is fine at MVP user counts; `idx(display_name)` is
 * proposed for post-merge.
 */
import { like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { env } from "../../env";

const RESULT_LIMIT = 20;

export interface SearchResult {
  userId: string;
  displayName: string;
}

export async function searchByDisplayName(prefix: string): Promise<SearchResult[]> {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return [];
  const database = drizzle(env.DIALED_CORE);
  const rows = await database
    .select({ userId: userProfiles.userId, displayName: userProfiles.displayName })
    .from(userProfiles)
    .where(like(userProfiles.displayName, `${trimmed}%`))
    .limit(RESULT_LIMIT);
  return rows
    .filter((r): r is { userId: string; displayName: string } => r.displayName !== null)
    .map((r) => ({ userId: r.userId, displayName: r.displayName }));
}
