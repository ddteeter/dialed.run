import type { JSX } from "react";

import { Bracketed, CoverageMark, Mono } from "../../../ui";
import type { CoverageLevel } from "../../../ui";
import type { Ladder } from "../ladder";

/**
 * The Call tab's teaser (D-16, screen O6).
 *
 * **It shows progress and never a recommendation.** That is the packet's
 * hard line and the reason this screen exists at all: the call itself is
 * the next epic, and a teaser that guessed an outfit would be shipping the
 * thing the data is not yet good enough for. Nothing here reads a garment.
 *
 * "Coverage is the progress bar — not run count" (O6): forty verdicts all
 * at 50° is still nothing known about January, so the ladder renders the
 * bands a runner has *not* covered alongside the ones they have.
 *
 * **Coverage is ink density, never a hue** (design round 6 §AB, D-48).
 * This screen shipped bracket notation as a placeholder precisely because
 * pink/teal/grey were claimed by two meanings at once, and design's answer
 * was that hue belongs to verdict — so coverage got the channel it should
 * have had. Their note on the artboard is explicit that the placeholder
 * was the right call: *"Lane 105 was right to ship text rather than borrow
 * a colour."*
 *
 * The words stay beside the swatches. *"The counts are there so the
 * reading never depends on the swatch"* — and ink is knowledge, so a band
 * nobody has logged looks hollow rather than merely differently coloured.
 */
export function CallLadder({
  ladder,
}: Readonly<{ ladder: Ladder }>): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <LadderHeadline ladder={ladder} />
      {/* One guard, not two: the bar and its legend are the same fact, and
          a ladder with no bands has neither. */}
      {ladder.bands.length === 0 ? undefined : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {ladder.bands.map(({ band, coverage }) => (
              <li
                key={band.bandFloorC}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <Bracketed className="w-24 shrink-0 text-night/40">
                  {band.label}
                </Bracketed>
                <CoverageMark level={coverage} />
                <Mono className="text-xs text-night/50">{coverage}</Mono>
                <Mono className="text-xs text-night/40">
                  {String(band.cold + band.dialed + band.warm)}
                </Mono>
              </li>
            ))}
          </ul>
          <CoverageLegend levels={ladder.bands.map((row) => row.coverage)} />
        </>
      )}
    </div>
  );
}

/**
 * The three things a runner can be told here, and no fourth.
 *
 * A runner with nothing logged is told the app is listening, not scolded
 * for an empty screen. One who has finished is told the data is ready and
 * the feature is not — which is honest about an unshipped epic in a way
 * that "coming soon" is not.
 */
function LadderHeadline({ ladder }: Readonly<{ ladder: Ladder }>): JSX.Element {
  if (ladder.verdictTotal === 0) {
    return (
      <p className="m-0 text-base">
        Logging now, calling later. Rate a run and this fills in.
      </p>
    );
  }
  if (ladder.verdictsUntilCall === 0) {
    return (
      <p className="m-0 text-base">
        The call is coming in an update — your data&rsquo;s ready.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-base">
        <Mono>{String(ladder.verdictsUntilCall)}</Mono> verdicts until your
        first call.
      </p>
      <ThinnestAsk band={ladder.thinnestBand} />
    </div>
  );
}

/**
 * How many bands sit at each level.
 *
 * Design's own legend, and the line that earns it: *"Forty verdicts all at
 * 50° leaves January hollow, and a hollow bar looks hollow."* The counts
 * make that readable without decoding the swatches, which is the point of
 * printing them at all.
 */
function CoverageLegend({
  levels,
}: Readonly<{ levels: readonly CoverageLevel[] }>): JSX.Element {
  const order: readonly CoverageLevel[] = ["covered", "partial", "unknown"];
  return (
    <ul className="m-0 flex list-none flex-wrap gap-4 border-t border-night/15 p-0 pt-3">
      {order.map((level) => (
        <li key={level} className="flex items-center gap-2">
          <CoverageMark level={level} />
          <Mono className="text-[11px] text-night/50">
            {level} {levels.filter((row) => row === level).length}
          </Mono>
        </li>
      ))}
    </ul>
  );
}

/**
 * The band worth logging next, when there is one.
 *
 * **Its own component so the empty case is reachable.** Inside
 * `LadderHeadline` this guard could never be false — that branch only runs
 * when `verdictTotal > 0`, which means at least one band, which means
 * `ladderFrom` found a thinnest one — so it was an equivalent mutant
 * carrying a Stryker suppression. Prettier then wrapped the line and
 * silently detached the directive, which is how it came back.
 *
 * Lifted out, "no thinnest band" is a state a test can simply render, and
 * the suppression is gone rather than repaired. Exported for that test:
 * the reachable version is the one worth keeping.
 */
export function ThinnestAsk({
  band,
}: Readonly<{ band: Ladder["thinnestBand"] }>): JSX.Element | undefined {
  if (band === undefined) return undefined;
  return (
    <p className="m-0 text-sm text-night/60">
      Thinnest so far:{" "}
      <Bracketed className="text-night/50">{band.label}</Bracketed>
    </p>
  );
}
