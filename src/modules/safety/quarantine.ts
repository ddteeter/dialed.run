/**
 * The suspected-CSAM quarantine's record (task 128 · SAF-5; decision
 * D-70): `quarantined_content`, written once and read only by an admin.
 *
 * The rows a quarantine deletes are copied here first, in the same batch,
 * so they are hidden from every read at once — no read anywhere has to
 * remember a filter — and still exist, with who uploaded them and when,
 * for the owner's report to NCMEC's CyberTipline. Kept a year
 * (`QUARANTINE_RETENTION_SECONDS`) after the quarantine, or a year after
 * that report when it is later (`recordNcmecReport`, C12).
 */
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { session, user } from "../../db/schema-auth";
import { quarantinedContent, userProfiles } from "../../db/schema-core";
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
 * Who uploaded it, as their account stands now, as JSON for the record's
 * `uploader_snapshot` (design 157): the context 18 U.S.C. §2258A(h)(2)
 * asks a provider to preserve with a report — "data … that may provide
 * context or additional information about the reported material or
 * person" — copied into the record so it keeps the record's clock.
 *
 * Without it, a ban deletes every session at once, the daily sweep
 * deletes an expired one 30 days on, and the account purge deletes the
 * email: each would take the context before the report's year was out.
 * In the record it has no foreign key, is touched by none of them, and
 * goes with the record's own purge.
 *
 * The email, when the account was made, the username, and each session's
 * times, IP address and browser — the only IP addresses we hold; no
 * upload records one. **Never a session's token**, which is a credential.
 * Read before the quarantine's batch, which cannot read for itself; an
 * account already gone gives no email or username and no sessions.
 */
export async function uploaderContextOf(
  db: Db,
  uploaderId: string,
): Promise<string> {
  const [account, profile, sessions] = await db.batch([
    db
      // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; uploaderContextOf reads one uploader's account, profile and sessions for a quarantine record, each table once
      .select({ email: user.email, createdAt: user.createdAt })
      // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; uploaderContextOf reads one uploader's account, profile and sessions for a quarantine record, each table once
      .from(user)
      .where(eq(user.id, uploaderId)),
    db
      .select({ username: userProfiles.username })
      .from(userProfiles)
      .where(eq(userProfiles.userId, uploaderId)),
    // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; uploaderContextOf reads one uploader's account, profile and sessions for a quarantine record, each table once
    db
      .select({
        createdAt: session.createdAt,
        // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; uploaderContextOf reads one uploader's account, profile and sessions for a quarantine record, each table once
        updatedAt: session.updatedAt,
        // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; uploaderContextOf reads one uploader's account, profile and sessions for a quarantine record, each table once
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      })
      .from(session)
      .where(eq(session.userId, uploaderId))
      .orderBy(asc(session.createdAt)),
  ]);
  // An absent field is left out of the JSON, which says "not found".
  return JSON.stringify({
    email: account[0]?.email,
    accountCreatedAt: account[0]?.createdAt,
    username: profile[0]?.username,
    sessions,
  });
}

/**
The most records one read returns.
*/
export const QUARANTINE_PAGE = 100;

/**
 * What is in quarantine, newest first — for an admin only. Anyone else
 * is refused with `AdminRequiredError`, before anything is read.
 *
 * The record's columns without its two snapshots: this is what Review
 * lists, and the snapshots are the content itself, which has no business
 * in a page's loader data.
 */
export async function quarantinedContentFor(db: Db, viewerId: string) {
  requireAdmin(viewerId);
  return db
    .select({
      id: quarantinedContent.id,
      subjectType: quarantinedContent.subjectType,
      subjectId: quarantinedContent.subjectId,
      uploaderId: quarantinedContent.uploaderId,
      entryId: quarantinedContent.entryId,
      quarantinedAt: quarantinedContent.quarantinedAt,
      retainUntil: quarantinedContent.retainUntil,
      ncmecReportedAt: quarantinedContent.ncmecReportedAt,
      ncmecReportId: quarantinedContent.ncmecReportId,
    })
    .from(quarantinedContent)
    .orderBy(desc(quarantinedContent.quarantinedAt))
    .limit(QUARANTINE_PAGE);
}

export type QuarantineSummary = Awaited<
  ReturnType<typeof quarantinedContentFor>
>[number];

/**
 * The operator's record that a quarantine was reported to NCMEC (C12).
 * `reportId` is CyberTipline's id for the report, when they have it.
 */
