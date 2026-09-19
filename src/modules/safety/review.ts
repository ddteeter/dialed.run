/**
 * The review queue: one row per thing awaiting a person, and the claim that
 * keeps two open tabs from both resolving it (law 2).
 *
 * The packet asks for "zero standing moderation workload", which is a claim
 * about volume, not about rigour — everything that lands here waits for a
 * human, and the daily digest reports how deep it is so an empty queue is a
 * fact rather than an assumption.
 */
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core/query-builders/update";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  outfitEntries,
  products,
  reports,
  reviewQueue,
  userProfiles,
} from "../../db/schema-core";
import { env } from "../../env";
import { columnWhere } from "../../lib/keyed-read";
import { orSqlNull } from "../../lib/sql-null";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";

import { reportReasonSchema } from "./contracts";
import type { ReportReason, ReportSubjectType } from "./contracts";

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
        createdAt: nowSeconds(),
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
          claimedAt: orSqlNull(undefined),
        },
      })
  );
}

/**
 * What the reviewer is actually looking at.
 *
 * **A ULID is not a subject.** The queue carried a type and an id, so
 * "Approve" was being pressed on an identifier — and for the one subject
 * that matters most, a reported photo, there was nothing on screen at all.
 * A `label` where words are the content and `photoKeys` where pixels are.
 */
export interface QueueSubject {
  label?: string | undefined;
  photoKeys: readonly string[];
}

export interface QueueRow {
  id: string;
  subjectType: ReportSubjectType;
  subjectId: string;
  source: "reports" | "classifier";
  createdAt: number;
  /**
   * How many distinct people reported this subject, and what they said was
   * wrong with it.
   *
   * **Both are the review screen's whole content.** Without them a row is
   * a subject type and a ULID, and a reviewer pressing Approve is
   * approving an identifier. Zero and empty are the honest answer for a
   * classifier-sourced row, which nobody reported.
   */
  reporterCount: number;
  reasons: readonly ReportReason[];
  subject: QueueSubject;
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
  // **One joined, grouped read rather than a second pass over the ids.**
  // The reports are what the reviewer is being asked about, so they are
  // not a detail to fetch afterwards — and fetching them afterwards needs
  // an `if (rows.length === 0)` in front of the second query, which is a
  // branch nothing can observe (see `blockedRunners`, which had one).
  //
  // LEFT, because a classifier-sourced row has no reports at all and must
  // still appear. `group_concat` is SQLite's only way to bring a set back
  // in one column; it is parsed rather than trusted on the way out.
  const rows = await db()
    .select({
      id: reviewQueue.id,
      subjectType: reviewQueue.subjectType,
      subjectId: reviewQueue.subjectId,
      source: reviewQueue.source,
      createdAt: reviewQueue.createdAt,
      reporterCount: sql<number>`count(distinct ${reports.reporterId})`,
      reasons: sql<string | null>`group_concat(distinct ${reports.reason})`,
    })
    .from(reviewQueue)
    .leftJoin(
      reports,
      and(
        eq(reports.subjectType, reviewQueue.subjectType),
        eq(reports.subjectId, reviewQueue.subjectId),
      ),
    )
    .where(eq(reviewQueue.status, "pending"))
    .groupBy(reviewQueue.id)
    .orderBy(asc(reviewQueue.createdAt))
    .limit(limit);

  const subjects = await subjectsFor(rows);
  return rows.map((row) => ({
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    source: row.source,
    createdAt: row.createdAt,
    reporterCount: row.reporterCount,
    reasons: reasonsFrom(row.reasons),
    subject: subjects.get(`${row.subjectType}:${row.subjectId}`) ?? {
      photoKeys: [],
    },
  }));
}

/**
 * The content behind one page of queue rows, in one batch.
 *
 * Four reads rather than a chain: a reported photo is looked up by its own
 * id and a reported entry by its entry id, so neither needs the other's
 * row first. Names come from the two tables that have them. Nothing here
 * walks from a photo to its entry to its author — that is a second round
 * trip for a line of text, where the image is the thing being judged.
 */
