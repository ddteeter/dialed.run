import type { JSX, ReactNode, Ref, UIEventHandler } from "react";

/**
 * A row that scrolls, as a labelled region a keyboard can reach.
 *
 * A scroller with nothing focusable in it is out of a keyboard's reach,
 * and axe says so (scrollable-region-focusable). It takes focus itself,
 * named for what it holds ("Photos"), so Tab lands on it, a screen
 * reader hears the region, and the arrow keys or a three-finger swipe
 * scroll it (owner, 2026-11-14, #659). `region` is the one role besides
 * `tabpanel` that `jsx-a11y-x/no-noninteractive-tabindex` lets take focus
 * in `eslint.config.js`, for this.
 *
 * What it scrolls stays itself: a list goes inside as a list. The ring
 * is the contract's 2px ink outline, drawn inside the edge, since a
 * scroller sits in panels that clip what overflows them.
 *
 * R57 (D-189 drawn): it pads 4 on every side and pulls back 4 by margin,
 * so what it holds doesn't move and the ring draws inside its clip, at
 * RADIUS.card, clear of the photos. The snap edge takes the same 4, so a
 * snapped photo lands where it sat at rest. Its name says what it holds
 * and how many ("Photos, 4"), which the owner passes as `label`.
 *
 * It takes focus, so it is a target, and a target is 44 (Accessibility
 * Contract 03): never shorter than that, whatever it holds, even a
 * photo that hasn't loaded yet.
 */
export function ScrollRegion({
  label,
  part,
  className,
  onScroll,
  ref,
  children,
}: Readonly<{
  /**
  The region's name, what a screen reader hears on it: what it holds, and
  how many ("Photos, 4").
  */
  label: string;
  /**
  Its `data-part`, how its owner's tests and specs find it.
  */
  part: string;
  /**
  The owner's layout and scrolling: `overflow-x-auto`, snapping and size.
  */
  className: string;
  onScroll?: UIEventHandler<HTMLDivElement> | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
  children: ReactNode;
}>): JSX.Element {
  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      tabIndex={0}
      data-part={part}
      onScroll={onScroll}
      className={`${RING_CLASS} ${className}`}
    >
      {children}
    </div>
  );
}

/**
The focus ring, inside the region's edge.
*/
const RING_CLASS =
  "-m-1 min-h-11 scroll-p-1 rounded-card p-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink";
