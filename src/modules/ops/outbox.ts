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
 *   their attempts, rows of a kind this build cannot read, and rows still
 *   due once the drain has run — debt the cap could not reach (law 6).
 */
import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  lte,
  min,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { outbox } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import {
  dedupeKeyFor,
  outboxKinds,
  readOutboxRow,
  scheduledOutboxKinds,
  type OutboxKind,
  type OutboxMessage,
} from "../../lib/sql/outbox";
import {
  boundHandler,
  outboxHandlers,
  OWED_AGAIN,
  Refused,
  type OutboxHandlers,
} from "./outbox-handlers";
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
 * Attempts after which a runner's email the sender keeps refusing is
 * closed: deleted unsent and reported once (SA-L22, design 244). At the
 * doubling backoff the eighth try comes a little over five days after the
 * first.
 *
 * Not at the first refusal, and not `OUTBOX_TERMINAL_ATTEMPTS`: the codes
 * that say "not this address" are also what a fault of ours earns for
 * every address (a suppressed sender, a malformed message), and during
 * one the operator's own mail fails too. The days are for that to be
 * noticed and fixed before any owed mail is discarded. The owner set the
 * number (2026-11-18).
 */
export const OUTBOX_REFUSED_ATTEMPTS = 8;

/**
 * Rows drained per kind per run, so one kind with a large or failing
 * backlog cannot starve the others of the run.
 */
export const OUTBOX_DRAIN_CAP = 50;

/**
 * Kinds whose one row is many D1 calls, drained fewer a run (design 232):
 * a `product_link` links up to `LINK_BATCH` garments, several calls each,
 * inside a cron invocation the run's other steps share.
 */
export const OUTBOX_DRAIN_CAPS: ReadonlyMap<string, number> = new Map([
  ["product_link", 5],
]);

/**
A kind's rows a run.
*/
function drainCapOf(kind: string): number {
  return OUTBOX_DRAIN_CAPS.get(kind) ?? OUTBOX_DRAIN_CAP;
}

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
  /**
   * The earliest the drain may work it, in epoch seconds — task 127's
   * reminder, 20 minutes after the run lands. Omitted, it is due once the
   * fast path's grace has passed.
   */
  readonly notBefore?: number | undefined;
}

export function oweOutbox(
  message: OutboxMessage,
  notBefore?: number,
): OutboxDebt {
  return { id: newUlid(), message, notBefore };
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
  const row = outboxRow(debt, now);
  return db.insert(outbox).values(row).onConflictDoUpdate(takeOver(row));
}

/**
 * `outboxInsert`, owed only if `where` matches a row of `from` when the
 * statement runs — `INSERT … SELECT … WHERE`, for a batch whose other
 * write may match nothing. A batch cannot branch on its own results, so
 * this is how the debt lands exactly when the change it pays for did, and
 * never without it.
 */
export function outboxInsertWhere(
  db: Db,
  debt: OutboxDebt,
  from: Readonly<{ table: SQLiteTable; where: SQL }>,
  now = nowSeconds(),
) {
  const row = outboxRow(debt, now);
  // Drizzle names every column of `outbox`, in the table's order, so the
  // select gives each one: the row's values, then a fresh row's defaults
  // (no attempts, never sent). A column added to the table fails this
  // loudly, as a count mismatch, on the first test that owes an export.
  return db
    .insert(outbox)
    .select(
      sql`select ${row.id}, ${row.kind}, ${row.dedupeKey}, ${row.payload}, 0, ${row.nextAttemptAt}, ${row.createdAt}, null, null from ${from.table} where ${from.where}`,
    )
    .onConflictDoUpdate(takeOver(row));
}

/**
 * The row a debt writes. A debt held back (`notBefore`) is due when it
 * says, or after the grace if that is later: the drain must still not race
 * a fast path. A scheduled kind has no fast path to race, so it waits for
 * no grace — a `product_link` is due at once, and the next hourly drain
 * takes it.
 */
