import { useEffect, useRef, type JSX } from "react";

import { Icon } from "./icons";

/**
 * A photo pager's two arrows and its arrow keys, written once for D's
 * pager (R55·207) and the full-photo view (Design 249.1). Each caller owns
 * its index and what turning the page does (D scrolls its snap row; the
 * viewer swaps the photo).
 *
 * Two 44 round `--ground` buttons with a hairline, inside the left and
 * right edges of a `relative` parent and centred on its height. Each is
 * absent at its end. Below `from` they are hidden: the phone swipes.
 *
 * **Focus never drops to the page.** The button a runner is pressing is
 * the one that disappears at its end, so when it goes, focus moves to the
 * other one.
 */
export interface PagerArrowsProps {
  index: number;
  count: number;
  onIndex: (next: number) => void;
  /**
   * The breakpoint the arrows show from: `wide` (720) for the viewer,
   * `desk` (1040) for D.
   */
  from: "wide" | "desk";
  /**
   * The buttons' names, the caller's words ("Previous photo", "Next
   * photo"): what is being paged is the caller's to say.
   */
  labels: Readonly<{ previous: string; next: string }>;
}

// Whole strings, so the unknown-class lint and Tailwind both see them.
const SHOWN_FROM: Readonly<Record<PagerArrowsProps["from"], string>> = {
  wide: "hidden wide:flex",
  desk: "hidden desk:flex",
};

const ARROW_CLASS =
  "absolute top-1/2 size-11 -translate-y-1/2 items-center justify-center rounded-pill border border-hairline bg-ground text-ink";

/**
 * The index one step from `index` in `direction`, held inside the pages.
 */
function stepped(index: number, count: number, direction: -1 | 1): number {
  return Math.min(count - 1, Math.max(0, index + direction));
}

export function PagerArrows({
  index,
  count,
  onIndex,
  from,
  labels,
}: Readonly<PagerArrowsProps>): JSX.Element | undefined {
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // The button to focus once the turn has rendered: with two photos the
  // other one is not mounted until then.
  const focusAfterRef = useRef<"previous" | "next">(undefined);
  useEffect(() => {
    const side = focusAfterRef.current;
    focusAfterRef.current = undefined;
    if (side === "previous") previousRef.current?.focus();
    else if (side === "next") nextRef.current?.focus();
  }, [index]);
  if (count < 2) return;
  const isFirst = index === 0;
  const isLast = index === count - 1;

  function turn(direction: -1 | 1): void {
    const next = stepped(index, count, direction);
    onIndex(next);
    // The pressed button leaves at its end; hand focus across.
    if (direction === 1 && next === count - 1)
      focusAfterRef.current = "previous";
    else if (direction === -1 && next === 0) focusAfterRef.current = "next";
  }

  return (
    <>
      {isFirst ? undefined : (
        <button
          ref={previousRef}
          type="button"
          aria-label={labels.previous}
          data-part="pager-previous"
          className={`${ARROW_CLASS} left-3 ${SHOWN_FROM[from]}`}
          onClick={() => {
            turn(-1);
          }}
        >
          <Icon name="back" size={16} />
        </button>
      )}
      {isLast ? undefined : (
        <button
          ref={nextRef}
          type="button"
          aria-label={labels.next}
          data-part="pager-next"
          className={`${ARROW_CLASS} right-3 ${SHOWN_FROM[from]}`}
          onClick={() => {
            turn(1);
          }}
        >
          <Icon name="forward" size={16} />
        </button>
      )}
    </>
  );
}

/**
 * What `pagerKeys` reads of a key press: React's event and the DOM's both
 * carry it, so a caller can wire the keys as `onKeyDown` or, where the
 * element is not a widget of its own, as a native listener.
 */
export type PagerKey = Readonly<{ key: string; preventDefault: () => void }>;

/**
 * ← and → for the pager's container. The default is
 * stopped only when the page turns, so a key at an end still scrolls.
 */
export function pagerKeys(
  index: number,
  count: number,
  onIndex: (next: number) => void,
): (event: PagerKey) => void {
  return (event) => {
    const direction = DIRECTION_OF[event.key];
    if (direction === undefined) return;
    const next = stepped(index, count, direction);
    if (next === index) return;
    event.preventDefault();
    onIndex(next);
  };
}

const DIRECTION_OF: Readonly<Partial<Record<string, -1 | 1>>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};
