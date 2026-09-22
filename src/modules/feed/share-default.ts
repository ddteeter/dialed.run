import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";

/**
 * Whether this runner's entries are public unless they say otherwise.
 *
 * *"Entries are public by default with a per-entry toggle and a per-user
 * default preference"* (CLAUDE.md §Product rules). Two surfaces in this
 * module need the answer and were about to read it twice: `attachKit`,
 * which stamps it on a new entry, and the verdict backlog, whose rows have
 * no sharing control of their own and so carry the default into
 * `submitVerdict`.
 *
 * `share_default` is `NOT NULL DEFAULT true`, so the only missing case is
 * a missing profile row — a runner who signed up and has not reached O1.
 *
 * **This is the seed, not the state.** The per-entry truth is
 * `outfit_entries.is_public`, which A3's sharing toggle writes and which
 * `submitVerdict` carries on every save; this only supplies its value at
 * the moment the entry is created. Two things follow, and both have been
 * asked on review: the runner's preference changing later does not
 * retroactively republish anything, and an entry the runner made private
 * stays private through every subsequent save.
 *
 * **And sharing lives on the entry, not on the run.** `runs` has no
 * public flag at all — deliberately, because a run on its own is not a
 * shareable artefact. What a feed shows is the kit, the verdict and the
 * photos, which are the entry; the run underneath it is a time, a
 * distance and a place that nobody else ever sees.
 */
// fallow-ignore-next-line code-duplication -- rhymes with onboarding/profile.ts's hasOnboarded: same select-by-userId-with-limit-1-then-??-default shape, but a different column with a different default (public-by-default vs not-yet-onboarded) that will evolve on its own product timeline
export async function isPublicByDefault(
  database: DrizzleD1Database,
  userId: string,
): Promise<boolean> {
  const [profile] = await database
    .select({ shareDefault: userProfiles.shareDefault })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  // Not equivalent to `&&`: `attachKit` fed this straight into a drizzle
  // insert, where an `undefined` result would have been dropped and the
  // column's own `DEFAULT true` would have covered for it. The backlog
  // reads this as plain data instead — `Backlog.isPublicByDefault` — with
  // no insert to catch a wrong `undefined`, so the missing-profile case is
  // asserted directly (`test/feed/share-default.test.ts`).
  return profile?.shareDefault ?? true;
}
