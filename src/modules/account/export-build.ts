/**
 * The export's queued build (task 126, ACC-10; D-79): the runner's rows
 * and files, streamed into one ZIP in `IMPORTS`, then the email.
 *
 * **Server-only, and reached only from `src/server.ts`**: it imports the
 * zip library, which must never reach the client bundle, so it is not in
 * this module's barrel and no route imports it.
 *
 * **Streaming, one file in memory at a time.** `client-zip`'s `makeZip`
 * pulls the next file from `entries()` only once the last is written, and
 * `entries()` fetches each photo or run file from R2 only when asked. R2
 * takes a stream only of known length, so the length is computed first
 * (`predictLength`) from sizes the bucket listings report, and the ZIP is
 * piped through a `FixedLengthStream` of exactly that length.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeZip, predictLength } from "client-zip";

import { dataExports } from "../../db/schema-core";
import { env } from "../../env";
import { EXPORT_LINK_TTL_S } from "../../lib/contracts/data-export";
import { entryPhotoPrefix } from "../../lib/entry-photo-key";
import { garmentPhotoPrefix } from "../../lib/garment-photo-key";
import { newUlid } from "../../lib/ids";
import { importFilePrefix } from "../../lib/import-file-key";
import { nowSeconds } from "../../lib/now";
import { listedPages } from "../../lib/sql/r2-pages";
import { emailDebt } from "../email";
import {
  captureException,
  outboxInsertWhere,
  oweOutbox,
  settleOutbox,
  type ExportConsumers,
  type OutboxDebt,
} from "../ops";
import { exportKeyFor, failExport, IN_FLIGHT } from "./data-exports";
import { exportData } from "./export";
import {
  exportFiles,
  type ExportObject,
  type ExportText,
} from "./export-files";
import { exportConsumers } from "./export-queue";

type Db = ReturnType<typeof drizzle>;
type Report = (error: unknown, context: Record<string, string>) => void;

export interface BuildDeps {
  readonly db: Db;
  readonly media: Pick<R2Bucket, "get" | "list">;
  readonly imports: Pick<R2Bucket, "get" | "list" | "put" | "delete">;
  readonly report: Report;
  /**
  The email's fast path (ops' `settleOutbox`); the drain is its net.
  */
  readonly settle: (db: Db, debt: OutboxDebt) => Promise<void>;
  readonly now: number;
}

/**
 * Every object under these prefixes, by key, with its size. R2, not D1:
 * which rows name which of these is decided in code (`exportFiles`).
 */
async function sizesUnder(
  bucket: Pick<R2Bucket, "list">,
  prefixes: readonly string[],
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (const prefix of prefixes) {
    for await (const objects of listedPages(bucket, prefix)) {
      for (const object of objects) sizes.set(object.key, object.size);
    }
  }
  return sizes;
}

/**
 * The most bytes one zero-filled stand-in hands the zip at a time.
 */
const ZERO_CHUNK = 64 * 1024;

/**
 * `size` zero bytes, a chunk at a time: the stand-in for a file that went
 * missing, so the ZIP still ends at the length R2 was promised.
 */
function zeros(size: number): ReadableStream<Uint8Array> {
  let left = size;
  return new ReadableStream({
    pull(controller) {
      if (left > 0) {
        const chunk = Math.min(left, ZERO_CHUNK);
        left -= chunk;
        controller.enqueue(new Uint8Array(chunk));
      } else {
        controller.close();
      }
    },
  });
}

/**
 * The ZIP, written to `key`: the texts first, then each object fetched as
 * the zip asks for it.
 *
 * **A file gone since the listing never errors the stream.** An errored
 * body leaves R2's `put` with rejections nobody holds ("Network connection
 * lost", measured in workerd), and throwing inside the zip library does
 * the same. So a missing file is written as zeros of its listed size, the
 * upload completes at its promised length, and then the half-made ZIP is
 * deleted and this throws; the queue's retry lists again (law 3).
 */
async function writeZip(
  deps: BuildDeps,
  key: string,
  files: { texts: readonly ExportText[]; objects: readonly ExportObject[] },
): Promise<void> {
  const made = new Date(deps.now * 1000);
  const encoder = new TextEncoder();
  const texts = files.texts.map((text) => ({
    name: text.name,
    input: encoder.encode(text.text),
    lastModified: made,
  }));
  const length = predictLength([
    ...texts.map((text) => ({ name: text.name, size: text.input.byteLength })),
    ...files.objects.map((object) => ({
      name: object.name,
      size: object.size,
    })),
  ]);
  const buckets = { media: deps.media, imports: deps.imports };
  const missing: string[] = [];
  async function* entries() {
    yield* texts;
    for (const object of files.objects) {
      const stored = await buckets[object.bucket].get(object.key);
      if (stored === null) missing.push(object.key);
      yield {
        name: object.name,
        input: stored === null ? zeros(object.size) : stored.body,
        size: object.size,
        lastModified: stored?.uploaded,
      };
    }
  }
  const { readable, writable } = new FixedLengthStream(length);
  await Promise.all([
    deps.imports.put(key, readable, {
      httpMetadata: { contentType: "application/zip" },
    }),
    makeZip(entries()).pipeTo(writable),
  ]);
  if (missing.length > 0) {
    await deps.imports.delete(key);
    throw new Error("an export file went missing");
  }
}

