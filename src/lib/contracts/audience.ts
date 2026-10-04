/**
 * Audience — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 *
 * Who may see an entry, and who a runner's new entries are for by default
 * (decision D-109, design 131). It replaces two booleans,
 * `outfit_entries.is_public` and `user_profiles.share_default`, because
 * groups need a third answer that a boolean cannot hold.
 */
import { z } from "zod";

// ---- Audience -------------------------------------------------------------

/**
 * Every audience an entry can be stored with, and so every one a reader
 * must handle.
 *
 * A tuple rather than only the schema because drizzle's `text` enum needs
 * a non-empty tuple, and zod 4's `.options` is typed as a plain array. The
 * schema below is built from this, so there is still one list.
 */
export const audiences = ["private", "groups", "runners"] as const;

/**
The stored and read type: all three, `groups` included.
*/
export const audienceSchema = z.enum(audiences);
export type Audience = z.infer<typeof audienceSchema>;

/**
 * What a writer may store until groups ship: launch writes only `private`
 * and `runners` (PRIVATE / SHARED on screen).
 *
 * `extract`, not `exclude(["groups"])`, on purpose: a fourth audience
 * added later is unwritable until it is named here, rather than writable
 * by default because nobody remembered to exclude it.
 */
export const writableAudienceSchema = audienceSchema.extract([
  "private",
  "runners",
]);
export type WritableAudience = z.infer<typeof writableAudienceSchema>;

/**
 * The one audience strangers see. Every read that shows an entry to
 * someone other than its author tests for this value and nothing else
 * (`safety/visibility.ts`'s one rule, `feed/feed.ts`'s index seek), so a
 * `groups` row is hidden from strangers without anyone having to remember
 * it.
 */
export const SHARED_AUDIENCE = "runners" satisfies WritableAudience;

/**
 * The audience a sharing switch stands for. A3's checkbox and the Settings
 * toggle stay on/off in the UI; this is where on/off becomes an audience.
 */
export function audienceOfShareToggle(isOn: boolean): WritableAudience {
  return isOn ? SHARED_AUDIENCE : "private";
}

/**
 * Whether an audience is the shared one: the switch's position for a
 * stored audience, and the boolean the dual write keeps in step until the
 * booleans are dropped (design 131, C1). `groups` is not shared: it is
 * hidden from strangers.
 */
export function isSharedAudience(audience: Audience): boolean {
  return audience === SHARED_AUDIENCE;
}
