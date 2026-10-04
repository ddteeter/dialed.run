import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { audienceOfShareToggle } from "../../lib/contracts";
import type { WritableAudience } from "../../lib/contracts";
import { isUnconfirmed } from "../account";

/**
 * The audience this runner's new entries start with (D-109): `runners`,
 * shared, unless they say otherwise.
 *
 * *"Entries are public by default with a per-entry toggle and a per-user
 * default preference"* (CLAUDE.md §Product rules). Two surfaces in this
 * module need the answer and were about to read it twice: `attachKit`,
 * which stamps it on a new entry, and the verdict backlog, whose rows have
 * no sharing control of their own and so carry the default into
 * `submitVerdict`.
 *
 * **Read from `share_default` until PR B** (design 131): the writers keep
 * it and `default_audience` in step, and a version a rollback could
 * restore reads only the boolean. `share_default` is `NOT NULL DEFAULT
 * true`, so the only missing case is a missing profile row — a runner who
 * signed up and has not reached O1.
 *
 * **This is the seed, not the state.** The per-entry truth is the entry's
 * own audience, which A3's sharing toggle writes and which
 * `submitVerdict` carries on every save; this only supplies its value at
 * the moment the entry is created. Two things follow, and both have been
 * asked on review: the runner's preference changing later does not
 * retroactively republish anything, and an entry the runner made private
 * stays private through every subsequent save.
 *
 * **An unconfirmed runner's entries start private** (decision D-50;
 * task 126): nothing unconfirmed reaches another runner, and confirming
 * restores the runner's own default — it is read here, at creation, so
 * nothing stored has to change when they confirm. Round 26 #11's "queued
 * share" was not adopted; an entry is shared or private, nothing else.
 *
 * **And sharing lives on the entry, not on the run.** `runs` has no
 * public flag at all — deliberately, because a run on its own is not a
 * shareable artefact. What a feed shows is the kit, the verdict and the
 * photos, which are the entry; the run underneath it is a time, a
 * distance and a place that nobody else ever sees.
 */
// fallow-ignore-next-line code-duplication -- rhymes with onboarding/profile.ts's hasOnboarded: same select-by-userId-with-limit-1-then-??-default shape, but a different column with a different default (public-by-default vs not-yet-onboarded) that will evolve on its own product timeline
export async function defaultAudienceFor(
  database: DrizzleD1Database,
  userId: string,
): Promise<WritableAudience> {
  const [profile] = await database
    .select({ shareDefault: userProfiles.shareDefault })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  // The missing-profile `?? true` is asserted directly
  // (`test/feed/share-default.test.ts`): `attachKit`'s fixtures always make
  // a profile row, so only that file reaches it.
  return audienceOfShareToggle(
    (profile?.shareDefault ?? true) && !(await isUnconfirmed(database, userId)),
  );
}

/**
 * The runner's chosen audience for one entry, as it may be stored: an
 * unconfirmed runner's entry stays private whatever the toggle said
 * (decision D-50), so a verdict saved before confirming cannot share it.
 */
export async function audienceAsChosen(
  database: DrizzleD1Database,
  userId: string,
  audience: WritableAudience,
): Promise<WritableAudience> {
  return (await isUnconfirmed(database, userId)) ? "private" : audience;
}