async function subjectsFor(
  rows: readonly { subjectType: ReportSubjectType; subjectId: string }[],
): Promise<Map<string, QueueSubject>> {
  // **Every id is offered to every table, and the keys sort it out.** The
  // four lookups used to be filtered by subject type first, which read as
  // correctness and was not: what stops a product's row being read as a
  // runner's is that `found` is keyed `type:id`, so a lookup that matched
  // the wrong table lands under a key nothing asks for. With the filter
  // gone that is the only thing holding it up, which is where it should
  // have been all along — and the filter's own predicate was a branch no
  // input could distinguish, because it never decided anything.
  //
  // The cost is a few extra index probes on a page of at most 100 rows.
  // **Four selects in one batch rather than one UNION**, asked on PR #73.
  // Drizzle does expose `union`/`unionAll` for SQLite, so the tool is
  // there; it is the wrong shape for this. A UNION requires every arm to
  // have the same column list, and these four do not describe the same
  // thing — a photo's key, an entry's photos in posted order, a runner's
  // display name, a product's brand and name. Forcing them into one row
  // shape means padding each arm with nulls for the other three's columns
  // and adding a discriminator column to tell them apart again, so the
  // types get worse (every field nullable) and the code gets longer at
  // both ends. `db.batch()` already makes this one round trip, which is
  // the only thing a UNION would have bought.
  const subjectIds = rows.map((row) => row.subjectId);
  const database = db();

  const [photoRows, entryPhotoRows, profileRows, productRows] =
    await database.batch([
      database
        .select({ id: entryPhotos.id, photoKey: entryPhotos.photoKey })
        .from(entryPhotos)
        .where(inArray(entryPhotos.id, subjectIds)),
      database
        .select({
          entryId: entryPhotos.entryId,
          photoKey: entryPhotos.photoKey,
        })
        .from(entryPhotos)
        .where(inArray(entryPhotos.entryId, subjectIds))
        .orderBy(asc(entryPhotos.position)),
      database
        .select({
          userId: userProfiles.userId,
          displayName: userProfiles.displayName,
        })
        .from(userProfiles)
        .where(inArray(userProfiles.userId, subjectIds)),
      database
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(inArray(products.id, subjectIds)),
    ]);

  const found = new Map<string, QueueSubject>();
  for (const row of photoRows) {
    found.set(`photo:${row.id}`, { photoKeys: [row.photoKey] });
  }
  for (const row of entryPhotoRows) {
    const key = `entry:${row.entryId}`;
    const already = found.get(key)?.photoKeys ?? [];
    found.set(key, { photoKeys: [...already, row.photoKey] });
  }
  for (const row of profileRows) {
    found.set(`profile:${row.userId}`, {
      label: row.displayName ?? undefined,
      photoKeys: [],
    });
  }
  for (const row of productRows) {
    found.set(`product:${row.id}`, { label: row.name, photoKeys: [] });
  }
  return found;
}

/**
 * `group_concat`'s comma-joined string as the reasons it stands for.
 *
 * Parsed, not split and trusted: this comes back out of SQLite as one
 * opaque column, and a value that is not a reason this app knows about
 * would otherwise reach a label lookup and render as nothing. Anything
 * unrecognised is dropped rather than shown, because a reviewer reading a
 * blank line cannot tell it from a reason with no words.
 */
