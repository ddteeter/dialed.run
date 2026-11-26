import type { UiGroup } from "../../../lib/contracts";
import type { CallRequest, CohortCell, CohortRung } from "../contract";
import { cellsAboveFloor } from "./floor";
import type { CallScope } from "./personal";

type Runner = CallRequest["runner"];

/**
 * The backoff ladder's order, narrowest rung first (design 194, "Cohort
 * shape"): the runner's climate zone and thermal level, then the zone,
 * then everyone. A record, so a rung added to the contract fails to
 * compile here until it is given a place.
 */
const RUNG_ORDER: Readonly<Record<CohortRung, number>> = {
  "zone-and-thermal": 0,
  zone: 1,
  everyone: 2,
};

function isSameZone(cell: CohortCell, runner: Runner): boolean {
  return (
    runner.climateZone !== undefined && cell.climateZone === runner.climateZone
  );
}

/**
 * Whether a cell counts runners like this one. A runner with no zone is
 * on neither zone rung, and one with no thermal level is not on the
 * narrowest: a cell that lacks the same field is not a match for them.
 */
function isRunnersCell(cell: CohortCell, runner: Runner): boolean {
  switch (cell.rung) {
    case "everyone": {
      return true;
    }
    case "zone": {
      return isSameZone(cell, runner);
    }
    case "zone-and-thermal": {
      return (
        isSameZone(cell, runner) &&
        runner.thermalLevel !== undefined &&
        cell.thermalLevel === runner.thermalLevel
      );
    }
  }
}

function isForScope(
  cell: CohortCell,
  scope: CallScope,
  group: UiGroup,
): boolean {
  return (
    cell.bandFloorC === scope.bandFloorC &&
    cell.precip === scope.precip &&
    cell.group === group
  );
}

/**
 * The cohort cell to read for a garment group: the narrowest rung that has
 * a cell for this band and class which counts runners like this one and
 * passes the privacy floor, else the next rung, else nothing.
 *
 * With no forecast there is no band, so there is no cell. The producer
 * sends one cell per rung, band, class and group; were it to send two,
 * the first in the request is read.
 */
export function cohortCellFor(
  cells: readonly CohortCell[],
  runner: Runner,
  scope: CallScope | undefined,
  group: UiGroup,
): CohortCell | undefined {
  if (scope === undefined) return undefined;
  let narrowest: CohortCell | undefined;
  for (const cell of cellsAboveFloor(cells)) {
    const isCandidate =
      isForScope(cell, scope, group) && isRunnersCell(cell, runner);
    const isNarrower =
      narrowest === undefined ||
      RUNG_ORDER[cell.rung] < RUNG_ORDER[narrowest.rung];
    if (isCandidate && isNarrower) narrowest = cell;
  }
  return narrowest;
}
