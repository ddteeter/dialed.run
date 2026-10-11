/**
 * Requests to remove an intimate image shared without consent, from
 * someone who may have no account (design 136, decision D-117): the TAKE
 * IT DOWN Act's signed-out path, beside the in-app `intimate` report.
 *
 * **A request whose link is ours hides it at once** (round 35 #58e, the
 * owner's call over D-117's first answer): "A valid request hides the
 * image at once, as a W1 report of the reason does." A link that is not
 * ours names nothing to hide. Every operator is emailed, and a person
 * decides within the 48 hours its `dueAt` keeps. The decision is
 * `feed`'s (`decideRemovalRequest`), because taking something down is;
 * a Decline gives the subject back through `releaseHoldWrites`.
 */
import { and, asc, eq, exists, inArray, ne, notExists, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  outfitEntries,
  reviewQueue,
  takedownRequests,
} from "../../db/schema-core";
import {
  takedownSubjectOf,
  type TakedownRequestValues,
  type TakedownSubject,
} from "../../lib/contracts/takedown";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import { firstRowWhere } from "../../lib/sql/keyed-read";
import { countSend, emailDebt, sendClaimOf } from "../email";
import { adminUserIds } from "./admin";
import { REMOVAL_DUE_SECONDS, removalDueLabel } from "./contracts";
import type { OweEmail } from "./reports";

type Db = ReturnType<typeof drizzle>;

export type TakedownRequestResult =
  | { readonly status: "received" }
  | { readonly status: "limited"; readonly until: number }
  | { readonly status: "refused" };

/**
 * What a request needs beyond its form: the Turnstile answer, checked by
 * `verify` (`ops`', handed in, since `ops` imports this module), the
 * visitor's address the limit counts, and whether this deployment limits
 * at all (a real https one does, as Au5's request does).
 */
export interface TakedownRequestInput<Attempt> extends TakedownRequestValues {
  readonly attempt: Attempt;
  readonly remoteIp: string | undefined;
  readonly isLimited: boolean;
}

export interface TakedownRequestDeps<Attempt> {
  readonly verify: (attempt: Attempt) => Promise<{ readonly ok: boolean }>;
  readonly owe: OweEmail;
}

/**
 * File a request: Turnstile, then the limit, then one batch of the row,
 * one alert per operator and the requester's receipt — so a request is
 * never recorded without the emails that make its 48 hours someone's job
 * (law 8c).
 *
 * **A repeat is the first request** (law 8b): the form's key, scoped to
 * the address, finds it, and nothing is written or sent again.
 *
 * **The limit's count is its own write**, before the batch: Au5 can make
 * the request conditional on the count in one statement, but here three
 * emails would each need the same condition. A count whose batch then
 * fails costs the visitor one of their hourly sends and nothing else.
 */
