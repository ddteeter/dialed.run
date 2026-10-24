import { useState, type ComponentType, type JSX } from "react";

import { FormField, Mono } from "../../../ui";
import type { LegalDoc } from "../legal-markdown";
import {
  matchingGroups,
  pieceCount,
  readLabel,
  COLLAPSED_ROWS,
  type LicenceGroup,
  type OpenSourcePiece,
} from "../open-source-search";
import type { BellState } from "../../notifications";
import { LegalSubsections } from "./LegalPage";
import { ReadingFrame, ReadingSection, ReadingShell } from "./ReadingFrame";

/**
 * `/open-source` (plan C9; round 29 #9; D-137): every open-source piece
 * the app ships, grouped by licence with the type first, and the notices
 * for what it vendors, on the legal reading page.
 *
 * - **The thank-you** is the kicker, the heading and the lead, which
 *   counts every piece. No mascot and no hearts.
 * - **A group** is headed by its licence and count. "Read the MIT
 *   licence" opens the full text once, above the rows; the group shows
 *   its first three rows and "Show all {N}" opens the rest. A row is the
 *   name, the shipped version, "Project", and the copyright line; "Notice"
 *   where the package ships an Apache NOTICE, and "Licence" where its own
 *   licence text says something the group's does not (an undesigned
 *   addition: design deltas).
 * - **"Built with"** follows the groups (design 151, undesigned): the
 *   tools that build the app and do not ship in it, each row naming its
 *   licence. The lead counts only what ships.
 * - **Search** is a FormField filtering every group by package name as
 *   you type. Empty groups hide, an opened group stays open, and no match
 *   reads "Nothing we ship is called “xyz”."
 *
 * The rows are generated, never written: `scripts/open-source-list.ts`.
 */
export function OpenSourcePage({
  groups,
  tools,
  notices,
  bellState,
  bell,
}: Readonly<{
  groups: readonly LicenceGroup[];
  /**
  "Built with": the tools that build the app and do not ship in it.
  */
  tools: LicenceGroup;
  /**
  The third-party notices: vendored material and credits.
  */
  notices: LegalDoc;
  bellState: BellState | undefined;
  bell: ComponentType<BellState>;
}>): JSX.Element {
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const all = [...groups, tools];
  const shown = matchingGroups(all, query);
  const noticesId = "third-party-notices";
  return (
    <ReadingShell bellState={bellState} bell={bell}>
      <ReadingFrame
        kicker="Open source"
        title="Built with thanks"
        contents={[
          ...all.map((group) => ({
            id: group.id,
            title: group.name,
            count: group.pieces.length,
          })),
          { id: noticesId, title: notices.title },
        ]}
      >
        <p className="m-0">
          {`dialed.run runs on code and type that people chose to give away. Here are all ${String(pieceCount(groups))} pieces, grouped by licence, with a link to each project.`}
        </p>
        <FormField name="find-a-package" label="Find a package">
          <input
            id="find-a-package"
            type="search"
            placeholder="Name, e.g. date-fns"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="w-full border-none bg-transparent"
          />
        </FormField>
        {shown.length === 0 ? (
          <p className="m-0">{`Nothing we ship is called “${query.trim()}”.`}</p>
        ) : undefined}
        {shown.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            isOpen={opened.has(group.id)}
            onOpen={() => {
              setOpened(new Set([...opened, group.id]));
            }}
          />
        ))}
        <ReadingSection id={noticesId} heading={notices.title}>
          <LegalSubsections doc={notices} />
        </ReadingSection>
      </ReadingFrame>
    </ReadingShell>
  );
}

function GroupSection({
  group,
  isOpen,
  onOpen,
}: Readonly<{
  group: LicenceGroup;
  isOpen: boolean;
  onOpen: () => void;
}>): JSX.Element {
  const rows = isOpen ? group.pieces : group.pieces.slice(0, COLLAPSED_ROWS);
  const count = String(group.pieces.length);
  return (
    <ReadingSection id={group.id} heading={group.name}>
      <Mono step="xs" className="text-muted">
        {group.kind === "type" ? `${count} · Type` : count}
      </Mono>
      {group.kind === "licence" ? undefined : (
        <p className="m-0 text-body">{GROUP_LINES[group.kind]}</p>
      )}
      {group.text === undefined ? undefined : (
        <TextDisclosure label={readLabel(group)} text={group.text} />
      )}
      <ul className="m-0 flex list-none flex-col p-0 text-body">
        {rows.map((piece) => (
          <PieceRow
            key={`${piece.name}@${String(piece.version)}`}
            piece={piece}
            showsLicence={group.kind === "tools"}
          />
        ))}
      </ul>
      {rows.length < group.pieces.length ? (
        <button
          type="button"
          onClick={onOpen}
          className="target self-start text-small text-ink underline underline-offset-4"
        >
          {`Show all ${count}`}
        </button>
      ) : undefined}
    </ReadingSection>
  );
}

/**
The line under a heading that is not a licence's.
*/
const GROUP_LINES = {
  type: "The two typefaces you read everything in.",
  tools:
    "The tools we build and test dialed.run with. None of them ships to you, so each is credited by name and licence.",
} as const;

function PieceRow({
  piece,
  showsLicence,
}: Readonly<{ piece: OpenSourcePiece; showsLicence: boolean }>): JSX.Element {
  return (
    <li className="flex flex-col gap-1 border-t border-hairline py-3">
      <div className="flex flex-wrap items-center gap-x-4">
        <span className="font-semibold">{piece.name}</span>
        {piece.version === undefined ? undefined : (
          <Mono step="md" className="text-muted">
            {piece.version}
          </Mono>
        )}
        {showsLicence && piece.licence !== undefined ? (
          <Mono step="xs" className="text-muted">
            {piece.licence}
          </Mono>
        ) : undefined}
        {piece.project === undefined ? undefined : (
          <a
            href={piece.project}
            className="target inline-flex items-center text-small text-ink underline underline-offset-4"
          >
            Project
          </a>
        )}
      </div>
      {piece.copyright === undefined ? undefined : (
        <span className="text-small text-muted">{`© ${piece.copyright}`}</span>
      )}
      {piece.notice === undefined ? undefined : (
        <TextDisclosure label="Notice" text={piece.notice} />
      )}
      {piece.text === undefined ? undefined : (
        <TextDisclosure label="Licence" text={piece.text} />
      )}
    </li>
  );
}

/**
 * A licence or notice, closed until asked for and then printed whole, as
 * its file sets it. Native `<details>`, so it opens without script and
 * nothing animates.
 */
function TextDisclosure({
  label,
  text,
}: Readonly<{ label: string; text: string }>): JSX.Element {
  return (
    <details>
      <summary className="target cursor-pointer text-small text-ink underline underline-offset-4">
        {label}
      </summary>
      <pre className="m-0 mt-2 font-sans text-small whitespace-pre-wrap">
        {text}
      </pre>
    </details>
  );
}
