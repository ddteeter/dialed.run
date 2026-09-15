/**
 * The review queue: one row per thing awaiting a person, and the claim that
 * keeps two open tabs from both resolving it (law 2).
 *
 * The packet asks for "zero standing moderation workload", which is a claim
 * about volume, not about rigour — everything that lands here waits for a
 * human, and the daily digest reports how deep it is so an empty queue is a
 * fact rather than an assumption.
 */
import { and, asc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";

import { outfitEntries, products, reviewQueue } from "../../db/schema-core";
import { env } from "../../env";
import { columnWhere } from "../../lib/keyed-read";
import { orSqlNull } from "../../lib/sql-null";
import { newUlid } from "../../lib/ids";

import type { ReportSubjectType } from "./contracts";

function db() {
  return drizzle(env.DIALED_CORE);
}

export interface EnqueueInput {
  subjectType: ReportSubjectType;
  subjectId: string;
  source: "reports" | "classifier";
}

/**
 * Builds the queue write **without executing it**, so a caller can put it
 * in the same `db.batch()` as the hide it accompanies.
 *
 * Returning an un-awaited builder is the footgun CLAUDE.md spells out: a
 * drizzle builder is thenable, and one that is neither awaited nor passed
 * to `batch()` silently does nothing. Every caller here hands it to a
 * batch; the return type is what stops someone calling this and walking
 * away.
 */
export function enqueueForReview(
  database: DrizzleD1Database,
  input: EnqueueInput,
) {
  return (
    database
      .insert(reviewQueue)
      .values({
        id: newUlid(),
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        source: input.source,
        status: "pending",
        createdAt: Math.floor(Date.now() / 1000),
      })
      // UNIQUE(subject_type, subject_id): a subject already queued stays one
      // decision. Re-opening a resolved row is deliberate — a subject
      // approved last week and reported again today needs looking at again,
      // and the reviewer should see it as pending rather than as settled.
      .onConflictDoUpdate({
        target: [reviewQueue.subjectType, reviewQueue.subjectId],
        set: {
          status: "pending",
          source: input.source,
          // Cleared, not left alone: this row is being re-opened, and a
          // stale reviewer stamped on a pending decision would read as
          // "someone already looked at this". An `undefined` here would
          // silently keep the old values (see lib/sql-null).
          resolvedBy: orSqlNull(undefined),
          resolvedAt: orSqlNull(undefined),
        },
      })
  );
}

export interface QueueRow {
  id: string;
  subjectType: ReportSubjectType;
  subjectId: string;
  source: "reports" | "classifier";
  createdAt: number;
}

/**
 * What is waiting, oldest first — the review page's only read, served by
 * `review_queue_status_created`.
 *
 * `limit` is a real bound rather than a courtesy: the page renders rows and
 * a solo operator reads them, so an unbounded read would be billing D1 for
 * rows nobody looks at.
 */
export async function pendingReviewQueue(limit = 100): Promise<QueueRow[]> {
  return db()
    .select({
      id: reviewQueue.id,
      subjectType: reviewQueue.subjectType,
      subjectId: reviewQueue.subjectId,
      source: reviewQueue.source,
      createdAt: reviewQueue.createdAt,
    })
    .from(reviewQueue)
    .where(eq(reviewQueue.status, "pending"))
    .orderBy(asc(reviewQueue.createdAt))
    .limit(limit);
}

/**
 * How many decisions are waiting. The daily digest reports this (packet
 * §2), which is the difference between "the queue is empty" and "nobody has
 * looked at the queue".
 */
export async function pendingReviewCount(): Promise<number> {
  const ids = await columnWhere(
    db(),
    reviewQueue,
    reviewQueue.id,
    eq(reviewQueue.status, "pending"),
  );
  return ids.length;
}

export type ClaimOutcome = "claimed" | "already_taken";

/**
 * Claims a pending row for this reviewer, reporting whether the claim
 * landed (law 2: operate only on rows the update actually claimed).
 *
 * With one operator this looks like ceremony. It is not: the review page is
 * a browser tab, tabs get duplicated, and "approve" on a stale tab must not
 * undo a "remove" from the fresh one.
 */
export async function claimForReview(
  queueId: string,
  reviewerId: string,
): Promise<ClaimOutcome> {
  const claimed = await db()
    .update(reviewQueue)
    .set({ status: "reviewing", resolvedBy: reviewerId })
    .where(and(eq(reviewQueue.id, queueId), eq(reviewQueue.status, "pending")))
    .returning({ id: reviewQueue.id });
  return claimed.length > 0 ? "claimed" : "already_taken";
}

export type ReviewDecision = "approve" | "remove";

export type ResolveOutcome = "resolved" | "already_resolved" | "not_found";

/**
 * What `openRow` hands back: the subject to act on, or the reason there is
 * nothing to act on. Named rather than written inline so the signature is
 * one line — a multi-line return type put the function's body and its own
 * parameter list into different clone spans, which is not a thing a reader
 * should have to think about.
 */
type OpenRow =
  | "not_found"
  | "already_resolved"
  | { subjectType: ReportSubjectType; subjectId: string };

/**
 * The row this decision is about, or the reason there isn't one.
 *
 * Split out of `resolveReview` so the outcome branching lives next to the
 * read that produces it, and so the caller reads as "load, then write"
 * rather than opening with eight lines of column list.
 *
 * Three answers rather than a boolean, because the review page says
 * something different for each: a stale tab whose row someone else already
 * settled is not the same as a link to a row that is gone.
 */
// fallow-ignore-next-line code-duplication -- the well-factored-pair residue CLAUDE.md names: openRow, feed/reactions.ts's assertVisible and feed/entries.ts's read all select a few columns for one row by id and branch on what they find, because that is what "load a row and decide" looks like once the bodies are already in lib/keyed-read.ts. A review decision, an entry's visibility to a reactor, and an entry's own load are three different facts over two tables; merging them would couple a moderation outcome to a feed read, and the extraction that produced this shape is what removed two OTHER clone groups from this module
async function openRow(queueId: string): Promise<OpenRow> {
  const [row] = await db()
    .select({
      subjectType: reviewQueue.subjectType,
      subjectId: reviewQueue.subjectId,
      status: reviewQueue.status,
    })
    .from(reviewQueue)
    .where(eq(reviewQueue.id, queueId))
    .limit(1);

  if (!row) return "not_found";
  if (row.status === "approved" || row.status === "removed") {
    return "already_resolved";
  }
  return { subjectType: row.subjectType, subjectId: row.subjectId };
}

/**
 * Resolves a claimed row and applies the decision to the subject.
 *
 * **One batch**, for the same reason the hide was: the queue row and the
 * subject's visibility are one decision, and a failure between them leaves
 * a subject removed with nothing recording why, or approved with the queue
 * still showing it as open.
 *
 * Approving restores `ok` rather than restoring "whatever it was", and that
 * is safe precisely because the hide never touched `isPublic` — the
 * runner's own sharing choice survived the whole round trip untouched.
 */
export async function resolveReview(
  queueId: string,
  reviewerId: string,
  decision: ReviewDecision,
): Promise<ResolveOutcome> {
  const row = await openRow(queueId);
  if (typeof row === "string") return row;

  // A read that decides what to write goes before the batch, not inside
  // it — a batch cannot branch on its own results.
  const writes = [
    db()
      .update(reviewQueue)
      .set({
        status: decision === "approve" ? "approved" : "removed",
        resolvedBy: reviewerId,
        resolvedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(reviewQueue.id, queueId)),
    ...subjectWritesFor(row.subjectType, row.subjectId, decision),
  ];

  await db().batch(asBatch(writes));
  return "resolved";
}

/**
 * What a decision does to the subject itself.
 *
 * `profile` is absent on purpose: removing a person is a ban, which has its
 * own path and its own notice, and folding it in here would make "remove"
 * mean two very different things depending on what was reported.
 */
function subjectWritesFor(
  subjectType: ReportSubjectType,
  subjectId: string,
  decision: ReviewDecision,
) {
  if (subjectType === "entry") {
    return [
      db()
        .update(outfitEntries)
        .set({
          moderationStatus: decision === "approve" ? "ok" : "removed",
        })
        .where(eq(outfitEntries.id, subjectId)),
    ];
  }
  if (subjectType === "product") {
    // Hidden products drop out of autocomplete and linked garments fall
    // back to their own text fields (packet §2) — the column 000 reserved
    // for exactly this.
    return [
      db()
        .update(products)
        .set({ status: decision === "approve" ? "active" : "hidden" })
        .where(eq(products.id, subjectId)),
    ];
  }
  return [];
}

/**
 * `db.batch()` types its argument as a non-empty tuple, and the array built
 * above is statically a plain array. This is the one place that gap shows,
 * so it is narrowed once here rather than at each call.
 */
function asBatch<T>(writes: T[]): [T, ...T[]] {
  const [first, ...rest] = writes;
  if (first === undefined) {
    throw new Error("a review always writes at least the queue row");
  }
  return [first, ...rest];
}
