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
  // Equivalent mutants, both on the same idea: a `LIKE` never matches
  // NULL, so the filter cannot drop a row and the raw rows already have
  // the shape below. It is here because the column is nullable and the
  // result type promises a name — a compiler-driven guard, not a runtime
  // one.
  // Stryker disable next-line ConditionalExpression,MethodExpression
  return rows.filter(isNamed).map((r) => ({ userId: r.userId, displayName: r.displayName }));
}

function isNamed(row: {
  userId: string;
  displayName: string | null;
}): row is SearchResult {
  // Stryker disable next-line ConditionalExpression
  return row.displayName !== null;
}
