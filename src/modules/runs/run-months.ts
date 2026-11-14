import { isTimeZone, monthYearLabel } from "../../lib/dates";

/**
 * How many runs the runs list reads, newest first. One number for the
 * query that stops there and the list that may only say "that's every
 * run" when it stopped short of it (Round 55 · 235).
 */
export const RUNS_LISTED = 50;

/**
What of a run the month breaks read: when it started, on its own clock.
*/
interface Dated {
  startedAt: number;
  clockZone: string | undefined;
}

/**
One month break: its heading's month and the runs under it.
*/
export interface RunMonth<TRun extends Dated> {
  month: string;
  runs: TRun[];
}

/**
 * The month a run was run in, on its own clock (P2a-02's one rule):
 * "November 2026", which the mono step sets as "NOVEMBER 2026".
 */
function monthOf(run: Dated): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: isTimeZone(run.clockZone) ? run.clockZone : "UTC",
  }).format(new Date(run.startedAt * 1000));
}

/**
 * The list's month breaks (Round 55 · 235): runs newest first, cut where
 * the month changes, in the order they came.
 */
export function runMonths<TRun extends Dated>(
  runs: readonly TRun[],
): RunMonth<TRun>[] {
  const months: RunMonth<TRun>[] = [];
  for (const run of runs) {
    const month = monthOf(run);
    const last = months.at(-1);
    if (last?.month === month) last.runs.push(run);
    else months.push({ month, runs: [run] });
  }
  return months;
}

/**
 * Where the list ends (Round 55 · 235): "since" the month of the oldest
 * run listed, "Aug 2026" — or nothing when the list stopped at its cap,
 * so it never says "every run" about the newest fifty.
 */
export function listedSince(runs: readonly Dated[]): string | undefined {
  const oldest = runs.at(-1);
  return oldest === undefined || runs.length >= RUNS_LISTED
    ? undefined
    : monthYearLabel(oldest.startedAt, oldest.clockZone);
}
