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

/**
 * The per-item flag as three visible choices, as A3b lists them.
 *
 * `"none"` rather than `""`: a radio's value is a real string and an empty
 * one reads as "no value" to the platform, which is a different thing from
 * "the runner chose not to flag this". The form maps it back to
 * `undefined`, which is what the contract stores.
 */
export const ITEM_FLAG_OPTIONS = ["none", "too_much", "not_enough"] as const;
export type ItemFlagChoice = (typeof ITEM_FLAG_OPTIONS)[number];

/**
 * One table for the sheet's choices and the chips' labels, so "Too much"
 * on a chip and in A3b cannot come to say two different things.
 */
export const ITEM_FLAG_LABELS: Readonly<Record<ItemFlagChoice, string>> = {
  none: "Fine",
  too_much: "Too much",
  not_enough: "Not enough",
};

export type Chip =
  | { kind: "flag"; itemId: string; name: string; flag: Flag }
  | { kind: "tag"; tag: EntryTag };

/**
Five chips in all — the board draws five, and round 20 says so.
*/
export const CHIP_COUNT = 5;

/**
"Up to two per-garment flags."
*/
const MAX_SUGGESTED_FLAGS = 2;

interface KitGarment {
  itemId: string;
  name: string;
}

interface Garment extends KitGarment {
  record: GarmentRecord;
}

function dialedShare(record: GarmentRecord): number {
  return record.dialed / record.total;
}

/**
 * Weakest first: lowest dialed share, then more runs, then kit order —
 * which `Array.prototype.sort` keeps for equal keys, being stable.
 */
function byWeakness(
  kit: readonly KitGarment[],
  records: Readonly<Record<string, GarmentRecord>>,
): Garment[] {
  // A garment with no record here — none at all, or one of nothing — has
  // no weakness to find (assumption 2), so it never reaches the sort.
  return kit
    .flatMap((garment) => {
      const record = records[garment.itemId];
      return record && record.total > 0 ? [{ ...garment, record }] : [];
    })
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
  candidates: readonly KitGarment[],
  records: Readonly<Record<string, GarmentRecord>>,
): Chip[] {
  if (verdict === undefined) return [];
  const weakest = byWeakness(candidates, records);
  const direction = DIRECTION_OF[verdict];
  // Uncapped here: the caller caps the whole garment block, chosen chips
  // included, and a second cap would be one no input could tell apart.
  if (direction !== undefined) {
    return weakest.map((garment) => ({
      kind: "flag",
      itemId: garment.itemId,
      name: garment.name,
      flag: direction,
    }));
  }
  const [first] = weakest;
  const flag = first && offDirection(first.record);
  return first && flag
    ? [{ kind: "flag", itemId: first.itemId, name: first.name, flag }]
    : [];
}

export function suggestChips(input: {
  verdict: number | undefined;
  /**
  The kit, in its own order.
  */
  kit: readonly KitGarment[];
  /**
   * Each garment's record in this band, by item id. A garment missing from
   * it — the run has no band, say — is one with no history here.
   */
  records: Readonly<Record<string, GarmentRecord>>;
  tagUse: Readonly<Record<string, number>>;
  chosenFlags: Readonly<Record<string, Flag>>;
  chosenTags: ReadonlySet<string>;
}): Chip[] {
  // Chosen chips come first and stay put whatever the verdict does —
  // "chosen chips stay". Kit order for garments, canonical order for tags.
  const chosenFlagChips: Chip[] = input.kit.flatMap((garment) => {
    const flag = input.chosenFlags[garment.itemId];
    return flag
      ? [{ kind: "flag", itemId: garment.itemId, name: garment.name, flag }]
      : [];
  });
  const chosenTagChips: Chip[] = entryTags
    .filter((tag) => input.chosenTags.has(tag))
    .map((tag) => ({ kind: "tag", tag }));

  const flagged = new Set(Object.keys(input.chosenFlags));
  const flagSuggestions = suggestedFlags(
    input.verdict,
    input.kit.filter((garment) => !flagged.has(garment.itemId)),
    input.records,
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

/**
 * What a chip says: "Gloves too much", or a tag in words. Normal case —
 * the chip's mono step uppercases it in CSS, so the accessible name stays
 * readable rather than being spelled out letter by letter.
 */
export function chipLabel(chip: Chip): string {
  return chip.kind === "flag"
    ? `${chip.name} ${ITEM_FLAG_LABELS[chip.flag].toLowerCase()}`
    : tagLabel(chip.tag);
}

/**
A tag in words — "cold first mile" — for the chips and for A3b's list.
*/
export function tagLabel(tag: EntryTag): string {
  return tag.replaceAll("_", " ");
}
