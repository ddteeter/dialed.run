import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { CALL_VERDICT_THRESHOLD } from "../../../lib/contracts";
import {
  Bracketed,
  CoverageMark,
  Mono,
  PhoneBell,
  Spoken,
  WeatherAttribution,
} from "../../../ui";
import type { CoverageLevel } from "../../../ui";
import { verdictsIn, type Ladder } from "../ladder";

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
 * is ink density, never a hue** (design round 6 §AB, R-48), and the words
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
      {/* K's ink header, the heading saying what the screen is doing
          rather than what it is called (#630 F-02). Full-bleed at the top
          of the phone screen; from `wide` the one top bar takes over and
          it drops to a plain title (Desktop Contract DS0 bend 4); on a
          dark page it is the panel (R50·143). No eyebrow: the countdown's
          kicker already says THE CALL, and once is enough. */}
      <header
        data-ground="ink-until-wide"
        className="-mx-6 -mt-8 flex items-start justify-between gap-3 bg-ground px-6 pb-6 pt-8 text-ink wide:mx-0 wide:mt-0 wide:p-0"
      >
        <h1 className="m-0 font-display text-display wide:text-title">
          Learning your body.
        </h1>
        {/* The row ends in the phone's bell, inverse on the ink with the
            rest of the block (Design 169.1). */}
        <PhoneBell />
      </header>

      <Countdown ladder={ladder} />

      {ladder.bands.length === 0 ? undefined : <Coverage ladder={ladder} />}

      {isCalling ? undefined : <LogThisNext band={ladder.thinnestBand} />}

      {/* R55·231: with all fifteen logged, the page ends on its sentence
          and a way to keep logging, after a hairline. */}
      {isCalling ? <LogAnother /> : undefined}

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
 * The meter's columns, one per cell — read from the threshold, so the grid
 * cannot disagree with `CELLS`. Inline because Tailwind only emits a class
 * it can find written out whole, and `grid-cols-${n}` is not one.
 */
const METER_COLUMNS = {
  gridTemplateColumns: `repeat(${String(CALL_VERDICT_THRESHOLD)}, minmax(0, 1fr))`,
};

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
  // R55·231: the card counts toward the threshold, and says so; the
  // coverage head below counts every verdict.
  const needed = `${String(logged)} of ${String(CALL_VERDICT_THRESHOLD)} needed`;

  return (
    <section
      data-part="countdown"
      className="flex flex-col gap-3 rounded-card bg-hi-viz p-5 text-accent-ink"
    >
      <Mono step="xs">{`The Call · ${needed}`}</Mono>
      <p className="m-0 font-display text-title">
        {ladder.verdictsUntilCall === 0
          ? "That’s enough to call."
          : `Log ${String(CALL_VERDICT_THRESHOLD)} verdicts and the Call starts.`}
      </p>
      <div
        role="img"
        aria-label={`${counted} logged`}
        className="grid gap-1"
        style={METER_COLUMNS}
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
 * "Your coverage" (R55·231): every band in the runner's range, gaps
 * included, as one strip of square cells over an axis of band floors,
 * each band's count under its floor, then a one-line legend of the
 * levels present. The head counts every verdict, which is not the
 * card's count toward the Call, and says so.
 *
 * The strip is drawn for the eye; a list says each band in words,
 * level and count, so the reading never depends on the swatch.
 */
function Coverage({ ladder }: Readonly<{ ladder: Ladder }>): JSX.Element {
  const columns = {
    gridTemplateColumns: `repeat(${String(ladder.bands.length)}, minmax(0, 1fr))`,
  };
  return (
    <section data-part="coverage" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 font-display text-heading">Your coverage</h2>
        <Mono step="xs" className="text-muted">
          {`${String(ladder.verdictTotal)} verdicts in all`}
        </Mono>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-1">
        <div
          data-part="coverage-strip"
          className="grid gap-0.5"
          style={columns}
        >
          {ladder.bands.map(({ band, coverage }) => (
            <CoverageMark key={band.bandFloorC} level={coverage} size="cell" />
          ))}
        </div>
        <div data-part="coverage-axis" className="grid gap-0.5" style={columns}>
          {ladder.bands.map(({ band }) => (
            <Mono
              key={band.bandFloorC}
              step="xs"
              className="flex flex-col items-center"
            >
              <span className="text-muted">{floorOf(band.label)}</span>
              <span>{String(verdictsIn(band))}</span>
            </Mono>
          ))}
        </div>
      </div>
      <ul className="sr-only">
        {ladder.bands.map(({ band, coverage }) => (
          <li key={band.bandFloorC}>
            {`${band.said}, ${coverage}, ${String(verdictsIn(band))} verdicts`}
          </li>
        ))}
      </ul>
      <CoverageLegend levels={ladder.bands.map((row) => row.coverage)} />
      {/* Feels-like bands, read from the provider's observations: data
          derived from Visual Crossing, credited beside it (D-144). Log
          this next names one of these bands, directly below. */}
      <WeatherAttribution />
    </section>
  );
}

/**
 * A band's floor, for the axis under its cell: "41–50°" is "41°". The
 * label is `bandLabel`'s, always the floor, an en dash and the top.
 */
function floorOf(label: string): string {
  return `${label.slice(0, label.indexOf("–"))}°`;
}

/**
 * How many bands sit at each level, on one line, and only the levels
 * present (R55·231: "UNKNOWN 0" goes).
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
  const present = order
    .map((level) => ({
      level,
      count: levels.filter((row) => row === level).length,
    }))
    .filter(({ count }) => count > 0);
  return (
    <ul className="m-0 flex list-none flex-wrap gap-4 p-0">
      {present.map(({ level, count }) => (
        <li key={level} className="flex items-center gap-1.5">
          <CoverageMark level={level} size="key" />
          <Mono step="xs">{`${level} ${String(count)}`}</Mono>
        </li>
      ))}
    </ul>
  );
}

/**
 * R55·231's last line once the Call is met: keep logging.
 */
function LogAnother(): JSX.Element {
  return (
    <div className="border-t border-hairline pt-4">
      <Link
        to="/runs/new"
        className="target inline-flex items-center text-body font-bold text-cold-text no-underline"
      >
        Log another run
      </Link>
    </div>
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
      <Bracketed step="lg">
        <Spoken shown={band.label} said={band.said} />
      </Bracketed>
    </section>
  );
}
