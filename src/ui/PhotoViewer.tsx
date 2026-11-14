import { useEffect, useRef, useState } from "react";
import type { JSX, RefObject } from "react";

import { SECONDARY_PILL } from "./form";
import { Icon } from "./icons";
import { Mono } from "./Mono";
import { PagerArrows, pagerKeys } from "./PagerArrows";

/**
A photo the viewer shows: where it is served from, and its alt text.
*/
export interface ViewedPhoto {
  src: string;
  alt: string;
}

/**
 * The full photo (Round 56 · 249.1), opened from a thumbnail.
 *
 * **On a phone** it is the whole screen in the theme's ground: a 56 head
 * with "PHOTO 1 OF 2" and the ✕ in its 44, the photo at its own ratio on
 * `--tint`, and a row a thumb swipes between photos. **From 720** it is
 * the centred panel at MEASURE.column and RADIUS.sheet, on `--panel`
 * with its hairline and `--lift` (`ground-drawer`), over the scrim, with
 * 44 pager arrows and the ← → keys.
 *
 * It is a native `<dialog>` opened with `showModal()`, so Esc and a phone's
 * system back both reach it as the dialog's `cancel`. No history entry
 * of our own is needed. Every close reports through `onClose`. The host
 * mounts it only while it is open, and puts focus back on the thumbnail
 * that opened it.
 *
 * **Remove** (249.3) sits in the foot as the hairline pill, alone on its
 * surface (D-186), with no confirm: nothing is saved until the entry is.
 * It reports the photo shown through `onRemove`, and the host closes the
 * viewer and moves focus (`PhotoRow`).
 *
 * It does not animate: the Motion Doctrine's per-surface map has no
 * photo viewer, and its NEVER list rules out a photo flying from its
 * thumbnail.
 */
export function PhotoViewer({
  photos,
  openAt,
  onClose,
  onRemove,
}: Readonly<{
  photos: readonly ViewedPhoto[];
  /**
  The photo it opens on.
  */
  openAt: number;
  onClose: () => void;
  onRemove: (index: number) => void;
}>): JSX.Element {
  const dialogRef = useModal();
  const pager = usePager(photos.length, openAt);

  return (
    <dialog
      ref={dialogRef}
      aria-label={counterWords(pager.index, photos.length)}
      data-slot="photo-viewer"
      onClose={onClose}
      onKeyDown={pagerKeys(pager.index, photos.length, pager.go)}
      className={VIEWER_CLASS}
    >
      <div
        data-part="viewer-head"
        className="flex h-14 shrink-0 items-center justify-between px-5"
      >
        <Mono step="xs" className="text-muted">
          {counterWords(pager.index, photos.length)}
        </Mono>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            dialogRef.current?.close();
          }}
          className="target -mr-3 inline-flex w-11 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-ink"
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <ul
          ref={pager.rowRef}
          data-part="viewer-photos"
          onScroll={pager.onScroll}
          className="m-0 flex min-h-0 w-full list-none snap-x snap-mandatory overflow-x-auto p-0"
        >
          {photos.map((photo, index) => (
            <li
              key={photo.src}
              aria-hidden={index === pager.index ? undefined : true}
              className="flex w-full shrink-0 snap-start items-center justify-center bg-tint"
            >
              <img src={photo.src} alt={photo.alt} className={PHOTO_CLASS} />
            </li>
          ))}
        </ul>
        <PagerArrows
          index={pager.index}
          count={photos.length}
          onIndex={pager.go}
          from="wide"
          labels={ARROW_LABELS}
        />
      </div>
      <div data-part="viewer-foot" className="flex shrink-0 flex-col p-5">
        <button
          type="button"
          onClick={() => {
            onRemove(pager.index);
          }}
          className={`target ${SECONDARY_PILL}`}
        >
          Remove photo
        </button>
      </div>
    </dialog>
  );
}

/**
 * Full screen on a phone, then the centred panel from `wide`. A dialog's
 * own default caps on width and height are lifted below 720, so the phone
 * view is the whole screen. From 720 the panel is as tall as its photo,
 * up to the phone sheet's fold, `--sheet-cap` (R54·164.4). The panel is a
 * floating surface (Design 246c), so in dark its edge steps up to
 * `--hairline-2` (246b), and `--lift` is the theme's.
 */
const VIEWER_CLASS =
  "fixed inset-0 m-0 flex h-dvh max-h-none w-full max-w-none flex-col border-none bg-ground p-0 text-ink backdrop:bg-scrim/60 wide:m-auto wide:h-fit wide:max-h-[var(--sheet-cap)] wide:max-w-column wide:overflow-hidden wide:rounded-sheet wide:ground-drawer wide:dark:border-hairline-2";

/**
 * The photo at its own ratio. On a phone it fills what the head and foot
 * leave. At width, the panel is as tall as the photo, so the photo carries
 * the cap: `--sheet-cap` less the 56 head and the foot's 88.
 */
const PHOTO_CLASS =
  "max-h-full max-w-full object-contain wide:max-h-[calc(var(--sheet-cap)-9rem)]";

/**
The arrows' names, the owner's (2026-11-13, #659).
*/
const ARROW_LABELS = { previous: "Previous photo", next: "Next photo" };

/**
"Photo 1 of 2": the head's line and the dialog's name.
*/
function counterWords(index: number, count: number): string {
  return `Photo ${String(index + 1)} of ${String(count)}`;
}

/**
 * The dialog, opened modal on mount. The host mounts the viewer only
 * while it is open, so there is no `open` prop to follow.
 */
function useModal(): RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  return dialogRef;
}

/**
 * Which photo is shown, and the row that shows it.
 *
 * The index is the truth. An arrow or a key sets it and scrolls the row
 * to match, at once, since scroll-driven motion is on the NEVER list. A
 * swipe scrolls the row, and the row's position sets the index.
 */
function usePager(
  count: number,
  openAt: number,
): {
  index: number;
  rowRef: RefObject<HTMLUListElement | null>;
  go: (index: number) => void;
  onScroll: () => void;
} {
  const [index, setIndex] = useState(() => clamp(openAt, count));
  const rowRef = useRef<HTMLUListElement>(null);
  // The photo it opened on, held so the scroll below runs on open only:
  // from then on the row follows `go` and the thumb.
  const opened = useRef(index);

  useEffect(() => {
    scrollRow(rowRef.current, opened.current);
  }, []);

  return {
    index,
    rowRef,
    go(target) {
      const next = clamp(target, count);
      setIndex(next);
      scrollRow(rowRef.current, next);
    },
    onScroll() {
      const row = rowRef.current;
      if (row === null || row.clientWidth === 0) return;
      setIndex(clamp(Math.round(row.scrollLeft / row.clientWidth), count));
    },
  };
}

/**
The row scrolled to a photo, at once.
*/
function scrollRow(row: HTMLUListElement | null, index: number): void {
  if (row === null) return;
  row.scrollLeft = index * row.clientWidth;
}

/**
An index kept inside the row.
*/
function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), count - 1);
}
