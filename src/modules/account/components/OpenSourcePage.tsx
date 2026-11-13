import { useRef, useState, type ComponentType, type JSX } from "react";

import { FormField, FormStatus, Icon, Mono } from "../../../ui";
import {
  plainText,
  sectionsOf,
  sectionText,
  type LegalDoc,
  type Section,
} from "../legal-markdown";
import { reflowed } from "../licence-text";
import {
  matchingGroups,
  matchingNotices,
  pieceCount,
  readLabel,
  COLLAPSED_ROWS,
  type LicenceGroup,
  type OpenSourcePiece,
} from "../open-source-search";
import type { BellState } from "../../notifications";
import { LegalBlocks } from "./LegalPage";
import {
  ReadingFrame,
  ReadingSection,
  ReadingShell,
  type ContentsEntry,
} from "./ReadingFrame";

/**
 * `/open-source` (plan C9; round 29 #9; D-137): every open-source piece
 * the app ships, grouped by licence with the type first, and the notices
 * for what it vendors, on the legal reading page.
 *
 * - **The thank-you** is the kicker, the heading and the lead, which
 *   counts every piece. No mascot and no hearts.
 * - **A group** is headed by its licence, its count at the end of the
 *   heading's line (A-01a). "Read the MIT licence" opens the full text
 *   once, above the rows; the group shows its first three rows and the
 *   "Show all {N}" pill opens the rest. A row is the name and the shipped
 *   version, "Project" at its right, and the copyright line; "Notice"
 *   where the package ships an Apache NOTICE, and "Licence" where its own
 *   licence text says something the group's does not (an undesigned
 *   addition: design deltas).
 * - **The third-party notices** follow the groups: R39's four rows, one
 *   per section of `docs/legal/third-party-notices.md`, under its own
 *   headings (R55·225).
 * - **"Tools we build with"** comes last, after the notices (design 151;
 *   round 40 #82): the tools that build the app and do not ship in it,
 *   each row naming its licence where a copyright line would sit. The
 *   lead counts only what ships.
 * - **Search** is a FormField filtering every group by package name, and
 *   the notices by their words, as you type; the contents filter with
 *   them (R55·225). Empty groups hide, an opened group stays open, and no
 *   match reads "Nothing we ship or build with is called “xyz”." The
 *   pack's ✕ clears it, shown only while there is text (R55·226).
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
  const shownNotices = matchingNotices(
    sectionsOf(notices.blocks).sections,
    query,
    sectionText,
  );
  const licences = shown.filter((group) => group.kind !== "tools");
  const shownTools = shown.filter((group) => group.kind === "tools");
  const open = (id: string) => {
    setOpened(new Set([...opened, id]));
  };
  const groupSection = (group: LicenceGroup) => (
    <GroupSection
      key={group.id}
      group={group}
      isOpen={opened.has(group.id)}
      onOpen={open}
    />
  );
  return (
    <ReadingShell bellState={bellState} bell={bell}>
      <ReadingFrame
        kicker="Open source"
        title="Built with thanks"
        contents={contentsOf(licences, shownNotices, notices.title, shownTools)}
      >
        <p className="m-0">
          {`dialed.run runs on code and type that people chose to give away. Here are all ${String(pieceCount(groups))} pieces, grouped by licence, with a link to each project.`}
        </p>
        <SearchField query={query} onQuery={setQuery} />
        <FormStatus>{searchStatus(query, shown, shownNotices)}</FormStatus>
        {shown.length + shownNotices.length === 0 ? (
          // The status region says it; drawn here, read there, once.
          <p aria-hidden="true" className="m-0">
            {noMatch(query)}
          </p>
        ) : undefined}
        {licences.map((group) => groupSection(group))}
        {shownNotices.length === 0 ? undefined : (
          <ReadingSection id={NOTICES_ID} heading={notices.title}>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {shownNotices.map((notice) => (
                <NoticeRow key={notice.id} notice={notice} />
              ))}
            </ul>
          </ReadingSection>
        )}
        {shownTools.map((group) => groupSection(group))}
      </ReadingFrame>
    </ReadingShell>
  );
}

const NOTICES_ID = "third-party-notices";

/**
 * The contents, filtered with the page (R55·225): each group the search
 * leaves, with what it leaves counted, then the notices while any is
 * left, then the tools.
 */
