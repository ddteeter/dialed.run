import { Mono, Spoken } from "../../../ui";
import type { StripConditions } from "../strip";

/**
 * A run's conditions as E1's strip and D's both read them: the measured
 * line in teal — teal always means measured conditions — or `Indoor`,
 * quieter, when the run says so. The caller decides whether there is a
 * cell at all. The line is drawn, and said in words (round 52 #158).
 */
export function ConditionsCell({
  cell,
}: Readonly<{ cell: NonNullable<StripConditions> }>) {
  return cell.kind === "indoor" ? (
    <Mono className="text-muted">Indoor</Mono>
  ) : (
    <Mono className="text-dialed-text">
      <Spoken shown={cell.shown} said={cell.said} />
    </Mono>
  );
}
