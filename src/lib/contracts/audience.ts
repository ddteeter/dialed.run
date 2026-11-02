/**
 * Audience — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 *
 * Who may see an entry, and who a runner's new entries are for by default
 * (decision D-109, design 131). It replaced two booleans, an entry's
 * sharing flag and the runner's sharing default (dropped in design 131's
 * C2), because groups need a third answer that a boolean cannot hold.
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
export const audiences = ["private", "groups", "runners", "world"] as const;

/**
The stored and read type: every audience, `groups` included.
*/
export const audienceSchema = z.enum(audiences);
export type Audience = z.infer<typeof audienceSchema>;

/**
 * What a writer may store until groups ship: `private`, `runners` and
 * `world` (PRIVATE / SHARED / PUBLIC on screen; `world` is D-151's open
 * web, round 41 #86a).
 *
 * `extract`, not `exclude(["groups"])`, on purpose: a fourth audience
 * added later is unwritable until it is named here, rather than writable
 * by default because nobody remembered to exclude it.
 */
export const writableAudienceSchema = audienceSchema.extract([
  "private",
  "runners",
  "world",
]);
export type WritableAudience = z.infer<typeof writableAudienceSchema>;

/**
 * SHARED on screen: runners signed in to dialed.run. A new runner's
 * default.
 */
export const SHARED_AUDIENCE = "runners" satisfies WritableAudience;

/**
 * PUBLIC on screen: anyone with the link, no sign-in (D-151). Only
 * `safety/visibility.ts`'s `worldVisibleEntry` shows it to a signed-out
 * visitor.
 */
export const WORLD_AUDIENCE = "world" satisfies WritableAudience;

/**
 * The audiences a signed-in stranger sees: a public kit is shared too, so
 * it counts in the feed, consensus and "worn by N" like a SHARED one.
 * Every read that shows an entry to someone other than its author tests
 * for these and nothing else (`safety/visibility.ts`'s one rule,
 * `feed/feed.ts`'s index seek), so a `groups` row is hidden from strangers
 * without anyone having to remember it.
 */
export const strangerAudiences = [
  SHARED_AUDIENCE,
  WORLD_AUDIENCE,
] as const satisfies readonly WritableAudience[];

/**
 * Whether a signed-in stranger may see an entry with this audience: the
 * in-memory reading of `strangerAudiences`, for a row already loaded.
 */
export function isStrangerAudience(audience: Audience): boolean {
  const shown: readonly Audience[] = strangerAudiences;
  return shown.includes(audience);
}

/**
 * A stored audience as a writer may store it again: itself when it is
 * writable, and `private` for `groups`, which nothing can write until
 * groups ship. Of the audiences a new entry may start with, `private` shows
 * nobody who was not meant to see it.
 */
export function writableAudienceOf(audience: Audience): WritableAudience {
  const parsed = writableAudienceSchema.safeParse(audience);
  return parsed.success ? parsed.data : "private";
}

/**
 * The word a file a person reads writes for each audience: the export's
 * `audience` and `default_audience` columns now, design 130's API
 * `visibility` later. They are the UI's words (PUBLIC / SHARED / PRIVATE on
 * screen; D-109: files write the UI's words), so `runners` itself never
 * leaves the server.
 */
export const audienceWord = {
  private: "private",
  groups: "groups",
  runners: "shared",
  world: "public",
} as const satisfies Record<Audience, string>;
export type AudienceWord = (typeof audienceWord)[Audience];
