import type { JSX, ReactNode } from "react";

import { Mono } from "./Mono";

/**
 * DS1's two columns for a step of the log flow at the desk (design round
 * 25, "Log a run is a desk page"): every input and the primary action in
 * the primary column — max 620, phone order — and read-only context cards
 * in `data-part="rail"` beside it.
 *
 * **The rail is the desk's alone.** Below 1040 it is not drawn: *"the
 * rail's history cards don't show here: the phone never had them."* And it
 * never holds an input, a button or a radio — which the conformance
 * harness checks, so a card that grows a control fails there rather than
 * in review.
 *
 * In `ui/` because two modules draw log steps (runs' A1, feed's A2 and
 * A3) and neither may reach into the other.
 */
export function DeskSplit({
  rail,
  children,
}: Readonly<{ rail: ReactNode; children: ReactNode }>): JSX.Element {
  return (
    <div className="mx-auto flex w-full flex-col wide:mx-0 desk:grid desk:max-w-page desk:grid-cols-[minmax(0,var(--container-column))_minmax(0,1fr)] desk:items-start desk:gap-x-6">
      {children}
      <div
        data-part="rail"
        className="hidden desk:flex desk:flex-col desk:gap-3 desk:py-6"
      >
        {rail}
      </div>
    </div>
  );
}

/**
 * One read-only card in the rail: a mono title and what it holds.
 */
export function RailCard({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>): JSX.Element {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-hairline p-4">
      <h2 className="m-0">
        <Mono step="xs" className="text-label">
          {title}
        </Mono>
      </h2>
      {children}
    </section>
  );
}
