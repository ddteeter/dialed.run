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
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  outfitEntries,
  reviewQueue,
  takedownBlocks,
  takedownRequests,
} from "../../db/schema-core";
import type {
  TakedownRequestValues,
  TakedownSubject,
} from "../../lib/contracts/takedown";
import type { PurgeTags } from "../../lib/cache-tags";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import { firstRowWhere } from "../../lib/sql/keyed-read";
import { countSend, emailDebt, sendClaimOf } from "../email";
import { adminUserIds } from "./admin";
import { REMOVAL_DUE_SECONDS, removalDueLabel } from "./contracts";
import { subjectCacheTagsOf } from "./kit-cache-tags";
import { hiddenNotice } from "./notices";
import { otherPhotosOf, type OtherPhotos } from "./other-photos";
import { photoMatchesOf, type PhotoMatches } from "./photo-matches";
import {
  filedSubjectOf,
  requestSubjectOf,
  requestSubjectsOf,
} from "./request-subject";
import type { OweEmail } from "./reports";
import { ipKey, requesterKey } from "./requester-key";
import type { HoldState } from "./takedown-limits";
import {
  confirmTokenHash,
  holdStateFor,
  requesterMatches,
  isValveShut,
  newConfirmToken,
  TAKEDOWN_VALVE_PER_HOUR,
  valveHour,
} from "./takedown-limits";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

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
  /**
  `TAKEDOWN_SECRET`, which keys the visitor's IP (design 137); absent, the
  limits match requesters by email alone.
  */
  readonly secret?: string | undefined;
  /**
  `ops`' edge purge, handed in for the reason `verify` is (design 163).
  */
  readonly purge: PurgeTags;
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
  const until = await limitedUntil(db, input, now);
  if (until !== undefined) return { status: "limited", until };
  const id = newUlid();
  const dueAt = now + REMOVAL_DUE_SECONDS;
  const subject = await filedSubjectOf(db, input.location);
  const keys = {
    requesterKey: requesterKey(email),
    ipKey: await ipKey(input.remoteIp, deps.secret),
  };
  // Design 137: what this request may do, read before its batch.
  const state = await holdStateFor(db, keys, now);
  const isHeld = state === "held" && subject !== undefined;
  const confirm = state === "confirm" ? await newConfirmToken() : undefined;
  const told = isHeld ? await holdNotice(db, subject) : [];
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
        requesterKey: keys.requesterKey,
        ipKey: keys.ipKey,
        holdState:
          subject === undefined && state === "held" ? undefined : state,
        heldAt: isHeld ? now : undefined,
        confirmTokenHash: confirm?.hash,
        posterUsername: input.posterUsername,
      })
      .onConflictDoNothing(),
    ...(isHeld ? holdWrites(db, subject) : []),
    ...told,
    ...(state === "held"
      ? operatorAlerts(deps.owe, id, dueAt, subject !== undefined)
      : []),
    ...(state === "valve" ? valveAlerts(deps.owe, now) : []),
    deps.owe(
      emailDebt(
        {
          to: { address: email },
          template: {
            kind: "removal_request_received",
            dueAt,
            isHidden: isHeld,
            confirmToken: confirm?.token,
          },
        },
        { dedupeKey: `removal_request_received:${id}` },
      ),
    ),
  ]);
  if (isHeld) await purgeHeld(db, subject, deps.purge);
  return { status: "received" };
}

/**
 * Design 163: a kit a request hid leaves the edge now, not within the
 * TTL — the open web's `/kit/<id>` is a link `/takedown` takes. So does a
 * held photo's kit, whose page shows it, and the purge deletes the
 * photo's public copy (D-152, design 163 step 8).
 */
async function purgeHeld(
  db: Db,
  subject: TakedownSubject,
  purge: PurgeTags,
): Promise<void> {
  purge(await subjectCacheTagsOf(db, subject.subjectType, subject.subjectId));
}

/**
 * When the visitor's hourly sends run out, the moment they return; nothing
 * when this deployment does not limit or the send is allowed. Counting is
 * the write that spends a send.
 */
