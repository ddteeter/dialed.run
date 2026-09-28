/**
 * Runner search: prefix match on `user_profiles.username`, public
 * profiles only (all profiles are public at MVP — see design doc), served
 * by the NOCASE expression index.
 *
 * Round 22's item 15 ruling draws the row as avatar, name and a Follow
 * pill inline, so each result carries whether the viewer already follows
 * them — one covering-index read for the whole page, not one per row. The
 * viewer is never a result: following yourself is not a thing.
 *
 * Nor is a banned runner, or anyone in a block pair with the viewer
 * (FEED-7, D-107): W2 says a blocked runner cannot find you in search and
 * you will not see them there. Both in the `WHERE`, ahead of the `LIMIT`,
 * so twenty hidden matches cannot leave an empty page that looks real.
 * Nor, for the viewer alone, a runner whose profile they reported (D-68).
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { follows, userProfiles } from "../../db/schema-core";
import { env } from "../../env";
import { normalizeUsername } from "../../lib/contracts";
import { columnWhere } from "../../lib/keyed-read";
import { runnersVisibleTo } from "./runner-visibility";

const RESULT_LIMIT = 20;

/**
 * `typed` as a LIKE prefix that matches only itself: `_` is in nearly
 * every handle and is LIKE's any-one-character, so unescaped `maya_` would
 * find `mayax`. One pass over the three, so a `\` added as an escape is
 * never escaped again.
 */
function likePrefix(typed: string): string {
  const escaped = typed.replaceAll(/[\\%_]/gu, String.raw`\$&`);
  return `${escaped}%`;
}

export interface SearchResult {
  userId: string;
  username: string;
  following: boolean;
}

/**
 * The read behind search, as a statement so a test can read its plan: the
 * prefix off `user_profiles_username_nocase`, and the block pair two
 * primary-key probes per candidate.
 */
export function searchStatement(
  database: DrizzleD1Database,
  viewerId: string,
  typed: string,
) {
  return runnersVisibleTo(
    database,
    viewerId,
    and(
      // ESCAPE with an ASCII character keeps SQLite's LIKE optimisation,
      // so the prefix is still served by the NOCASE index.
      sql`${userProfiles.username} LIKE ${likePrefix(typed)} ESCAPE '\\'`,
      ne(userProfiles.userId, viewerId),
    ),
  ).limit(RESULT_LIMIT);
}

export async function searchRunners(
  viewerId: string,
  prefix: string,
): Promise<SearchResult[]> {
  // The handle as it is stored: no "@", no spaces, lowercased — the field
  // shows "@" before a handle, so a runner may well type one.
  const typed = normalizeUsername(prefix);
  if (typed.length === 0) return [];
  const database = drizzle(env.DIALED_CORE);
  const rows = await searchStatement(database, viewerId, typed);
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
    username: r.username,
    following: followed.has(r.userId),
  }));
}
// Stryker restore ConditionalExpression,MethodExpression

function isNamed<T extends { username: string | null }>(
  row: T,
): row is T & { username: string } {
  // Stryker disable next-line ConditionalExpression
  return row.username !== null;
}