function outboxRow(debt: OutboxDebt, now: number) {
  const grace = scheduledOutboxKinds.includes(debt.message.kind)
    ? 0
    : OUTBOX_FAST_PATH_GRACE_S;
  return {
    id: debt.id,
    kind: debt.message.kind,
    dedupeKey: dedupeKeyFor(debt.message),
    payload: JSON.stringify(debt.message.payload),
    nextAttemptAt: Math.max(now + grace, debt.notBefore ?? 0),
    createdAt: now,
  };
}

function takeOver(row: ReturnType<typeof outboxRow>) {
  return {
    target: [outbox.kind, outbox.dedupeKey],
    set: { id: row.id, nextAttemptAt: row.nextAttemptAt },
  };
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
  const handler = boundHandler(handlers, debt.message);
  try {
    // Refused (SA-L22) is reported like a failure and left for the drain,
    // which is what counts a row's tries and closes it.
    const refused = await runToSettle(db, handler, debt.id);
    if (refused !== undefined) throw refusalOf(refused);
  } catch (error) {
    report(error, {
      surface: "outbox-fast-path",
      kind: debt.message.kind,
      outboxId: debt.id,
      ...handler.context(),
    });
  }
}

export interface DrainOptions {
  readonly report?: Report;
  readonly handlers?: OutboxHandlers;
  readonly now?: number;
  /**
   * The kinds to drain, every kind this build knows by default. The hourly
   * firings drain `email` alone, so a held-back reminder goes out within
   * the hour rather than at the next daily digest.
   */
  readonly kinds?: readonly OutboxKind[];
  /**
   * Which lines the drain writes (design 162). `owed`, the daily
   * digest's and the default: every kind whose fast path failed, settled
   * or not. `unsettled`, the hourly firings': only rows this run could not
   * settle. The hourly drain is the only sender a held reminder has, so
   * a row it sends is the schedule arriving, and an hourly line is an
   * alert.
   */
  readonly lines?: "owed" | "unsettled";
  /**
   * Whether the drain then says what it left due of the kinds it drained
   * (design 232): the hourly firings', so a backlog is a line the hour it
   * forms, not at the next daily digest.
   */
  readonly backlog?: boolean;
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
/**
 * The drainer's read: one kind's due rows, oldest first. A row whose send
 * landed is due too — marking it sent moves `next_attempt_at` to the send
 * (`emailHandler`) — so this is one range on `outbox_kind_due` and never
 * an OR the index cannot narrow. Exported for the test that reads its plan.
 */
export function dueRowsOf(db: Db, kind: OutboxKind, now: number) {
  return db
    .select({
      id: outbox.id,
      attempts: outbox.attempts,
      nextAttemptAt: outbox.nextAttemptAt,
    })
    .from(outbox)
    .where(and(eq(outbox.kind, kind), lte(outbox.nextAttemptAt, now)))
    .orderBy(asc(outbox.nextAttemptAt))
    .limit(drainCapOf(kind));
}

async function claimDue(
  db: Db,
  kind: OutboxKind,
  now: number,
): Promise<ClaimedRow[]> {
  const due = await dueRowsOf(db, kind, now);
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
 * Run a row's handler, then settle the row: delete it, by its own id, so
 * a row taken over by a newer write since it was read is that writer's to
 * settle. A handler that did part of the work and owes the rest (design
 * 232) leaves the row, at the backoff its claim set, with its attempts
 * back at none, so a long job done a run at a time never reads as
 * failing. Throws what the handler throws.
 */
async function runToSettle(
  db: Db,
  handler: ReturnType<typeof boundHandler>,
  rowId: string,
): Promise<Refused | undefined> {
  const ofRow = eq(outbox.id, rowId);
  const outcome = await handler.run(db, rowId);
  if (outcome instanceof Refused) return outcome;
  await (outcome === OWED_AGAIN
    ? db.update(outbox).set({ attempts: 0 }).where(ofRow)
    : db.delete(outbox).where(ofRow));
  return undefined;
}

/**
What a refused row is reported as: the far side's code and nothing else.
*/
function refusalOf(refused: Refused): Error {
  return new Error(`the sender refused this address: ${refused.reason}`);
}

/**
 * What became of a claimed row: `settled` and gone; `closed`, gone unsent
 * because the far side kept refusing it; or nothing, and it is still owed.
 */
type Worked = "settled" | "closed" | undefined;

/**
 * A refused row (SA-L22): reported with the far side's code, and closed —
 * deleted unsent — once a runner's email has been refused
 * `OUTBOX_REFUSED_ATTEMPTS` times. `closed` on the report says which, so
 * the one report that ends a debt reads apart from the tries before it,
 * and a run of them under one code reads as a fault of ours.
 */
async function refusedRow(
  db: Db,
  row: ClaimedRow,
  refused: Refused,
  report: (error: Error, isClosed: boolean) => void,
): Promise<Worked> {
  const isClosed =
    row.kind === "email" && row.attempts >= OUTBOX_REFUSED_ATTEMPTS;
  if (isClosed) await db.delete(outbox).where(eq(outbox.id, row.id));
  report(refusalOf(refused), isClosed);
  return isClosed ? "closed" : undefined;
}

/**
 * Work one claimed row. `settled` when it settled and its row is gone.
 * No answer leaves the row owed at its new backoff, reported with the
 * row's ids and never its payload.
 */
async function workRow(
  db: Db,
  row: ClaimedRow,
  report: Report,
  handlers: OutboxHandlers,
): Promise<Worked> {
  const where = {
    surface: "outbox-drain",
    kind: row.kind,
    outboxId: row.id,
    attempts: String(row.attempts),
    terminal: String(row.attempts >= OUTBOX_TERMINAL_ATTEMPTS),
  };
  // Sent already (the Worker that sent it died before its delete): the
  // work is done, and doing it again is the duplicate the mark exists to
  // prevent. Only the delete is owed.
  if (row.sentAt !== null) {
    await db.delete(outbox).where(eq(outbox.id, row.id));
    return "settled";
  }
  const read = readOutboxRow(row.kind, row.payload);
  if (!read.ok) {
    report(new Error(`outbox row unreadable: ${read.problem}`), where);
    return undefined;
  }
  const { message } = read;
  const handler = boundHandler(handlers, message);
  try {
    const refused = await runToSettle(db, handler, row.id);
    if (refused === undefined) return "settled";
    return await refusedRow(db, row, refused, (error, isClosed) => {
      report(error, {
        ...where,
        closed: String(isClosed),
        ...handler.context(),
      });
    });
  } catch (error) {
    report(error, { ...where, ...handler.context() });
    return undefined;
  }
}

/**
 * Work a kind's claimed rows in turn, and count what became of them.
 */
async function workClaimed(
  db: Db,
  claimed: readonly ClaimedRow[],
  report: Report,
  handlers: OutboxHandlers,
): Promise<{ settled: number; closed: number }> {
  let settled = 0;
  let closed = 0;
  for (const row of claimed) {
    const worked = await workRow(db, row, report, handlers);
    if (worked === "settled") settled += 1;
    else if (worked === "closed") closed += 1;
  }
  return { settled, closed };
}

/**
 * The drainer: for each kind this build knows, up to `OUTBOX_DRAIN_CAP`
 * due rows, claimed and worked. A kind it does not know is never claimed
 * — a newer deploy wrote it, and a newer deploy will drain it — and the
 * digest reports it instead.
 *
 * Every row it found is a fast path that failed, so each kind's count is
 * an anomaly line: the digest says the debt existed whether or not this
 * run paid it. A scheduled kind (`scheduledOutboxKinds`) is the exception:
 * its rows are due by design, so it earns a line only when one of them
 * did not settle.
 */
export async function drainOutbox(
  db: Db,
  anomalies: string[],
  options: DrainOptions = {},
): Promise<void> {
  const report = options.report ?? captureException;
  const handlers = options.handlers ?? outboxHandlers;
  const now = options.now ?? nowSeconds();
  const kinds = options.kinds ?? outboxKinds;
  for (const kind of kinds) {
    const claimed = await claimDue(db, kind, now);
    if (claimed.length === 0) continue;
    const { settled, closed } = await workClaimed(
      db,
      claimed,
      report,
      handlers,
    );
    const line = drainLine(kind, claimed.length, settled, options.lines);
    if (line !== undefined) anomalies.push(line);
    // Whatever the run's lines, a closed debt is said once (law 6): the
    // row is gone, so no later line can name it.
    if (closed > 0) {
      anomalies.push(
        `${String(closed)} ${kind} outbox row(s) closed unsent: the sender refused the address ${String(OUTBOX_REFUSED_ATTEMPTS)} times`,
      );
    }
  }
  if (options.backlog !== true) return;
  const left = await stillDueOf(db, now, kinds);
  anomalies.push(...left.map((row) => stillDueLine(row, now)));
}

/**
What one kind's run says, if anything, under `DrainOptions["lines"]`.
*/
function drainLine(
  kind: OutboxKind,
  claimed: number,
  settled: number,
  lines: DrainOptions["lines"],
): string | undefined {
  if (lines === "unsettled") {
    return settled < claimed
      ? `${String(claimed - settled)} of ${String(claimed)} ${kind} outbox row(s) did not settle`
      : undefined;
  }
  if (settled === claimed && scheduledOutboxKinds.includes(kind)) {
    return undefined;
  }
  return `${String(claimed)} ${kind} outbox row(s) were owed; ${String(settled)} settled`;
}

/**
 * Rows of a kind this build drains that are due at `now`: how many, and
 * the earliest they fell due. Read after the drain, a row a run worked has
 * settled or moved to its backoff, so whatever is left is debt the cap
 * never reached. It is one range on `outbox_kind_due` per kind, read
 * daily by the digest and whenever the Desk opens (design 168), which
 * passes the digest's start as a subquery; exported for the test that
 * reads its plan.
 */
export function stillDueOf(
  db: Db,
  now: number | SQL<number>,
  kinds: readonly OutboxKind[] = outboxKinds,
) {
  return db
    .select({
      kind: outbox.kind,
      rows: count(),
      oldest: min(outbox.nextAttemptAt),
    })
    .from(outbox)
    .where(
      and(inArray(outbox.kind, [...kinds]), lte(outbox.nextAttemptAt, now)),
    )
    .groupBy(outbox.kind);
}

const HOUR_S = 60 * 60;

/**
 * The debt nobody is paying (law 6): rows past their terminal attempt
 * count, rows of a kind this build cannot drain, and rows still due at
 * `now` — the drain's own `now`, so a row it backed off is not counted.
 *
 * The first two reads are not index-covered, and that is deliberate:
 * `attempts` and a NOT IN over `kind` would each need an index for a table
 * that only ever holds unpaid debt — a handful of rows on a bad day — read
 * once a day by a cron, never by a page. The third is covered
 * (`stillDueOf`), because a backlog is exactly when the table is large.
 *
 * The still-due line has no threshold to tune: a healthy drain leaves
 * nothing due, so one row left is the cap at work, and its age says how
 * far behind the drain is (design 162).
 */
export async function checkOutboxBacklog(
  db: Db,
  anomalies: string[],
  now = nowSeconds(),
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
  const stillDue = await stillDueOf(db, now);
  anomalies.push(...stillDue.map((row) => stillDueLine(row, now)));
}

/**
 * One kind's rows still due after a drain, and how long the oldest has
 * waited: the daily check's line, and the hourly drain's (design 232).
 */
function stillDueLine(
  row: Readonly<{ kind: string; rows: number; oldest: number | null }>,
  now: number,
): string {
  const waited = Math.floor((now - (row.oldest ?? now)) / HOUR_S);
  return `${String(row.rows)} ${row.kind} outbox row(s) still due after the drain, which takes ${String(drainCapOf(row.kind))} a run; the oldest has waited ${String(waited)}h`;
}