async function limitedUntil(
  db: Db,
  input: { readonly isLimited: boolean; readonly remoteIp: string | undefined },
  now: number,
): Promise<number | undefined> {
  if (!input.isLimited) return undefined;
  const counted = await countSend(
    db,
    "takedown",
    input.remoteIp ?? "unknown",
    now,
  );
  const claim = sendClaimOf(counted);
  return claim.isAllowed ? undefined : claim.until;
}

/**
 * One "Removal request, due by …" per operator: owed when a request may
 * alert — at filing, or at its confirm (design 137).
 */
function operatorAlerts(
  owe: OweEmail,
  requestId: string,
  dueAt: number,
  isOurs: boolean,
): BatchItem<"sqlite">[] {
  return adminUserIds().map((userId) =>
    owe(
      emailDebt(
        {
          to: { userId },
          template: { kind: "removal_requested", dueAt, isOurs },
        },
        { dedupeKey: `removal_requested:${requestId}:${userId}` },
      ),
    ),
  );
}

/**
 * The valve's one alert per operator per hour (design 137): the dedupe
 * key is the hour, so every request the shut valve quiets owes the same
 * row and only the first is sent.
 */
function valveAlerts(owe: OweEmail, now: number): BatchItem<"sqlite">[] {
  const hour = String(valveHour(now));
  return adminUserIds().map((userId) =>
    owe(
      emailDebt(
        {
          to: { userId },
          template: {
            kind: "takedown_valve",
            perHour: TAKEDOWN_VALVE_PER_HOUR,
          },
        },
        { dedupeKey: `takedown_valve:${hour}:${userId}` },
      ),
    ),
  );
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
 * The author's notice that a request hid their kit or photo (R-163; owner,
 * 2026-10-24): the hide notice a report's hide sends (D-145), unchanged.
 * Read before the batch, which cannot branch, and only while the subject
 * is in a state the hold moves — so a subject a report already hid, or a
 * removal already took, is not told it was hidden again. Suspected CSAM
 * is not known yet when a request lands; the quarantine that may follow
 * tells nobody anything more (D-70).
 */
async function holdNotice(
  db: Db,
  subject: TakedownSubject,
): Promise<BatchItem<"sqlite">[]> {
  const { table, where } = holdable[subject.subjectType](subject.subjectId);
  const [row] = await db
    .select({ one: sql`1` })
    .from(table)
    .where(where);
  return row === undefined
    ? []
    : hiddenNotice(db, subject.subjectType, subject.subjectId);
}

/**
 * A subject a hold would move: public, and the row it names. The hold's
 * own `where` (`visibilityWrites`), so the notice and the hide cannot
 * disagree about what "public" is.
 */
const holdable: Record<
  TakedownSubject["subjectType"],
  (subjectId: string) => {
    readonly table: typeof outfitEntries | typeof entryPhotos;
    readonly where: SQL | undefined;
  }
> = {
  entry: (subjectId) => ({
    table: outfitEntries,
    where: and(eq(outfitEntries.id, subjectId), HOLD_FROM.entry),
  }),
  photo: (subjectId) => ({
    table: entryPhotos,
    where: and(eq(entryPhotos.id, subjectId), HOLD_FROM.photo),
  }),
};

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
 * The states a hold may start from: public, never a removal, and never a
 * photo the classifier flagged.
 */
const HOLD_FROM_STATUS = { entry: "ok" } as const;

const HOLD_FROM = {
  entry: eq(outfitEntries.moderationStatus, HOLD_FROM_STATUS.entry),
  photo: inArray(entryPhotos.screenStatus, ["pending", "pass"]),
} as const;

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
    // The hold's start is `HOLD_FROM.entry`'s one state, so a ternary
    // inside the comparison says both directions.
    const from = eq(
      outfitEntries.moderationStatus,
      hold ? HOLD_FROM_STATUS.entry : "hidden_pending_review",
    );
    return db
      .update(outfitEntries)
      .set({ moderationStatus: hold ? "hidden_pending_review" : "ok" })
      .where(and(eq(outfitEntries.id, subjectId), from, when));
  },
  photo: (db, subjectId, { hold, when }) => {
    const from = hold
      ? HOLD_FROM.photo
      : eq(entryPhotos.screenStatus, "hidden_pending_review");
    return db
      .update(entryPhotos)
      .set({ screenStatus: hold ? "hidden_pending_review" : "pending" })
      .where(and(eq(entryPhotos.id, subjectId), from, when));
  },
};

