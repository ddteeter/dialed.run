import { viewerClockLabel } from "../../lib/dates";

/**
 * A run's start on its clock (`RunSummary.clockZone`), "6:04 AM", or
 * "6:04 AM UTC" when the run has no zone and its runner no home zone yet,
 * so an unmarked UTC time is never printed (P2a-02, the owner's 2026-11-05
 * rule for clocks).
 */
export function runClockLabel(
  epochSeconds: number,
  clockZone: string | undefined,
): string {
  return viewerClockLabel(epochSeconds, { homeZone: clockZone });
}
