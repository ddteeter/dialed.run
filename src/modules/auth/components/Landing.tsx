import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { SignedOutLayout, Wordmark } from "../../../ui";

/**
 * `/` — the landing page, as round 21's item 23 draws its bar.
 *
 * *"From 720 up, a wordmark and one action — 'Log in' (hairline) signed
 * out, 'Your closet' (ink) signed in — and the hero drops its own
 * wordmark. Below 720, no bar. No nav, search, bell or 'Log a run'; pink
 * stays off it."* The bar is `SignedOutLayout`'s; this is the hero.
 *
 * **The hero keeps the primary ask** — that is why the bar's Log in is
 * only hairline. Round 50 · 151a: signed out, the ask is "Request access"
 * (public stays invite-only, D-173, so asking is the way in), then "Have
 * an account? Log in". Signed in it is "Your closet", which below 720,
 * where there is no bar, the hero carries for the bar. No other sections
 * until the owner gives copy (151b is #523).
 */
export function Landing({
  signedIn,
}: Readonly<{ signedIn: boolean }>): JSX.Element {
  return (
    <SignedOutLayout action={signedIn ? "closet" : "log-in"}>
      <main className="mx-auto flex w-full max-w-column flex-col items-start gap-6 px-6 pt-16 wide:mx-0">
        {/* "The bar's wordmark is the only one": from 720 up this one goes. */}
        <span className="wide:hidden">
          <Wordmark brackets={false} className="text-title" />
        </span>
        <h1 className="m-0 font-display text-display uppercase">
          Every run has an outfit. Log it.
        </h1>
        <p className="m-0 max-w-panel text-body text-quiet">
          A virtual wardrobe for runners: what you wore, on which run, in which
          weather.
        </p>
        {signedIn ? <SignedInAsk /> : <SignedOutAsk />}
      </main>
    </SignedOutLayout>
  );
}

/**
 * The ink pill, never pink: *"--action belongs to the product's own
 * verbs"*, and joining is not one of them.
 */
const PRIMARY_ASK_CLASS =
  "target inline-flex items-center rounded-pill bg-ink px-5 font-bold text-ground no-underline";

/**
 * Request access, then Log in for someone who already has an account.
 *
 * Design 154 (#528) part 3, a guess: the Log in line shows at every width,
 * though the bar repeats Log in from 720 up, because 151a lists it as the
 * hero's second line.
 */
function SignedOutAsk(): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-4">
      <Link to="/account/request-access" className={PRIMARY_ASK_CLASS}>
        Request access
      </Link>
      <p className="m-0 text-body text-quiet">
        Have an account?{" "}
        <Link
          data-target="inline"
          to="/auth/login"
          className="font-bold text-ink underline underline-offset-4"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}

/**
 * The bar's "Your closet", for the phone that has no bar.
 */
function SignedInAsk(): JSX.Element {
  return (
    <Link to="/closet" className={`${PRIMARY_ASK_CLASS} wide:hidden`}>
      Your closet
    </Link>
  );
}
