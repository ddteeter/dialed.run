import type { JSX, ReactNode } from "react";

import { SignedOutLayout } from "./Layout";
import { Wordmark } from "./Wordmark";

/**
 * The signed-out panel: the Auth board's frame (round 22), which the
 * account pages an email link opens wear too — round 26's "LINK LANDINGS
 * · SIGNED-OUT SHELL", Au4 and Au5.
 *
 * *"A 390 column on paper, top-aligned under the bar and never vertically
 * centred — centring jumps when a band appears"* (Au2 1040). From 720 up
 * the bar's wordmark is the one: *"The panel drops its own wordmark, so
 * there is one."*
 *
 * The regions carry the board's `data-part` names — panel, header,
 * wordmark — so a conformance spec compares region to region.
 */
export function SignedOutPanel({
  heading,
  notice,
  children,
}: Readonly<{
  heading: string;
  /**
  What sits above the heading: Au7's notice, a landing's kicker.
  */
  notice?: ReactNode;
  children: ReactNode;
}>): JSX.Element {
  return (
    <SignedOutLayout action="none">
      <main
        data-part="panel"
        className="mx-auto flex w-full max-w-panel flex-col gap-7 px-6 pt-12 pb-12 wide:pt-14"
      >
        <div data-part="header" className="flex flex-col gap-5">
          <span data-part="wordmark" className="wide:hidden">
            <Wordmark brackets={false} className="text-title" />
          </span>
          {notice}
          <h1 className="m-0 font-display text-display uppercase">{heading}</h1>
        </div>
        {children}
      </main>
    </SignedOutLayout>
  );
}
