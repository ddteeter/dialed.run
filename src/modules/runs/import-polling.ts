/**
 * When A1 asks again how an upload is getting on, and when it stops.
 *
 * A plain module rather than part of the component: the component takes
 * server functions as props, but the policy is arithmetic, and arithmetic
 * is tested without timers or a rendered screen.
 */
const POLL_INTERVAL_MS = 2000;

/**
 * Give up polling after two minutes.
 *
 * Polling used to continue for as long as the status was non-terminal,
 * which is fine for the normal case (a few seconds) and wrong for the one
 * that matters: an import wedged in `processing` — a consumer that claimed
 * the row and then died — left every open tab polling every two seconds
 * forever. The queue's own retries and the DLQ own recovery; the browser
 * asking again for the rest of the afternoon adds nothing.
 */
const POLL_BUDGET_MS = 120_000;
const MAX_POLLS = POLL_BUDGET_MS / POLL_INTERVAL_MS;

/**
 * When A1 says it is slow: twenty seconds still reading (round 22, *"Stalled
 * (>20s pending) → failure band … 'Our end is slow. Your file is fine.'"*).
 * Polling carries on behind the band, so a parse that lands late still
 * lands.
 */
export const STALL_AFTER_MS = 20_000;

/**
What of an import's outcome the policy reads.
*/
interface Progress {
  status: string;
  run?: { weatherStatus: string } | undefined;
}

/**
 * Whether there is more to wait for: the file is still being read, or the
 * run is in and its weather is still being asked for — the parsed card's
 * conditions block breathes until it lands.
 *
 * **No answer yet is more to wait for.** It is what a first poll that
 * failed leaves behind, and treating it as settled stopped polling for
 * good on one dropped request. The budget still ends it.
 */
function isUnsettled(progress: Progress | undefined): boolean {
  if (progress === undefined) return true;
  if (isReading(progress.status)) return true;
  return (
    progress.status === "done" && progress.run?.weatherStatus === "pending"
  );
}

/**
 * Milliseconds until the next poll, or **0 meaning stop**. 0 is what
 * react-query wants too — it schedules only for a positive number — so the
 * caller passes it through rather than converting it.
 */
export function importPollIntervalMs(
  progress: Progress | undefined,
  pollCount: number,
): number {
  if (!isUnsettled(progress)) return 0;
  if (pollCount >= MAX_POLLS) return 0;
  return POLL_INTERVAL_MS;
}

/**
True while the file itself is still being read.
*/
export function isReading(status: string | undefined): boolean {
  return status === "pending" || status === "processing";
}
