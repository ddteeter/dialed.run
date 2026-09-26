/**
 * What A3's Noted receipt says, decided where a test can reach it.
 *
 * A sibling that imports nothing server-side, for the reason
 * `attach-rules.ts` gives: the form that uses it ships to the browser.
 */

/**
 * Noted's two sentences for a run with nothing to count (round 21, ask
 * 3). *"Same block, same place, one sentence naming the missing input"* —
 * A3 never navigates, so a run with no band or no kit still gets a
 * receipt, where it used to be sent to its entry, "on exactly the runs
 * where the runner most wonders if it worked".
 */
export const NOTHING_MOVED = {
  noBand: "Logged. No weather came with this run, so no band record moved.",
  noKit: "Logged. No kit on this run, so no garment record moved.",
} as const;

/**
 * Either the sentence itself, or the one record whose count makes it.
 */
export type NotedPlan =
  | { kind: "nothing-moved"; sentence: string }
  | { kind: "record"; itemId: string; name: string; bandFloorC: number };

/**
 * What the receipt is about.
 *
 * The band is asked first because it is the wider absence: a run with no
 * weather moves no record at all, kit or not, and "no kit" would name the
 * lesser of the two gaps. With both, the record is the kit's first piece.
 */
export function notedPlan(
  bandFloorC: number | undefined,
  kit: readonly { itemId: string; name: string }[],
): NotedPlan {
  if (bandFloorC === undefined) {
    return { kind: "nothing-moved", sentence: NOTHING_MOVED.noBand };
  }
  const [first] = kit;
  if (first === undefined) {
    return { kind: "nothing-moved", sentence: NOTHING_MOVED.noKit };
  }
  return { kind: "record", itemId: first.itemId, name: first.name, bandFloorC };
}
