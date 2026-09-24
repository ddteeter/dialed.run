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
 * K's two ends, which round 22 answered: *"Zero: K as drawn, meter at 0 …
 * 'Log five verdicts and the Call starts.' Threshold met in v1: K stays,
 * meter full, 'That's enough to call. The Call arrives in the next
 * release.' No button — there's no B1 to hand off to."*
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
 * K's hi-viz block — one of *"two yellow moments only"* — with the
 * countdown, the meter and the sentence for where the runner is.
 */
function Countdown({ ladder }: Readonly<{ ladder: Ladder }>): JSX.Element {
  const logged = CALL_VERDICT_THRESHOLD - ladder.verdictsUntilCall;
  const remaining = ladder.verdictsUntilCall;

  return (
    <section
      data-part="countdown"
      className="flex flex-col gap-3 rounded-card bg-hi-viz p-5 text-accent-ink"
    >
      <Mono step="xs">Until your first call</Mono>
      <p className="m-0 flex items-baseline gap-2">
        <span className="font-display text-display">{remaining}</span>
        <span className="text-lead font-bold">
          {remaining === 1 ? "verdict" : "verdicts"}
        </span>
      </p>
      <div
        role="meter"
        aria-label="Verdicts toward your first call"
        aria-valuemin={0}
        aria-valuemax={CALL_VERDICT_THRESHOLD}
        aria-valuenow={logged}
        className="h-2 overflow-hidden rounded-pill border border-accent-ink"
      >
        <div
          data-part="meter-fill"
          className="h-full bg-accent-ink"
          style={{
            width: `${String((logged / CALL_VERDICT_THRESHOLD) * 100)}%`,
          }}
        />
      </div>
      <Bracketed>{`${String(logged)} of ${String(CALL_VERDICT_THRESHOLD)}`}</Bracketed>
      <CountdownLine ladder={ladder} />
    </section>
  );
}

/**
 * Round 22's two sentences, at the two ends of the meter. Between them the
 * number says it, and a third sentence would only repeat it.
 */
function CountdownLine({
  ladder,
}: Readonly<{ ladder: Ladder }>): JSX.Element | undefined {
  if (ladder.verdictsUntilCall === 0) {
    return (
      <p className="m-0 text-body">
        That&rsquo;s enough to call. The Call arrives in the next release.
      </p>
    );
  }
  if (ladder.verdictTotal === 0) {
    return (
      <p className="m-0 text-body">
        Log {CALL_VERDICT_THRESHOLD} verdicts and the Call starts.
      </p>
    );
  }
  return undefined;
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
