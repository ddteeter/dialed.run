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

import { runDraftSchema } from "../../lib/contracts";
import { ulidSchema } from "../../lib/ids";
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

export const manualTempInput = z.object({
  runId: z.string().min(1),
  // The habitable range for a run, not for the planet: a value outside it
  // is a typo or a unit mix-up, and storing it would poison the fallback
  // it exists to feed.
  tempC: z.number().min(-60).max(60),
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
 * The file out of a multipart import upload, or the reason it is not one.
 *
 * Size is checked here, before the bytes are read: an oversized upload is
 * refused without allocating it. `startImport` checks the cap again
 * against the bytes it was actually handed — this is the early exit, not
 * the guarantee.
 */
export function importUploadFrom(input: unknown): { file: File } {
  const part = filePartFrom(input, "file", MAX_IMPORT_BYTES);
  if (!part.ok) throw new ImportUploadError(IMPORT_REFUSALS[part.problem]);
  return { file: part.file };
}
