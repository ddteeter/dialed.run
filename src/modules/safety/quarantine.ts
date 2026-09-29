/**
 * The suspected-CSAM quarantine's record (task 128 · SAF-5; decision
 * D-70): `quarantined_content`, written once and read only by an admin.
 *
 * The rows a quarantine deletes are copied here first, in the same batch,
 * so they are hidden from every read at once — no read anywhere has to
 * remember a filter — and still exist, with who uploaded them and when,
 * for the owner's report to NCMEC's CyberTipline. Kept a year
 * (`QUARANTINE_RETENTION_SECONDS`).
 */
import { and, asc, desc, eq, lte } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { quarantinedContent } from "../../db/schema-core";
import { env } from "../../env";
import { quarantineKeyFor } from "../../lib/entry-photo-key";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";

import { requireAdmin } from "./admin";

type Db = ReturnType<typeof drizzle>;

/**
One year, the preservation the owner set (D-70).
*/
export const QUARANTINE_RETENTION_SECONDS = 365 * 24 * 60 * 60;

export type QuarantineRecord = Omit<
  typeof quarantinedContent.$inferInsert,
  "id" | "retainUntil"
>;

/**
 * The row, as a statement for the caller's batch — the same batch as the
 * deletes it preserves, so the rows are never gone without their copy.
 */
export function quarantineInsert(db: Db, record: QuarantineRecord) {
  return db.insert(quarantinedContent).values({
    id: newUlid(),
    ...record,
    retainUntil: record.quarantinedAt + QUARANTINE_RETENTION_SECONDS,
  });
}

/**
The most records one read returns.
*/
export const QUARANTINE_PAGE = 100;

/**
 * What is in quarantine, newest first — for an admin only. Anyone else
 * is refused with `AdminRequiredError`, before anything is read.
 */
export async function quarantinedContentFor(db: Db, viewerId: string) {
  requireAdmin(viewerId);
  return db
    .select()
    .from(quarantinedContent)
    .orderBy(desc(quarantinedContent.quarantinedAt))
    .limit(QUARANTINE_PAGE);
}

/**
 * The most records one purge takes. The purge rides the daily digest, and
 * a year's quarantines expire a few a day at most, so a backlog past this
 * is finished on the following days rather than in one long firing.
 */
export const QUARANTINE_PURGE_CAP = 50;

/**
 * How far a claim moves a record's `retain_until` on: the lease that keeps
 * an overlapping purge off it, and — if this one fails — when the next
 * daily firing may try again. Retention only ever lengthens, so a claim
 * can never make evidence go early.
 */
export const QUARANTINE_PURGE_LEASE_SECONDS = 24 * 60 * 60;

/**
 * What `photos_snapshot` must say for a purge to know which copies are
 * owed a delete: each photo's `preservedKey`, where the quarantine copied
 * it — absent for a photo whose object was already gone.
 */
const photosSnapshotSchema = z.array(
  z.object({ preservedKey: z.string().optional() }),
);

/**
 * A record's snapshot read back: the copies it names, or what is wrong
 * with it. The two failures are named apart, as the outbox's rows are,
 * because they point at different culprits — a snapshot that is not JSON
 * was written wrong, a well-formed one of the wrong shape was written by
 * another build — and the name is what reaches Sentry.
 */
export type SnapshotKeys =
  | { readonly ok: true; readonly keys: string[] }
  | { readonly ok: false; readonly problem: string };

/**
 * The copies a record's snapshot names. Only keys under the quarantine
 * prefix: the snapshot is JSON in a table, and a purge that trusted it
 * could be pointed at a runner's live photo. Never throws.
 */
export function preservedKeysOf(snapshot: string): SnapshotKeys {
  let decoded: unknown;
  try {
    decoded = JSON.parse(snapshot);
  } catch {
    return { ok: false, problem: "not JSON" };
  }
  const parsed = photosSnapshotSchema.safeParse(decoded);
  if (!parsed.success) return { ok: false, problem: "not a list of photos" };
  const prefix = quarantineKeyFor("");
  return {
    ok: true,
    keys: parsed.data.flatMap((photo) =>
      photo.preservedKey?.startsWith(prefix) === true
        ? [photo.preservedKey]
        : [],
    ),
  };
}

export interface QuarantinePurge {
  readonly purged: number;
  /**
   * Records this run claimed and could not purge, with why — for the
   * caller to report (law 6). Each stays, due again when its lease passes.
   */
  readonly failed: readonly { readonly id: string; readonly error: unknown }[];
}

/**
 * Claim, then work (law 2): each due record is claimed by a
 * compare-and-swap on the `retain_until` this run read, moving it a lease
 * on, so a purge that overlaps this one read the same value, finds it
 * moved, and claims nothing. One batch for one round trip; each claim
 * stands alone.
 */
async function claimExpired(db: Db, now: number) {
  const due = await db
    .select({
      id: quarantinedContent.id,
      retainUntil: quarantinedContent.retainUntil,
    })
    .from(quarantinedContent)
    .where(lte(quarantinedContent.retainUntil, now))
    .orderBy(asc(quarantinedContent.retainUntil))
    .limit(QUARANTINE_PURGE_CAP);
  const [first, ...rest] = due.map((row) =>
    db
      .update(quarantinedContent)
      .set({ retainUntil: now + QUARANTINE_PURGE_LEASE_SECONDS })
      .where(
        and(
          eq(quarantinedContent.id, row.id),
          eq(quarantinedContent.retainUntil, row.retainUntil),
        ),
      )
      .returning({
        id: quarantinedContent.id,
        photosSnapshot: quarantinedContent.photosSnapshot,
      }),
  );
  if (first === undefined) return [];
  const claimed = await db.batch([first, ...rest]);
  return claimed.flat();
}

/**
 * The year is up: delete a quarantine's preserved copies and its record
 * (decision D-70: silent, everything kept a year, then gone). Nobody is
 * told — the uploader never was.
 *
 * **Reconciliation, not an outbox (law 8c).** The record is the durable
 * marker that copies are still owed a delete, and the daily firing
 * re-drives it: the copies go first and the record last, so a failure
 * anywhere leaves the record to be claimed again once its lease passes,
 * and a re-run's delete of copies already gone is a no-op in R2.
 *
 * **Named, never listed.** Two records can share an entry's prefix — a
 * photo quarantined, then the rest of the entry — and each must go on its
 * own date, so a record deletes exactly the copies its snapshot names.
 *
 * The `moderation_actions` row stays: it says who acted, when and why, and
 * holds none of the content.
 */
export async function purgeExpiredQuarantine(
  db: Db,
  media: Pick<R2Bucket, "delete"> = env.MEDIA,
  now = nowSeconds(),
): Promise<QuarantinePurge> {
  const claimed = await claimExpired(db, now);
  const failed: { id: string; error: unknown }[] = [];
  for (const record of claimed) {
    const read = preservedKeysOf(record.photosSnapshot);
    try {
      if (!read.ok) {
        throw new Error(`quarantine snapshot unreadable: ${read.problem}`);
      }
      await media.delete(read.keys);
      await db
        .delete(quarantinedContent)
        .where(eq(quarantinedContent.id, record.id));
    } catch (error) {
      failed.push({ id: record.id, error });
    }
  }
  return { purged: claimed.length - failed.length, failed };
}
