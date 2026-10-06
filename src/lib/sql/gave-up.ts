import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import type { GaveUpKind } from "../contracts/gave-up";
import type { Reporter } from "./queue-batch";

/**
 * The shape every write to `gave_up` is made of (Operator Screens D6;
 * register R-119), and the DLQ wiring every consumer that writes one
 * shares — kept here, foundation, because the shape is schema-free.
 *
 * **The writers themselves — `gaveUpUpsert`, `gaveUpClear`, and
 * `giveUpEach`'s orchestration of them — live in `src/db/gave-up.ts`,
 * not here.** `lib/` is foundation and may not import `src/db/`
 * (`foundation-stays-foundation`), and a writer of a concrete table has
 * to import its schema from somewhere. `db` is foundation too and
 * importable by any module, so that is where the table-specific half
 * lives; this file holds only what never needed the schema in the first
 * place.
 */

export interface GaveUpFact {
  readonly kind: GaveUpKind;
  readonly subjectId: string;
  /**
  The last failure, in one sentence an operator can act on.
  */
  readonly reason: string;
  /**
  The error as thrown, when the writer had one: the row's detail.
  */
  readonly rawError?: string | undefined;
  /**
  How many attempts this giving-up ended.
  */
  readonly tries: number;
}

/**
 * A dead letter's reason on the Desk. The DLQ is handed the job and not
 * the error that sank it — each try's error went to Sentry as it happened
 * — so the sentence says what is known and where the rest is.
 */
export const DEAD_LETTER_REASON =
  "It failed every try the queue gives a job, so the queue stopped. Each error is in Sentry.";

/**
 * What a dead-lettered job owes besides being reported: the writes that
 * mark it (its row's status, its runner's notice), and which job it was,
 * for its row on the Desk's Gave up (Operator Screens D6; R-119).
 */
export interface GaveUpWrites {
  readonly writes: readonly BatchItem<"sqlite">[];
  readonly subject: { readonly kind: GaveUpKind; readonly subjectId: string };
}

export interface GiveUpHandlers<Job> extends Reporter {
  readonly db: DrizzleD1Database;
  /**
   * The deliveries the queue made before it dead-lettered the job — its
   * `max_retries` plus the first — read from ops' queue registry, which a
   * test pins to `wrangler.jsonc`.
   */
  readonly tries: number;
  /**
   * The job's writes, or nothing when there is nothing to record — a job
   * that finished after all, say, or one whose dead letter is handled some
   * other way. Any read that decides goes here, before the batch.
   */
  onJob: (job: Job) => Promise<GaveUpWrites | undefined>;
  deadLettered: string;
}
