/**
 * Following feed (E1) — fanout-on-read, no feed table, no write
 * amplification (docs/architecture.md "Feed read paths"). The statement
 * builder is exported separately so tests can pull `.toSQL()` off it and
 * run `EXPLAIN QUERY PLAN` without duplicating the query.
 */
import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";

import {
  entryPhotos,
  entryTags as entryTagsTable,
  follows,
  outfitEntries,
  outfitEntryItems,
  reactions,
  runs,
  userProfiles,
} from "../../db/schema-core";
import { env } from "../../env";
import { SHARED_AUDIENCE } from "../../lib/contracts";
import { garmentNamesByIds } from "./garment-names";
import { observationsForRuns } from "./conditions";
import type { Conditions } from "./conditions";
import { followingCount } from "./follows";
import {
  isUnderReviewForAuthor,
  publicPhotoStatus,
  publiclyVisibleEntry,
} from "../safety";

export interface FeedCursor {
  createdAt: number;
  id: string;
}

const PAGE_SIZE = 20;

type ModerationStatus = (typeof outfitEntries.$inferSelect)["moderationStatus"];

/**
 * Strictly older than the cursor, in `(created_at, id)` order.
 *
 * **The leading `created_at <= ?` is what makes it a seek.** The bare
 * `created_at < ? OR (created_at = ? AND id < ?)` is equivalent, but an OR
 * across two shapes gives the planner no range, and D1's plan read each
 * author's entries from their newest rather than from the cursor — so
 * page k re-read the k − 1 pages before it. With the conjunct, the
 * `entries_user_audience_created` seek starts at the cursor (`feed.test.ts`
 * pins `created_at<?` in the plan).
 */
function feedCursorPredicate(cursor: FeedCursor) {
  return and(
    lte(outfitEntries.createdAt, cursor.createdAt),
    or(
      lt(outfitEntries.createdAt, cursor.createdAt),
      lt(outfitEntries.id, cursor.id),
    ),
  );
}

/**
 * One page of E1: the viewer's own shared entries and those of everyone
 * they follow, newest first.
 *
 * **Driven from the authors, each read to at most a page** (FEED-5
 * review). The statement is
 *
 *     authors (the viewer's followees, and the viewer)
 *       CROSS JOIN page
 *       WHERE page.id IN (that author's newest `limit` shared entries
 *                         past the cursor)
 *
 * so the rows it scans are at most `limit` per author — they scale with
 * who the viewer follows, never with how many runners the site has. The
 * earlier shape seeked the site-wide index across every runner's
 * shared entries and checked each author against the followee set row by
 * row, so a viewer following a few quiet runners walked the whole site
 * looking for a page. Taking each author's top `limit` loses nothing: the
 * page's newest `limit` across all authors are all inside the union of
 * each author's newest `limit`.
 *
 * `CROSS JOIN` is load-bearing, not style: it is SQLite's one way of
 * fixing the join order, and without it the planner prefers the
 * site-wide index because it reads in `ORDER BY` order and can stop at the
 * `LIMIT`. Each author's read is an `entries_user_audience_created` seek;
 * the outer sort is over at most `limit` × authors rows.
 *
 * **The authors are a subquery, not a bound list** (R-101). Binding the
 * ids put one parameter per follow into the statement, and the 93rd follow
 * crossed D1's 100-parameter cap. The viewer joins the set through their
 * own `user` row — a primary-key read, and a row that exists for anyone
 * holding a session. `feed.test.ts` pins the plan.
 *
 * Each author's read goes through the one visibility rule told who is
 * looking, so a blocked pair and what the viewer reported drop out in SQL,
 * ahead of the `LIMIT` (task 128, SAF-12/13).
 *
 * **The author always sees their own shared entries, under review
 * included** (D-67, FEED-6). Each author row carries the one
 * `moderation_status` it reads: `ok` for everyone, plus a second row for
 * the viewer alone asking for `hidden_pending_review`. So the status stays
 * an equality in the seek — `moderation_status = authors.status` — rather
 * than an `IN` that would cost each author a sort over their history, and
 * the arm that skips the visibility rule can only ever name the viewer.
 * Nobody else's under-review entry has an author row that asks for it.
 */
