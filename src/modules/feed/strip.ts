import type { Units } from "../../lib/contracts";
import { formatTempRange } from "../../lib/contracts/measures";
import type { Conditions } from "./conditions-shape";

/**
 * The second cell of a post's run strip — `TEMP · CONDITION` — or what
 * stands in for it (round 22, E1): *"No conditions: 'INDOOR' if the run
 * says so, otherwise the second cell is absent — never '—' or 'N/A'."*
 *
 * Conditions win over the indoor flag: a run with a real observation
 * attached has conditions to show whatever it was marked. The temperature
 * is the range the run actually covered (R-5), in the viewer's own unit.
 */
export type StripConditions =
  { kind: "conditions"; text: string } | { kind: "indoor" } | undefined;

export function stripConditions(
  conditions: Conditions | undefined,
  isIndoor: boolean,
  units: Units,
): StripConditions {
  if (conditions !== undefined) {
    const temperature = formatTempRange(
      conditions.span.minTempC,
      conditions.span.maxTempC,
      units.temp,
    );
    return {
      kind: "conditions",
      text: `${temperature} · ${conditions.condition}`,
    };
  }
  return isIndoor ? { kind: "indoor" } : undefined;
}

/**
 * Whether these conditions are Visual Crossing's reading — the data its
 * licence says to credit "near the data, with a clickable link" (audit
 * §1.8, FEED-8). A band a runner set in R2b is theirs, not the provider's,
 * so it carries no credit; no conditions at all carry nothing to credit.
 */
export function isProvidersReading(
  conditions: { source: string } | undefined,
): boolean {
  return conditions?.source === "visualcrossing";
}
