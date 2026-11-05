import { useRef, useState, type ComponentType, type JSX } from "react";

import { FormField, FormStatus, Mono } from "../../../ui";
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
 * - **"Tools we build with"** comes last, after the notices (design 151;
 *   round 40 #82): the tools that build the app and do not ship in it,
 *   each row naming its licence where a copyright line would sit. The
 *   lead counts only what ships.
 * - **Search** is a FormField filtering every group by package name as
 *   you type. Empty groups hide, an opened group stays open, and no match
 *   reads "Nothing we ship or build with is called “xyz”."
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
  "Tools we build with": the tools that build the app and do not ship in it.
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
  const shown = matchingGroups([...groups, tools], query);
  const noticesId = "third-party-notices";
  const open = (id: string) => {
    setOpened(new Set([...opened, id]));
  };
  return (
    <ReadingShell bellState={bellState} bell={bell}>
      <ReadingFrame
        kicker="Open source"
        title="Built with thanks"
        contents={[
          ...groups.map((group) => contentsEntry(group)),
          { id: noticesId, title: notices.title },
          contentsEntry(tools),
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
        <FormStatus>{searchStatus(query, shown)}</FormStatus>
        {shown.length === 0 ? (
          // The status region says it; drawn here, read there, once.
          <p aria-hidden="true" className="m-0">
            {noMatch(query)}
          </p>
        ) : undefined}
        {shown
          .filter((group) => group.kind !== "tools")
          .map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              isOpen={opened.has(group.id)}
              onOpen={open}
            />
          ))}
        <ReadingSection id={noticesId} heading={notices.title}>
          <LegalSubsections doc={notices} />
        </ReadingSection>
        {shown
          .filter((group) => group.kind === "tools")
          .map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              isOpen={opened.has(group.id)}
              onOpen={open}
            />
          ))}
      </ReadingFrame>
    </ReadingShell>
  );
}

/**
 * What the search's status region says: nothing until there is a query,
 * then how many match, or the line that says none do.
 */
function searchStatus(query: string, shown: readonly LicenceGroup[]): string {
  if (query.trim() === "") return "";
  if (shown.length === 0) return noMatch(query);
  const count = pieceCount(shown);
  return count === 1
    ? "1 package matches."
    : `${String(count)} packages match.`;
}

function noMatch(query: string): string {
  return `Nothing we ship or build with is called “${query.trim()}”.`;
}

/**
 * Show all removes itself, so focus would fall to the page: it goes to
 * the first row it showed instead, as that row mounts.
 *
 * Once. The ref is a fresh function every render, so React detaches the
 * last one (which forgets the press) before attaching the next: a row
 * that a search re-renders or brings back never takes focus from the
 * search box. Returning that cleanup also means React never calls the
 * ref with `null`.
 */
function useFocusFirstShown() {
  const pressed = useRef(false);
  return {
    press: () => {
      pressed.current = true;
    },
    firstShown: (row: HTMLLIElement) => {
      if (pressed.current) row.focus();
      return () => {
        pressed.current = false;
      };
    },
  };
}

function GroupSection({
  group,
  isOpen,
  onOpen,
}: Readonly<{
  group: LicenceGroup;
  isOpen: boolean;
  onOpen: (id: string) => void;
}>): JSX.Element {
  const rows = isOpen ? group.pieces : group.pieces.slice(0, COLLAPSED_ROWS);
  const count = String(group.pieces.length);
  const { firstShown, press } = useFocusFirstShown();
  return (
    <ReadingSection id={group.id} heading={group.name}>
      <Mono step="sm" className="text-muted">
        {`${count}${COUNT_SUFFIX[group.kind]}`}
      </Mono>
      {group.kind === "licence" ? undefined : (
        <p className={`m-0 ${GROUP_LINES[group.kind].className}`}>
          {GROUP_LINES[group.kind].text}
        </p>
      )}
      {group.text === undefined ? undefined : (
        <TextDisclosure label={readLabel(group)} text={group.text} />
      )}
      <ul className="m-0 flex list-none flex-col p-0 text-body">
        {rows.map((piece, index) => (
          <PieceRow
            key={`${piece.name}@${String(piece.version)}`}
            piece={piece}
            showsLicence={group.kind === "tools"}
            rowRef={index === COLLAPSED_ROWS ? firstShown : undefined}
          />
        ))}
      </ul>
      {rows.length < group.pieces.length ? (
        <button
          type="button"
          onClick={() => {
            press();
            onOpen(group.id);
          }}
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
  type: {
    text: "The typefaces you read everything in.",
    className: "text-body",
  },
  // Round 40 #82: TYPE.small in --quiet.
  tools: {
    text: "We build and test dialed.run with these. None of them ships in the app, so each is credited by name and licence.",
    className: "text-small text-quiet",
  },
} as const;

/**
 * What a group's count says after the number (round 40 #82: "44 · NOT
 * SHIPPED"); uppercase lives in the type, so it is written in normal case.
 */
const COUNT_SUFFIX = {
  type: " · Type",
  licence: "",
  tools: " · Not shipped",
} as const;

/**
A group's entry in the contents column, with its count.
*/
function contentsEntry(group: LicenceGroup) {
  return { id: group.id, title: group.name, count: group.pieces.length };
}

function PieceRow({
  piece,
  showsLicence,
  rowRef,
}: Readonly<{
  piece: OpenSourcePiece;
  showsLicence: boolean;
  /**
  The first row Show all showed, which takes focus when it does.
  */
  rowRef?: ((row: HTMLLIElement) => () => void) | undefined;
}>): JSX.Element {
  return (
    <li
      ref={rowRef}
      tabIndex={rowRef === undefined ? undefined : -1}
      className="flex flex-col gap-1 border-t border-hairline py-3"
    >
      <div className="flex flex-wrap items-center gap-x-4">
        <span className="font-semibold wrap-anywhere">{piece.name}</span>
        {piece.version === undefined ? undefined : (
          <Mono step="sm" className="text-muted">
            {piece.version}
          </Mono>
        )}
        {piece.project === undefined ? undefined : (
          <a
            href={piece.project}
            aria-label={`Project: ${piece.name}`}
            className="target inline-flex items-center text-small text-ink underline underline-offset-4"
          >
            Project
          </a>
        )}
      </div>
      {showsLicence && piece.licence !== undefined ? (
        // Round 40 #82: a tool's licence id sits in the copyright line's slot.
        <Mono step="xs" className="text-muted">
          {piece.licence}
        </Mono>
      ) : undefined}
      {piece.copyright === undefined ? undefined : (
        <span className="text-small text-muted">{`© ${piece.copyright}`}</span>
      )}
      {piece.notice === undefined ? undefined : (
        <TextDisclosure label="Notice" of={piece.name} text={piece.notice} />
      )}
      {piece.text === undefined ? undefined : (
        <TextDisclosure label="Licence" of={piece.name} text={piece.text} />
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
  of,
  text,
}: Readonly<{
  label: string;
  /**
   * The package a row's Notice or Licence belongs to, said after the word
   * so a list of summaries is not a hundred "Licence"s. The drawn word
   * starts the name (WCAG 2.5.3); the Project link is named the same way.
   */
  of?: string | undefined;
  text: string;
}>): JSX.Element {
  return (
    <details>
      <summary
        aria-label={of === undefined ? undefined : `${label}: ${of}`}
        className="target cursor-pointer text-small text-ink underline underline-offset-4"
      >
        {label}
      </summary>
      <pre className="m-0 mt-2 font-sans text-small whitespace-pre-wrap wrap-anywhere">
        {text}
      </pre>
    </details>
  );
}
