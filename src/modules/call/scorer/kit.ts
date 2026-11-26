import type { UiGroup } from "../../../lib/contracts";
import type { CohortCell } from "../contract";
import type { GroupRecord } from "./personal";

/**
 * The groups a kit always fills when the closet has a piece for them. The
 * rest are worn only on evidence (design sprint-a1, open question 7).
 */
const STAPLE_GROUPS: ReadonlySet<UiGroup> = new Set<UiGroup>([
  "tops",
  "bottoms",
  "shoes",
]);

function isMostly(part: number, whole: number): boolean {
  return part * 2 > whole;
}

/**
 * What the runner's own runs say about wearing a piece from a group, or
 * nothing when they do not settle it.
 *
 * With runs both ways it is the comparison itself: wearing one has to have
 * been dialed more often than going without. With runs one way only there
 * is nothing to compare, so the record settles it only when that way was
 * mostly dialed.
 */
function ownSay(record: GroupRecord): boolean | undefined {
  if (record.withRuns > 0 && record.withoutRuns > 0) {
    return (
      record.withDialed * record.withoutRuns >
      record.withoutDialed * record.withRuns
    );
  }
  if (isMostly(record.withDialed, record.withRuns)) return true;
  if (isMostly(record.withoutDialed, record.withoutRuns)) return false;
  return undefined;
}

/**
 * Whether the kit takes a piece from this group.
 *
 * A staple group always does. Any other does only when counted evidence
 * says wearing one beat not wearing one here: the runner's own runs when
 * they settle it, else most of the cohort's runners wearing one.
 */
export function shouldWearGroup(
  group: UiGroup,
  record: GroupRecord,
  cell: CohortCell | undefined,
): boolean {
  if (STAPLE_GROUPS.has(group)) return true;
  const isCohortHabit =
    cell !== undefined && isMostly(cell.groupRunners, cell.bandRunners);
  return ownSay(record) ?? isCohortHabit;
}
