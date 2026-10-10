/**
 * An operator's decision on a `/takedown` request (design 136, decision
 * D-117): take the subject down, or decline with a reason, and tell the
 * requester either way.
 *
 * Here rather than in `safety`, which records the request, because taking
 * a kit or photo down is `moderateContent`'s, and `feed` owns that.
 *
 * **Retry-safe from any point** (law 1). The takedown goes first: a
 * decision that dies after it leaves the request pending, and the retry's
 * takedown finds the subject gone and answers `already_removed`. Then the
 * request's claim and the requester's email are one batch, the email
 * written only where the claim landed, so the requester is told exactly
 * once and never about a decision that did not happen (law 8c).
 */
import { and, eq, sql } from "drizzle-orm";

import { takedownRequests } from "../../db/schema-core";
import { nowSeconds } from "../../lib/now";
import { firstRowWhere } from "../../lib/sql/keyed-read";
import { emailDebt } from "../email";
import { outboxInsertWhere, oweOutbox } from "../ops";
import { moderateContent } from "./moderation";

type Db = Parameters<typeof moderateContent>[0];

export type RemovalDecision =
  | { readonly outcome: "removed" }
  | { readonly outcome: "declined"; readonly reason: string };

export type RemovalDecisionResult = "decided" | "already_decided" | "not_found";

export async function decideRemovalRequest(
  db: Db,
  actorId: string,
  requestId: string,
  decision: RemovalDecision,
  now = nowSeconds(),
): Promise<RemovalDecisionResult> {
  const request = await firstRowWhere(
    db,
    takedownRequests,
    eq(takedownRequests.id, requestId),
  );
  if (request === undefined) return "not_found";
  if (request.status !== "pending") return "already_decided";
  if (
    decision.outcome === "removed" &&
    request.subjectType !== null &&
    request.subjectId !== null
  ) {
    await moderateContent(db, {
      actorId,
      action: "takedown",
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      reason: "intimate",
      notice: `removal request ${request.id}`,
    });
  }
  const reason = decision.outcome === "declined" ? decision.reason : undefined;
  // The row as this decision leaves it: only then is the email owed.
  const decided = sql`${takedownRequests.id} = ${request.id} and ${takedownRequests.status} = ${decision.outcome} and ${takedownRequests.resolvedAt} = ${now}`;
  const stillPending = and(
    eq(takedownRequests.id, request.id),
    eq(takedownRequests.status, "pending"),
  );
  const told = emailDebt(
    {
      to: { address: request.requesterEmail },
      template: {
        kind: "removal_request_decided",
        outcome: decision.outcome,
        reason,
      },
    },
    { dedupeKey: `removal_request_decided:${request.id}` },
  );
  await db.batch([
    db
      .update(takedownRequests)
      .set({
        status: decision.outcome,
        declineReason: reason,
        resolvedAt: now,
        resolvedBy: actorId,
      })
      .where(stillPending),
    outboxInsertWhere(
      db,
      oweOutbox(told),
      { table: takedownRequests, where: decided },
      now,
    ),
  ]);
  return "decided";
}
