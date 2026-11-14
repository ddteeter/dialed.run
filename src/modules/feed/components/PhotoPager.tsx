import { useEffect, useRef, useState } from "react";

import { PagerArrows, pagerKeys } from "../../../ui";

import { PhotoCounter, PhotoSlot } from "./PhotoSlot";
import { DeletePhoto } from "./RetractEntry";
import type { DeletePhotoProps } from "./RetractEntry";

/**
 * The photos, one at a time: a scroll-snapping row a thumb swipes, each
 * photo at 4:5 with its own `1 / 2` bottom right from two photos, and its
 * delete top right when the viewer owns it. Absent with no photos.
 *
 * At desk (R55·207) the photo is capped at 560 tall and centred on
 * `--photo` in the column, and the shared `PagerArrows` sit inside its
 * edges; ← and → turn the page wherever focus is in the pager. The arrows
 * and the keys move the row, and the row's own scroll (a swipe, a
 * trackpad) moves the index back, so the two never disagree.
 *
 * D's, and `/k`'s since design 163 step 8, so its own file: `/k` must not
 * reach D's screen to draw it. `srcOf` is where a key is served: the
 * app's own photo route on D, and the public bucket's URL as it stands on
 * `/k`.
 */
const PAGER_LABELS = { previous: "Previous photo", next: "Next photo" };

/**
 * The row's item nearest its scroll position: the page being shown.
 */
function nearestPage(row: HTMLElement): number {
  const offsets = [...row.children].map((item) =>
    item instanceof HTMLElement ? item.offsetLeft : Infinity,
  );
  const distances = offsets.map((left) => Math.abs(left - row.scrollLeft));
  return distances.indexOf(Math.min(...distances));
}

export function PhotoPager({
  photoKeys,
  deletePhoto,
  srcOf = (key) => `/feed/photo/${key}`,
}: Readonly<{
  photoKeys: readonly string[];
  deletePhoto: DeletePhotoProps["deletePhoto"] | undefined;
  srcOf?: (key: string) => string;
}>) {
  const [index, setIndex] = useState(0);
  const rowRef = useRef<HTMLUListElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const count = photoKeys.length;

  function show(page: number): void {
    setIndex(page);
    const row = rowRef.current;
    const item = row?.children[page];
    // Instant, not smooth: the Motion Doctrine has no scroll motion.
    if (item instanceof HTMLElement) row?.scrollTo({ left: item.offsetLeft });
  }

  // ← and → wherever focus is inside the pager: on the arrows, or on an
  // owner's delete. A native listener, because the group is not a widget
  // of its own; its controls are the real buttons inside it.
  const onKey = pagerKeys(index, count, show);
  useEffect(() => {
    const group = groupRef.current;
    if (group === null) return;
    group.addEventListener("keydown", onKey);
    return () => {
      group.removeEventListener("keydown", onKey);
    };
  });

  if (count === 0) return;

  return (
    <div
      data-part="photo-pager"
      // A named group, so the photos and their arrows read as one thing.
      ref={groupRef}
      role="group"
      aria-label="Photos"
      className="relative"
    >
      <ul
        ref={rowRef}
        data-part="photo"
        onScroll={(event) => {
          setIndex(nearestPage(event.currentTarget));
        }}
        className="m-0 flex list-none snap-x snap-mandatory gap-2 overflow-x-auto p-0"
      >
        {photoKeys.map((key, page) => (
          <li
            key={key}
            className="w-full shrink-0 snap-start desk:flex desk:h-140 desk:justify-center desk:rounded-card desk:bg-photo"
          >
            <PhotoSlot
              src={srcOf(key)}
              shape="portrait"
              className="w-full desk:h-full desk:w-auto"
              overlay={<PhotoCounter index={page} count={count} />}
            >
              {deletePhoto === undefined ? undefined : (
                <DeletePhoto
                  photoKey={key}
                  index={page}
                  deletePhoto={deletePhoto}
                />
              )}
            </PhotoSlot>
          </li>
        ))}
      </ul>
      {/* Over the shown photo's own box (560 tall at 4:5, centred), so
          the arrows sit inside its edges; only the arrows take a press. */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 aspect-4/5 -translate-x-1/2 *:pointer-events-auto">
        <PagerArrows
          index={index}
          count={count}
          onIndex={show}
          from="desk"
          labels={PAGER_LABELS}
        />
      </div>
    </div>
  );
}
