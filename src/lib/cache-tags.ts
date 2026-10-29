/**
 * The tags a public page is stored under at the edge, and what a purge
 * names (design 160, D-152): `entry:<id>`, `runner:<userId>` and
 * `handle:<handle>`.
 *
 * **In `lib` because the writers are everywhere.** A kit is taken back by
 * its runner (`feed`), by a report or a takedown (`safety`), by a ban
 * (`safety`), by leaving (`account`) or by a profile switch
 * (`onboarding`), and `ops` imports `safety` and `onboarding`, so they
 * cannot import the tags from `ops`. The page headers (`ops`) and the
 * purges read the same three functions here, so a page cannot be stored
 * under a tag no purge names.
 */

/**
The tag naming one kit's page and card.
*/
export function entryCacheTag(entryId: string): string {
  return `entry:${entryId}`;
}

/**
 * The tag naming everything a runner has on the open web, so one purge
 * covers a ban, a leaving or a handle change.
 */
export function runnerCacheTag(userId: string): string {
  return `runner:${userId}`;
}

/**
 * The tag naming the page at one handle's path, `/@<handle>`, public or
 * not (design 160): what a purge names when a profile is made public, so
 * the not-public page cached there gives way within the purge rather than
 * the TTL. It says nothing about who holds the handle, or whether anyone
 * does — the path already said the handle. `handle` is the normalized one
 * (lowercase), so `/@Maya` and `/@maya` share it.
 */
export function handleCacheTag(handle: string): string {
  return `handle:${handle}`;
}

/**
 * Purges these tags from the edge, in the background (design 160, D-152):
 * it never throws and never delays the write that asked (law 5). `ops`'
 * `purgePublicPages`, handed to the writers that cannot import `ops`, and a
 * spy in a test.
 */
export type PurgeTags = (tags: readonly string[]) => void;

/**
 * What taking a kit back purges: the kit's own page and card, and every
 * page of its runner's that lists it (the public profile). One purge for
 * both, since a purge is rate-limited per call, not per tag.
 */
export function kitCacheTags(runnerId: string, entryId: string): string[] {
  return [entryCacheTag(entryId), runnerCacheTag(runnerId)];
}

/**
 * What a change to a runner's profile purges: everything public of theirs
 * (`runner:`), and the not-public page cached at their handle's path, which
 * carries only the handle's tag. Only the runner's when they hold no
 * handle, since no page is at a path then.
 */
export function profileCacheTags(
  runnerId: string,
  handle: string | null | undefined,
): string[] {
  const runner = runnerCacheTag(runnerId);
  return typeof handle === "string"
    ? [runner, handleCacheTag(handle)]
    : [runner];
}
