import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { ZodType } from "zod";

import type { GaveUpKind } from "../lib/contracts/gave-up";
import { newUlid } from "../lib/ids";
import { nowSeconds } from "../lib/now";
import {
  DEAD_LETTER_REASON,
  type GaveUpFact,
  type GiveUpHandlers,
} from "../lib/sql/gave-up";
import { deadLetterEach, type Reporter } from "../lib/sql/queue-batch";
import { orSqlNull } from "../lib/sql/sql-null";
import { gaveUp } from "./schema-core";

export {
  DEAD_LETTER_REASON,
  type GaveUpFact,
  type GaveUpWrites,
} from "../lib/sql/gave-up";

/**
 * The two writes every job that can give up makes to `gave_up` (Operator
 * Screens D6; register R-119): record that it gave up, and forget it once
 * a later try succeeds.
 *
 * **Here in `src/db/`, not `lib/sql/`.** `lib/` is foundation and may not
 * import `src/db/` (`foundation-stays-foundation`), but a writer of a
 * concrete table has to import its schema from somewhere — so the
 * table-specific half of this (the writers, and `giveUpEach`'s
 * orchestration of them) lives beside the schema it writes, where every
 * module that needs it can import it directly (`db` is foundation too,
 * and importable by any module — `modules/weather`, `modules/runs`,
 * `modules/enrichment`, `modules/ops/gave-up.ts` all already do). What
 * stays genuinely table-agnostic (`GaveUpFact`, the DLQ wiring shapes,
 * `DEAD_LETTER_REASON`) stays in `lib/sql/gave-up.ts`, and this file
 * imports from there rather than the reverse.
 */

/**
 * Record a job as given up. A job already here is the same row (UNIQUE on
 * kind and subject): its tries add to what it had, its reason and raw
 * error become this failure's, and `first_failed_at` stays when it first
 * went wrong — so a sweep that re-drives a failure all day reads as one
 * row whose count climbs, not a row per hour.
 */
export function gaveUpUpsert(
  db: DrizzleD1Database,
  fact: GaveUpFact,
  now = nowSeconds(),
) {
  return db
    .insert(gaveUp)
    .values({
      id: newUlid(),
      kind: fact.kind,
      subjectId: fact.subjectId,
      reason: fact.reason,
      rawError: fact.rawError,
      tries: fact.tries,
      firstFailedAt: now,
      lastFailedAt: now,
    })
    .onConflictDoUpdate({
      target: [gaveUp.kind, gaveUp.subjectId],
      set: {
        reason: fact.reason,
        rawError: orSqlNull(fact.rawError),
        tries: sql`${gaveUp.tries} + ${fact.tries}`,
        lastFailedAt: now,
      },
    });
}

/**
 * Forget a job: a later try succeeded, or the operator dealt with it. A
 * job with no row is a no-op, so a success path can always say it.
 */
export function gaveUpClear(
  db: DrizzleD1Database,
  kind: GaveUpKind,
  subjectId: string,
) {
  return db
    .delete(gaveUp)
    .where(and(eq(gaveUp.kind, kind), eq(gaveUp.subjectId, subjectId)));
}

/**
 * `deadLetterEach`, for a queue whose jobs the Desk lists when they give
 * up: the job's own writes and its `gave_up` row land in one batch, so a
 * status marked `failed` is never a failure the Desk cannot see, and a row
 * on the Desk is never one whose status says otherwise.
 */
export function giveUpEach<Job>(
  batch: MessageBatch,
  schema: ZodType<Job>,
  handlers: GiveUpHandlers<Job>,
): Promise<void> {
  const { db, tries } = handlers;
  return deadLetterEach(batch, schema, {
    onJob: async (job) => {
      const owed = await handlers.onJob(job);
      if (owed === undefined) return;
      const fact = { ...owed.subject, reason: DEAD_LETTER_REASON, tries };
      await db.batch([gaveUpUpsert(db, fact), ...owed.writes]);
    },
    deadLettered: handlers.deadLettered,
    captureException: handlers.captureException,
  });
}

/**
 * `giveUpEach`, with its wiring given positionally rather than as an
 * object literal — every DLQ handler names the same five fields (`db`,
 * `tries`, `onJob`, `deadLettered`, `captureException`) and only `onJob`
 * and `deadLettered` actually vary per queue, so a caller passes those two
 * and nothing else is spelled out at the call site.
 */
export function dlqBatchHandler<Job>(
  batch: MessageBatch,
  schema: ZodType<Job>,
  deps: Reporter & { readonly db: DrizzleD1Database },
  tries: number,
  deadLettered: string,
  onJob: GiveUpHandlers<Job>["onJob"],
): Promise<void> {
  return giveUpEach(batch, schema, {
    db: deps.db,
    tries,
    onJob,
    deadLettered,
    captureException: deps.captureException,
  });
}
