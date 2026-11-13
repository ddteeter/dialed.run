import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";

import { Layout } from "../../../ui";
import { SignedOutFrame } from "../../../ui/SignedOutFrame";

/**
 * `/` — the landing page (Round 55 · 175).
 *
 * Signed out it wears the one signed-out frame (176), whose bar already
 * holds Log in and, from 720 up, Request access. Signed in it wears the
 * product's own shell, whose bar holds Log a run, and the hero never
 * repeats it: it ends on "Go to your feed".
 *
 * **The hero** sits on MEASURE.page's left edge, 96 under the bar at the
 * desk. The headline breaks by sentence: "LOG IT." always starts its own
 * line, and the first sentence balances over its lines. The right half
 * is the image slot, still open under #523, so nothing is drawn there.
 * No other sections until the owner gives copy (151b is #523).
 */
export function Landing({
  signedIn,
}: Readonly<{ signedIn: boolean }>): JSX.Element {
  return signedIn ? (
    <Layout>
      {/* In the product's measure, on its screens' own gutter. */}
      <div className="px-6">
        <Hero>
          <Link to="/feed" className={GO_TO_FEED_CLASS}>
            Go to your feed
          </Link>
        </Hero>
      </div>
    </Layout>
  ) : (
    <SignedOutFrame>
      {/* The bar's own structure — gutters outside, the measure inside —
          so the hero's edge is the wordmark's at every width (#625 A-09). */}
      <main className="flex-1 px-5 wide:px-6">
        <div className="mx-auto w-full max-w-page">
          <Hero>
            <SignedOutAsk />
          </Hero>
        </div>
      </main>
    </SignedOutFrame>
  );
}

/**
 * The hero, in the page's first track: the 7 of a 7/5 split at the desk,
 * whose 5 is the image slot (#523).
 */
function Hero({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <div
      data-part="hero"
      className="pt-12 pb-16 desk:grid desk:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] desk:gap-12 desk:pt-24"
    >
      <div className="flex flex-col items-start gap-5 wide:gap-6">
        <h1 className="m-0 font-display text-display uppercase">
          {/* By sentence: the first balances over its lines, and "Log
              it." always starts its own. One heading, read as one line. */}
          <span className="block text-balance">Every run has an outfit.</span>{" "}
          <span className="block">Log it.</span>
        </h1>
        <p className="m-0 max-w-panel text-lead text-quiet">
          A virtual wardrobe for runners: what you wore, on which run, in which
          weather.
        </p>
        {children}
      </div>
    </div>
  );
}

/**
 * Signed in, the way on is the ink pill: the bar's pink Log a run is the
 * product's verb, and this is not a second one.
 */
const GO_TO_FEED_CLASS =
  "target inline-flex items-center rounded-pill bg-ink px-5 font-bold text-ground no-underline";

/**
 * The phone's pink pill: below 720 the bar holds only Log in, so Request
 * access moves into the hero, and shows once per view.
 */
const REQUEST_ACCESS_CLASS =
  "target inline-flex items-center justify-center self-stretch rounded-pill bg-action px-5 font-bold text-accent-ink no-underline wide:hidden";

/**
 * Request access on the phone (from 720 up the bar holds it), then the
 * cross-link for someone with a code (176: quiet text, a bold ink
 * underlined link).
 */
function SignedOutAsk(): JSX.Element {
  return (
    <>
      <Link to="/account/request-access" className={REQUEST_ACCESS_CLASS}>
        Request access
      </Link>
      <p data-part="cross-link" className="m-0 text-body text-quiet">
        Have a code?{" "}
        <Link
          data-target="inline"
          to="/join"
          className="font-bold text-ink underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}
