/**
 * `/open-source`'s decisions that run in the browser (plan C9; round 29
 * #9): the search, the collapse to three rows, and the words that depend
 * on a group. Nothing here imports the list itself — that is read on the
 * server (`./open-source`) — so the page's bundle carries none of it.
 */

/**
One row: a package, a typeface, or a tool.
*/
export interface OpenSourcePiece {
  readonly name: string;
  /**
  The licence's id; a tool's row prints it, a group's heading names the rest.
  */
  readonly licence?: string | undefined;
  /**
  The shipped version; a typeface has none on record.
  */
  readonly version?: string | undefined;
  /**
  Who holds the copyright, as its licence file says it; printed after ©.
  */
  readonly copyright?: string | undefined;
  readonly project?: string | undefined;
  /**
  An Apache NOTICE file, which the licence asks be passed on with it.
  */
  readonly notice?: string | undefined;
  /**
  Its own licence text, where it says something its group's does not.
  */
  readonly text?: string | undefined;
}

/**
Every piece under one licence.
*/
export interface LicenceGroup {
  /**
  The section's id, which the contents link to.
  */
  readonly id: string;
  /**
  The licence as the heading names it: "MIT", "Apache 2.0".
  */
  readonly name: string;
  /**
   * `type`: the typefaces, which come first. `licence`: the packages that
   * ship under one licence. `tools`: "Tools we build with", the tools that build the
   * app and do not ship in it (design 151), each row naming its licence.
   */
  readonly kind: "type" | "licence" | "tools";
  /**
  The licence's words, printed once for the group.
  */
  readonly text: string | undefined;
  readonly pieces: readonly OpenSourcePiece[];
}

/**
 * A group shows its first three rows until "Show all" opens it (round 29
 * #9).
 */
export const COLLAPSED_ROWS = 3;

/**
 * The groups a search leaves: each holding only the pieces whose **name**
 * contains what was typed, ignoring case and the spaces around it, and
 * none left empty. A blank search leaves every group whole.
 */
export function matchingGroups(
  groups: readonly LicenceGroup[],
  query: string,
): readonly LicenceGroup[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return groups;
  return groups.flatMap((group) => {
    const pieces = group.pieces.filter((piece) =>
      piece.name.toLowerCase().includes(wanted),
    );
    return pieces.length === 0 ? [] : [{ ...group, pieces }];
  });
}

/**
How many pieces the groups hold between them: the lead's {N}.
*/
export function pieceCount(groups: readonly LicenceGroup[]): number {
  return groups.reduce((total, group) => total + group.pieces.length, 0);
}

/**
 * The control that opens a group's licence text: "Read the MIT licence" —
 * or, where the name already says licence ("SIL Open Font License 1.1"),
 * "Read the licence text", as the board has it for the type.
 */
export function readLabel(group: LicenceGroup): string {
  return /licen[cs]e/iu.test(group.name)
    ? "Read the licence text"
    : `Read the ${group.name} licence`;
}