export interface NcmecReport {
  readonly recordId: string;
  readonly reportId?: string | undefined;
}

/**
 * Record that a quarantined record was reported to NCMEC, now.
 *
 * A completed CyberTipline report is a request to preserve its contents
 * for a year after the report (18 U.S.C. §2258A(h)(1), as the REPORT Act
 * amended it), so `retain_until` becomes the later of what it was and a
 * year past the report. It never moves earlier: the quarantine's own year
 * stays the floor, and so does a purge's lease.
 *
 * **The first recording is the report time.** Recording again — a
 * double-click, a retry, or adding the report id afterwards — keeps the
 * time it first recorded and so moves nothing, which is what makes it
 * safe to repeat. One statement, so the time and the clock it sets can
 * never disagree: SQLite reads every column in `SET` as it stood before
 * the update.
 *
 * The time is when the operator records it, not a time they type: the
 * record is made after the report is filed, so its year ends no earlier
 * than the report's would. Admin-only, refused before anything is
 * written. Says `gone` when there is no record by that id (already
 * purged, or never), and otherwise the record's report and clock as they
 * now stand.
 */
export async function recordNcmecReport(
  db: Db,
  viewerId: string,
  report: NcmecReport,
  now = nowSeconds(),
) {
  requireAdmin(viewerId);
  const reportedAt = sql<number>`coalesce(${quarantinedContent.ncmecReportedAt}, ${now})`;
  const [recorded] = await db
    .update(quarantinedContent)
    .set({
      ncmecReportedAt: reportedAt,
      retainUntil: sql<number>`max(${quarantinedContent.retainUntil}, ${reportedAt} + ${QUARANTINE_RETENTION_SECONDS})`,
      // Given, it replaces what was there, so a mistyped id can be
      // corrected; omitted, it leaves it, as drizzle sets no column whose
      // value is `undefined`.
      ncmecReportId: report.reportId,
    })
    .where(eq(quarantinedContent.id, report.recordId))
    .returning({
      ncmecReportedAt: quarantinedContent.ncmecReportedAt,
      ncmecReportId: quarantinedContent.ncmecReportId,
      retainUntil: quarantinedContent.retainUntil,
    });
  return recorded === undefined
    ? ({ outcome: "gone" } as const)
    : ({ outcome: "recorded", ...recorded } as const);
}

/**
 * The most records one purge takes. The purge rides the daily digest, and
 * a year's quarantines expire a few a day at most, so a backlog past this
 * is finished on the following days rather than in one long firing.
 */
export const QUARANTINE_PURGE_CAP = 50;

/**
 * How far a claim moves a record's `retain_until` on: the lease that keeps
 * an overlapping purge off it, and — if this one fails — when a later
 * firing may try again. Retention only ever lengthens, so a claim can
 * never make evidence go early.
 *
 * **Half the daily interval, not a whole one** (PR #129 review). The purge
 * reads `now` when the digest reaches it, which is some way into the
 * firing and never at the same moment twice. A 24h lease taken late one
 * day ran past the next day's firing if that one reached the purge any
 * earlier, so a failed record was retried every other day. Twelve hours
 * is still far longer than any purge runs, and ends well before the next.
 */
export const QUARANTINE_PURGE_LEASE_SECONDS = 12 * 60 * 60;

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
 * The records whose year is up, oldest first, with the `retain_until`
 * each was read at — the value its claim compares against.
 */
export async function dueQuarantine(db: Db, now: number) {
  return db
    .select({
      id: quarantinedContent.id,
      retainUntil: quarantinedContent.retainUntil,
    })
    .from(quarantinedContent)
    .where(lte(quarantinedContent.retainUntil, now))
    .orderBy(asc(quarantinedContent.retainUntil))
    .limit(QUARANTINE_PURGE_CAP);
}

/**
 * Claim, then work (law 2): each due record is claimed by a
 * compare-and-swap on the `retain_until` it was read at, moving it a lease
 * on, so a purge that overlaps this one — having read the same value —
 * finds it moved and claims nothing. One batch for one round trip; each
 * claim stands alone. Returns the records this call claimed.
 */
export async function claimQuarantine(
  db: Db,
  due: readonly { id: string; retainUntil: number }[],
  now: number,
) {
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
  const claimed = await claimQuarantine(db, await dueQuarantine(db, now), now);
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
