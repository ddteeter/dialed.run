import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { CALL_VERDICT_THRESHOLD } from "../../../lib/contracts";

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
  "Weather attaches itself from your GPS and the time — you never type it.",
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
 * rather than a data source. *"We read that a run happened. Nothing
 * else."* is the product rule stated to the person it applies to, and it
 * is exactly what the webhook does.
 */
export function NowGoRun(): JSX.Element {
  return (
    <div className="overflow-hidden rounded-3xl bg-hi-viz text-night">
      <div className="flex flex-col gap-3 px-5 pb-6 pt-4">
        <Steps />
        <h1 className="m-0 font-display text-4xl uppercase leading-[0.95] tracking-[-0.04em]">
          Now go run.
        </h1>
      </div>

      <div className="flex flex-col gap-5 bg-night px-5 py-6 text-chalk">
        <p className="m-0 text-[17px] leading-relaxed">
          Next time you finish a run, upload it and tell us what you wore.
          That&rsquo;s the whole loop.
        </p>

        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-hi-viz">
            What happens as you log
          </span>
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {PROMISES.map((promise, index) => (
              <li key={promise} className="flex items-start gap-3">
                <span className="pt-0.5 font-mono text-[11px] text-pink">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm leading-snug">{promise}</span>
              </li>
            ))}
          </ol>
        </div>

        <StravaOffer />

        <div className="flex flex-col gap-2.5">
          <Link
            to="/runs/new"
            className="rounded-full bg-pink px-4 py-4 text-center font-display text-base uppercase text-night"
          >
            I have a run to upload
          </Link>
          <Link
            to="/"
            className="rounded-full border border-chalk/30 px-4 py-3.5 text-center text-[15px] font-semibold text-chalk"
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
    <div aria-hidden="true" className="flex gap-1">
      {[0, 1, 2, 3].map((step) => (
        <div key={step} className="h-[3px] flex-1 bg-night" />
      ))}
    </div>
  );
}

/**
 * The optional Strava connect.
 *
 * The caption is the product rule as the user sees it — "Strava activity
 * data is never stored, displayed, or used; the webhook's only effect is a
 * notification row" — and saying it here is the point. An offer that
 * explained itself only in a privacy policy would be asking for an OAuth
 * grant on trust.
 */
function StravaOffer(): JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-chalk/15 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">Connect Strava</span>
          <span className="text-xs text-chalk/60">
            So we can remind you. Optional.
          </span>
        </div>
        <Link
          to="/runs/strava"
          className="shrink-0 rounded-full border border-chalk/30 px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.06em]"
        >
          Connect
        </Link>
      </div>
      <p className="m-0 text-xs leading-snug text-chalk/60">
        We read that a run happened. Nothing else.
      </p>
    </div>
  );
}
