import type { ReactNode } from "react";

import { Mono, type MonoStep } from "./Mono";

/**
 * Bracket notation for bounded, measured values: [38–46°], [8 OF 9],
 * [UNTESTED]. Never a garment name, username, or prose. Brackets inherit
 * the surrounding text color; they are pink only when the wordmark is the
 * subject — use Wordmark for that, never this.
 *
 * The uppercase comes from `Mono`, in CSS, rather than being typed into
 * every call site. Pass "Indoor" and this renders [INDOOR]. That keeps the
 * accessible name in normal case, which is what a screen reader should
 * announce — several readers spell out short all-caps tokens letter by
 * letter, having no way to tell a shouted word from an initialism — while
 * the brand's uppercase display (docs/product.md §Brand) is unchanged
 * visually. Callers that pass SHOUTING strings get the same pixels and a
 * worse announcement, so don't.
 *
 * `step` reaches the mono ramp for the same reason `Mono` has it, with one
 * extra constraint: only `xs` and `sm` are uppercase, so a bracketed value
 * at `md` or `lg` renders the caller's own casing. That is right for the
 * data strip — `[38–46°]` at `lg` has no letters to shout — and wrong for
 * a word, which is why the default stays `sm`.
 */
export function Bracketed({
  step,
  children,
  className,
}: Readonly<{
  step?: MonoStep | undefined;
  children: ReactNode;
  className?: string | undefined;
}>) {
  return (
    <Mono step={step} className={className}>
      {"["}
      {children}
      {"]"}
    </Mono>
  );
}
