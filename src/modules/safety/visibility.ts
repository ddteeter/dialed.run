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
 *
 * **This is the public half only.** The owner sees their own entry
 * whatever its moderation status — the "fail open for the owner" half of
 * the packet's rule — so every call site pairs this with an ownership
 * check rather than replacing it. There was an `isOwnEntry` here for
 * that, exported and called by nobody: both call sites compare the two
 * ids themselves, which is plainer than a function wrapping `===`.
 */
export function isEntryPubliclyVisible(entry: {
  isPublic: boolean;
  moderationStatus: string;
}): boolean {
  return entry.isPublic && entry.moderationStatus === "ok";
}

/**
 * The one `screen_status` a photo may be public with.
 *
 * Named rather than written as a bare `"pass"` at each site, because
 * three reads and one SQL predicate have to agree and a fourth reader
 * with its own spelling is how a gate stops gating.
 */
export const publicPhotoStatus = "pass";

/**
 * Whether a photo may be shown to somebody who does not own it.
 *
 * **The classifier's verdict was written and never read.** `screenPhoto`
 * has always recorded `pass` / `hidden_pending_review` on
 * `entry_photos.screen_status`, and until this predicate existed nothing
 * consulted it: `isPhotoVisible` asked only about the ENTRY, so a photo
 * the model flagged as explicit was served to strangers with HTTP 200 on
 * any public entry. The test that was supposed to catch it — "hides a
 * flagged photo from everyone but its owner" — asserted the column value
 * and never asked whether anyone could see it.
 *
 * Pending counts as not-public too, and deliberately: an unscreened photo
 * is one nothing has looked at, which is the state the whole path exists
 * to keep off the public feed until the sweep runs.
 */
export function isPhotoPubliclyVisible(photo: {
  screenStatus: string;
}): boolean {
  return photo.screenStatus === publicPhotoStatus;
}
