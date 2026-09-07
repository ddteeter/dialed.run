/**
 * When to poll an in-flight import, and when to stop.
 *
 * A plain module rather than part of ImportStatus.tsx: that component
 * imports the server functions, which pull TanStack's virtual entries, and
 * those cannot resolve inside the vitest workers pool. Keeping the policy
 * here is what makes it testable — and the review asked for it to be
 * confirmed rather than asserted.
 */
const POLL_INTERVAL_MS = 2000;

/**
 * Give up after two minutes of a run staying pending or processing.
 *
 * Polling used to continue for as long as the status was non-terminal,
 * which is fine for the normal case (a few seconds) and wrong for the one
 * that matters: an import wedged in `processing` — a consumer that claimed
 * the row and then died — left every open tab polling every two seconds
 * forever. The queue's own retries and the DLQ own recovery; the browser
 * asking again for the rest of the afternoon adds nothing.
 *
 * Two minutes is well past the queue's redelivery window for a job of this
 * size, so stopping means something is actually wrong rather than slow.
 */
const POLL_BUDGET_MS = 120_000;
const MAX_POLLS = POLL_BUDGET_MS / POLL_INTERVAL_MS;

/**
 * Milliseconds until the next poll, or **0 meaning stop**. Pure, so the
 * policy can be tested without timers or a rendered component; the caller
 * translates 0 into react-query's `false`.
 */
export function importPollIntervalMs(
  status: string | undefined,
  pollCount: number,
): number {
  if (status !== "pending" && status !== "processing") return 0;
  if (pollCount >= MAX_POLLS) return 0;
  return POLL_INTERVAL_MS;
}

/**
True once the budget has elapsed with the import still unfinished.
*/
export function hasStalledImport(
  status: string | undefined,
  elapsedMs: number,
): boolean {
  return (
    (status === "pending" || status === "processing") &&
    elapsedMs >= POLL_BUDGET_MS
  );
}