function contentsOf(
  licences: readonly LicenceGroup[],
  notices: readonly Section[],
  noticesTitle: string,
  tools: readonly LicenceGroup[],
): readonly ContentsEntry[] {
  return [
    ...licences.map((group) => contentsEntry(group)),
    ...(notices.length === 0 ? [] : [{ id: NOTICES_ID, title: noticesTitle }]),
    ...tools.map((group) => contentsEntry(group)),
  ];
}

/**
 * "Find a package", and the pack's ✕ at a 44 target in ink while there is
 * text (R55·226): pressing it empties the field and leaves focus in it.
 * The browser's own clear is hidden for every search field (`styles.css`).
 */
function SearchField({
  query,
  onQuery,
}: Readonly<{ query: string; onQuery: (query: string) => void }>) {
  const field = useRef<HTMLInputElement>(null);
  return (
    <FormField name="find-a-package" label="Find a package">
      <input
        ref={field}
        id="find-a-package"
        type="search"
        placeholder="Name, e.g. date-fns"
        value={query}
        onChange={(event) => {
          onQuery(event.target.value);
        }}
        className="w-full border-none bg-transparent"
      />
      {query === "" ? undefined : (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            onQuery("");
            field.current?.focus();
          }}
          className="target -mr-3 inline-flex shrink-0 items-center justify-center text-ink"
        >
          <Icon name="close" />
        </button>
      )}
    </FormField>
  );
}

/**
 * What the search's status region says: nothing until there is a query,
 * then how many packages match, or the line that says nothing does.
 */
function searchStatus(
  query: string,
  shown: readonly LicenceGroup[],
  notices: readonly Section[],
): string {
  if (query.trim() === "") return "";
  if (shown.length + notices.length === 0) return noMatch(query);
  const count = pieceCount(shown);
  return count === 1
    ? "1 package matches."
    : `${String(count)} packages match.`;
}

function noMatch(query: string): string {
  return `Nothing we ship or build with is called “${query.trim()}”.`;
}

/**
 * One third-party notice: R39's row, its heading bold on a hairline, then
 * its text as written.
 */
function NoticeRow({ notice }: Readonly<{ notice: Section }>): JSX.Element {
  return (
    <li className="flex flex-col gap-2 border-t border-hairline pt-3">
      <h3 id={notice.id} className="m-0 text-body font-bold">
        {plainText(notice.heading)}
      </h3>
      <LegalBlocks blocks={notice.blocks} />
    </li>
  );
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
    <ReadingSection
      id={group.id}
      heading={group.name}
      aside={
        <Mono step="sm" className="shrink-0 text-muted">
          {`${count}${COUNT_SUFFIX[group.kind]}`}
        </Mono>
      }
    >
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
        // A-01c: the board's full-width hairline pill.
        <button
          type="button"
          onClick={() => {
            press();
            onOpen(group.id);
          }}
          className="target w-full rounded-pill border border-ink text-body font-semibold text-ink"
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
      {/* A-01b: Project at the row's right, wherever the name ends. */}
      <div className="flex items-baseline justify-between gap-x-4">
        <span className="min-w-0">
          <span className="font-semibold wrap-anywhere">{piece.name}</span>
          {piece.version === undefined ? undefined : (
            <>
              {" "}
              <Mono step="sm" className="text-muted">
                {piece.version}
              </Mono>
            </>
          )}
        </span>
        {piece.project === undefined ? undefined : (
          // A-02: a line target, so a row with a link is as tall as one
          // without; the row's 12 padding holds its hit area.
          <a
            href={piece.project}
            aria-label={`Project: ${piece.name}`}
            className="target-line inline-block shrink-0 text-small text-ink underline underline-offset-4"
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
 * A licence or notice, closed until asked for. Native `<details>`, so it
 * opens without script and nothing animates. R55·226: no browser marker;
 * the text link carries the pack's chevron, turned down while open. The
 * text is reflowed into paragraphs the page wraps (A-12), not printed
 * with its file's line breaks.
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
    <details className="group">
      <summary
        aria-label={of === undefined ? undefined : `${label}: ${of}`}
        className="target-line inline-flex cursor-pointer list-none items-center gap-1 text-small text-ink underline underline-offset-4 [&::-webkit-details-marker]:hidden"
      >
        {label}
        <Icon name="forward" size={16} className="group-open:rotate-90" />
      </summary>
      <div className="mt-2 flex flex-col gap-2 text-small wrap-anywhere">
        {reflowed(text).map((paragraph, index) => (
          <p key={index} className="m-0">
            {paragraph}
          </p>
        ))}
      </div>
    </details>
  );
}
