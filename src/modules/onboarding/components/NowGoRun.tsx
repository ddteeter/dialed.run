import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { CALL_VERDICT_THRESHOLD } from "../../../lib/contracts";
import { focusOnMount, Mono, StravaConsent } from "../../../ui";

/**
 * What the loop does with what a runner logs — P3's numbered list.
 *
 * The third line is derived rather than typed. Design wrote it as
 * `"After " + threshold + " verdicts we start making the call for you."`,
 * with `threshold` the same constant the Call teaser counts down from — so
 * a sentence that restated 15 would be a second copy of a number the owner
 * is expected to move ("a threshold the owner may want to move", per
 * `CALL_VERDICT_THRESHOLD`'s own note), and moving it would leave this
 * screen promising the old one.
 */
const PROMISES: readonly string[] = [
  // Round 35 #46: qualified, as M1 step 01 was, because R2b lets a runner
  // set conditions when the archive has no record for the hour.
  "Weather comes with each run, fetched for when and where you ran.",
  "Each piece learns the range it actually works in, for you.",
  `After ${String(CALL_VERDICT_THRESHOLD)} verdicts we start making the call for you.`,
];

/**
 * Screen P3 — the close, replacing O4 and O5.
 *
 * Design's own note under the artboard says what it is for: *"No history
 * seeding, no first call — so the honest ending is an instruction plus a
 * promise, not a payoff."* Nothing here celebrates, because nothing has
 * happened yet.
 *
 * **Hi-viz, which is rationed.** `docs/product.md` keeps yellow for "the
 * app telling you something" and says sparingly in v1; this is one of the
 * two places design spends it, and it is spent on the instruction rather
 * than on any of the reassurance below it.
 *
 * The Strava offer is on this screen rather than earlier for the reason
 * its own caption gives — it is optional, and it is a reminder mechanism
 * rather than a data source.
 *
 * `shouldFocusOffer`: the runner is back from a refused Strava receipt's
 * Try again, which returns here when the trip started here (round 39,
 * #66), so focus lands on the offer's heading and the consent is the next
 * thing read.
 */
export function NowGoRun({
  shouldFocusOffer = false,
}: Readonly<{ shouldFocusOffer?: boolean | undefined }>): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      {/* The band is the screen's one emphasis (round 49, R49·138b): the
          full bar and the instruction, and nothing else is hi-viz. At
          desk it runs the full column; its bar keeps the measure. */}
      <div className="flex flex-col gap-3 bg-failure px-5 pb-6 pt-4 text-ink">
        <Steps />
        <h1 className="m-0 font-display text-display uppercase">Now go run.</h1>
      </div>

      {/* Light, on the page's own ground: "nothing in the light runner
          app sits on ink" (R49·138b). Ink is the dark theme's. */}
      <div className="flex flex-col gap-5 desk:max-w-column">
        <p className="m-0 text-lead">
          Next time you finish a run, upload it and tell us what you wore.
          That&rsquo;s the whole loop.
        </p>

        <div className="flex flex-col gap-3">
          <h2 className="m-0 text-muted">
            <Mono step="xs">What happens as you log</Mono>
          </h2>
          {/* Split by hairlines, as the board draws the promises. */}
          <ol className="m-0 flex list-none flex-col border-t border-hairline p-0">
            {PROMISES.map((promise, index) => (
              <li
                key={promise}
                className="flex items-start gap-3 border-b border-hairline py-3"
              >
                <Mono step="sm" className="pt-1 text-muted">
                  {String(index + 1).padStart(2, "0")}
                </Mono>
                <span className="text-body">{promise}</span>
              </li>
            ))}
          </ol>
        </div>

        <StravaOffer shouldFocus={shouldFocusOffer} />

        <div className="flex flex-col gap-3">
          <Link
            to="/runs/new"
            className="target flex items-center justify-center rounded-pill bg-action px-4 py-4 text-center font-display text-body uppercase text-accent-ink"
          >
            I have a run to upload
          </Link>
          <Link
            to="/"
            className="target flex items-center justify-center rounded-pill border border-hairline px-4 py-4 text-center text-body font-semibold text-ink"
          >
            Done for now
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Four filled segments: onboarding is over.
 *
 * `aria-hidden`, because it is the same fact the heading states and a
 * screen reader announcing "list, four items, blank" is noise. It is not a
 * `progressbar` either — a progress bar that is always complete reports
 * nothing.
 */
function Steps(): JSX.Element {
  return (
    <div aria-hidden="true" className="flex gap-1 desk:max-w-column">
      {[0, 1, 2, 3].map((step) => (
        <div key={step} className="h-1 flex-1 bg-ink" />
      ))}
    </div>
  );
}

/**
 * The optional Strava connect.
 *
 * The consent says what it reads and what it never does, in full, before
 * the button — saying it here is the point: an offer that explained itself
 * only in a privacy policy would be asking for an OAuth grant on trust.
 * Round 39 (#66) retired the shorter "We read that a run happened.
 * Nothing else." under it, *"because the consent now says it in full and
 * two versions can drift."*
 */
function StravaOffer({
  shouldFocus,
}: Readonly<{ shouldFocus: boolean }>): JSX.Element {
  return (
    // The `--panel` inset (R49·138b), now that the body is on the ground.
    <div className="flex flex-col gap-3 rounded-sheet bg-panel p-4">
      <div className="flex flex-col gap-1">
        <h2
          ref={shouldFocus ? focusOnMount : undefined}
          tabIndex={shouldFocus ? -1 : undefined}
          className="m-0 text-body font-semibold"
        >
          Connect Strava
        </h2>
        <span className="text-micro text-muted">
          So we can remind you. Optional.
        </span>
      </div>
      {/* Strava's own button in our pill's place, left-aligned (round 26,
          item 21; task 127, STR-7). */}
      <StravaConsent from="onboarding" />
    </div>
  );
}
