/**
 * "1 run", "38 runs" — a piece's run count as the closet's sentences and
 * record lines say it (round 26's delete sheet, F's rail card), and as
 * A3's rail says a piece's record in the band. In `lib` because both the
 * closet and the feed say it, and neither may reach into the other.
 */
export function runsLabel(count: number): string {
  return count === 1 ? "1 run" : `${String(count)} runs`;
}
