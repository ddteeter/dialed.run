/**
 * Requests to remove an intimate image shared without consent, from
 * someone who may have no account (design 136, decision D-117): the TAKE
 * IT DOWN Act's signed-out path, beside the in-app `intimate` report.
 *
 * **A request hides nothing.** The in-app reason hides at once because a
 * confirmed account stands behind it; a form anyone on the internet can
 * fill must not be able to take any photo down (D-117). So a request is
 * recorded, every operator is emailed, and a person decides within the 48
 * hours its `dueAt` keeps. The decision is `feed`'s
 * (`decideRemovalRequest`), because taking something down is.
 */
import { and, asc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { takedownRequests } from "../../db/schema-core";
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
          template: { kind: "removal_request_received", dueAt },
        },
        { dedupeKey: `removal_request_received:${id}` },
      ),
    ),
  ]);
  return { status: "received" };
}

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
