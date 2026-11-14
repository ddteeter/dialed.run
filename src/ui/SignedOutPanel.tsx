import type { JSX, ReactNode } from "react";

import { SignedOutLayout } from "./Layout";
import { Mono } from "./Mono";

/**
 * A signed-out receipt (Au5's, and `/takedown`'s): the receipt takes the
 * panel's title (R55·181). A teal (`--dialed-text`) MONO.xs kicker, then
 * the receipt's title as the TYPE.display line in place of the form's,
 * then the words of what happens next. One headline, in one face.
 */
export function SignedOutReceipt({
  kicker,
  title,
  children,
}: Readonly<{
  kicker: string;
  title: string;
  children: ReactNode;
}>): JSX.Element {
  return (
    <SignedOutPanel
      heading={title}
      notice={
        <Mono step="xs" className="text-dialed-text">
          {kicker}
        </Mono>
      }
    >
      <div data-part="receipt" className="flex flex-col gap-5">
        {children}
      </div>
    </SignedOutPanel>
  );
}

/**
 * The signed-out panel: the Auth board's frame (round 22), which the
 * account pages an email link opens wear too — round 26's "LINK LANDINGS
 * · SIGNED-OUT SHELL", Au4 and Au5.
 *
 * *"A 390 column on paper, top-aligned under the bar and never vertically
 * centred — centring jumps when a band appears"* (Au2 1040). The one
 * signed-out frame's bar (R55·176) carries the wordmark at every width, so
 * the panel has none of its own: *"so there is one."*
 *
 * The regions carry the board's `data-part` names — panel and
 * header — so a conformance spec compares region to region.
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
    <SignedOutLayout>
      <main
        data-part="panel"
        className="mx-auto flex w-full max-w-panel flex-col gap-7 px-6 pt-12 pb-12 wide:pt-14"
      >
        <div data-part="header" className="flex flex-col gap-5">
          {notice}
          <h1 className="m-0 font-display text-display uppercase">{heading}</h1>
        </div>
        {children}
      </main>
    </SignedOutLayout>
  );
}