export type TakedownConfirmResult = "confirmed" | "decided" | "not_found";

/**
 * A requester's confirm (design 137): a request past the cap waited for
 * it, and now does what it would have done at filing — hides a link of
 * ours and alerts the operators — unless the valve has shut since, when it
 * owes the valve's alert instead. A repeat is the first confirm; a
 * request already decided stays decided.
 *
 * The claim (`confirmed_at` still NULL) is in the batch with the hold and
 * the alerts. The hold is safe to repeat (it moves only a public
 * subject), and every alert's dedupe key is the request's or the hour's,
 * so a confirm that races itself sends each once.
 */
export async function confirmTakedownRequest(
  db: Db,
  token: string,
  effects: { readonly owe: OweEmail; readonly purge: PurgeTags },
  now = nowSeconds(),
): Promise<TakedownConfirmResult> {
  const { owe } = effects;
  const request = await firstRowWhere(
    db,
    takedownRequests,
    eq(takedownRequests.confirmTokenHash, await confirmTokenHash(token)),
  );
  if (request === undefined) return "not_found";
  if (request.status !== "pending") return "decided";
  if (request.confirmedAt !== null) return "confirmed";
  const subject = await requestSubjectOf(db, request);
  const isShut = await isValveShut(db, now);
  const isHeld = !isShut && subject !== undefined;
  const told = isHeld ? await holdNotice(db, subject) : [];
  const unconfirmed = and(
    eq(takedownRequests.id, request.id),
    isNull(takedownRequests.confirmedAt),
  );
  await db.batch([
    db
      .update(takedownRequests)
      .set({
        confirmedAt: now,
        holdState: isShut ? "valve" : "held",
        heldAt: isHeld ? now : undefined,
      })
      .where(unconfirmed),
    ...(isHeld ? holdWrites(db, subject) : []),
    ...told,
    ...(isShut
      ? valveAlerts(owe, now)
      : operatorAlerts(owe, request.id, request.dueAt, subject !== undefined)),
  ]);
  if (isHeld) await purgeHeld(db, subject, effects.purge);
  return "confirmed";
}

/**
 * One pending request as Review shows it: what was asked, by whom, and
 * how long is left. `subject` is what the link points at when it is ours,
 * read again from `location` so Review can link the photo by its key (or
 * the photo filing recorded, for a public copy's URL: `./request-subject`).
 */
