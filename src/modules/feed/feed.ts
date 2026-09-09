/**
 * Following feed (E1) — fanout-on-read, no feed table, no write
 * amplification (docs/architecture.md "Feed read paths"). The statement
 * builder is exported separately so tests can pull `.toSQL()` off it and
 * run `EXPLAIN QUERY PLAN` without duplicating the query.
 */
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  entryPhotos,
  entryTags as entryTagsTable,
  outfitEntries,
  outfitEntryItems,
  reactions,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../db/schema-core";
import { env } from "../../env";
import { forIds } from "../../lib/for-ids";
import { observationsForRuns } from "./conditions";
import type { Conditions } from "./conditions";
import { followeeIdsOf } from "./follows";

export interface FeedCursor {
  createdAt: number;
  id: string;
}

const PAGE_SIZE = 20;


function feedCursorPredicate(cursor: FeedCursor) {
  const sameInstantEarlierId = and(
    eq(outfitEntries.createdAt, cursor.createdAt),
    lt(outfitEntries.id, cursor.id),
  );
  return or(lt(outfitEntries.createdAt, cursor.createdAt), sameInstantEarlierId);
}

export function followingFeedStatement(
  database: DrizzleD1Database,
  userIds: readonly string[],
  cursor: FeedCursor | undefined,
  limit = PAGE_SIZE,
) {
  const scope = and(
    inArray(outfitEntries.userId, [...userIds]),
    eq(outfitEntries.isPublic, true),
    cursor ? feedCursorPredicate(cursor) : undefined,
  );
  return database
    .select()
    .from(outfitEntries)
    .where(scope)
    .orderBy(desc(outfitEntries.createdAt), desc(outfitEntries.id))
    .limit(limit);
}

export interface FeedItem {
  entryId: string;
  userId: string;
  authorDisplayName: string | undefined;
  runId: string;
  runTitle: string;
  distanceM: number;
  durationS: number;
  startedAt: number;
  verdict: number | undefined;
  caption: string | undefined;
  createdAt: number;
  itemNames: string[];
  photoKeys: string[];
  tags: string[];
  usefulCount: number;
  conditions: Conditions | undefined;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: FeedCursor | undefined;
}

/**
 * Batches the core-DB hydration reads (CLAUDE.md D1 discipline: db.batch()).
 */
async function hydrateEntries(
  database: DrizzleD1Database,
  entryRows: (typeof outfitEntries.$inferSelect)[],
): Promise<FeedItem[]> {
  // Equivalent mutant: an empty page produces empty reads and an empty
  // map either way. What the return saves is six queries and a batch on
  // every empty feed — which is what a new account sees.
  // Stryker disable next-line ConditionalExpression
  if (entryRows.length === 0) return [];
  const entryIds = entryRows.map((e) => e.id);
  const runIds = entryRows.map((e) => e.runId);
  const userIds = [...new Set(entryRows.map((e) => e.userId))];

  const runsQuery = database.select().from(runs).where(inArray(runs.id, runIds));
  const authorsQuery = database
    .select({ userId: userProfiles.userId, displayName: userProfiles.displayName })
    .from(userProfiles)
    .where(inArray(userProfiles.userId, userIds));
  const itemsQuery = database
    .select()
    .from(outfitEntryItems)
    .where(inArray(outfitEntryItems.entryId, entryIds));
  const photosQuery = database
    .select()
    .from(entryPhotos)
    .where(inArray(entryPhotos.entryId, entryIds))
    .orderBy(entryPhotos.entryId, entryPhotos.position);
  const tagsQuery = database
    .select()
    .from(entryTagsTable)
    .where(inArray(entryTagsTable.entryId, entryIds));
  const reactionsQuery = database
    .select({ entryId: reactions.entryId })
    .from(reactions)
    .where(inArray(reactions.entryId, entryIds));

  const [runRows, authorRows, itemRows, photoRows, tagRows, reactionRows] =
    await database.batch([
      runsQuery,
      authorsQuery,
      itemsQuery,
      photosQuery,
      tagsQuery,
      reactionsQuery,
    ]);

  const runsById = new Map(runRows.map((r) => [r.id, r]));
  const authorsById = new Map(authorRows.map((a) => [a.userId, a]));
  const itemIds = [...new Set(itemRows.map((i) => i.itemId))];
  const garments = await forIds(itemIds, () =>
    database
      .select({ id: wardrobeItems.id, name: wardrobeItems.name })
      .from(wardrobeItems)
      .where(inArray(wardrobeItems.id, itemIds)),
  );
  const garmentNameById = new Map(garments.map((g) => [g.id, g.name]));

  const observations = await observationsForRuns(runRows);

  const usefulCounts = new Map<string, number>();
  for (const row of reactionRows) {
    usefulCounts.set(row.entryId, (usefulCounts.get(row.entryId) ?? 0) + 1);
  }

  return entryRows.map((entry) => {
    const run = runsById.get(entry.runId);
    // photosQuery is ordered by (entryId, position) in SQL, so this filter
    // preserves position order without an in-memory sort.
    const photosForEntry = photoRows.filter((p) => p.entryId === entry.id);
    return {
      entryId: entry.id,
      userId: entry.userId,
      // Equivalent mutant on the optional chain: every entry's author is
      // in the batch that fetched them, so the lookup always hits. It is
      // here because `Map#get` is typed as possibly missing.
      // Stryker disable next-line OptionalChaining
      authorDisplayName: authorsById.get(entry.userId)?.displayName ?? undefined,
      runId: entry.runId,
      runTitle: run?.title ?? "Run",
      distanceM: run?.distanceM ?? 0,
      durationS: run?.durationS ?? 0,
      startedAt: run?.startedAt ?? entry.createdAt,
      verdict: entry.verdict ?? undefined,
      caption: entry.caption ?? undefined,
      createdAt: entry.createdAt,
      itemNames: itemRows
        .filter((i) => i.entryId === entry.id)
        .map((i) => garmentNameById.get(i.itemId) ?? "[removed item]"),
      photoKeys: photosForEntry.map((p) => p.photoKey),
      tags: tagRows.filter((t) => t.entryId === entry.id).map((t) => t.tag),
      usefulCount: usefulCounts.get(entry.id) ?? 0,
      conditions: run ? observations.get(run.id) : undefined,
    };
  });
}

export async function followingFeed(
  viewerId: string,
  cursor?: FeedCursor,
  limit = PAGE_SIZE,
): Promise<FeedPage> {
  const database = drizzle(env.DIALED_CORE);
  const followeeIds = await followeeIdsOf(viewerId);
  const userIds = [viewerId, ...followeeIds];
  const rows = await followingFeedStatement(database, userIds, cursor, limit + 1);
  const page = rows.slice(0, limit);
  const items = await hydrateEntries(database, page);
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      last && rows.length > limit ? { createdAt: last.createdAt, id: last.id } : undefined,
  };
}