/**
 * The `account_export` job: claim the row, build and stage the ZIP, then
 * mark it ready and owe the email in one batch (a write and the message
 * that records it). A job whose row is finished, failed or gone claims
 * nothing and stops.
 *
 * **Every claim is its own** (`claim_id`, fresh each time). `building` is
 * claimable again, so a redelivery after a crash rebuilds rather than
 * stranding the row — which also means a sweep re-send or a duplicate
 * delivery can take the claim while another build is still running. Each
 * writes its own ZIP (the key carries the claim), and only the build still
 * holding the claim can finish: the ready update is guarded on it, and the
 * email is an `INSERT … SELECT` that owes a row only if that update made
 * the export ready under this claim. A build that finishes nothing deletes
 * the ZIP it wrote. So one export sends one email and leaves one ZIP,
 * whoever wins, and a row purged or failed mid-build gets neither.
 */
export async function buildExport(
  deps: BuildDeps,
  exportId: string,
): Promise<void> {
  const { db, now } = deps;
  const claimId = newUlid();
  const [row] = await db
    .update(dataExports)
    .set({ status: "building", claimedAt: now, claimId })
    .where(
      and(eq(dataExports.id, exportId), inArray(dataExports.status, IN_FLIGHT)),
    )
    .returning({
      userId: dataExports.userId,
      linkToken: dataExports.linkToken,
    });
  if (row === undefined) return;
  const { userId } = row;
  const key = exportKeyFor({ userId, id: exportId, claimId });
  try {
    const data = await exportData(db, userId);
    const stored = {
      media: await sizesUnder(deps.media, [
        entryPhotoPrefix(userId),
        garmentPhotoPrefix(userId),
      ]),
      imports: await sizesUnder(deps.imports, [importFilePrefix(userId)]),
    };
    await writeZip(deps, key, exportFiles(data, stored, now));
  } catch (error) {
    // The ids, never a file name or a byte (law 7); the queue retries.
    deps.report(error, { surface: "account-export-build", exportId, userId });
    throw error;
  }
  const debt = oweOutbox(
    emailDebt(
      {
        to: { userId },
        template: { kind: "export_ready", token: row.linkToken },
      },
      { dedupeKey: `export_ready:${exportId}` },
    ),
  );
  // This export, under this build's claim, in `status`.
  const mine = (status: "building" | "ready") =>
    sql.join(
      [
        eq(dataExports.id, exportId),
        eq(dataExports.claimId, claimId),
        eq(dataExports.status, status),
      ],
      sql` and `,
    );
  const [readied] = await db.batch([
    db
      .update(dataExports)
      .set({
        status: "ready",
        readyAt: now,
        expiresAt: now + EXPORT_LINK_TTL_S,
      })
      .where(mine("building"))
      .returning({ id: dataExports.id }),
    outboxInsertWhere(
      db,
      debt,
      { table: dataExports, where: mine("ready") },
      now,
    ),
  ]);
  if (readied.length === 0) {
    // The claim was taken over, or the row failed or went while this
    // built: another build owns the export now, or nobody does. Nothing
    // was owed; what this build wrote is its own to remove.
    await deps.imports.delete(key);
    return;
  }
  await deps.settle(db, debt);
}

function liveBuildDeps(): BuildDeps {
  return {
    db: drizzle(env.DIALED_CORE),
    media: env.MEDIA,
    imports: env.IMPORTS,
    report: captureException,
    settle: (db, debt) => settleOutbox(db, debt),
    now: nowSeconds(),
  };
}

/**
 * `dialed-exports`' consumer and dead-letter consumer, on the live
 * bindings. The Worker entry passes them to `handleQueueBatch`.
 */
export function exportConsumersFromEnv(): ExportConsumers {
  return exportConsumers(
    {
      build: (exportId) => buildExport(liveBuildDeps(), exportId),
      fail: (exportId) =>
        failExport(drizzle(env.DIALED_CORE), exportId, captureException),
    },
    captureException,
  );
}
