/**
 * The data export's hourly upkeep (task 126, ACC-10), on the `:00`
 * firing: expired ZIPs deleted, old failures forgotten, and exports whose
 * queue send was lost sent again.
 *
 * Re-runnable from any point (law 1) and claim-then-work (law 2). Not in
 * this module's barrel, and called by nothing in `ops` (the cycle the
 * purge documents): the Worker entry hands it to `handleScheduled`.
 */
import { and, asc, eq, inArray, lt, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { dataExports } from "../../db/schema-core";
import { env } from "../../env";
import { EXPORT_LINK_TTL_S } from "../../lib/data-export";
import { nowSeconds } from "../../lib/now";
import { captureException } from "../ops";
import { exportKeyFor, type ExportQueue } from "./data-exports";

type Db = ReturnType<typeof drizzle>;
type Report = (error: unknown, context: Record<string, string>) => void;

/**
Rows one firing expires, and rows it re-sends, at most.
*/
export const EXPORT_SWEEP_CAP = 50;

/**
 * How long a `pending` export waits before its send counts as lost — past
 * any queue's normal delivery, so the sweep never races a live send.
 */
export const EXPORT_STALL_S = 15 * 60;

/**
 * How long a claim holds: a build (`building`) or an expiry (`expiring`)
 * older than this is taken to have died. A queue consumer is stopped at
 * 15 minutes, so an hour is never a build still running.
 */
export const EXPORT_LEASE_S = 60 * 60;

export interface SweepDeps {
  readonly db: Db;
  readonly bucket: Pick<R2Bucket, "delete">;
  readonly queue: ExportQueue;
  readonly report: Report;
  readonly now: number;
}

function liveSweepDeps(): SweepDeps {
  return {
    db: drizzle(env.DIALED_CORE),
    bucket: env.IMPORTS,
    queue: env.IMPORTS_QUEUE,
    report: captureException,
    now: nowSeconds(),
  };
}

export async function sweepExports(
  anomalies: string[],
  deps: SweepDeps = liveSweepDeps(),
): Promise<void> {
  await expireExports(anomalies, deps);
  // A failure's row lives as long as a ready one would have: the page says
  // "didn't work" until the runner asks again, or a week passes. A failed
  // build never completed its `put`, so there is nothing staged.
  await deps.db
    .delete(dataExports)
    .where(
      and(
        eq(dataExports.status, "failed"),
        lt(dataExports.requestedAt, deps.now - EXPORT_LINK_TTL_S),
      ),
    );
  await resendStalled(anomalies, deps);
}

/**
 * Claim the expired, delete each ZIP, then its row. A ZIP that will not
 * delete leaves its row `expiring`, and the next firing past the lease
 * claims it again.
 */
async function expireExports(
  anomalies: string[],
  deps: SweepDeps,
): Promise<void> {
  const { db, now } = deps;
  const expirable = or(
    and(eq(dataExports.status, "ready"), lte(dataExports.expiresAt, now)),
    and(
      eq(dataExports.status, "expiring"),
      lt(dataExports.claimedAt, now - EXPORT_LEASE_S),
    ),
  );
  const oldest = db
    .select({ id: dataExports.id })
    .from(dataExports)
    .where(expirable)
    .orderBy(asc(dataExports.requestedAt))
    .limit(EXPORT_SWEEP_CAP);
  const claimed = await db
    .update(dataExports)
    .set({ status: "expiring", claimedAt: now })
    .where(and(inArray(dataExports.id, oldest), expirable))
    .returning({ id: dataExports.id, userId: dataExports.userId });
  let failed = 0;
  for (const row of claimed) {
    try {
      await deps.bucket.delete(exportKeyFor(row.userId, row.id));
      await db
        .delete(dataExports)
        .where(
          and(eq(dataExports.id, row.id), eq(dataExports.status, "expiring")),
        );
    } catch (error) {
      failed += 1;
      deps.report(error, {
        surface: "account-export-expire",
        exportId: row.id,
        userId: row.userId,
      });
    }
  }
  if (failed > 0) {
    anomalies.push(
      `${String(failed)} expired data export(s) could not be deleted and are retried next hour`,
    );
  }
}

/**
 * Re-send what a lost send or a lost message stranded: `pending` past the
 * stall window, `building` past the lease (law 8c). The consumer claims
 * before it works, so a duplicate costs one no-op delivery.
 */
async function resendStalled(
  anomalies: string[],
  deps: SweepDeps,
): Promise<void> {
  const { db, now } = deps;
  const neverClaimed = and(
    eq(dataExports.status, "pending"),
    lt(dataExports.requestedAt, now - EXPORT_STALL_S),
  );
  const claimDied = and(
    eq(dataExports.status, "building"),
    lt(dataExports.claimedAt, now - EXPORT_LEASE_S),
  );
  const stalled = await db
    .select({ id: dataExports.id, userId: dataExports.userId })
    .from(dataExports)
    .where(or(neverClaimed, claimDied))
    .orderBy(asc(dataExports.requestedAt))
    .limit(EXPORT_SWEEP_CAP);
  if (stalled.length === 0) return;
  for (const row of stalled) {
    try {
      await deps.queue.send({ type: "account_export", exportId: row.id });
    } catch (error) {
      deps.report(error, {
        surface: "account-export-resend",
        exportId: row.id,
        userId: row.userId,
      });
    }
  }
  anomalies.push(
    `${String(stalled.length)} data export(s) stalled and were re-sent`,
  );
}
