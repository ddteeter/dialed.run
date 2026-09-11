import type { JSX } from "react";

import { Bracketed, Mono } from "../../../ui";
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
 * **Coverage is a text label, not a colour, and that is on purpose.** O6
 * says pink/teal/grey mean covered/partial/unknown; the shipped profile
 * already uses the same three for cold/dialed/warm verdicts. Until design
 * resolves which meaning wins (design-deltas item 6), bracket notation
 * carries it — CLAUDE.md's undesigned-surface protocol says a text label
 * in the existing system is always the correct placeholder, and it avoids
 * teaching a colour a second meaning that may have to be untaught.
 */
export function CallLadder({ ladder }: Readonly<{ ladder: Ladder }>): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <LadderHeadline ladder={ladder} />
      {ladder.bands.length === 0 ? undefined : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {ladder.bands.map(({ band, coverage }) => (
            <li
              key={band.bandFloorC}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <Bracketed className="w-24 shrink-0 text-night/40">
                {band.label}
              </Bracketed>
              <Bracketed className="text-xs text-night/50">{coverage}</Bracketed>
              <Mono className="text-xs text-night/40">
                {String(band.cold + band.dialed + band.warm)}
              </Mono>
            </li>
          ))}
        </ul>
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
  // Equivalent mutant, and unreachable rather than merely untested:
  // this branch is only reached when `verdictTotal > 0`, which means at
  // least one band, which means `ladderFrom` found a thinnest one. The
  // guard narrows the type for the compiler and nothing else.
  //
  // Hoisted to a statement because a `next-line` directive does not attach
  // inside a JSX expression.
  // Stryker disable next-line ConditionalExpression
  const ask = ladder.thinnestBand === undefined ? undefined : (
    <p className="m-0 text-sm text-night/60">
      Thinnest so far:{" "}
      <Bracketed className="text-night/50">{ladder.thinnestBand.label}</Bracketed>
    </p>
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-base">
        <Mono>{String(ladder.verdictsUntilCall)}</Mono> verdicts until your
        first call.
      </p>
      {ask}
    </div>
  );
}
