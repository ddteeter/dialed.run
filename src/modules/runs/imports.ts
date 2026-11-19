/**
 * Import intake (102 §2): stores the raw upload in R2, records the
 * `imports` row, and enqueues the parse job. The R2 key carries the file
 * extension (`imports/{userId}/{importId}.{ext}`) so the queue consumer
 * can pick a parser without a schema column — the `imports` table stays
 * exactly the contract shape in docs/contracts.md.
 */

import { and, eq } from "drizzle-orm";

import { imports, runs } from "../../db/schema-core";
import { importFileKeyFor } from "../../lib/import-file-key";
import { firstColumnWhere } from "../../lib/sql/keyed-read";
import { isWithinRateLimit } from "../email";
import {
  ImportUploadError,
  UPLOAD_REFUSALS,
  UPLOADS_PER_DAY,
  checkUpload,
} from "./upload-limits";
import { newUlid } from "../../lib/ids";
import type { CoreDb } from "./core-db";
import { importJob, type ImportJob } from "./queue-messages";
import { summaryOfRun } from "./service";
import type { RunSummary } from "./service";
import { nowSeconds } from "../../lib/now";

/**
 * Re-exported, not declared: both live in `./upload-limits` so a route can
 * reach them without reaching this file's schema and parser imports. See
 * that file for the measurement.
 */
export { ImportUploadError, MAX_IMPORT_BYTES } from "./upload-limits";

export type ImportRow = typeof imports.$inferSelect;

export interface ImportsQueueProducer {
  send(message: ImportJob): Promise<unknown>;
}

export interface StartImportInput {
  userId: string;
  filename: string;
  bytes: ArrayBuffer;
  idempotencyKey?: string | undefined;
  /**
  The Garmin activity the bytes were fetched for (plan 160).
  */
  garminActivityId?: string | undefined;
}

/**
Sentry's `captureException`, handed in by `functions.ts`: importing `ops`
here would be a cycle (see `strava/oauth.ts`).
*/
export type ReportException = (
  error: unknown,
  context: Record<string, string>,
) => void;

/**
Validates size/type, writes the raw bytes to R2, records the `imports` row,
and enqueues the parse job. Never throws on a parseable-later problem — only
on inputs the upload step itself can reject outright (size, extension).
*/
export async function startImport(
  db: CoreDb,
  importBucket: R2Bucket,
  queue: ImportsQueueProducer,
  input: StartImportInput,
  report: ReportException,
): Promise<{ importId: string }> {
  // The well refuses the same file by the same rule before sending it;
  // this is the guarantee behind that courtesy.
  const check = checkUpload({
    name: input.filename,
    size: input.bytes.byteLength,
  });
  if (!check.ok) throw new ImportUploadError(check.problem);
  const { extension } = check;

  // Three systems in sequence — R2, the row, the queue — and nothing spans
  // them (law 8c). The reconciliation is `imports.status`: a row stuck
  // `pending` past the grace window is re-dispatched by the daily digest,
  // so a failed queue send costs a delay rather than the upload. An R2 put
  // that succeeds where the insert then fails would leave an object no row
  // names, and no bucket rule expires it: so the failed insert
  // takes its object back with it, one attempt (law 3). A Worker that dies
  // between the two still leaves one, and account deletion's purge lists
  // the runner's whole prefix rather than reading rows, so it goes then.
  // A repeat of a submission we already have returns its import, so a
  // retry does not upload the same file twice or start a second parse
  // (law 8b). Checked before the R2 put, because the put is the expensive
  // half.
  const existing = await repeatOf(db, input);
  if (existing !== undefined) return { importId: existing };

  const importId = newUlid();
  const r2Key = importFileKeyFor(input.userId, importId, extension);
  await importBucket.put(r2Key, input.bytes);

  try {
    await db.insert(imports).values({
      id: importId,
      userId: input.userId,
      r2Key,
      idempotencyKey: input.idempotencyKey,
      garminActivityId: input.garminActivityId,
      status: "pending",
      createdAt: nowSeconds(),
    });
  } catch (error) {
    try {
      await importBucket.delete(r2Key);
    } catch (deleteError) {
      // The insert's failure is the one the runner is owed; a delete that
      // fails too leaves the object for the purge, as above, and is
      // reported so the stray file is known (law 7: ids, never the bytes).
      report(deleteError, {
        surface: "import-orphan-delete",
        userId: input.userId,
        importId,
      });
    }
    throw error;
  }

  await queue.send(importJob(importId));

  return { importId };
}

