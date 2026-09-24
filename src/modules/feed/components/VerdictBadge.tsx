import { verdictLabel } from "../../../lib/contracts";
import { Mono } from "../../../ui";

/**
 * A run's verdict as a badge — E1's author row and D's run strip.
 *
 * **The fill follows A3** (round 22): dialed is the teal surface, and the
 * four off verdicts are a hairline in ink. E1 drew dialed yellow, which
 * was drift — yellow is failure and nothing else. The hue carries "it
 * worked"; the words carry which way it did not.
 *
 * Mono, because a verdict is a measurement a runner took, and uppercase by
 * the mono step's CSS so the accessible text stays in normal case.
 */
export function VerdictBadge({ verdict }: Readonly<{ verdict: number }>) {
  const label = verdictLabel(verdict);
  if (label === undefined) return;
  return (
    <span
      data-part="verdict-badge"
      className={`shrink-0 rounded-pill px-2 py-1 ${
        verdict === 0 ? "bg-teal text-ink" : "border border-ink"
      }`}
    >
      <Mono step="xs">{label}</Mono>
    </span>
  );
}
