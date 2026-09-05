import type { ReactNode } from "react";

import { Mono } from "./Mono";

/**
 * Bracket notation for bounded, measured values: [38–46°], [8 OF 9],
 * [UNTESTED]. Never a garment name, username, or prose. Brackets inherit
 * the surrounding text color; they are pink only when the wordmark is the
 * subject — use Wordmark for that, never this.
 */
export function Bracketed({
  children,
  className,
}: Readonly<{
  children: ReactNode;
  className?: string | undefined;
}>) {
  return (
    <Mono className={className}>
      {"["}
      {children}
      {"]"}
    </Mono>
  );
}
