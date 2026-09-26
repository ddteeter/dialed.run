/**
 * Every trust boundary this module's server functions sit behind (D-41).
 *
 * `functions.ts` imports TanStack Start, which makes it unimportable in
 * the workers pool and so unreachable by mutation testing. A zod schema is
 * a decision about what the outside world is allowed to send, so it lives
 * here, next door, where a test can reach it — and `functions.ts` stays
 * glue that imports, wires and delegates.
 */
import { z } from "zod";

import { manualSkySchema, runDraftSchema } from "../../lib/contracts";
import { ulidSchema } from "../../lib/ids";
import { SET_CONDITION_BANDS } from "./run-conditions";
import { ImportUploadError, MAX_IMPORT_BYTES } from "./upload-limits";
import { filePartFrom } from "../../lib/file-part";
import type { FilePartProblem } from "../../lib/file-part";

export const manualRunInput = runDraftSchema.extend({
  // Minted once when the form mounts, resent on every retry of that same
  // composed submission.
  idempotencyKey: ulidSchema.optional(),
});

export const importIdInput = z.object({ importId: z.string().min(1) });

export const runIdInput = z.object({ runId: z.string().min(1) });

/**
 * R2b's pick: one of the bands it offers, never a typed number (round 22).
 * Anything else is refused, so the server stores only what the sheet can
 * show.
 */
export const conditionsBandInput = z.object({
  runId: ulidSchema,
  bandFloorC: z
    .number()
    .refine((floor) => SET_CONDITION_BANDS.includes(floor), {
      message: "Pick one of the bands.",
    }),
  // Round 26, item 2: the sky is required, as the band is.
  sky: manualSkySchema,
});

/**
 * A1's time correction, as the shift the runner made rather than a new
 * epoch: the screen shows the run's wall-clock time in its own zone, and
 * the difference between two times on the same clock is the one thing
 * that needs no zone to be right. Bounded by a day either way — a run that
 * started on another day is another run.
 */
export const retimeRunInput = z.object({
  runId: ulidSchema,
  // The new start, absolute, so a retry is the same request rather than a
  // second move. How far it may be from the old one is the service's rule,
  // because only the service knows the old one.
  startedAt: z.number().int().nonnegative(),
});

/**
 * The callback's *search params*, which are looser than the input above on
 * purpose.
 *
 * `validateSearch` runs before anything else and throws if it refuses, so
 * a redirect carrying `?code=` with nothing after it would blow up the
 * route rather than reach `stravaCallbackOutcome`, whose whole job is to
 * answer "no" politely. The tightening lives in `stravaCallbackInput`,
 * which the server function validates with.
 */
export const stravaCallbackSearch = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export const stravaCallbackInput = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

/**
The sentences this screen uses for each refusal.
*/
const IMPORT_REFUSALS: Readonly<Record<FilePartProblem, string>> = {
  "not-form-data": "Expected multipart form data.",
  missing: "No file was attached.",
  "too-large": "That file is larger than 25 MB.",
};

/**
 * The file out of a multipart import upload, or the reason it is not one,
 * and the key that makes a retry of it the same upload (law 8b).
 *
 * Size is checked here, before the bytes are read: an oversized upload is
 * refused without allocating it. `startImport` checks the cap again
 * against the bytes it was actually handed — this is the early exit, not
 * the guarantee. The key is optional because a form that predates it still
 * sends a file and nothing else.
 */
export function importUploadFrom(input: unknown): {
  file: File;
  idempotencyKey: string | undefined;
} {
  const part = filePartFrom(input, "file", MAX_IMPORT_BYTES);
  if (!part.ok) throw new ImportUploadError(IMPORT_REFUSALS[part.problem]);
  const key = ulidSchema
    .optional()
    .parse(part.form.get("idempotencyKey") ?? undefined);
  return { file: part.file, idempotencyKey: key };
}