export function followingFeedStatement(
  database: DrizzleD1Database,
  viewerId: string,
  cursor: FeedCursor | undefined,
  limit = PAGE_SIZE,
) {
  const authors = database
    .select({
      id: follows.followeeId,
      status: sql<ModerationStatus>`'ok'`.as("status"),
    })
    .from(follows)
    .where(eq(follows.followerId, viewerId))
    .unionAll(
      // The viewer as constant rows: `select ? from (select 1)`. Drizzle
      // has no select without a `from`, and borrowing a table for it would
      // make the viewer's own entries depend on a row existing there.
      database
        .select({
          id: sql<string>`${viewerId}`,
          status: sql<ModerationStatus>`'ok'`,
        })
        .from(sql`(select 1)`),
    )
    .unionAll(
      database
        .select({
          id: sql<string>`${viewerId}`,
          status: sql<ModerationStatus>`'hidden_pending_review'`,
        })
        .from(sql`(select 1)`),
    )
    .as("authors");
  const page = alias(outfitEntries, "page");
  // The viewer's under-review row skips the rule for strangers; every
  // other author row goes through it.
  const shownToViewer = or(
    eq(authors.status, "hidden_pending_review"),
    publiclyVisibleEntry(viewerId),
  );
  const authorsNewest = database
    .select({ id: outfitEntries.id })
    .from(outfitEntries)
    .where(
      and(
        eq(outfitEntries.userId, authors.id),
        eq(outfitEntries.audience, SHARED_AUDIENCE),
        eq(outfitEntries.moderationStatus, authors.status),
        shownToViewer,
        cursor ? feedCursorPredicate(cursor) : undefined,
      ),
    )
    .orderBy(desc(outfitEntries.createdAt), desc(outfitEntries.id))
    .limit(limit);
  return database
    .select(getTableColumns(page))
    .from(authors)
    .crossJoin(page)
    .where(inArray(page.id, authorsNewest))
    .orderBy(desc(page.createdAt), desc(page.id))
    .limit(limit);
}

export interface FeedItem {
  entryId: string;
  userId: string;
  authorUsername: string | undefined;
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
  /**
  The viewer's own entry, hidden from everyone else pending review — the
  card says so (R-62, D-67). Always false on anyone else's: nobody else
  is ever shown one.
  */
  underReview: boolean;
  /**
  The viewer's own post, which says so after its time (the Feed board's
  "E1 Card states": `SAT · 6:30 AM · YOU`).
  */
  isOwn: boolean;
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
      username: userProfiles.username,
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
  const markedQuery = database
    .select({ entryId: reactions.entryId })
    .from(reactions)
    .where(
      and(eq(reactions.userId, viewerId), inArray(reactions.entryId, entryIds)),
    );

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
      authorUsername: authorsById.get(entry.userId)?.username ?? undefined,
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
      underReview: isUnderReviewForAuthor(entry, viewerId),
      isOwn: entry.userId === viewerId,
    };
  });
}

export async function followingFeed(
  viewerId: string,
  cursor?: FeedCursor,
  limit = PAGE_SIZE,
): Promise<FeedPage> {
  const database = drizzle(env.DIALED_CORE);
  const [rows, followeeCount] = await Promise.all([
    followingFeedStatement(database, viewerId, cursor, limit + 1),
    followingCount(viewerId),
  ]);
  const page = rows.slice(0, limit);
  const items = await hydrateEntries(database, page, viewerId);
  const last = page.at(-1);
  return {
    items,
    followeeCount,
    nextCursor:
      last && rows.length > limit
        ? { createdAt: last.createdAt, id: last.id }
        : undefined,
  };
}
