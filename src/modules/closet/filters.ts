/**
 * Closet C's rail (R-94, design 174): GROUP, WORKS AT and COVERAGE, as
 * pure functions over rows the loader already read.
 *
 * **No server imports, and none from `./service`.** The grid filters in
 * the browser, so this file is what a component may reach; `service.ts`
 * imports the overlap rule back from here rather than keeping its own
 * copy. Rows are read structurally (`RailView`) for the same reason.
 */
import {
  coverageOfVerdicts,
  type UiGroup,
  type VerdictCoverage,
} from "../../lib/contracts";
import type { TempRange } from "../../lib/contracts/thermal";

/**
What the rail narrows by. Temperatures in Celsius, the search's unit.
*/
export interface RailFilters {
  group?: UiGroup | undefined;
  fromC?: number | undefined;
  toC?: number | undefined;
  coverage?: VerdictCoverage | undefined;
}

/**
The parts of a closet row the rail reads.
*/
export interface RailView {
  uiGroup: UiGroup;
  tempRange: TempRange | undefined;
  performance: { summary: { verdictCount: number } } | undefined;
}

/**
 * How well a piece is known: the ladder's rule over its verdicts (owner,
 * 2026-11-05). A piece never worn has no record and no verdicts.
 */
export function coverageOf(view: RailView): VerdictCoverage {
  return coverageOfVerdicts(view.performance?.summary.verdictCount ?? 0);
}

/**
 * Whether a working range overlaps the asked one. An end the runner left
 * open, or one the piece has none at, always satisfies its side.
 */
export function shouldIncludeByTempFilter(
  tempRange: TempRange | undefined,
  filters: Readonly<{
    minTempC?: number | undefined;
    maxTempC?: number | undefined;
  }>,
): boolean {
  if (filters.minTempC === undefined && filters.maxTempC === undefined) {
    return true;
  }
  if (!tempRange) return false;
  // Open ends as infinities rather than as `!== undefined` guards.
  //
  // "An open end always satisfies its side of the overlap" was written as a
  // comment above three `!== undefined` checks, and mutation testing showed
  // why that is not the same as saying it: `x < undefined` is already
  // false, so every one of those guards could be deleted without changing
  // an answer. They were load-bearing for the compiler and decorative at
  // runtime. Said this way it is one overlap test, and every part of it is
  // reachable.
  const askedFrom = filters.minTempC ?? -Infinity;
  const askedTo = filters.maxTempC ?? Infinity;
  const goodFrom = tempRange.lowC ?? -Infinity;
  const goodTo = tempRange.highC ?? Infinity;
  return goodTo >= askedFrom && goodFrom <= askedTo;
}

/**
The rows the rail's filters leave, in the order they came.
*/
export function filterViews<View extends RailView>(
  views: readonly View[],
  filters: RailFilters,
): View[] {
  return views.filter(
    (view) =>
      (filters.group === undefined || view.uiGroup === filters.group) &&
      (filters.coverage === undefined ||
        coverageOf(view) === filters.coverage) &&
      shouldIncludeByTempFilter(view.tempRange, {
        minTempC: filters.fromC,
        maxTempC: filters.toC,
      }),
  );
}

export interface RailCounts {
  all: number;
  groups: ReadonlyMap<UiGroup, number>;
  coverage: ReadonlyMap<VerdictCoverage, number>;
}

/**
 * The rail's counts, over every row it is handed and **not** narrowed by
 * the other groups: board C counts COVERAGE to the closet's 47 while Tops
 * is set, so a count says what the closet holds, not what one more tap
 * would leave. The caller hands in what the retired switch admits.
 */
export function railCounts(views: readonly RailView[]): RailCounts {
  const groups = new Map<UiGroup, number>();
  const coverage = new Map<VerdictCoverage, number>();
  for (const view of views) {
    groups.set(view.uiGroup, (groups.get(view.uiGroup) ?? 0) + 1);
    const level = coverageOf(view);
    coverage.set(level, (coverage.get(level) ?? 0) + 1);
  }
  return { all: views.length, groups, coverage };
}

/**
 * WORKS AT's bounds: the closet's own coldest and warmest stated ends,
 * so the control spans what the runner owns and nothing else. Nothing when
 * no piece states an end — there is no span to draw.
 */
export function worksAtSpan(
  views: readonly RailView[],
): { lowC: number; highC: number } | undefined {
  const ends = views.flatMap((view) =>
    [view.tempRange?.lowC, view.tempRange?.highC].filter(
      (end) => end !== undefined,
    ),
  );
  return ends.length === 0
    ? undefined
    : { lowC: Math.min(...ends), highC: Math.max(...ends) };
}
