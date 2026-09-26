import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { CALL_VERDICT_THRESHOLD } from "../../../lib/contracts";
import { Bracketed, CoverageMark, Mono } from "../../../ui";
import type { CoverageLevel } from "../../../ui";
import type { Ladder } from "../ladder";

/**
 * The Call tab's teaser — V1's K, as round 22's item 24 rules it.
 *
 * **It shows progress and never a recommendation.** That is the packet's
 * hard line and the reason this screen exists at all: the call itself is
 * the next epic, and a teaser that guessed an outfit would be shipping the
 * thing the data is not yet good enough for. Nothing here reads a garment.
 *
 * K's two ends, which round 22 answered and round 26 #15 re-counted to
 * fifteen: *"At 0 the kicker reads 0 OF 15 VERDICTS and the line reads
 * 'Your first verdict is one run away.'"* Threshold met in v1: K stays,
 * meter full, *"That's enough to call. The Call arrives in the next
 * release. No button — there's no B1 to hand off to."*
 *
 * "Coverage is the progress bar — not run count" (O6): forty verdicts all
 * at 50° is still nothing known about January, so the ladder renders the
 * bands a runner has *not* covered alongside the ones they have. **Coverage
 * is ink density, never a hue** (design round 6 §AB, D-48), and the words
 * stay beside the swatches — *"the counts are there so the reading never
 * depends on the swatch"*.
 *
 * K's "What we know so far" block is absent: its three rows are facts this
 * screen is not handed, and a missing part is absent rather than a
 * placeholder (round 22, item 3's rule for every v1 surface).
 */
export function CallLadder({
  ladder,
}: Readonly<{ ladder: Ladder }>): JSX.Element {
  const isCalling = ladder.verdictsUntilCall === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* K's ink header: the tab's name as the eyebrow, and the heading
          saying what the screen is doing rather than what it is called. */}
      <header
        data-ground="ink"
        className="flex flex-col gap-2 bg-ground p-5 text-ink"
      >
        <Mono step="xs" className="text-muted">
          The Call
        </Mono>
        <h1 className="m-0 font-display text-display">Learning your body.</h1>
      </header>

      <Countdown ladder={ladder} />

      {ladder.bands.length === 0 ? undefined : <Coverage ladder={ladder} />}

      {isCalling ? undefined : <LogThisNext band={ladder.thinnestBand} />}

      {/* "No button" once the threshold is met: there is nowhere for it
          to go in v1. Before that, the one thing that moves the meter. */}
      {isCalling ? undefined : (
        <Link
          to="/runs/new"
          className="target grid min-h-13 place-items-center rounded-card bg-action px-6 py-4 font-display text-body uppercase text-accent-ink no-underline"
        >
          Log a run
        </Link>
      )}
    </div>
  );
}

/**
 * One cell per verdict the Call needs, in order.
 */
const CELLS = Array.from(
  { length: CALL_VERDICT_THRESHOLD },
  (_, index) => index,
);

/**
 * K's hi-viz block — one of *"two yellow moments only"* — as round 26 #15
 * redraws it ("K Call teaser 15", which supersedes round 22's K): the
 * count in the kicker, the one instruction, a meter of fifteen cells, and
 * the line for where the runner is.
 *
 * **Cells, not a bar**: *"each cell is one verdict you did."*
 */
function Countdown({ ladder }: Readonly<{ ladder: Ladder }>): JSX.Element {
  const logged = CALL_VERDICT_THRESHOLD - ladder.verdictsUntilCall;
  const counted = `${String(logged)} of ${String(CALL_VERDICT_THRESHOLD)} verdicts`;

  return (
    <section
      data-part="countdown"
      className="flex flex-col gap-3 rounded-card bg-hi-viz p-5 text-accent-ink"
    >
      <Mono step="xs">{`The Call · ${counted}`}</Mono>
      <p className="m-0 font-display text-title">
        {ladder.verdictsUntilCall === 0
          ? "That’s enough to call."
          : `Log ${String(CALL_VERDICT_THRESHOLD)} verdicts and the Call starts.`}
      </p>
      <div
        role="img"
        aria-label={`${counted} logged`}
        className="grid grid-cols-15 gap-1"
      >
        {CELLS.map((cell) => (
          <span
            key={cell}
            data-part="meter-cell"
            data-state={cell < logged ? "logged" : undefined}
            className={
              cell < logged
                ? "h-4 rounded-none border border-accent-ink bg-accent-ink"
                : "h-4 rounded-none border border-accent-ink"
            }
          />
        ))}
      </div>
      <p className="m-0 text-body">{countdownLine(ladder)}</p>
    </section>
  );
}

/**
 * The line under the meter, for where the runner is: none yet, some, or
 * enough.
 */
function countdownLine(ladder: Ladder): string {
  if (ladder.verdictsUntilCall === 0) {
    return "The Call arrives in the next release.";
  }
  if (ladder.verdictTotal === 0) return "Your first verdict is one run away.";
  return `${String(ladder.verdictsUntilCall)} to go. Each one teaches it what you run warm or cold in.`;
}

/**
 * "Your coverage" — every band in the runner's range, gaps included,
 * with the words beside each swatch and a legend of how many sit at each
 * level.
 */
function Coverage({ ladder }: Readonly<{ ladder: Ladder }>): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <Mono step="xs" className="text-muted">
          Your coverage
        </Mono>
        <Bracketed className="text-muted">
          {`${String(ladder.verdictTotal)} verdicts`}
        </Bracketed>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {ladder.bands.map(({ band, coverage }) => (
          <li
            key={band.bandFloorC}
            className="flex items-center justify-between gap-3 text-body"
          >
            <Bracketed className="w-24 shrink-0 text-muted">
              {band.label}
            </Bracketed>
            <CoverageMark level={coverage} />
            <Mono className="text-muted">{coverage}</Mono>
            <Mono className="text-muted">
              {String(band.cold + band.dialed + band.warm)}
            </Mono>
          </li>
        ))}
      </ul>
      <CoverageLegend levels={ladder.bands.map((row) => row.coverage)} />
    </section>
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
    <ul className="m-0 flex list-none flex-wrap gap-4 border-t border-hairline p-0 pt-3">
      {order.map((level) => (
        <li key={level} className="flex items-center gap-2">
          <CoverageMark level={level} />
          <Mono className="text-muted">
            {level} {levels.filter((row) => row === level).length}
          </Mono>
        </li>
      ))}
    </ul>
  );
}

/**
 * K's ink card — the other yellow moment, its eyebrow — naming the band
 * worth logging next. Absent when there is no history to reason from.
 *
 * Exported so "no thinnest band" is a state a test can render: inside the
 * ladder it can only be reached with no bands at all.
 */
export function LogThisNext({
  band,
}: Readonly<{ band: Ladder["thinnestBand"] }>): JSX.Element | undefined {
  if (band === undefined) return undefined;
  return (
    <section
      data-ground="ink"
      className="flex flex-col gap-2 rounded-card bg-ground p-5 text-ink"
    >
      <Mono step="xs" className="text-hiviz-text">
        Log this next
      </Mono>
      {/* A band is a measured range, so mono and bracketed — at `lg`, the
          ramp's display step, where K sets it large. */}
      <Bracketed step="lg">{band.label}</Bracketed>
    </section>
  );
}
