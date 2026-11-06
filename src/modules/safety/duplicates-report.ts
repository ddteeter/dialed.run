/**
 * The Desk's D2 · Duplicates as one value (task 110): pure, so the page's
 * component and its DOM test can build one without the D1 handle
 * `duplicates.ts` imports.
 */
import type { DuplicateCandidate } from "./duplicates";

/**
A candidate as the Desk draws it: its variants and their pieces, summed.
*/
export interface DuplicateGroup extends DuplicateCandidate {
  /**
   * The group's identity for a list: its product ids, which no other
   * group shares, because `clustersIn` claims each name once.
   */
  key: string;
  pieces: number;
}

/**
 * The Desk's D2 page (task 110): every group, sorted by pieces affected,
 * under the board's header count: names → probable products · pieces.
 */
export interface DuplicatesReport {
  names: number;
  pieces: number;
  groups: readonly DuplicateGroup[];
}

export function duplicatesReport(
  candidates: readonly DuplicateCandidate[],
): DuplicatesReport {
  const groups = candidates
    .map((candidate) => ({
      ...candidate,
      key: candidate.products.map((row) => row.id).join(" "),
      pieces: candidate.products.reduce((sum, row) => sum + row.pieces, 0),
    }))
    .toSorted(
      (left, right) =>
        right.pieces - left.pieces || left.brand.localeCompare(right.brand),
    );
  return {
    names: groups.reduce((sum, group) => sum + group.products.length, 0),
    pieces: groups.reduce((sum, group) => sum + group.pieces, 0),
    groups,
  };
}
