/**
 * The tags a public page is stored under at the edge, and what a purge
 * names (design 163, D-154): `entry:<id>`, `runner:<userId>` and
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
 * not (design 163): what a purge names when a profile is made public, so
 * the not-public page cached there gives way within the purge rather than
 * the TTL. It says nothing about who holds the handle, or whether anyone
 * does — the path already said the handle. `handle` is the normalized one
 * (lowercase), so `/@Maya` and `/@maya` share it.
 */
export function handleCacheTag(handle: string): string {
  return `handle:${handle}`;
}

/**
 * Purges these tags from the edge, in the background (design 163, D-154):
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

/**
 * The kits and runners a purge names, read back from its tags (design
 * 163 step 8): what the public photo reconcile works through when a
 * purge goes out, so every path that takes a page back takes its
 * photos' copies back too, with no second call to forget. The prefixes
 * are the builders' own, so a tag cannot be built one way and read
 * another. A handle's tag names a path, not a kit or a runner, and is
 * left out.
 */
export interface TaggedScope {
  readonly entryIds: readonly string[];
  readonly runnerIds: readonly string[];
}

export function scopeOfTags(tags: readonly string[]): TaggedScope {
  return {
    entryIds: idsTagged(tags, entryCacheTag("")),
    runnerIds: idsTagged(tags, runnerCacheTag("")),
  };
}

/**
Each distinct id after `prefix`, among the tags that carry it.
*/
function idsTagged(tags: readonly string[], prefix: string): string[] {
  const ids = tags
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length));
  return [...new Set(ids)];
}
