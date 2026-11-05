import type { JSX } from "react";

/**
 * A measured value shown one way and said another: "8:20 /mi" on screen,
 * "8 minutes 20 seconds per mile" to a screen reader, which reads the
 * first as "eight twenty slash m i" (a11y judgment audit, 2026-11-04).
 *
 * Two spans rather than an `aria-label`: a label on a plain span is
 * ignored, and the value sits inside running text as often as not.
 *
 * The said half is `normal-case`, so a headline's capitals do not make a
 * screen reader spell "MI" or "MINUTES" out (RunHeader's unit, likewise).
 */
export function Spoken({
  shown,
  said,
}: Readonly<{ shown: string; said: string }>): JSX.Element {
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only normal-case">{said}</span>
    </>
  );
}
