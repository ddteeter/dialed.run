import type { JSX, ReactNode } from "react";

import { Wordmark } from "./Wordmark";

/**
 * The shell an onboarding step wears (round 49, R49·138a).
 *
 * Below 1040 it adds nothing: the steps have always been the page, with no
 * bar, and "below 1040 nothing changes". From 1040 up the step sits in the
 * page measure under a bar that shows **only the wordmark** — no tabs and
 * no You, "since there's still nowhere to go". So the wordmark is not a
 * link either: a way out of a flow with nowhere to go would be the one
 * thing on the bar.
 *
 * It owns the page's one `<main>`, which each step route used to write
 * out itself (plan 161's `region`).
 */
export function OnboardingShell({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-ground text-ink">
      <header
        data-part="top-bar"
        className="hidden border-b border-hairline px-6 py-4 desk:block"
      >
        <div className="mx-auto flex min-h-11 w-full max-w-page items-center">
          <Wordmark className="text-title" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-page flex-1">{children}</main>
    </div>
  );
}
