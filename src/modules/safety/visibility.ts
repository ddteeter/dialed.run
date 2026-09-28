/**
 * What "visible to the public" means for an entry, in one place.
 *
 * Before 106 this was a single condition — `is_public = 1` — and every read
 * that needed it simply wrote it. A second condition turns that into five
 * copies of a rule, and CLAUDE.md is explicit about what happens next: a
 * hand-written second copy is not a duplicate of the truth, it is a rival
 * truth, and the compiler stays silent while they drift. The one that
 * matters most is the consensus aggregate, where a missed clause does not
 * hide anything visibly — it just quietly counts a removed entry in the
 * numbers everyone reads.
 *
 * So the predicate lives here, and the places that show entries to
 * strangers import it.
 */
import { and, eq, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  blocks,
  outfitEntries,
  reports,
  userProfiles,
} from "../../db/schema-core";

/**
 * The entry is shared by its author, nothing is pending or settled against
 * it, and its author is not banned — and, when a viewer is named, the
 * viewer and the author have not blocked each other and the viewer has not
 * reported it.
 *
 * **One rule, two forms, and the difference is who is asking.** Without a
 * viewer this is the anonymous rule: what may count in a number everyone
 * reads. The consensus aggregate uses that form on purpose, because a block
 * and a reporter's own hide are the viewer's business and must not move a
 * count anybody else sees (`docs/contracts.md`) — while a banned author's
 * entries stop counting for everybody. Every read that shows entries to a
 * person names them, and gets the rest.
 *
 * **All of it in SQL** (D-107, D-108). Each clause is a `NOT EXISTS` on an
 * index the table already has, so a `LIMIT` after it returns the first N
 * survivors, not the survivors of the first N — the failure CLAUDE.md's D1
 * discipline names, and the one a post-query filter would have walked
 * straight into.
 *
 * Column order still matches `entries_public_created` (is_public,
 * moderation_status, created_at), so a caller that adds a `created_at`
 * range gets two equalities then a range — an index seek rather than a
 * scan. The subqueries run per surviving row, each a primary-key or
 * unique-index probe.
 */
export function publiclyVisibleEntry(viewerId?: string): SQL | undefined {
  return and(
    eq(outfitEntries.isPublic, true),
    eq(outfitEntries.moderationStatus, "ok"),
    authorNotBanned(),
    ...(viewerId === undefined
      ? []
      : [notBlockedEitherWay(viewerId), notReportedBy(viewerId)]),
  );
}

/**
 * What a signed-in viewer may open: their own entry whatever its state —
 * "fail open for the owner" — and anyone else's by the rule above.
 *
 * The owner half is why this is a second export rather than an argument:
 * a feed of strangers must never pick it up, and a read of one entry
 * (detail, a photo, a Useful) always needs it.
 */
export function entryVisibleTo(viewerId: string): SQL | undefined {
  return or(eq(outfitEntries.userId, viewerId), publiclyVisibleEntry(viewerId));
}

/**
 * A ban hides everything its runner posted (packet 106 §4, audit 0.3). The
 * profile's primary key answers it, and a runner with no profile row is
 * not banned — the same default `banStateOf` keeps.
 */
function authorNotBanned(): SQL {
  return sql`not exists (select 1 from ${userProfiles} where ${userProfiles.userId} = ${outfitEntries.userId} and ${userProfiles.bannedAt} is not null)`;
}

/**
 * W2 promises both directions: "They can't see your entries" and "You
 * won't see them in the feed". One row, read from both ends — `blocks_pk`
 * leads on `blocker_id`, `blocks_blocked` on `blocked_id`.
 */
function notBlockedEitherWay(viewerId: string): SQL {
  return sql`not exists (select 1 from ${blocks} where (${blocks.blockerId} = ${viewerId} and ${blocks.blockedId} = ${outfitEntries.userId}) or (${blocks.blockerId} = ${outfitEntries.userId} and ${blocks.blockedId} = ${viewerId}))`;
}

/**
 * W1: "The entry is hidden from your feed straight away, whatever we
 * decide." The report row is the hide, and only for the person who filed
 * it — `reports_one_per_reporter` is (reporter, type, subject), exactly
 * this probe.
 */
function notReportedBy(viewerId: string): SQL {
  return sql`not exists (select 1 from ${reports} where ${reports.reporterId} = ${viewerId} and ${reports.subjectType} = 'entry' and ${reports.subjectId} = ${outfitEntries.id})`;
}

/**
 * D-62, the safety half (SAF-9): the entry is hidden pending review **and**
 * the viewer is its author — the one person who still sees it, and so the
 * one person who needs telling why nobody else does. The feed renders the
 * marker (129, FEED-6); this is what it asks.
 *
 * `removed` is not "under review": a person has decided, and the author
 * learns that through the content-removed notice instead.
 */
export function isUnderReviewForAuthor(
  entry: { userId: string; moderationStatus: string },
  viewerId: string | undefined,
): boolean {
  return (
    entry.moderationStatus === "hidden_pending_review" &&
    entry.userId === viewerId
  );
}

/**
 * The one `screen_status` a photo may be public with.
 *
 * Named rather than written as a bare `"pass"` at each site, because
 * three reads and one SQL predicate have to agree and a fourth reader
 * with its own spelling is how a gate stops gating.
 */
export const publicPhotoStatus = "pass";
