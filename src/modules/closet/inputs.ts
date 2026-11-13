/**
 * The closet server functions' input contracts, kept out of `functions.ts`.
 *
 * That file imports `createServerFn`, so nothing in it can be imported by a
 * test or reached by mutation testing (R-41). A zod schema is a trust
 * boundary and belongs where it can be exercised, which is here.
 */
import { z } from "zod";

import {
  garmentCategories,
  garmentSchema,
  performanceBucketSchema,
  tempUnitSchema,
  uiGroups,
  verdictCoverages,
  type TempUnit,
  type UiGroup,
  type VerdictCoverage,
} from "../../lib/contracts";
import { unitToC } from "../../lib/contracts/temperature";
import { ulidSchema } from "../../lib/ids";

/**
 * Screen C's filter set. The category list is `garmentCategories` rather
 * than an enum written out again — it was written out twice before, and
 * the copy here was free to fall behind the union it filters.
 */
export const closetFiltersInput = z.object({
  category: z.enum(garmentCategories).optional(),
  minTempC: z.number().optional(),
  maxTempC: z.number().optional(),
  windResistant: z.boolean().optional(),
  waterResistant: z.boolean().optional(),
  // The same four values were a TS union in service.ts and an enum here,
  // free to drift. One list in contracts now; the type derives from it.
  performance: performanceBucketSchema.optional(),
  includeRetired: z.boolean().optional(),
});

export const itemIdInput = z.object({ itemId: ulidSchema });

/**
 * F's rail card, read for the add form (nothing) or for one piece's edit
 * form, which leaves that piece out of its own card (Round 54 · 168.2).
 */
export const nearbyInput = z
  .object({ exceptItemId: ulidSchema.optional() })
  .optional();

/**
 * Screen C's search.
 *
 * - `retired=true` opens with retired pieces shown (set after a retire, so
 *   the piece is visibly still there).
 * - `group`, `coverage`, `from` and `to` are the rail's filters (R-94).
 *   `from`/`to` are Celsius: the one unit the URL holds, so a link means
 *   the same thing whoever's unit wrote it.
 * - `lowest`, `highest` and `unit` are only ever *read*. WORKS AT works
 *   before hydration as a plain GET form, and a form cannot convert what
 *   the runner typed, so it sends its own fields and says which unit they
 *   are in, and the conversion happens here, at the edge. None of the
 *   three comes back out: what the route holds is always Celsius.
 * - **Idempotent, and it has to be.** The router runs this again over a
 *   search that still holds the raw fields beside the Celsius it made, so
 *   an end is always read from what was typed when that is there, never
 *   from its own output. Converting `from` itself under `unit=f` turned
 *   60–80°F into a Celsius that the next pass converted again, until it
 *   settled where the scales meet: −40° (e2e, design 174).
 *
 * TanStack parses search values as JSON, so numbers and the boolean we
 * navigate with round-trip as themselves. Anything else is dropped rather
 * than refused, field by field: a hand-edited URL still opens the closet,
 * with whatever of it made sense. A span whose ends are the wrong way
 * round makes no sense as a whole, so both ends go.
 *
 * **What a delete took away is not in here** (PR #129 review). It rides
 * the navigation's history state (`deletedGarment`), which only the app
 * can write: a search param echoed as "{name} deleted." was a sentence
 * anyone could put on a runner's screen with a crafted link.
 */
export interface ClosetSearch {
  retired?: true | undefined;
  group?: UiGroup | undefined;
  coverage?: VerdictCoverage | undefined;
  from?: number | undefined;
  to?: number | undefined;
}

const groupParam = z.enum(uiGroups);
const coverageParam = z.enum(verdictCoverages);
const degreesParam = z.number();

/**
An end, in Celsius: as typed into the form, in its unit, or else as the search already holds it.
*/
function endC(
  typed: unknown,
  celsius: unknown,
  unit: TempUnit,
): number | undefined {
  const fromForm = degreesParam.safeParse(typed);
  if (fromForm.success) return unitToC(fromForm.data, unit);
  const held = degreesParam.safeParse(celsius);
  return held.success ? held.data : undefined;
}

export function closetSearch(search: Record<string, unknown>): ClosetSearch {
  const unit = tempUnitSchema.catch("c").parse(search.unit);
  const group = groupParam.safeParse(search.group);
  const coverage = coverageParam.safeParse(search.coverage);
  const from = endC(search.lowest, search.from, unit);
  const to = endC(search.highest, search.to, unit);
  // An open end is no end: nothing is colder than it, or warmer.
  const isBackwards = (from ?? -Infinity) > (to ?? Infinity);
  return {
    ...(search.retired === true && { retired: true }),
    ...(group.success && { group: group.data }),
    ...(coverage.success && { coverage: coverage.data }),
    ...(from !== undefined && !isBackwards && { from }),
    ...(to !== undefined && !isBackwards && { to }),
  };
}

/**
 * The garment plus the key that identifies *this* submission of it.
 *
 * A separate wrapper rather than a field on `garmentSchema`, because the
 * key is a property of the request and not of the thing being saved —
 * putting it in the contract would mean every read of a garment carries it.
 */
export const newItemInput = z.object({
  garment: garmentSchema,
  idempotencyKey: ulidSchema.optional(),
});

export const updateItemInput = z.object({
  itemId: ulidSchema,
  garment: garmentSchema,
});

/**
 * The multipart body, refused early if it is not one.
 *
 * Here rather than inline in the server function's validator for the same
 * reason as the schemas: a `throw` is a decision, and a decision inside
 * `functions.ts` is one no test can reach.
 */
export function requireFormData(data: unknown): FormData {
  if (!(data instanceof FormData)) {
    throw new TypeError("Expected multipart form data.");
  }
  return data;
}