export async function fileTakedownRequest<Attempt>(
  db: Db,
  input: TakedownRequestInput<Attempt>,
  deps: TakedownRequestDeps<Attempt>,
  now = nowSeconds(),
): Promise<TakedownRequestResult> {
  const verdict = await deps.verify(input.attempt);
  if (!verdict.ok) return { status: "refused" };
  const email = input.email.toLowerCase();
  const earlier = await firstRowWhere(
    db,
    takedownRequests,
    and(
      eq(takedownRequests.requesterEmail, email),
      eq(takedownRequests.idempotencyKey, input.idempotencyKey),
    ),
  );
  if (earlier !== undefined) return { status: "received" };
  if (input.isLimited) {
    const counted = await countSend(
      db,
      "takedown",
      input.remoteIp ?? "unknown",
      now,
    );
    const claim = sendClaimOf(counted);
    if (!claim.isAllowed) return { status: "limited", until: claim.until };
  }
  const id = newUlid();
  const dueAt = now + REMOVAL_DUE_SECONDS;
  const subject = takedownSubjectOf(input.location);
  await db.batch([
    db
      .insert(takedownRequests)
      .values({
        id,
        requesterEmail: email,
        signature: input.signature,
        location: input.location,
        subjectType: subject?.subjectType,
        subjectId: subject?.subjectId,
        description: input.description === "" ? undefined : input.description,
        dueAt,
        createdAt: now,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing(),
    ...(subject === undefined ? [] : holdWrites(db, subject)),
    ...adminUserIds().map((userId) =>
      deps.owe(
        emailDebt(
          {
            to: { userId },
            template: {
              kind: "removal_requested",
              dueAt,
              isOurs: subject !== undefined,
            },
          },
          { dedupeKey: `removal_requested:${id}:${userId}` },
        ),
      ),
    ),
    deps.owe(
      emailDebt(
        {
          to: { address: email },
          template: {
            kind: "removal_request_received",
            dueAt,
            isOurs: subject !== undefined,
          },
        },
        { dedupeKey: `removal_request_received:${id}` },
      ),
    ),
  ]);
  return { status: "received" };
}

/**
 * Hide what a request's link names, in the request's own batch, into the
 * state a report's hide uses: `hidden_pending_review`, "not public, a
 * person will look". Only from a public state — never over a removal,
 * and never over a photo the classifier flagged — so a request can take
 * a subject out of sight and never bring one back.
 */
function holdWrites(db: Db, subject: TakedownSubject): BatchItem<"sqlite">[] {
  return [
    visibilityWrites[subject.subjectType](db, subject.subjectId, {
      hold: true,
      when: undefined,
    }),
  ];
}

/**
 * A Decline's give-back, for the decision's batch: the subject the
 * request hid goes back to what an approval leaves (`ok`, and a photo to
 * `pending`, never `pass`, as `resolveReview` does) — but only when
 *
 * - this request is the one just declined (`declinedAt` is the
 *   decision's moment, so a batch whose claim did not land restores
 *   nothing);
 * - no review row is still open on the subject (reports hid it too, and
 *   that is a person's call still to make); and
 * - no other request for it is still pending.
 */
export function releaseHoldWrites(
  db: Db,
  request: { readonly id: string; readonly declinedAt: number },
  subject: TakedownSubject,
): BatchItem<"sqlite">[] {
  const thisDeclined = and(
    eq(takedownRequests.id, request.id),
    eq(takedownRequests.status, "declined"),
    eq(takedownRequests.resolvedAt, request.declinedAt),
  );
  const reviewOpen = and(
    eq(reviewQueue.subjectType, subject.subjectType),
    eq(reviewQueue.subjectId, subject.subjectId),
    inArray(reviewQueue.status, ["pending", "reviewing"]),
  );
  const otherPending = and(
    eq(takedownRequests.subjectType, subject.subjectType),
    eq(takedownRequests.subjectId, subject.subjectId),
    eq(takedownRequests.status, "pending"),
    ne(takedownRequests.id, request.id),
  );
  const when = and(
    exists(rowsWhere(db, takedownRequests, thisDeclined)),
    notExists(rowsWhere(db, reviewQueue, reviewOpen)),
    notExists(rowsWhere(db, takedownRequests, otherPending)),
  );
  return [
    visibilityWrites[subject.subjectType](db, subject.subjectId, {
      hold: false,
      when,
    }),
  ];
}

function rowsWhere(
  db: Db,
  table: typeof takedownRequests | typeof reviewQueue,
  where: SQL | undefined,
) {
  return db
    .select({ one: sql`1` })
    .from(table)
    .where(where);
}

/**
 * One subject's visibility, held or given back, per subject type: the
 * column, the state a hold leaves, the states it may start from, and
 * what a give-back restores. `when` is the give-back's extra condition.
 */
const visibilityWrites: Record<
  TakedownSubject["subjectType"],
  (
    db: Db,
    subjectId: string,
    change: { readonly hold: boolean; readonly when: SQL | undefined },
  ) => BatchItem<"sqlite">
> = {
  entry: (db, subjectId, { hold, when }) => {
    const from = eq(
      outfitEntries.moderationStatus,
      hold ? "ok" : "hidden_pending_review",
    );
    return db
      .update(outfitEntries)
      .set({ moderationStatus: hold ? "hidden_pending_review" : "ok" })
      .where(and(eq(outfitEntries.id, subjectId), from, when));
  },
  photo: (db, subjectId, { hold, when }) => {
    const from = hold
      ? inArray(entryPhotos.screenStatus, ["pending", "pass"])
      : eq(entryPhotos.screenStatus, "hidden_pending_review");
    return db
      .update(entryPhotos)
      .set({ screenStatus: hold ? "hidden_pending_review" : "pending" })
      .where(and(eq(entryPhotos.id, subjectId), from, when));
  },
};

/**
 * One pending request as Review shows it: what was asked, by whom, and
 * how long is left. `subject` is what the link points at when it is ours,
 * read again from `location` so Review can link the photo by its key.
 */
export interface PendingTakedownRequest {
  readonly id: string;
  readonly requesterEmail: string;
  readonly signature: string;
  readonly location: string;
  readonly description: string | undefined;
  readonly subject: TakedownSubject | undefined;
  readonly createdAt: number;
  readonly dueAt: number;
  readonly due: string;
}

/**
 * The open requests, soonest due first — the order an operator must work
 * them in. Served by `takedown_requests_status_due`.
 */
export async function pendingTakedownRequests(
  db: Db,
  now = nowSeconds(),
  limit = 50,
): Promise<PendingTakedownRequest[]> {
  const rows = await db
    .select()
    .from(takedownRequests)
    .where(eq(takedownRequests.status, "pending"))
    .orderBy(asc(takedownRequests.dueAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    requesterEmail: row.requesterEmail,
    signature: row.signature,
    location: row.location,
    description: row.description ?? undefined,
    subject: takedownSubjectOf(row.location),
    createdAt: row.createdAt,
    dueAt: row.dueAt,
    due: removalDueLabel(row.dueAt, now),
  }));
}
