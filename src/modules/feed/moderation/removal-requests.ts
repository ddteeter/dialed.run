/**
 * An operator's decision on a `/takedown` request (design 136, decision
 * D-117): take the subject down, or decline with a reason, and tell the
 * requester either way. A Decline gives back what the request hid.
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
 *
 * **Held to the request, both ways.** The takedown's batch holds to the
 * request still pending as it lands, and a Decline's claim to no takedown
 * recorded for this request, so of two opposite decisions sent together
 * only one acts. Each answers `decided` only where its own claim landed.
 */
import { and, eq, like, notExists, sql } from "drizzle-orm";

import { moderationActions, takedownRequests } from "../../../db/schema-core";
import { removalRequestNotice } from "../../../lib/contracts/takedown";
import { nowSeconds } from "../../../lib/now";
import { firstRowWhere } from "../../../lib/sql/keyed-read";
import { emailDebt } from "../../email";
import { outboxInsertWhere, oweOutbox } from "../../ops";
import { releaseHoldWrites, requestSubjectOf } from "../../safety";
import type { HeldTo } from "./garment-moderation";
import { moderateContent } from "./moderation";

type Db = Parameters<typeof moderateContent>[0];

/**
 * What the operator decided. `reason` is a decline's; the server input
 * (`removalDecisionInput`) requires it there and allows it nowhere else.
 */
export interface RemovalDecision {
  readonly outcome: "removed" | "declined";
  readonly reason?: string | undefined;
}

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
  // A request no longer pending takes nothing down (the takedown is held
  // to it) and is claimed by nothing, so it answers `already_decided`.
  // The subject is read from the request as filed, the way Review shows
  // it: a link that is not ours names nothing to take down.
  const subject = await requestSubjectOf(db, request);
  if (subject !== undefined && decision.outcome === "removed") {
    const heldTo = stillPending(db, request.id);
    try {
      await moderateContent(db, {
        actorId,
        action: "takedown",
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        reason: "intimate",
        notice: removalRequestNotice(request.id),
        heldTo,
      });
    } catch (error: unknown) {
      if (heldTo.refused(error)) return "already_decided";
      throw error;
    }
  }
  const { reason } = decision;
  // The row as this decision leaves it: only then is the email owed.
  const decided = sql`${takedownRequests.id} = ${request.id} and ${takedownRequests.status} = ${decision.outcome} and ${takedownRequests.resolvedAt} = ${now}`;
  // A Decline of a subject of ours also waits on no takedown recorded for
  // this request: one whose claim is still to land.
  const claimable = and(
    eq(takedownRequests.id, request.id),
    eq(takedownRequests.status, "pending"),
    subject !== undefined && decision.outcome === "declined"
      ? notExists(takenDownFor(db, request.id, subject))
      : undefined,
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
      .where(claimable),
    outboxInsertWhere(
      db,
      oweOutbox(told),
      { table: takedownRequests, where: decided },
      now,
    ),
    // A Decline gives back what the request hid (round 35 #58e), in the
    // claim's batch and only where the claim landed. Owed on every
    // decision about a subject of ours: the give-back moves a subject only
    // when this request is the one just *declined*, so after a removal it
    // matches nothing — the outcome needs no second check here.
    ...(subject === undefined
      ? []
      : releaseHoldWrites(db, { id: request.id, declinedAt: now }, subject)),
  ]);
  return (await wasClaimedHere(db, request.id, { actorId, decision, now }))
    ? "decided"
    : "already_decided";
}

/**
 * The takedown's hold on the request (`moderateContent`'s `heldTo`): it
 * fails the takedown's batch when the request is no longer pending as it
 * lands, setting its status, which may not be empty, to nothing.
 */
function stillPending(db: Db, requestId: string): HeldTo {
  const status = sql<"pending">`(case when ${takedownRequests.status} = 'pending' then ${takedownRequests.status} else null end)`;
  return {
    statement: db
      .update(takedownRequests)
      .set({ status })
      .where(eq(takedownRequests.id, requestId)),
    refused: (error) => {
      const text = String(error);
      return (
        text.includes("NOT NULL") && text.includes("takedown_requests.status")
      );
    },
  };
}

/**
 * A takedown this request's Take it down recorded: its audit row, on the
 * request's subject, carrying the request's notice.
 */
function takenDownFor(
  db: Db,
  requestId: string,
  subject: NonNullable<Awaited<ReturnType<typeof requestSubjectOf>>>,
) {
  const notice = removalRequestNotice(requestId);
  return db
    .select({ one: sql`1` })
    .from(moderationActions)
    .where(
      and(
        eq(moderationActions.action, "takedown"),
        eq(moderationActions.subjectType, subject.subjectType),
        eq(moderationActions.subjectId, subject.subjectId),
        like(moderationActions.reason, `%${notice}`),
      ),
    );
}

/**
Whether the request reads back as this decision left it.
*/
async function wasClaimedHere(
  db: Db,
  requestId: string,
  claim: Readonly<{ actorId: string; decision: RemovalDecision; now: number }>,
): Promise<boolean> {
  const row = await firstRowWhere(
    db,
    takedownRequests,
    and(
      eq(takedownRequests.id, requestId),
      eq(takedownRequests.status, claim.decision.outcome),
      eq(takedownRequests.resolvedAt, claim.now),
      eq(takedownRequests.resolvedBy, claim.actorId),
    ),
  );
  return row !== undefined;
}
