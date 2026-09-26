/**
 * Import intake (102 §2): stores the raw upload in R2, records the
 * `imports` row, and enqueues the parse job. The R2 key carries the file
 * extension (`imports/{userId}/{importId}.{ext}`) so the queue consumer
 * can pick a parser without a schema column — the `imports` table stays
 * exactly the contract shape in docs/contracts.md.
 */

import { and, eq } from "drizzle-orm";

import { imports, runs } from "../../db/schema-core";
import { firstColumnWhere } from "../../lib/keyed-read";
import { ImportUploadError, checkUpload } from "./upload-limits";
import { newUlid } from "../../lib/ids";
import type { CoreDb } from "./core-db";
import type { ImportJob } from "./queue-messages";
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
}

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
  // that succeeds where the insert then fails leaves an orphan object,
  // which the bucket's 30-day lifecycle rule collects.
  // A repeat of a submission we already have returns its import, so a
  // retry does not upload the same file twice or start a second parse
  // (law 8b). Checked before the R2 put, because the put is the expensive
  // half.
  if (input.idempotencyKey !== undefined) {
    const existing = await firstColumnWhere(
      db,
      imports,
      imports.id,
      and(
        eq(imports.userId, input.userId),
        eq(imports.idempotencyKey, input.idempotencyKey),
      ),
    );
    if (existing !== undefined) return { importId: existing };
  }

  const importId = newUlid();
  const r2Key = `imports/${input.userId}/${importId}.${extension}`;
  await importBucket.put(r2Key, input.bytes);

  await db.insert(imports).values({
    id: importId,
    userId: input.userId,
    r2Key,
    idempotencyKey: input.idempotencyKey,
    status: "pending",
    createdAt: nowSeconds(),
  });

  await queue.send({ type: "import", importId });

  return { importId };
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
