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
} from "../../db/schema-core";
import { env } from "../../env";
import { garmentNamesByIds } from "./garment-names";
import { observationsForRuns } from "./conditions";
import type { Conditions } from "./conditions";
import { followeeIdsOf } from "./follows";
import { publicPhotoStatus, publiclyVisibleEntry } from "../safety";

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
  return or(
    lt(outfitEntries.createdAt, cursor.createdAt),
    sameInstantEarlierId,
  );
}

export function followingFeedStatement(
  database: DrizzleD1Database,
  userIds: readonly string[],
  cursor: FeedCursor | undefined,
  limit = PAGE_SIZE,
) {
  const scope = and(
    inArray(outfitEntries.userId, [...userIds]),
    publiclyVisibleEntry(),
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
  /**
  The run says it was indoors — the strip reads "INDOOR" rather than
  dropping its conditions cell (round 22, E1).
  */
  indoor: boolean;
  verdict: number | undefined;
  caption: string | undefined;
  createdAt: number;
  itemNames: string[];
  photoKeys: string[];
  tags: string[];
  usefulCount: number;
  /**
  Whether the viewer has already marked this one useful, so the card's
  control starts in the right state (round 22: Useful on the card).
  */
  viewerHasReacted: boolean;
  conditions: Conditions | undefined;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: FeedCursor | undefined;
  /**
  How many runners the viewer follows — what decides which tab the feed
  opens on (round 22: zero follows lands on Your conditions) and which
  sentence Following's empty state says.
  */
  followeeCount: number;
}

/**
 * Batches the core-DB hydration reads (CLAUDE.md D1 discipline: db.batch()).
 */
async function hydrateEntries(
  database: DrizzleD1Database,
  entryRows: (typeof outfitEntries.$inferSelect)[],
  viewerId: string,
): Promise<FeedItem[]> {
  // Equivalent mutant: an empty page produces empty reads and an empty
  // map either way. What the return saves is six queries and a batch on
  // every empty feed — which is what a new account sees.
  // Stryker disable next-line ConditionalExpression
  if (entryRows.length === 0) return [];
  const entryIds = entryRows.map((e) => e.id);
  const runIds = entryRows.map((e) => e.runId);
  const userIds = [...new Set(entryRows.map((e) => e.userId))];

  const runsQuery = database
    .select()
    .from(runs)
    .where(inArray(runs.id, runIds));
  const authorsQuery = database
    .select({
      userId: userProfiles.userId,
      displayName: userProfiles.displayName,
    })
    .from(userProfiles)
    .where(inArray(userProfiles.userId, userIds));
  const itemsQuery = database
    .select()
    .from(outfitEntryItems)
    .where(inArray(outfitEntryItems.entryId, entryIds));
  // A photo the classifier has not passed is shown to its author and to
  // nobody else, so the condition is per-entry rather than per-page: one
  // feed mixes the viewer's own entries with everyone else's. In SQL,
  // because a row a stranger may not see is a row D1 should not scan.
  const ownEntryIds = entryRows
    .filter((entry) => entry.userId === viewerId)
    .map((entry) => entry.id);
  const showable = or(
    eq(entryPhotos.screenStatus, publicPhotoStatus),
    inArray(entryPhotos.entryId, ownEntryIds),
  );
  const photosQuery = database
    .select()
    .from(entryPhotos)
    .where(and(inArray(entryPhotos.entryId, entryIds), showable))
    .orderBy(entryPhotos.entryId, entryPhotos.position);
  const tagsQuery = database
    .select()
    .from(entryTagsTable)
    .where(inArray(entryTagsTable.entryId, entryIds));
  const reactionsQuery = database
    .select({ entryId: reactions.entryId })
    .from(reactions)
    .where(inArray(reactions.entryId, entryIds));
  // Which of these the viewer has marked, so each card's Useful starts in
  // the right state (round 22). Its own read on the same primary key
  // rather than a column on every reaction row: one row per mark, and
  // only the viewer's.
  const viewerMarks = and(
    eq(reactions.userId, viewerId),
    inArray(reactions.entryId, entryIds),
  );
  const markedQuery = database
    .select({ entryId: reactions.entryId })
    .from(reactions)
    .where(viewerMarks);

  const [
    runRows,
    authorRows,
    itemRows,
    photoRows,
    tagRows,
    reactionRows,
    markedRows,
  ] = await database.batch([
    runsQuery,
    authorsQuery,
    itemsQuery,
    photosQuery,
    tagsQuery,
    reactionsQuery,
    markedQuery,
  ]);

  const runsById = new Map(runRows.map((r) => [r.id, r]));
  const authorsById = new Map(authorRows.map((a) => [a.userId, a]));
  const itemIds = [...new Set(itemRows.map((i) => i.itemId))];
  const garmentNameById = await garmentNamesByIds(database, itemIds);

  const observations = await observationsForRuns(runRows);

  const usefulCounts = new Map<string, number>();
  for (const row of reactionRows) {
    usefulCounts.set(row.entryId, (usefulCounts.get(row.entryId) ?? 0) + 1);
  }
  const reactedByViewer = new Set(markedRows.map((row) => row.entryId));

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
      // Block pair rather than `next-line`: prettier wraps this property
      // onto a second line and the `?.` lives there, so `next-line` was
      // pointing at the key and covering nothing.
      // Stryker disable OptionalChaining
      authorDisplayName:
        authorsById.get(entry.userId)?.displayName ?? undefined,
      // Stryker restore OptionalChaining
      runId: entry.runId,
      runTitle: run?.title ?? "Run",
      distanceM: run?.distanceM ?? 0,
      durationS: run?.durationS ?? 0,
      startedAt: run?.startedAt ?? entry.createdAt,
      indoor: run?.indoor ?? false,
      verdict: entry.verdict ?? undefined,
      caption: entry.caption ?? undefined,
      createdAt: entry.createdAt,
      itemNames: itemRows
        .filter((i) => i.entryId === entry.id)
        .map((i) => garmentNameById.get(i.itemId) ?? "[removed item]"),
      photoKeys: photosForEntry.map((p) => p.photoKey),
      tags: tagRows.filter((t) => t.entryId === entry.id).map((t) => t.tag),
      usefulCount: usefulCounts.get(entry.id) ?? 0,
      viewerHasReacted: reactedByViewer.has(entry.id),
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
  const rows = await followingFeedStatement(
    database,
    userIds,
    cursor,
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const items = await hydrateEntries(database, page, viewerId);
  const last = page.at(-1);
  return {
    items,
    followeeCount: followeeIds.length,
    nextCursor:
      last && rows.length > limit
        ? { createdAt: last.createdAt, id: last.id }
        : undefined,
  };
}
