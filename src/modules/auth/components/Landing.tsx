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
 * only hairline — and below 720, where there is no bar, it carries the
 * bar's one action too, so a phone is never left without the way in.
 * The full landing brief is still open (D-93), so the hero is the copy
 * the page already had and nothing new.
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
 * Create account is the hero's own ask; Log in is the bar's, repeated
 * here only where there is no bar.
 */
function SignedOutAsk(): JSX.Element {
  return (
    <div className="flex items-center gap-4">
      <Link to="/auth/signup" className={PRIMARY_ASK_CLASS}>
        Create account
      </Link>
      <Link
        to="/auth/login"
        className="target inline-flex items-center font-semibold text-ink underline underline-offset-4 wide:hidden"
      >
        Log in
      </Link>
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
