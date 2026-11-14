import type { RefObject } from "react";
import { useEffect, useState } from "react";

/**
 * The phone's track count, and the count every render starts from: the
 * phone grid is two columns at every count (Round 55 · 188), and the
 * server has no width to measure.
 */
export const PHONE_TRACKS = 2;

/**
 * How many tracks a grid lays out, from its computed
 * `grid-template-columns`. A laid-out grid resolves `auto-fill` to one
 * length per track ("190px 190px 190px"), so the count is the words. A
 * grid that has not been laid out reports nothing, and keeps the phone's.
 */
export function trackCount(template: string): number {
  const tracks = template.split(" ").filter((track) => track !== "").length;
  return tracks === 0 ? PHONE_TRACKS : tracks;
}

/**
 * Round 55 · 187: Add follows the last tile when its row has room, and
 * when the count fills the last row it becomes one 56-tall row across the
 * grid. An empty closet fills its (no) rows, so Add stands alone.
 */
export function isRowFull(count: number, tracks: number): boolean {
  return count % tracks === 0;
}

/**
 * Whether the grid's last row is full, measured from the grid itself and
 * again whenever its width changes. `auto-fill` decides the track count
 * from the width, so CSS alone cannot say where the last row ends.
 *
 * The effect has no dependency list on purpose, as `useRunnerZone`'s has
 * none: the ref is the same object on every render, so a list holding it
 * changes nothing a test could see, and with no list there is no array
 * for a mutant to replace. Measuring again after a render sets the same
 * count, which React ignores.
 */
export function useIsRowFull(
  listRef: RefObject<HTMLUListElement | null>,
  count: number,
): boolean {
  const [tracks, setTracks] = useState(PHONE_TRACKS);
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const measure = () => {
      setTracks(trackCount(getComputedStyle(list).gridTemplateColumns));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  });
  return isRowFull(count, tracks);
}
