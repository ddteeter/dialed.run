/**
 * What A2 needs to know about the run it is attaching a kit to.
 *
 * **The run's own GPS and time, never the device's.** Round 22 (A2
 * Waiting): *"Location isn't asked here: A2 reads the run's own GPS, never
 * the device's."* The screen used to ask the browser for a position and
 * match against the weather *now*, where the runner was standing — so a
 * run logged at lunch was suggested the kit for a lunchtime that never
 * happened, and a denied prompt left the screen waiting on an answer that
 * was not coming. The run's observation is the band it was run in.
 *
 * Two reads, because they cost differently and the board draws them
 * separately. The context — distance, conditions, the closet grouped and
 * matched — is cheap and backs the screen's first frame: *"the picker, the
 * photo row and the button are A2 at rest, from the first frame."* The
 * suggestion scans up to two hundred of the runner's own entries and is
 * what the screen waits on: *"Only most-likely changes."*
 *
 * A file of its own rather than more of `entries.ts`, which this lane
 * shares with another; the two reads here are A2's and only A2's.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { outfitEntries, runs } from "../../db/schema-core";
import { env } from "../../env";
import { ulidSchema } from "../../lib/ids";
import type { Conditions } from "./conditions";
import { observationsForRuns } from "./conditions";
import { pickerGroups } from "./picker";
import type { PickerGroup } from "./picker";
import { nearestPriorEntry } from "./prefill";
import type { PrefillCandidate } from "./prefill";

/**
Both reads take the run and nothing else.
*/
export const attachRunInput = z.object({ runId: ulidSchema });

export interface AttachContext {
  distanceM: number;
  /**
  The run's own conditions, or none — indoor, no location, no weather yet.
  */
  conditions: Conditions | undefined;
  groups: PickerGroup[];
  /**
   * The entry this run already has, when it has one. A2 does not choose a
   * kit for it: `attachKit` never replaces a kit, so a pick here would be
   * dropped without a word. The route sends the runner on to A3 for this
   * entry instead.
   */
  entryId: string | undefined;
}

/**
 * The run, if it is this runner's. Scoped in SQL: a run that is someone
 * else's reads exactly as one that is not there, which is the answer both
 * deserve on a screen that only ever shows your own.
 */
async function ownRun(userId: string, runId: string) {
  const [run] = await drizzle(env.DIALED_CORE)
    .select({
      id: runs.id,
      lat: runs.lat,
      lng: runs.lng,
      startedAt: runs.startedAt,
      durationS: runs.durationS,
      distanceM: runs.distanceM,
      // A run has at most one entry (UNIQUE `entries_run`), so the join
      // never multiplies the row; the probe is that index.
      entryId: outfitEntries.id,
    })
    .from(runs)
    .leftJoin(outfitEntries, eq(outfitEntries.runId, runs.id))
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  return run;
}

/**
 * The run's conditions. Read from `DIALED_WEATHER` by the run's own cache
 * key — a second database, so the correlation is assembled in code and not
 * joined (CLAUDE.md, D1 discipline's one exception).
 */
async function conditionsOf(
  run: NonNullable<Awaited<ReturnType<typeof ownRun>>>,
): Promise<Conditions | undefined> {
  const observations = await observationsForRuns([run]);
  return observations.get(run.id);
}

/**
 * Both reads start here: the runner's own run, if it is theirs, and its
 * conditions. Nothing for a run that is not this runner's, or not there at
 * all — the two are indistinguishable on purpose (see `ownRun`).
 */
async function ownRunConditions(
  userId: string,
  runId: string,
): Promise<
  | {
      run: NonNullable<Awaited<ReturnType<typeof ownRun>>>;
      conditions: Conditions | undefined;
    }
  | undefined
> {
  const run = await ownRun(userId, runId);
  if (run === undefined) return undefined;
  return { run, conditions: await conditionsOf(run) };
}

export async function attachContext(
  userId: string,
  runId: string,
): Promise<AttachContext | undefined> {
  const found = await ownRunConditions(userId, runId);
  if (found === undefined) return undefined;
  return {
    distanceM: found.run.distanceM,
    conditions: found.conditions,
    groups: await pickerGroups(userId, found.conditions),
    entryId: found.run.entryId ?? undefined,
  };
}

/**
 * The most-likely kit for this run: the runner's own nearest past entry to
 * the conditions this run was actually run in. Nothing when the run has no
 * conditions — there is nothing to be near — and the screen says so.
 */
export async function prefillForRun(
  userId: string,
  runId: string,
): Promise<PrefillCandidate | undefined> {
  const found = await ownRunConditions(userId, runId);
  if (found?.conditions === undefined) return undefined;
  return nearestPriorEntry(userId, found.conditions);
}
