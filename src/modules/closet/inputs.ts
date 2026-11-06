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
 * Screen C's search.
 *
 * - `retired=true` opens with retired pieces shown (set after a retire, so
 *   the piece is visibly still there).
 * - `group`, `coverage`, `from` and `to` are the rail's filters (R-94).
 *   `from`/`to` are Celsius: the one unit the URL holds, so a link means
 *   the same thing whoever's unit wrote it.
 * - `unit` is only ever *read*. WORKS AT works before hydration as a plain
 *   GET form, and a form cannot convert what the runner typed, so it says
 *   which unit it typed in and the conversion happens here, at the edge.
 *   It never comes back out: what the route holds is always Celsius.
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
  retired?: true;
  group?: UiGroup;
  coverage?: VerdictCoverage;
  from?: number;
  to?: number;
}

const groupParam = z.enum(uiGroups);
const coverageParam = z.enum(verdictCoverages);
const degreesParam = z.number();

function degreesC(value: unknown, unit: TempUnit): number | undefined {
  const parsed = degreesParam.safeParse(value);
  return parsed.success ? unitToC(parsed.data, unit) : undefined;
}

export function closetSearch(search: Record<string, unknown>): ClosetSearch {
  const unit = tempUnitSchema.catch("c").parse(search.unit);
  const group = groupParam.safeParse(search.group);
  const coverage = coverageParam.safeParse(search.coverage);
  const from = degreesC(search.from, unit);
  const to = degreesC(search.to, unit);
  const isBackwards = from !== undefined && to !== undefined && from > to;
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
