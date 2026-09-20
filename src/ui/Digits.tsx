import { useEffect, useState } from "react";
import type { JSX } from "react";

import { DURATION } from "./motion";

/**
 * Which way the meter turned.
 */
type Roll = "up" | "down";

/**
 * Down only when the value went down.
 *
 * Total, and deliberately so: "did not move" answers `up` rather than
 * being a third case nobody renders. Same shape as `FlowStep`'s
 * `directionBetween` — the interesting half is the one that reverses, and
 * writing it that way is what makes the comparison observable rather than
 * a fact about a guard somewhere else.
 */
export function rollFrom(previous: number, next: number): Roll {
  return next < previous ? "down" : "up";
}

/**
 * The four class names, written out.
 *
 * Not built as `digit-in-${roll}`: Tailwind finds class names by scanning
 * source text, so a name that only exists once the template literal has
 * run is a name Tailwind never emits — and an unknown class is dropped in
 * silence, which here would mean a number that changes with no move at
 * all and a green suite to go with it.
 */
const ROLL_CLASS: Readonly<
  Record<Roll, { arriving: string; leaving: string }>
> = {
  up: { arriving: "digit-in-up", leaving: "digit-out-up" },
  down: { arriving: "digit-in-down", leaving: "digit-out-down" },
};

const SLOT = "digit-slot";

/**
 * A count that rolls when it changes (design/motion.js, "Numbers &
 * temps"): the old value leaves through one edge of its slot while the new
 * one arrives behind it. A count going down rolls the other way, because
 * a decrement that rolled up would read as the wrong number arriving.
 *
 * **Mono is the premise, not the decoration.** "Plex Mono is tabular, so a
 * roll reads as a meter changing, a fade reads as a bug" — a roll in a
 * proportional face is a jitter, because the slot resizes under it. This
 * renders a bare `<span>` and expects to sit inside a `Mono`, which is
 * where the family and the ramp step come from.
 *
 * The departing value is `aria-hidden`: for the ~140ms both are in the
 * document, only one of them is the count.
 */
export function Digits({
  value,
  className,
}: Readonly<{
  value: number;
  className?: string | undefined;
}>): JSX.Element {
  const [seen, setSeen] = useState(value);
  const [leaving, setLeaving] = useState<number | undefined>();

  // Derived during render rather than in an effect, so the arriving digit
  // carries its animation on the frame it first paints. An effect would
  // show the new number in place and roll it afterwards, which reads as
  // the value changing twice.
  if (seen !== value) {
    setSeen(value);
    setLeaving(seen);
  }

  // Dropped on a timer rather than on `animationend`.
  //
  // The event is the obvious hook and it is the wrong one: it never fires
  // where there is no animation to end — a browser honouring
  // `prefers-reduced-motion` with a 90ms swap still fires it, but a test
  // DOM, a print stylesheet, or a viewer whose browser dropped the class
  // does not, and the old value would then sit under the new one forever.
  // Law 5: the count is the primary thing, the roll is not.
  useEffect(() => {
    if (leaving === undefined) return;
    const timer = globalThis.setTimeout(() => {
      setLeaving(undefined);
    }, DURATION.quick);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [leaving]);

  // `?? value` rather than a resting pair of empty class names: a digit
  // that is not moving has no direction, and inventing one gave the
  // resting object a `leaving` field nothing ever read — a mutant with no
  // reader is a mutant no test can kill. Asked from where it is, a still
  // digit answers "up" and the answer is then thrown away below.
  const roll = ROLL_CLASS[rollFrom(leaving ?? value, value)];

  return (
    <span className={className === undefined ? SLOT : `${SLOT} ${className}`}>
      {leaving === undefined ? undefined : (
        <span aria-hidden="true" className={`digit-leaving ${roll.leaving}`}>
          {String(leaving)}
        </span>
      )}
      {/* Keyed by the value so a second change restarts the animation:
          re-applying a class name a node already carries does not. */}
      <span
        key={String(value)}
        className={leaving === undefined ? "" : roll.arriving}
      >
        {String(value)}
      </span>
    </span>
  );
}
