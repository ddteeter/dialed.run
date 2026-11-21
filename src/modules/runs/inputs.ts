/**
 * Every trust boundary this module's server functions sit behind (R-41).
 *
 * `functions.ts` imports TanStack Start, which makes it unimportable in
 * the workers pool and so unreachable by mutation testing. A zod schema is
 * a decision about what the outside world is allowed to send, so it lives
 * here, next door, where a test can reach it — and `functions.ts` stays
 * glue that imports, wires and delegates.
 */
import { z } from "zod";

import { manualSkySchema, runDraftSchema } from "../../lib/contracts";
import { rowIdSchema, ulidSchema } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import { SET_CONDITION_BANDS } from "./run-conditions";
import { RUNS_LISTED } from "./run-months";
import { ImportUploadError, MAX_IMPORT_BYTES } from "./upload-limits";
import { filePartFrom } from "../../lib/file-part";
import type { FilePartProblem } from "../../lib/file-part";

/**
 * How far past the clock a typed start may be: a day, so a runner whose
 * device clock runs ahead is not refused (SA-M31, owner 2026-11-15).
 */
export const MAX_START_AHEAD_SECONDS = 86_400;

/**
 * A start a runner typed or moved: a run's start, and not in the future.
 * The clock is read on each parse, in the form and again on the server.
 */
const typedStart = runDraftSchema.shape.startedAt.refine(
  (startedAt) => startedAt <= nowSeconds() + MAX_START_AHEAD_SECONDS,
  "Pick a start that isn't in the future.",
);

// A manual run has no file to read moving time or a climb from (D-111), so
// the form may not send either: what the runner types is distance and time.
export const manualRunInput = runDraftSchema
  .omit({ movingS: true, elevationGainM: true })
  .extend({
    startedAt: typedStart,
    // Minted once when the form mounts, resent on every retry of that same
    // composed submission.
    idempotencyKey: ulidSchema.optional(),
  });

/**
 * Round 55 · 183: A1 and R1 can carry a calendar day, the day a Strava
 * reminder arrived in the runner's zone (owner, 2026-11-13: never anything
 * from the activity). Anything that is not a day is no day.
 */
export const newRunSearch = z
  .object({ date: z.iso.date().optional() })
  .catch({});

export type NewRunSearch = z.infer<typeof newRunSearch>;

export const importIdInput = z.object({ importId: rowIdSchema });

/**
One tap on IMPORT › (G3): which Garmin activity, and the tap's own key, so
a replayed tap starts nothing new (law 8b). Garmin's activity ids are
decimal numbers; the id goes into a URL path, so nothing else is accepted.
*/
export const garminImportInput = z.object({
  activityId: z.string().regex(/^\d{1,20}$/u),
  idempotencyKey: ulidSchema,
});

export const runIdInput = z.object({ runId: rowIdSchema });

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
  startedAt: typedStart,
  // The zone the card read the time in — the run's own, or the device's
  // for a run with none — so the server holds the date fixed on the same
  // clock. Anything `Intl` will not accept reads as UTC (`lib/dates`).
  timeZone: z.string().max(64).optional(),
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

/**
 * Each of Strava's callback values, bounded (SA-M17): a code, a state
 * nonce or an error name is a few dozen characters.
 */
const CALLBACK_VALUE_MAX = 1024;

export const stravaCallbackInput = z.object({
  code: z.string().min(1).max(CALLBACK_VALUE_MAX).optional(),
  state: z.string().min(1).max(CALLBACK_VALUE_MAX).optional(),
  error: z.string().max(CALLBACK_VALUE_MAX).optional(),
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
 * Size is checked here, against the declared size, before the file's bytes
 * are copied out of the form (the request body was bounded before the
 * framework read it, `modules/ops/edge/body-cap.ts`). `startImport` checks the cap again
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

/**
 * How many the runs list shows (R58·299): fifty, then fifty more for each
 * "Show 50 more", up to a thousand, past which a page is not a list. A
 * value nobody's Show row wrote reads as the first fifty.
 */
export const runListSearch = z.object({
  show: z.coerce
    .number()
    .int()
    .min(RUNS_LISTED)
    .max(RUNS_LISTED * 20)
    .optional()
    .catch(undefined),
});
export type RunListSearch = z.infer<typeof runListSearch>;

/**
What the runs list's loader reads from its search: fifty unless asked.
*/
export function runListDeps(search: RunListSearch): { show: number } {
  return { show: search.show ?? RUNS_LISTED };
}

/**
The runs list's read: how many it shows.
*/
export const runListInput = z.object({
  show: z
    .number()
    .int()
    .min(RUNS_LISTED)
    .max(RUNS_LISTED * 20),
});
