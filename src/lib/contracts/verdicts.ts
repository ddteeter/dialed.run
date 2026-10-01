/**
 * Verdicts — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 */
import { z } from "zod";

// ---- Verdicts (D-05/D-12) -------------------------------------------------

/**
 * The sentence is here because the screen used to enforce this with a
 * `disabled` submit button, which §5 bans: it drops focus, stops
 * announcing, and tells a user nothing about why nothing happened. The
 * schema refusing the submission with a reason is the contract's answer,
 * and the reason has to live where every renderer of it can find it.
 */
export const verdictSchema = z
  .number({ error: "Say how the kit felt." })
  .int()
  .min(-2)
  .max(2);

/**
 * The verdict scale, once. Coldest to warmest — the order the A3 choices
 * render in, so no screen keeps its own array.
 *
 * `token` is the stored/analytics form and `label` is the only user-facing
 * wording (UI lexicon, docs/product.md §Brand). Both live on the same row
 * because they were previously three tables: a token map here that nothing
 * ever imported, plus display labels open-coded twice over in
 * feed/entry.$entryId.tsx and feed/verdict.$entryId.tsx — free to disagree
 * about what "0" is called, and in practice already drifting.
 */
export const verdictScale = [
  { value: -2, token: "way_cold", label: "Way cold" },
  { value: -1, token: "bit_cold", label: "A bit cold" },
  { value: 0, token: "dialed", label: "Dialed" },
  { value: 1, token: "bit_warm", label: "A bit warm" },
  { value: 2, token: "way_warm", label: "Way warm" },
] as const;
export type VerdictValue = (typeof verdictScale)[number]["value"];

/**
User-facing wording for a stored verdict; `undefined` if out of range or
if there is no verdict to word.
*/
export function verdictLabel(value: number | undefined): string | undefined {
  return verdictScale.find((entry) => entry.value === value)?.label;
}
export const itemFlagSchema = z.enum(["too_much", "not_enough"]);
export const entryTags = [
  "cold_first_mile",
  "cold_throughout",
  "overheated_late",
  "sleeves_damp",
  "chafed",
  "perfect_warmup",
  "wind_cut_through",
  "hands_cold",
  "hands_sweaty",
] as const;
export const entryTagSchema = z.enum(entryTags);
