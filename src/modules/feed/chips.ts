import { entryTags } from "../../lib/contracts";
import type { GarmentRecord } from "./band-signals";

/**
 * A3's "Anything specific?" chips — generated, never composed.
 *
 * Design round 20, in full: *"the chips are generated, never composed.
 * Five, in two blocks: up to two per-garment flags — GARMENT + TOO MUCH or
 * NOT ENOUGH, direction set by the verdict (warm → too much, cold → not
 * enough, dialed → the weakest garment in this band, either direction),
 * garment picked by the weakest band record — then tags ranked by this
 * runner's use in the band, filling to five. MORE › opens A3b … Fine is the
 * default and is never a chip. Changing the verdict recomputes unchosen
 * chips; chosen chips stay."*
 *
 * Pure, and in one place, because the ruling leaves four things unsaid and
 * each is an assumption a later ruling may change — a one-function change
 * rather than a UI one. The four, each pinned by a test:
 *
 * 1. **"Weakest" is the lowest dialed share** (dialed ÷ runs in the band);
 *    ties go to the garment with more runs, the stronger evidence, then to
 *    kit order.
 * 2. **A garment never worn in this band is not suggested.** It has no
 *    record to be weak — suggesting it would be a guess about a garment
 *    the runner has told us nothing about here.
 * 3. **A dialed verdict suggests one garment** ("the weakest garment",
 *    singular), in the direction it has more often been off; one never off
 *    either way is not suggested at all. Warm and cold suggest up to two.
 * 4. **Before a verdict is chosen there are no garment chips** — their
 *    direction is set by the verdict, so there is nothing to set it by.
 *    Tags still fill to five.
 */

export type Flag = "too_much" | "not_enough";
export type EntryTag = (typeof entryTags)[number];

export type Chip =
  | { kind: "flag"; itemId: string; flag: Flag }
  | { kind: "tag"; tag: EntryTag };

/**
Five chips in all — the board draws five, and round 20 says so.
*/
export const CHIP_COUNT = 5;

/**
"Up to two per-garment flags."
*/
const MAX_SUGGESTED_FLAGS = 2;

interface Garment {
  itemId: string;
  record: GarmentRecord;
}

function dialedShare(record: GarmentRecord): number {
  return record.dialed / record.total;
}

/**
 * Weakest first: lowest dialed share, then more runs, then kit order —
 * which `Array.prototype.sort` keeps for equal keys, being stable.
 */
function byWeakness(garments: readonly Garment[]): Garment[] {
  return garments
    .filter((garment) => garment.record.total > 0)
    .toSorted(
      (a, b) =>
        dialedShare(a.record) - dialedShare(b.record) ||
        b.record.total - a.record.total,
    );
}

/**
The way a garment has more often been off, or none if neither.
*/
function offDirection(record: GarmentRecord): Flag | undefined {
  if (record.warmer > record.colder) return "too_much";
  if (record.colder > record.warmer) return "not_enough";
  return undefined;
}

/**
 * The direction a warm or cold verdict sets — round 20's "warm → too much,
 * cold → not enough", on both steps of each side. A dialed verdict has no
 * entry here, which is how it reaches its own rule below: one table rather
 * than a `!== 0` and a `> 0` that could only ever agree.
 */
const DIRECTION_OF: Readonly<Record<number, Flag>> = {
  [-2]: "not_enough",
  [-1]: "not_enough",
  1: "too_much",
  2: "too_much",
};

function suggestedFlags(
  verdict: number | undefined,
  candidates: readonly Garment[],
): Chip[] {
  if (verdict === undefined) return [];
  const weakest = byWeakness(candidates);
  const direction = DIRECTION_OF[verdict];
  // Uncapped here: the caller caps the whole garment block, chosen chips
  // included, and a second cap would be one no input could tell apart.
  if (direction !== undefined) {
    return weakest.map((garment) => ({
      kind: "flag",
      itemId: garment.itemId,
      flag: direction,
    }));
  }
  const [first] = weakest;
  const flag = first && offDirection(first.record);
  return first && flag ? [{ kind: "flag", itemId: first.itemId, flag }] : [];
}

export function suggestChips(input: {
  verdict: number | undefined;
  /**
  The kit, in its own order, each with its record in this band.
  */
  garments: readonly Garment[];
  tagUse: Readonly<Record<string, number>>;
  chosenFlags: Readonly<Record<string, Flag>>;
  chosenTags: ReadonlySet<string>;
}): Chip[] {
  // Chosen chips come first and stay put whatever the verdict does —
  // "chosen chips stay". Kit order for garments, canonical order for tags.
  const chosenFlagChips: Chip[] = input.garments.flatMap((garment) => {
    const flag = input.chosenFlags[garment.itemId];
    return flag ? [{ kind: "flag", itemId: garment.itemId, flag }] : [];
  });
  const chosenTagChips: Chip[] = entryTags
    .filter((tag) => input.chosenTags.has(tag))
    .map((tag) => ({ kind: "tag", tag }));

  const flagged = new Set(Object.keys(input.chosenFlags));
  const flagSuggestions = suggestedFlags(
    input.verdict,
    input.garments.filter((garment) => !flagged.has(garment.itemId)),
  ).slice(0, Math.max(0, MAX_SUGGESTED_FLAGS - chosenFlagChips.length));

  const flagBlock = [...chosenFlagChips, ...flagSuggestions];
  const room = CHIP_COUNT - flagBlock.length - chosenTagChips.length;
  const tagSuggestions: Chip[] = entryTags
    .filter((tag) => !input.chosenTags.has(tag))
    .toSorted((a, b) => (input.tagUse[b] ?? 0) - (input.tagUse[a] ?? 0))
    .slice(0, Math.max(0, room))
    .map((tag) => ({ kind: "tag", tag }));

  return [...flagBlock, ...chosenTagChips, ...tagSuggestions];
}