export function reasonsFrom(concatenated: string | null): ReportReason[] {
  // Null explicitly, rather than `?? ""` and letting the split produce a
  // list of one empty string that the parse then drops. Both reach the
  // same answer, which is what made the fallback untestable — and a row
  // nobody reported is a real case, not a defensive one.
  if (concatenated === null) return [];
  // One rule, asked once. A `known` Set in front of a `.parse()` was two
  // spellings of the same question, and the Set made the parse
  // unreachable on the only input that could have thrown.
  return concatenated.split(",").flatMap((value) => {
    const parsed = reportReasonSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
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
 *
 * **The claim expires.** It is a lock held by a browser tab, and a tab can
 * be closed, crash, or simply be walked away from — so `claimedAt` stamps
 * it and `releaseStaleClaims` hands it back. Without that a single
 * abandoned tab silently removed a row from the queue forever, which is
 * law 6's silent permanent failure wearing a very ordinary hat.
 */
export async function claimForReview(
  queueId: string,
  reviewerId: string,
): Promise<ClaimOutcome> {
  const claimed = await db()
    .update(reviewQueue)
    .set({
      status: "reviewing",
      resolvedBy: reviewerId,
      // The claim's expiry clock. Without it the claim had no end: see
      // `releaseStaleClaims`.
      claimedAt: nowSeconds(),
    })
    .where(and(eq(reviewQueue.id, queueId), eq(reviewQueue.status, "pending")))
    .returning({ id: reviewQueue.id });
  return claimed.length > 0 ? "claimed" : "already_taken";
}

/**
 * How long a reviewer may hold a row before the queue takes it back.
 *
 * Thirty minutes: long enough that nobody loses a row they are actually
 * reading — a reviewer deciding on one photo is working in seconds, not
 * hours — and short enough that a closed tab costs one sweep rather than a
 * permanent disappearance. It is a lease, not a deadline: a reviewer still
 * holding the tab simply re-claims.
 */
export const claimLeaseSeconds = 30 * 60;

export interface ReleaseReport {
  released: number;
}

/**
 * Hands back rows whose reviewer never came back (law 2's other half).
 *
 * Claiming is the easy half and the one that was built; releasing is the
 * half that decides whether the queue is honest. A row stuck in
 * `reviewing` is invisible to `pendingReviewQueue` and counts for nothing
 * in the digest's depth, so an abandoned tab does not merely delay a
 * decision — it removes the subject from the only two places anyone would
 * ever notice it was waiting. Raised on PR #73.
 *
 * `resolvedBy` is cleared with the status: leaving the old reviewer's id
 * on a row that is pending again would read as "someone looked at this",
 * which is the exact thing that was not true.
 */
export async function releaseStaleClaims(
  now: number = nowSeconds(),
): Promise<ReleaseReport> {
  const released = await db()
    .update(reviewQueue)
    .set({
      status: "pending",
      resolvedBy: orSqlNull(undefined),
      claimedAt: orSqlNull(undefined),
    })
    .where(
      and(
        eq(reviewQueue.status, "reviewing"),
        // `lt`, not `lte`: a row claimed exactly on the boundary has held
        // the lease for precisely its length and not longer.
        lt(reviewQueue.claimedAt, now - claimLeaseSeconds),
      ),
    )
    .returning({ id: reviewQueue.id });
  return { released: released.length };
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
  // `as const` is load-bearing: it makes TypeScript read this literal as
  // the non-empty tuple `db.batch()` asks for, where a plain array
  // literal widens and does not fit. That is why there is no narrowing
  // helper here any more — the one that was here threw on an empty array
  // that could not happen, and an unreachable throw is a branch no test
  // can reach.
  const writes = [
    db()
      .update(reviewQueue)
      .set({
        status: decision === "approve" ? "approved" : "removed",
        resolvedBy: reviewerId,
        resolvedAt: nowSeconds(),
        // Settled rows carry no claim. Left set, a resolved row would still
        // look claimed to anything reading the lease.
        claimedAt: orSqlNull(undefined),
      })
      .where(eq(reviewQueue.id, queueId)),
    ...subjectWritesFor(row.subjectType, row.subjectId, decision),
  ] as const;

  await db().batch(writes);
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
  return subjectWriters[subjectType](subjectId, decision);
}

/**
 * Keyed by subject type rather than written as a chain of `if`s.
 *
 * Two reasons, and the second is the one that matters. `Record<
 * ReportSubjectType, …>` makes a new subject type a compile error here
 * instead of a silent no-op. And the `profile` branch is unobservable
 * from the outside — it writes nothing, so a test cannot tell a wrong
 * branch from the right one, and the `if` that guarded it survived every
 * mutation. A lookup has no branch to get wrong.
 */
const subjectWriters: Record<
  ReportSubjectType,
  (subjectId: string, decision: ReviewDecision) => BatchItem<"sqlite">[]
> = {
  entry: (subjectId, decision) => [
    setOnSubject(outfitEntries, subjectId, {
      moderationStatus: onDecision(decision, "ok", "removed"),
    }),
  ],
  // Hidden products drop out of autocomplete and linked garments fall
  // back to their own text fields (packet §2) — the column 000 reserved
  // for exactly this.
  product: (subjectId, decision) => [
    setOnSubject(products, subjectId, {
      status: onDecision(decision, "active", "hidden"),
    }),
  ],
  // Deliberately nothing: removing a person is a ban, which has its own
  // path and its own notice.
  profile: () => [],
  // Approve sends a photo back to `pending`, NOT to `pass`: it can reach
  // this queue never having been screened, and `pass` would publish bytes
  // no classifier saw. Remove settles as `flagged`, which nothing else
  // writes. Entry photos only — a garment photo lives in
  // `wardrobe_items.visibility` and a private closet has no strangers to
  // report it. Owner's call, 2026-09-15; the reasoning is in
  // docs/designs/106-trust-safety.md.
  photo: (subjectId, decision) => [
    setOnSubject(entryPhotos, subjectId, {
      screenStatus: onDecision(decision, "pending", "flagged"),
    }),
  ],
};

/**
 * One column set on the row a report named.
 *
 * Three writers above differ only in table, column and the pair of
 * values, and repeating `update(…).set(…).where(eq(…))` around each made
 * them one shape the clone detector was right to flag. Extracting the
 * ternary alone did not fix it, because the skeleton itself was the
 * repeat.
 *
 * `SQLiteUpdateSetSource<T>` is what keeps this honest: the values are
 * still checked against the table's own columns, so a typo in a column
 * name or a value outside an enum is a compile error here exactly as it
 * was inline. A `Record<string, string>` would have removed the clone by
 * removing the type safety.
 */
function setOnSubject<T extends SQLiteTable & { id: SQLiteColumn }>(
  table: T,
  subjectId: string,
  values: SQLiteUpdateSetSource<T>,
): BatchItem<"sqlite"> {
  return db().update(table).set(values).where(eq(table.id, subjectId));
}

/**
 * Which of two column values a decision means.
 *
 * Written once rather than three times, and that is what the three
 * writers above have in common — a different table, a different column
 * and a different pair of values each, but one rule for choosing between
 * them. Repeating the ternary made the three read as one shape the clone
 * detector was right to flag; naming it leaves each writer a line.
 */
function onDecision<T extends string>(
  decision: ReviewDecision,
  approved: T,
  removed: T,
): T {
  return decision === "approve" ? approved : removed;
}
