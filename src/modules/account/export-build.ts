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
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { makeZip, predictLength } from "client-zip";

import { dataExports } from "../../db/schema-core";
import { env } from "../../env";
import { EXPORT_LINK_TTL_S } from "../../lib/data-export";
import { entryPhotoPrefix } from "../../lib/entry-photo-key";
import { garmentPhotoPrefix } from "../../lib/garment-photo-key";
import { nowSeconds } from "../../lib/now";
import { listedPages } from "../../lib/r2-pages";
import { emailDebt } from "../email";
import {
  captureException,
  outboxInsert,
  oweOutbox,
  settleOutbox,
  type OutboxDebt,
} from "../ops";
import type { ExportWork } from "../runs";
import { exportKeyFor, failExport, IN_FLIGHT } from "./data-exports";
import { exportData } from "./export";
import {
  exportFiles,
  type ExportObject,
  type ExportText,
} from "./export-files";

type Db = ReturnType<typeof drizzle>;
type Report = (error: unknown, context: Record<string, string>) => void;

export interface BuildDeps {
  readonly db: Db;
  readonly media: Pick<R2Bucket, "get" | "list">;
  readonly imports: Pick<R2Bucket, "get" | "list" | "put">;
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
 * The ZIP, written to `key`: the texts first, then each object fetched as
 * the zip asks for it. A file that is gone by the time it is fetched
 * throws, and the queue's retry lists again (law 3).
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
  // A file gone between the listing and now ends the ZIP short rather than
  // throwing inside the zip library, which cannot hand a source's error
  // back without leaving a rejection nobody holds. Short of its length,
  // the stream refuses to close, the upload fails, and this says why.
  const found = { isMissing: false };
  async function* entries() {
    yield* texts;
    for (const object of files.objects) {
      const stored = await buckets[object.bucket].get(object.key);
      if (stored === null) {
        found.isMissing = true;
        return;
      }
      yield {
        name: object.name,
        input: stored.body,
        size: object.size,
        lastModified: stored.uploaded,
      };
    }
  }
  const { readable, writable } = new FixedLengthStream(length);
  try {
    await Promise.all([
      deps.imports.put(key, readable, {
        httpMetadata: { contentType: "application/zip" },
      }),
      makeZip(entries()).pipeTo(writable),
    ]);
  } catch (error) {
    throw found.isMissing ? new Error("an export file went missing") : error;
  }
}

/**
 * The `account_export` job: claim the row, build and stage the ZIP, then
 * mark it ready and owe the email in one batch (a write and the message
 * that records it). A job whose row is finished, failed or gone claims
 * nothing and stops; `building` is claimable again, so a redelivery after
 * a crash rebuilds rather than stranding the row.
 */
export async function buildExport(
  deps: BuildDeps,
  exportId: string,
): Promise<void> {
  const { db, now } = deps;
  const [row] = await db
    .update(dataExports)
    .set({ status: "building", claimedAt: now })
    .where(
      and(eq(dataExports.id, exportId), inArray(dataExports.status, IN_FLIGHT)),
    )
    .returning();
  if (row === undefined) return;
  const { userId } = row;
  try {
    const data = await exportData(db, userId);
    const stored = {
      media: await sizesUnder(deps.media, [
        entryPhotoPrefix(userId),
        garmentPhotoPrefix(userId),
      ]),
      imports: await sizesUnder(deps.imports, [`imports/${userId}/`]),
    };
    await writeZip(
      deps,
      exportKeyFor(userId, exportId),
      exportFiles(data, stored, now),
    );
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
  const stillBuilding = and(
    eq(dataExports.id, exportId),
    eq(dataExports.status, "building"),
  );
  await db.batch([
    db
      .update(dataExports)
      .set({
        status: "ready",
        readyAt: now,
        expiresAt: now + EXPORT_LINK_TTL_S,
      })
      .where(stillBuilding),
    outboxInsert(db, debt, now),
  ]);
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
 * The export work `dialed-imports`' consumer is handed (`ExportWork`), on
 * the live bindings. The Worker entry passes it to `handleQueueBatch`.
 */
export function exportWorkFromEnv(): ExportWork {
  return {
    build: (exportId) => buildExport(liveBuildDeps(), exportId),
    fail: (exportId) =>
      failExport(drizzle(env.DIALED_CORE), exportId, captureException),
  };
}