/**
 * The import a submission already started, when it carries a key we have
 * seen from this runner.
 */
async function repeatOf(
  db: CoreDb,
  input: Readonly<Pick<StartImportInput, "userId" | "idempotencyKey">>,
): Promise<string | undefined> {
  return input.idempotencyKey === undefined
    ? undefined
    : firstColumnWhere(
        db,
        imports,
        imports.id,
        and(
          eq(imports.userId, input.userId),
          eq(imports.idempotencyKey, input.idempotencyKey),
        ),
      );
}

const DAY_S = 24 * 60 * 60;

/**
 * Count one of a runner's uploads today, and say whether it is within
 * `UPLOADS_PER_DAY`.
 */
export function isWithinUploadCap(
  db: CoreDb,
  userId: string,
  now = nowSeconds(),
): Promise<boolean> {
  return isWithinRateLimit(
    db,
    "upload-runner",
    userId,
    UPLOADS_PER_DAY,
    DAY_S,
    now,
  );
}

/**
 * A runner's upload, started, or refused with the sentence they read.
 */
export type FileUpload =
  | Readonly<{ isStarted: true; importId: string }>
  | Readonly<{ isStarted: false; refusal: string }>;

/**
 * A file a runner uploads: `startImport`, within `UPLOADS_PER_DAY` a
 * runner (SA-M29). A repeat of a submission returns its import and is not
 * counted again. A Garmin import calls `startImport` itself: each
 * activity imports once, so the picker is bounded already.
 *
 * The refusal is an answer, not an error: a thrown one reaches the form
 * as "Our end failed", and this is the runner's to read.
 */
export async function startFileUpload(
  db: CoreDb,
  importBucket: R2Bucket,
  queue: ImportsQueueProducer,
  input: Omit<StartImportInput, "garminActivityId">,
  report: ReportException,
): Promise<FileUpload> {
  const existing = await repeatOf(db, input);
  if (existing !== undefined) return { isStarted: true, importId: existing };
  if (!(await isWithinUploadCap(db, input.userId))) {
    return { isStarted: false, refusal: UPLOAD_REFUSALS.tooMany };
  }
  const { importId } = await startImport(db, importBucket, queue, input, report);
  return { isStarted: true, importId };
}

/**
 * Where an import has got to, and the run at the end of it.
 *
 * **A1's one poll** (round 22: *"Every upload outcome renders in A1, in
 * place"*). The status and the run come back together so the card that
 * lands is the run's own — its distance, its time in its own zone, and its
 * conditions from the observation, "not a re-fetch". A duplicate's run is
 * the one already logged, entry and all, which is what its receipt opens.
 */
export interface ImportOutcome {
  status: ImportRow["status"];
  failureReason: string | null;
  run: RunSummary | undefined;
}

export async function getImportOutcome(
  db: CoreDb,
  userId: string,
  importId: string,
): Promise<ImportOutcome | undefined> {
  // The run comes with the import, in one read: joined on the runner too,
  // so an import can only ever carry its own runner's run.
  const [row] = await db
    // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; getImportOutcome reads one import with the run it made, scoped to its runner
    .select({ upload: imports, run: runs })
    .from(imports)
    .leftJoin(runs, and(eq(runs.id, imports.runId), eq(runs.userId, userId)))
    .where(and(eq(imports.id, importId), eq(imports.userId, userId)))
    .limit(1);
  if (row === undefined) return undefined;
  return {
    status: row.upload.status,
    failureReason: row.upload.failureReason,
    run: row.run === null ? undefined : await summaryOfRun(db, userId, row.run),
  };
}
