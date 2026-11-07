/**
 * Who reported something, and the record of an operator looking (D-164,
 * R-66; round 8's D1). Coordinated reporting is itself a moderation case,
 * so the reviewer can see the reporters behind a fold, and opening it is
 * written to `review_audit`. The promise to reporters is that the author
 * never learns, not that the reviewer cannot see.
 *
 * **One batch, the record first.** The audit row is written from the
 * queue row by `INSERT … SELECT`, and the reporters are read after it in
 * the same batch, so there is no way to read the names without the record
 * landing: a batch commits whole or not at all.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import {
  reports,
  reviewAudit,
  reviewQueue,
  userProfiles,
} from "../../db/schema-core";
import { primaryCoreDb } from "../../env";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import type { ReportReason } from "./contracts";

/**
 * One reporter, oldest first: the handle they go by now (a closed
 * account's is gone), what they picked, and when.
 */
export interface Reporter {
  handle: string | null;
  reason: ReportReason;
  createdAt: number;
}

export async function reportersFor(
  actorId: string,
  reviewId: string,
): Promise<Reporter[]> {
  const db = primaryCoreDb();
  const auditId = newUlid();
  const at = nowSeconds();
  const record = db
    .select({
      id: sql<string>`${auditId}`.as("id"),
      actorId: sql<string>`${actorId}`.as("actor_id"),
      action: sql<"opened_reporters">`'opened_reporters'`.as("action"),
      reviewId: reviewQueue.id,
      subjectType: reviewQueue.subjectType,
      subjectId: reviewQueue.subjectId,
      createdAt: sql<number>`${at}`.as("created_at"),
    })
    .from(reviewQueue)
    .where(eq(reviewQueue.id, reviewId));
  const sameSubject = and(
    eq(reports.subjectType, reviewQueue.subjectType),
    eq(reports.subjectId, reviewQueue.subjectId),
  );
  const [, reporters] = await db.batch([
    db.insert(reviewAudit).select(record),
    db
      .select({
        handle: userProfiles.username,
        reason: reports.reason,
        createdAt: reports.createdAt,
      })
      .from(reviewQueue)
      .innerJoin(reports, sameSubject)
      .leftJoin(userProfiles, eq(userProfiles.userId, reports.reporterId))
      .where(eq(reviewQueue.id, reviewId))
      .orderBy(asc(reports.createdAt), asc(reports.id)),
  ]);
  return reporters;
}
