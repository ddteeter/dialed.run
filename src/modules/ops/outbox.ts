/**
 * The generic transactional outbox (CLAUDE.md law 8c).
 *
 * A write that owes work to another system — R2, today — records the debt
 * as an `outbox` row **in the same `db.batch()`** as the change itself, so
 * the two land together or not at all. Then:
 *
 * - **the fast path** (`settleOutbox`) does the work straight away and
 *   deletes the row. It never fails the caller's action (law 5): the D1
 *   change is done, and the row owns what is left;
 * - **the drainer** (`drainOutbox`, from the daily digest) re-drives every
 *   row a fast path could not settle, backing off between attempts;
 * - **the digest** (`checkOutboxBacklog`) reports rows that have exhausted
 *   their attempts, and rows of a kind this build cannot read (law 6).
 */
import { and, asc, count, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { outbox } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import {
  dedupeKeyFor,
  outboxKinds,
  readOutboxRow,
  type OutboxKind,
  type OutboxMessage,
} from "../../lib/outbox";
import { outboxHandlers, type OutboxHandlers } from "./outbox-handlers";
import { captureException } from "./sentry";

type Db = ReturnType<typeof drizzle>;
type Report = typeof captureException;

/**
 * Attempts after which a row counts as terminal and the digest names it.
 * The drainer keeps trying past it, at the longest backoff: every handler
 * is idempotent, and a debt like a runner's photo is worth finishing late.
 */
export const OUTBOX_TERMINAL_ATTEMPTS = 5;

/**
 * Rows drained per kind per run, so one kind with a large or failing
 * backlog cannot starve the others of the run.
 */
export const OUTBOX_DRAIN_CAP = 50;

/**
 * How long a fresh row waits before the drainer may take it: long enough
 * that the fast path which wrote it has finished, so the two never work
 * one debt at once and a row the fast path is about to settle is not
 * reported as owed.
 */
export const OUTBOX_FAST_PATH_GRACE_S = 15 * 60;

const BACKOFF_BASE_S = 60 * 60;
const BACKOFF_MAX_S = 7 * 24 * 60 * 60;

/**
 * How long to wait after the `attempts`th attempt: an hour, doubling, at
 * most a week. The drainer runs daily, so the early steps are also the
 * lease that stops an overlapping run taking a row already in hand.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(BACKOFF_BASE_S * 2 ** (attempts - 1), BACKOFF_MAX_S);
}

/**
 * One debt, with the row id this writer will settle it by. Minted by the
 * caller so the fast path deletes only the row it wrote (see
 * `outboxInsert`).
 */
export interface OutboxDebt {
  readonly id: string;
  readonly message: OutboxMessage;
}

export function oweOutbox(message: OutboxMessage): OutboxDebt {
  return { id: newUlid(), message };
}

/**
 * The row, as a statement for the caller's `db.batch()` — never awaited
 * here, because landing with the change it pays for is the whole point.
 *
 * A second debt with the same key is the same row, and it takes the row
 * over: the id becomes the new writer's, and it is due as a fresh row is.
 * Taking over, not ignoring, is what makes a fast path's delete safe: with
 * INSERT OR IGNORE two writers would share one id, and the first to settle
 * would delete the second's debt. A fast path that settled deletes its own
 * id only, so if another write owed the same work while it ran, the row
 * survives for that writer — whose work the first run may have listed too
 * early to see.
 */
export function outboxInsert(db: Db, debt: OutboxDebt, now = nowSeconds()) {
  const due = now + OUTBOX_FAST_PATH_GRACE_S;
  return db
    .insert(outbox)
    .values({
      id: debt.id,
      kind: debt.message.kind,
      dedupeKey: dedupeKeyFor(debt.message),
      payload: JSON.stringify(debt.message.payload),
      nextAttemptAt: due,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [outbox.kind, outbox.dedupeKey],
      set: { id: debt.id, nextAttemptAt: due },
    });
}

/**
 * The fast path: do the work now, and delete the row when it is done.
 *
 * Never throws. The caller's D1 change has already committed, so a
 * failure here is not the runner's failure — it is reported, and the row
 * stays for the drainer.
 */
export async function settleOutbox(
  db: Db,
  debt: OutboxDebt,
  report: Report = captureException,
  handlers: OutboxHandlers = outboxHandlers,
): Promise<void> {
  const handler = handlers[debt.message.kind];
  try {
    await handler.run(db, debt.message.payload);
    await db.delete(outbox).where(eq(outbox.id, debt.id));
  } catch (error) {
    report(error, {
      surface: "outbox-fast-path",
      kind: debt.message.kind,
      outboxId: debt.id,
      ...handler.context(debt.message.payload),
    });
  }
}

export interface DrainOptions {
  readonly report?: Report;
  readonly handlers?: OutboxHandlers;
  readonly now?: number;
}

type ClaimedRow = typeof outbox.$inferSelect;

/**
 * Claim, then work (law 2). Each due row is claimed by a compare-and-swap
 * on the `next_attempt_at` this run read, moving it to the backoff: a run
 * that overlaps this one read the same value, finds it gone, and claims
 * nothing. Only the rows an UPDATE actually returned are worked.
 *
 * The attempt is counted at the claim, not after the work, so a run that
 * dies mid-handler has still spent one and waits its backoff.
 *
 * One batch for one round trip; each claim stands alone, so nothing
 * depends on them landing together.
 */
async function claimDue(
  db: Db,
  kind: OutboxKind,
  now: number,
): Promise<ClaimedRow[]> {
  const due = await db
    .select({
      id: outbox.id,
      attempts: outbox.attempts,
      nextAttemptAt: outbox.nextAttemptAt,
    })
    .from(outbox)
    .where(and(eq(outbox.kind, kind), lte(outbox.nextAttemptAt, now)))
    .orderBy(asc(outbox.nextAttemptAt))
    .limit(OUTBOX_DRAIN_CAP);
  const [first, ...rest] = due.map((row) =>
    db
      .update(outbox)
      .set({
        attempts: sql`${outbox.attempts} + 1`,
        nextAttemptAt: now + backoffSeconds(row.attempts + 1),
      })
      .where(
        and(eq(outbox.id, row.id), eq(outbox.nextAttemptAt, row.nextAttemptAt)),
      )
      .returning(),
  );
  if (first === undefined) return [];
  const claimed = await db.batch([first, ...rest]);
  return claimed.flat();
}

/**
 * Work one claimed row. `true` when it settled and its row is gone.
 * Anything else leaves the row owed at its new backoff, reported with the
 * row's ids and never its payload.
 */
async function didSettle(
  db: Db,
  row: ClaimedRow,
  report: Report,
  handlers: OutboxHandlers,
): Promise<boolean> {
  const where = {
    surface: "outbox-drain",
    kind: row.kind,
    outboxId: row.id,
    attempts: String(row.attempts),
    terminal: String(row.attempts >= OUTBOX_TERMINAL_ATTEMPTS),
  };
  const read = readOutboxRow(row.kind, row.payload);
  if (!read.ok) {
    report(new Error(`outbox row unreadable: ${read.problem}`), where);
    return false;
  }
  const { message } = read;
  const handler = handlers[message.kind];
  try {
    await handler.run(db, message.payload);
    // Its own id, as the fast path does: a row taken over by a newer
    // write since this run claimed it is that writer's to settle.
    await db.delete(outbox).where(eq(outbox.id, row.id));
    return true;
  } catch (error) {
    report(error, { ...where, ...handler.context(message.payload) });
    return false;
  }
}

/**
 * The drainer: for each kind this build knows, up to `OUTBOX_DRAIN_CAP`
 * due rows, claimed and worked. A kind it does not know is never claimed
 * — a newer deploy wrote it, and a newer deploy will drain it — and the
 * digest reports it instead.
 *
 * Every row it found is a fast path that failed, so each kind's count is
 * an anomaly line: the digest says the debt existed whether or not this
 * run paid it.
 */
export async function drainOutbox(
  db: Db,
  anomalies: string[],
  options: DrainOptions = {},
): Promise<void> {
  const report = options.report ?? captureException;
  const handlers = options.handlers ?? outboxHandlers;
  const now = options.now ?? nowSeconds();
  for (const kind of outboxKinds) {
    const claimed = await claimDue(db, kind, now);
    if (claimed.length === 0) continue;
    let settled = 0;
    for (const row of claimed) {
      if (await didSettle(db, row, report, handlers)) settled += 1;
    }
    anomalies.push(
      `${String(claimed.length)} ${kind} outbox row(s) were owed; ${String(settled)} settled`,
    );
  }
}

/**
 * The debt nobody is paying (law 6): rows past their terminal attempt
 * count, and rows of a kind this build cannot drain.
 *
 * Neither read is index-covered, and that is deliberate: `attempts` and a
 * NOT IN over `kind` would each need an index for a table that only ever
 * holds unpaid debt — a handful of rows on a bad day — read once a day by
 * a cron, never by a page.
 */
export async function checkOutboxBacklog(
  db: Db,
  anomalies: string[],
): Promise<void> {
  const exhausted = await db
    .select({ kind: outbox.kind, rows: count() })
    .from(outbox)
    .where(gte(outbox.attempts, OUTBOX_TERMINAL_ATTEMPTS))
    .groupBy(outbox.kind);
  for (const { kind, rows } of exhausted) {
    anomalies.push(
      `${String(rows)} ${kind} outbox row(s) exhausted ${String(OUTBOX_TERMINAL_ATTEMPTS)} attempts and are still owed`,
    );
  }
  const unreadable = await db
    .select({ kind: outbox.kind, rows: count() })
    .from(outbox)
    .where(notInArray(outbox.kind, [...outboxKinds]))
    .groupBy(outbox.kind);
  for (const { kind, rows } of unreadable) {
    anomalies.push(
      `${String(rows)} outbox row(s) of kind ${kind}, which this build cannot drain`,
    );
  }
}
