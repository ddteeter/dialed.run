/**
 * Import intake (102 §2): stores the raw upload in R2, records the
 * `imports` row, and enqueues the parse job. The R2 key carries the file
 * extension (`imports/{userId}/{importId}.{ext}`) so the queue consumer
 * can pick a parser without a schema column — the `imports` table stays
 * exactly the contract shape in docs/contracts.md.
 */

import { and, eq } from "drizzle-orm";

import { imports } from "../../db/schema-core";
import { firstColumnWhere } from "../../lib/keyed-read";
import { newUlid } from "../../lib/ids";
import type { CoreDb } from "./core-db";
import { IMPORT_EXTENSIONS, importExtensionOf } from "./parsers";
import type { ImportExtension } from "./parsers";
import type { ImportJob } from "./queue-messages";
import { selectOwnedRow } from "../../lib/owned";

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export type ImportRow = typeof imports.$inferSelect;

export class ImportUploadError extends Error {}

export interface ImportsQueueProducer {
  send(message: ImportJob): Promise<unknown>;
}

export interface StartImportInput {
  userId: string;
  filename: string;
  bytes: ArrayBuffer;
  idempotencyKey?: string | undefined;
}

function extensionFromFilename(filename: string): ImportExtension {
  const extension = importExtensionOf(filename);
  if (extension === undefined) {
    throw new ImportUploadError(
      `Unsupported file type. Upload a ${IMPORT_EXTENSIONS.join(", ")} file.`,
    );
  }
  return extension;
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
  if (input.bytes.byteLength === 0) {
    throw new ImportUploadError("That file is empty.");
  }
  if (input.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportUploadError("That file is larger than 25 MB.");
  }
  const extension = extensionFromFilename(input.filename);

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
    createdAt: Math.floor(Date.now() / 1000),
  });

  await queue.send({ type: "import", importId });

  return { importId };
}

export async function getImportStatus(
  db: CoreDb,
  userId: string,
  importId: string,
): Promise<ImportRow | undefined> {
  return selectOwnedRow(db, imports, { id: importId, userId });
}
