import { Fragment } from "react";
import type { JSX, ReactNode } from "react";

import { Mono } from "../../../../ui";
import type { Line } from "../../evidence";
import { drawn, PART_MARK } from "../facts";

/**
 * A measured line of the Call, drawn one way and said another (D-150).
 *
 * Drawn as Round 62's 364.1 rules it: without the engine's slot brackets,
 * and wrapping only at its " · ", so each part between the marks holds
 * together on one line. `Spoken` takes one string and cannot hold the
 * parts, so the two halves are written out here the way it writes them:
 * the drawn half hidden from a screen reader, the said half for it alone,
 * in its own case so `Mono`'s capitals do not make a reader spell a word.
 *
 * It sets no type of its own: the caller wraps it in the `Mono` step the
 * board gives the line.
 */
export function DrawnLine({ line }: Readonly<{ line: Line }>): JSX.Element {
  const [first, ...rest] = drawn(line.shown);
  return (
    <>
      <span aria-hidden="true">
        <span className="whitespace-nowrap">{first}</span>
        {rest.map((part, index) => (
          <Fragment key={index}>
            {PART_MARK}
            <span className="whitespace-nowrap">{part}</span>
          </Fragment>
        ))}
      </span>
      <span className="sr-only normal-case">{line.said}</span>
    </>
  );
}

/**
 * The hour line over a Call ("TOMORROW · 6:10 AM · STEADY"), in MONO.xs at
 * the label's colour. The words are the route's: an hour needs a clock and
 * the runner's time zone, and the effort is not on the result, so the
 * screen takes the line as a node and draws nothing without one.
 */
export function WhenLine({
  when,
}: Readonly<{ when: ReactNode }>): JSX.Element | undefined {
  if (when === undefined) return undefined;
  return (
    <Mono step="xs" className="text-label">
      {when}
    </Mono>
  );
}
