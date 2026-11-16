import { isTimeZone, monthYearLabel } from "../../lib/dates";

/**
 * How many runs the runs list reads at a time, newest first, and how many
 * more each "Show 50 more" adds (Round 55 · 235, R58·299).
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
export function monthOf(run: Dated): string {
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
 * run listed, "Aug 2026", once every run is listed (R58·299), and nothing
 * while there are more, so it never says "every run" about the newest
 * fifty.
 */
export function listedSince(
  runs: readonly Dated[],
  total: number,
): string | undefined {
  const oldest = runs.at(-1);
  return oldest === undefined || runs.length < total
    ? undefined
    : monthYearLabel(oldest.startedAt, oldest.clockZone);
}

/**
 * How many more the list's Show row offers (R58·299, as 236a's "Show 9
 * more"): the next fifty, or what is left when that is fewer.
 */
export function moreToShow(listed: number, total: number): number {
  return Math.max(0, Math.min(RUNS_LISTED, total - listed));
}

/**
 * The oldest listed month counted whole (R58·299): when the list stops
 * inside a month, its break counts the month, not the runs above the cut.
 */
export interface CutMonth {
  month: string;
  count: number;
}

/**
 * A month break's count: the whole month's where the list was cut inside
 * it, the listed runs' everywhere else, since a month above the cut is
 * listed whole.
 */
export function monthCount(
  month: string,
  listed: number,
  cut: CutMonth | undefined,
): number {
  return cut?.month === month ? cut.count : listed;
}
