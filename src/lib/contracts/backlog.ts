import type { Conditions } from "./conditions";

/**
 * DS2's verdict backlog, as the table reads it (design 276). The reads
 * that assemble it are `modules/feed/attach/backlog.ts`; the table that
 * renders it is `modules/runs/components/VerdictBacklog`. The shapes live
 * here so the table imports no module to name them.
 */

/**
 * What the outfit cell offers: *"Same as Monday? Use · Pick"*.
 *
 * The names travel with the ids because the cell draws the kit as chips.
 * Reading them in the component would mean a component making a server
 * call, which it may not.
 */
export interface BacklogKit {
  entryId: string;
  itemIds: readonly string[];
  itemNames: readonly string[];
}

export interface BacklogSuggestion extends BacklogKit {
  /**
  When the run that kit was worn on started, so the cell can say which day
  it is offering rather than "a previous run".
  */
  wornAt: number;
}

export interface BacklogRow {
  runId: string;
  startedAt: number;
  durationS: number;
  distanceM: number;
  /**
  Absent when no observation resolved — an indoor run, or one the hourly
  cron has not caught up with. The row is still judgeable; it just has
  nothing to be near, so it gets no suggestion either.
  */
  conditions: Conditions | undefined;
  /**
   * The kit this run already has, when the runner attached one and never
   * gave a verdict — the owner's ruling puts that run in the backlog too.
   * The row shows it and saves only the verdict: `attachKit` never
   * replaces a kit, so offering another here would save a verdict against
   * a kit the runner never saw.
   */
  kit: BacklogKit | undefined;
  /**
  What the outfit cell offers a run with no kit yet; none for one that has.
  */
  suggestion: BacklogSuggestion | undefined;
}

export interface Backlog {
  rows: readonly BacklogRow[];
}
