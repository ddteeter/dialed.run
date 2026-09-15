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
import { and, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { outfitEntries } from "../../db/schema-core";

/**
 * The entry is shared by its author **and** nothing is pending or settled
 * against it.
 *
 * Column order matches `entries_public_created`
 * (is_public, moderation_status, created_at), so a caller that adds a
 * `created_at` range gets two equalities then a range — an index seek
 * rather than a scan. That ordering is the reason the migration put
 * `moderation_status` in the middle.
 */
export function publiclyVisibleEntry(): SQL | undefined {
  return and(
    eq(outfitEntries.isPublic, true),
    eq(outfitEntries.moderationStatus, "ok"),
  );
}

/**
 * The same rule for a row already in hand, for the two paths that read the
 * entry first and decide afterwards (a photo GET, a reaction write).
 *
 * Takes the two fields rather than a whole row so a caller cannot pass
 * something that merely looks like an entry, and so the `select` stays
 * narrow — D1 bills rows scanned, and both callers are on a hot path.
 */
export function isEntryPubliclyVisible(entry: {
  isPublic: boolean;
  moderationStatus: string;
}): boolean {
  return entry.isPublic && entry.moderationStatus === "ok";
}

/**
 * Whether the viewer is the author. The owner sees their own entry whatever
 * its moderation status — that is the "fail open for the owner" half of the
 * packet's rule, and it is why every call site pairs this with the check
 * above rather than replacing it.
 */
export function isOwnEntry(entry: { userId: string }, viewerId: string): boolean {
  return entry.userId === viewerId;
}
