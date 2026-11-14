import { useCallback, useState, type JSX, type ReactNode } from "react";

import { Mono } from "../../../ui";

/**
 * Where a posted photo sits, and what it shows while it loads or when it
 * does not (R55·206, 207).
 *
 * - **Loading**: the slot is `--photo` at the photo's ratio, so the card
 *   keeps its height and nothing jumps.
 * - **Failed**: it stays `--photo`, takes the system's one hatch
 *   (`.photo-hatch`) and MONO.xs "Photo didn't load" at the bottom left.
 *   The `img` is hidden, so there is no browser icon or outline, and
 *   `overlay` (the `1 / N` counter) hides with it.
 *
 * Ratios are 207's: 4:5 on the card and D, square on the public tile.
 *
 * **A photo can fail before React is listening.** The server sends the
 * `img`, the browser fetches it at once, and an error that lands before
 * hydration fires no `onError`. So on mount, an element that has already
 * finished with nothing to show is asked again: setting `src` re-runs the
 * fetch, and its `error` now reaches the handler. A photo that loaded has
 * a width and is left alone.
 */
export type PhotoShape = "portrait" | "square";

// Whole strings, so the unknown-class lint and Tailwind both see them.
const SHAPE_CLASS: Readonly<Record<PhotoShape, string>> = {
  portrait: "aspect-4/5",
  square: "aspect-square",
};

export function PhotoSlot({
  src,
  shape,
  overlay,
  children,
  className = "",
}: Readonly<{
  src: string;
  shape: PhotoShape;
  /**
   * Drawn on the photo, and hidden while it has failed: the counter.
   */
  overlay?: ReactNode;
  /**
   * Drawn on the photo whether or not it loaded: the owner's delete.
   */
  children?: ReactNode;
  className?: string;
}>): JSX.Element {
  const [isFailed, setFailed] = useState(false);
  // Once per element and source, not per render: asking again re-runs
  // the fetch.
  const askAgainIfFailedEarly = useCallback(
    (img: HTMLImageElement | null): void => {
      // `complete` with no width: the fetch ended before hydration, badly
      // (or, in a test DOM, never ran). Ask again, now that we listen.
      if (img === null || !img.complete || img.naturalWidth !== 0) return;
      img.setAttribute("src", src);
    },
    [src],
  );

  return (
    <span
      data-part="photo-slot"
      data-state={isFailed ? "failed" : "shown"}
      className={`relative block overflow-hidden rounded-card ${SHAPE_CLASS[shape]} ${
        isFailed ? "photo-hatch" : "bg-photo"
      } ${className}`}
    >
      <img
        ref={askAgainIfFailedEarly}
        src={src}
        alt=""
        hidden={isFailed}
        onError={() => {
          setFailed(true);
        }}
        className="size-full object-cover"
      />
      {isFailed ? (
        <span className="absolute bottom-3 left-3 text-muted">
          <Mono step="xs">Photo didn&apos;t load</Mono>
        </span>
      ) : (
        overlay
      )}
      {children}
    </span>
  );
}

/**
 * A photo's place among several, bottom right in ink on a `--ground`
 * chip: the same on the card, D and the public tile (R55·207). Absent for
 * a lone photo (round 35 #53c).
 */
export function PhotoCounter({
  index,
  count,
}: Readonly<{ index: number; count: number }>): JSX.Element | undefined {
  if (count < 2) return;
  return (
    <span
      data-part="photo-counter"
      className="absolute right-3 bottom-3 rounded-pill bg-ground px-2 py-1 text-ink"
    >
      <Mono step="xs">
        {String(index + 1)} / {String(count)}
      </Mono>
    </span>
  );
}
