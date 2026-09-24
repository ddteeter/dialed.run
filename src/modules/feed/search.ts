/**
 * Runner search: prefix match on `user_profiles.display_name`, public
 * profiles only (all profiles are public at MVP — see design doc), served
 * by the NOCASE expression index.
 *
 * Round 22's item 15 ruling draws the row as avatar, name and a Follow
 * pill inline, so each result carries whether the viewer already follows
 * them — one covering-index read for the whole page, not one per row. The
 * viewer is never a result: following yourself is not a thing.
 */
import { and, eq, inArray, like, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { follows, userProfiles } from "../../db/schema-core";
import { env } from "../../env";
import { columnWhere } from "../../lib/keyed-read";

const RESULT_LIMIT = 20;

export interface SearchResult {
  userId: string;
  displayName: string;
  following: boolean;
}

export async function searchRunners(
  viewerId: string,
  prefix: string,
): Promise<SearchResult[]> {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return [];
  const database = drizzle(env.DIALED_CORE);
  const rows = await database
    .select({
      userId: userProfiles.userId,
      displayName: userProfiles.displayName,
    })
    .from(userProfiles)
    .where(
      and(
        like(userProfiles.displayName, `${trimmed}%`),
        ne(userProfiles.userId, viewerId),
      ),
    )
    .limit(RESULT_LIMIT);
  const found = rows.map((row) => row.userId);
  const followedAmongFound = and(
    eq(follows.followerId, viewerId),
    inArray(follows.followeeId, found),
  );
  const followed = new Set(
    await columnWhere(
      database,
      follows,
      follows.followeeId,
      followedAmongFound,
    ),
  );
  // Equivalent mutants, both on the same idea: a `LIKE` never matches
  // NULL, so the filter cannot drop a row and the raw rows already have
  // the shape below. It is here because the column is nullable and the
  // result type promises a name — a compiler-driven guard, not a runtime
  // one.
  // Block pair, not `next-line`: prettier wraps this expression across
  // several lines, and a `next-line` directive only ever covers the first.
  //
  // The `restore` sits after the closing brace because Stryker reads
  // directives from a node's *leading* comments, and a comment on the last
  // line before `}` leads no node — it is the previous statement's
  // trailing comment. (guardrails 0.6.0 sanction-placement)
  // Stryker disable ConditionalExpression,MethodExpression
  return rows.filter(isNamed).map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    following: followed.has(r.userId),
  }));
}
// Stryker restore ConditionalExpression,MethodExpression

function isNamed(row: {
  userId: string;
  displayName: string | null;
}): row is { userId: string; displayName: string } {
  // Stryker disable next-line ConditionalExpression
  return row.displayName !== null;
}
