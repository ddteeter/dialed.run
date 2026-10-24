/**
 * `/open-source` (plan C9; round 29 #9; D-137): every open-source piece
 * the app ships, grouped by licence, and the notices for what it vendors.
 *
 * **Both texts are files, bundled as strings and read here on the
 * server**, as the legal pages' are (`./legal`): `open-source-list.json`,
 * which `scripts/open-source-list.ts` writes from the bundles' licence
 * reports and the font licence at every build (design 151), and `docs/legal/third-party-notices.md`.
 * The page receives rows, never the files, so neither rides in the client
 * bundle.
 *
 * The list is a file this repo writes, but it is still parsed rather than
 * trusted: a project link that is not `https://` would otherwise reach an
 * `href`.
 */
import { z } from "zod";

import notices from "../../../docs/legal/third-party-notices.md?raw";
import type { BellState } from "../notifications";
import { readerBellState } from "./legal";
import { headingId, parseLegalDoc, type LegalDoc } from "./legal-markdown";
import listSource from "./open-source-list.json?raw";
import type { LicenceGroup } from "./open-source-search";

type Db = Parameters<typeof readerBellState>[0];

const pieceSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1).optional(),
  licence: z.string().min(1),
  copyright: z.string().min(1).optional(),
  project: z.string().startsWith("https://").optional(),
  notice: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
});

const listSchema = z.object({
  type: z.array(pieceSchema),
  packages: z.array(pieceSchema),
  tools: z.array(pieceSchema),
  licences: z.record(z.string(), z.string()),
});

export type OpenSourceList = z.infer<typeof listSchema>;
type Piece = z.infer<typeof pieceSchema>;

/**
The list as the build wrote it.
*/
export function openSourceList(source: string = listSource): OpenSourceList {
  return listSchema.parse(JSON.parse(source));
}

/**
 * How a heading names a licence. The SPDX id, where it reads well; the
 * board's words where it does not.
 */
const LICENCE_NAMES: Readonly<Record<string, string>> = {
  "Apache-2.0": "Apache 2.0",
  "CC-BY-4.0": "CC BY 4.0",
  "OFL-1.1": "SIL Open Font License 1.1",
};

function groupsOf(
  pieces: readonly Piece[],
  licences: Readonly<Record<string, string>>,
  kind: LicenceGroup["kind"],
): LicenceGroup[] {
  const byLicence = new Map<string, Piece[]>();
  for (const piece of pieces) {
    byLicence.set(piece.licence, [
      ...(byLicence.get(piece.licence) ?? []),
      piece,
    ]);
  }
  return [...byLicence].map(([licence, members]) => {
    const name = LICENCE_NAMES[licence] ?? licence;
    return {
      id: headingId(name),
      name,
      kind,
      text: licences[licence],
      pieces: members,
    };
  });
}

/**
 * The page's groups: the type first, "because it's the part the runner
 * actually sees", then the packages' licences, largest first and by name
 * where two are the same size.
 */
export function licenceGroups(list: OpenSourceList): readonly LicenceGroup[] {
  const packages = groupsOf(list.packages, list.licences, "licence").toSorted(
    (a, b) => b.pieces.length - a.pieces.length || a.name.localeCompare(b.name),
  );
  return [...groupsOf(list.type, list.licences, "type"), ...packages];
}

/**
 * "Built with" (design 151): the tools that build the app and do not ship
 * in it, under one heading, each row naming its licence.
 */
export function toolsGroup(list: OpenSourceList): LicenceGroup {
  return {
    id: "built-with",
    name: "Built with",
    kind: "tools",
    text: undefined,
    pieces: list.tools,
  };
}

export interface OpenSourcePage {
  readonly groups: readonly LicenceGroup[];
  readonly tools: LicenceGroup;
  /**
  The vendored material and the credits (D-137).
  */
  readonly notices: LegalDoc;
  /**
   * The bell for a signed-in reader, who reads in the signed-in shell;
   * `undefined` for a signed-out one.
   */
  readonly bellState: BellState | undefined;
}

export async function openSourcePage(
  db: Db,
  userId: string | undefined,
  source: { readonly list?: string; readonly notices?: string } = {},
): Promise<OpenSourcePage> {
  const list = openSourceList(source.list);
  return {
    groups: licenceGroups(list),
    tools: toolsGroup(list),
    notices: parseLegalDoc(source.notices ?? notices),
    bellState: await readerBellState(db, userId),
  };
}
