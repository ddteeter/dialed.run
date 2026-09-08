/**
 * Import intake (102 §2): stores the raw upload in R2, records the
 * `imports` row, and enqueues the parse job. The R2 key carries the file
 * extension (`imports/{userId}/{importId}.{ext}`) so the queue consumer
 * can pick a parser without a schema column — the `imports` table stays
 * exactly the contract shape in docs/contracts.md.
 */
import { and, eq } from "drizzle-orm";

import { imports } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import type { CoreDb } from "./core-db";
import { IMPORT_EXTENSIONS, importExtensionOf } from "./parsers";
import type { ImportExtension } from "./parsers";
import type { ImportJob } from "./queue-messages";

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
  const importId = newUlid();
  const r2Key = `imports/${input.userId}/${importId}.${extension}`;
  await importBucket.put(r2Key, input.bytes);

  await db.insert(imports).values({
    id: importId,
    userId: input.userId,
    r2Key,
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
  const rows = await db
    .select()
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, userId)))
    .limit(1);
  return rows[0];
}