export interface PendingTakedownRequest {
  readonly id: string;
  readonly requesterEmail: string;
  readonly signature: string;
  readonly location: string;
  readonly description: string | undefined;
  /**
  Who posted it, as the requester gave it (round 37 #59g).
  */
  readonly posterUsername: string | undefined;
  readonly subject: TakedownSubject | undefined;
  readonly createdAt: number;
  readonly dueAt: number;
  readonly due: string;
  /**
  What filing decided (design 137); `undefined` for a link that is not ours, which hides nothing.
  */
  readonly holdState: HoldState | undefined;
  /**
  The requester's other open requests among those listed, by either key.
  */
  readonly relatedIds: readonly string[];
  /**
   * The posting runner's other photos (D-117, R-145 c), when the link is
   * ours; `undefined` when it is not, since then nobody is known.
   */
  readonly otherPhotos: OtherPhotos | undefined;
  /**
   * Photos from any runner, private included, that match the linked one by
   * fingerprint (D-142, design 146); `undefined` when the link is not ours.
   */
  readonly photoMatches?: PhotoMatches | undefined;
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
  // Counted among the rows already read rather than by a query per row:
  // the list is at most `limit` long, and a requester past it is still
  // one whose other requests show once these are decided.
  const keyOf = (row: (typeof rows)[number]) =>
    row.requesterKey ?? requesterKey(row.requesterEmail);
  const subjects = await requestSubjectsOf(db, rows);
  const listed = rows.map((row, index) => ({ row, subject: subjects[index] }));
  const others = await otherPhotosOf(
    db,
    listed.flatMap(({ subject }) => subject ?? []),
  );
  const matches = await photoMatchesOf(
    db,
    listed.flatMap(({ subject }) => subject ?? []),
  );
  return listed.map(({ row, subject }) => ({
    id: row.id,
    requesterEmail: row.requesterEmail,
    signature: row.signature,
    location: row.location,
    description: row.description ?? undefined,
    posterUsername: row.posterUsername ?? undefined,
    subject,
    otherPhotos:
      subject && others.get(`${subject.subjectType}:${subject.subjectId}`),
    photoMatches:
      subject && matches.get(`${subject.subjectType}:${subject.subjectId}`),
    createdAt: row.createdAt,
    dueAt: row.dueAt,
    due: removalDueLabel(row.dueAt, now),
    holdState: row.holdState ?? undefined,
    relatedIds: rows
      .filter(
        (other) =>
          other.id !== row.id &&
          (keyOf(other) === keyOf(row) ||
            (row.ipKey !== null && other.ipKey === row.ipKey)),
      )
      .map((other) => other.id),
  }));
}

export type BlockResult =
  | { readonly status: "blocked"; readonly declined: number }
  | { readonly status: "not_found" };

/**
 * Block and decline all (design 137): every pending request from this
 * request's requester, by either key, is declined with no outcome email,
 * what each hid is given back, and both keys go into `takedown_blocks`,
 * so what they file next is recorded and does nothing. One batch: the
 * declines first, so each give-back sees no other pending request of the
 * requester's on its subject.
 */
export async function blockAndDeclineAll(
  db: Db,
  actorId: string,
  requestId: string,
  now = nowSeconds(),
): Promise<BlockResult> {
  const request = await firstRowWhere(
    db,
    takedownRequests,
    eq(takedownRequests.id, requestId),
  );
  if (request === undefined) return { status: "not_found" };
  const keys = {
    requesterKey: request.requesterKey ?? requesterKey(request.requesterEmail),
    ipKey: request.ipKey ?? undefined,
  };
  // The request itself by its id, as well as by its keys: one filed
  // before migration 0055 has no `requester_key` for the keys to match.
  const theirs = or(
    eq(takedownRequests.id, request.id),
    requesterMatches(keys),
  );
  const pending = await db
    .select()
    .from(takedownRequests)
    .where(and(theirs, eq(takedownRequests.status, "pending")));
  const declines = pending.map((row) =>
    db
      .update(takedownRequests)
      .set({
        status: "declined",
        declineReason: BLOCKED_REASON,
        resolvedAt: now,
        resolvedBy: actorId,
      })
      .where(
        and(
          eq(takedownRequests.id, row.id),
          eq(takedownRequests.status, "pending"),
        ),
      ),
  );
  const subjects = await requestSubjectsOf(db, pending);
  const giveBacks = pending.flatMap((row, index) => {
    const subject = subjects[index];
    return subject === undefined
      ? []
      : releaseHoldWrites(db, { id: row.id, declinedAt: now }, subject);
  });
  const block = (key: string, kind: "email" | "ip") =>
    db
      .insert(takedownBlocks)
      .values({ key, kind, createdAt: now, createdBy: actorId })
      .onConflictDoNothing();
  await db.batch([
    block(keys.requesterKey, "email"),
    ...(keys.ipKey === undefined ? [] : [block(keys.ipKey, "ip")]),
    ...declines,
    ...giveBacks,
  ]);
  return { status: "blocked", declined: pending.length };
}

/**
The reason a block-and-decline records; no email carries it.
*/
const BLOCKED_REASON = "Blocked as abuse";
