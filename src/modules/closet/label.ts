/**
 * "1 run", "38 runs" — a piece's run count as the closet's sentences and
 * record lines say it (round 26's delete sheet, F's rail card).
 */
export function runsLabel(count: number): string {
  return count === 1 ? "1 run" : `${String(count)} runs`;
}
