import type { ComponentType, JSX, ReactNode } from "react";

import { Mono } from "../../../ui";
import type { LegalSlug } from "../inputs";
import {
  plainText,
  sectionsOf,
  type BodyBlock,
  type Inline,
  type LegalDoc,
} from "../legal-markdown";
import type { BellState } from "../../notifications";
import { ReadingFrame, ReadingSection, ReadingShell } from "./ReadingFrame";

/**
 * A legal text as a reading page (task 126, ACC-13; round 26 #14, round
 * 27 #5 and #12, round 28 #16; D-52; Round 55 · 220–224): `/privacy`,
 * `/terms` and `/copyright`, on the frame `./ReadingFrame` describes.
 *
 * **The text is the owner's; how it is drawn is ours.** Nothing here
 * changes a word of `docs/legal/`. The page draws the source's own
 * conventions in the app's language instead: the bracketed name as plain
 * dialed.run, an `[OWNER: …]` note as a hi-viz marker, a bare address as
 * a mailto link, and the draft banner as the app's notice block.
 */
export function LegalPage({
  slug,
  doc,
  bellState,
  bell,
}: Readonly<{
  /**
  Which text: its title is the boards' short name (R55·221).
  */
  slug: LegalSlug;
  doc: LegalDoc;
  /**
  The bell's counts for a signed-in reader; absent for a signed-out one.
  */
  bellState: BellState | undefined;
  /**
  The bell for the signed-in shell, given its counts (the route's to wire).
  */
  bell: ComponentType<BellState>;
}>): JSX.Element {
  const { preamble, sections } = sectionsOf(doc.blocks);
  const draft = preamble.find((block) => isDraftBanner(block));
  return (
    <ReadingShell bellState={bellState} bell={bell}>
      <ReadingFrame
        title={LEGAL_TITLES[slug]}
        notice={
          draft?.kind === "quote" ? (
            <DraftNotice inlines={draft.inlines} />
          ) : undefined
        }
        contents={doc.contents.map((entry) => ({
          id: entry.id,
          title: named(entry.title),
        }))}
      >
        <LegalBlocks blocks={preamble.filter((block) => block !== draft)} />
        {sections.map((section) => (
          <ReadingSection
            key={section.id}
            id={section.id}
            ruled
            heading={<Inlines inlines={section.heading} />}
          >
            <LegalBlocks blocks={section.blocks} />
          </ReadingSection>
        ))}
      </ReadingFrame>
    </ReadingShell>
  );
}

/**
 * Each page's title, the boards' short names (R55·221), rather than the
 * text's own `#` heading ("[dialed.run] copyright and DMCA notice").
 */
export const LEGAL_TITLES: Readonly<Record<LegalSlug, string>> = {
  privacy: "Privacy policy",
  terms: "Terms of use",
  copyright: "Copyright",
};

/**
 * The texts open with a block quote whose first words are a bold
 * "DRAFT: …" — the banner the owner removes on publishing.
 */
function isDraftBanner(block: BodyBlock): boolean {
  // A quote always holds one paragraph, so it has a first inline; any
  // other block has no lead to read.
  const lead = block.kind === "quote" ? block.inlines[0] : undefined;
  return (
    lead?.kind === "strong" && /^DRAFT\b/u.test(plainText(lead.children))
  );
}

/**
 * R55·223: the app's notice block under the title, above the contents:
 * MONO.xs DRAFT, the ruled line in ink, then the banner's provenance — the
 * source's own words after its bold lead — in TYPE.small --quiet.
 */
function DraftNotice({
  inlines,
}: Readonly<{ inlines: readonly Inline[] }>): JSX.Element {
  const provenance = withoutLeadingSpace(inlines.slice(1));
  return (
    <div className="mt-2 flex flex-col gap-1 rounded-none bg-notice px-4 py-3 inset-ring-1 inset-ring-notice-rule">
      <Mono step="xs" className="text-ink">
        Draft
      </Mono>
      <p className="m-0 text-body text-ink">Not reviewed by a lawyer yet.</p>
      {provenance.length === 0 ? undefined : (
        <p className="m-0 text-small text-quiet">
          <Inlines inlines={provenance} />
        </p>
      )}
    </div>
  );
}

function withoutLeadingSpace(inlines: readonly Inline[]): readonly Inline[] {
  const [first, ...rest] = inlines;
  return first?.kind === "text"
    ? [{ kind: "text", text: first.text.trimStart() }, ...rest]
    : inlines;
}

/**
 * The texts write the service's name "[dialed.run]"; in prose, headings
 * and the contents it is plain dialed.run (R55·221).
 */
function named(text: string): string {
  return text.replaceAll("[dialed.run]", "dialed.run");
}

/**
 * Blocks in order, as the text has them: a section's, the preamble's, or
 * a third-party notice's on `/open-source`.
 */
export function LegalBlocks({
  blocks,
}: Readonly<{ blocks: readonly BodyBlock[] }>): JSX.Element {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </>
  );
}

function BlockView({ block }: Readonly<{ block: BodyBlock }>): JSX.Element {
  switch (block.kind) {
    case "subheading": {
      // R55·222: a sub-section is TYPE.heading, in the display face.
      return (
        <h3 className="m-0 pt-2 font-display text-heading">
          <Inlines inlines={block.inlines} />
        </h3>
      );
    }
    case "paragraph": {
      return (
        <p className="m-0">
          <Inlines inlines={block.inlines} />
        </p>
      );
    }
    case "quote": {
      return (
        <blockquote className="m-0 border-l-2 border-hairline pl-4 text-muted">
          <Inlines inlines={block.inlines} />
        </blockquote>
      );
    }
    case "list": {
      return (
        <ul className="m-0 flex list-disc flex-col gap-2 pl-6">
          <Items items={block.items} />
        </ul>
      );
    }
    case "numbered": {
      return (
        <ol
          start={block.start}
          className="m-0 flex list-decimal flex-col gap-2 pl-6"
        >
          <Items items={block.items} />
        </ol>
      );
    }
    // The last kind is the default, so a block of no kind at all is drawn
    // as a table and fails loudly, rather than rendering as nothing.
    default: {
      return block.head.length > 2 ? (
        <WideTable head={block.head} rows={block.rows} />
      ) : (
        <TableView head={block.head} rows={block.rows} />
      );
    }
  }
}

function Items({
  items,
}: Readonly<{ items: readonly (readonly Inline[])[] }>): JSX.Element {
  return (
    <>
      {items.map((item, index) => (
        // A bare URL is one word: it breaks rather than scrolling the
        // page sideways at 320px (plan 161's reflow check).
        <li key={index} className="wrap-anywhere">
          <Inlines inlines={item} leadIn />
        </li>
      ))}
    </>
  );
}

type Cells = readonly (readonly Inline[])[];

function TableView({
  head,
  rows,
}: Readonly<{ head: Cells; rows: readonly Cells[] }>): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-small">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className="border-b-2 border-ink py-2 pr-4 text-left align-bottom font-semibold"
              >
                <Inlines inlines={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <BodyRows
            rows={rows}
            cellClass={() => "border-b border-hairline py-2 pr-4 align-top"}
          />
        </tbody>
      </table>
    </div>
  );
}

function BodyRows({
  rows,
  cellClass,
}: Readonly<{
  rows: readonly Cells[];
  cellClass: (index: number) => string;
}>): JSX.Element {
  return (
    <>
      {rows.map((row, rowIndex) => (
        <tr key={rowIndex}>
          {row.map((cell, index) => (
            <td key={index} className={cellClass(index)}>
              <Inlines inlines={cell} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * R55·220, a table wider than two columns. Below the desk each row is a
 * --panel card: its first cell as the heading, then each other cell under
 * its column's header (the label is the header: a guess the PR records).
 * At the desk it is a table that breaks out of the 620 text to the right,
 * from the text's left edge to the page measure's right edge: the frame's
 * width (`100cqw`, `ReadingFrame`'s container) less the contents rail and
 * its gap (240 + 48, `--spacing` × 72). Only one of the two is drawn at a
 * width, so a reader hears the table once.
 */
function WideTable({
  head,
  rows,
}: Readonly<{ head: Cells; rows: readonly Cells[] }>): JSX.Element {
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-3 p-0 desk:hidden">
        {rows.map((row, rowIndex) => (
          <li
            key={rowIndex}
            className="flex flex-col gap-2 rounded-card border border-hairline bg-panel px-4 py-3"
          >
            {row.slice(0, 1).map((cell, index) => (
              <p key={index} className="m-0 text-body font-semibold">
                <Inlines inlines={cell} />
              </p>
            ))}
            <dl className="m-0 grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
              {row.slice(1).map((cell, index) => (
                <div key={index} className="contents">
                  <dt>
                    <Mono step="xs" className="text-muted">
                      {head.slice(index + 1, index + 2).map((label, at) => (
                        <Inlines key={at} inlines={label} />
                      ))}
                    </Mono>
                  </dt>
                  <dd className="m-0 text-body">
                    <Inlines inlines={cell} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-card border border-hairline bg-panel desk:block desk:w-[calc(100cqw-var(--spacing)*72)]">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr>
              {head.map((cell, index) => (
                <th
                  key={index}
                  scope="col"
                  className="border-b border-hairline px-4 py-3 text-left align-bottom font-normal"
                >
                  <Mono step="xs" className="text-muted">
                    <Inlines inlines={cell} />
                  </Mono>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <BodyRows
              rows={rows}
              cellClass={(index) =>
                index === 0
                  ? "border-t border-hairline px-4 py-3 align-top font-semibold"
                  : "border-t border-hairline px-4 py-3 align-top"
              }
            />
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * What the page draws for a run of inlines: the text's own, with each
 * run of plain text cut where the page draws something of its own
 * (`proseParts`).
 */
type Drawn = Inline | ProsePart;

function Inlines({
  inlines,
  inLink = false,
  leadIn = false,
}: Readonly<{
  inlines: readonly Inline[];
  /**
  Inside a link, where an address is already part of one.
  */
  inLink?: boolean;
  /**
  A list item's: bold that opens it is its lead-in (R55·222).
  */
  leadIn?: boolean;
}>): JSX.Element {
  const drawn: readonly Drawn[] = inlines.flatMap<Drawn>((inline) =>
    inline.kind === "text" ? proseParts(inline.text) : [inline],
  );
  return (
    <>
      {drawn.map((inline, index) => (
        <InlineView
          key={index}
          inline={inline}
          inLink={inLink}
          isLeadIn={leadIn && index === 0}
        />
      ))}
    </>
  );
}

/**
 * One inline. R55·221 and 224: plain dialed.run; an owner's note as its
 * sentence on a hi-viz highlight, led by a MONO.xs OWNER tag, with no
 * brackets; and each address a mailto link, except inside a link.
 */
function InlineView({
  inline,
  inLink,
  isLeadIn,
}: Readonly<{
  inline: Drawn;
  inLink: boolean;
  isLeadIn: boolean;
}>): JSX.Element {
  switch (inline.kind) {
    case "text": {
      return <>{inline.text}</>;
    }
    case "owner": {
      return (
        <mark className="box-decoration-clone bg-hi-viz px-1 text-accent-ink">
          <Mono step="xs">Owner</Mono> {inline.text}
        </mark>
      );
    }
    case "email": {
      return inLink ? (
        <>{inline.text}</>
      ) : (
        <TextLink href={`mailto:${inline.text}`}>{inline.text}</TextLink>
      );
    }
    case "strong": {
      return (
        // R55·222: a list's bold lead-in is TYPE.body 600.
        <strong
          className={isLeadIn ? "text-body font-semibold" : "font-semibold"}
        >
          <Inlines inlines={inline.children} inLink={inLink} />
        </strong>
      );
    }
    case "code": {
      // R55·223: MONO.md, and a file name never breaks. A box of its own
      // takes the next line whole rather than breaking at a hyphen; only a
      // name longer than the line itself breaks, so a 320 screen never
      // scrolls sideways (plan 161's reflow check).
      return (
        <code className="inline-block max-w-full wrap-anywhere">
          <Mono step="md">{inline.text}</Mono>
        </code>
      );
    }
    case "link": {
      return (
        <TextLink href={inline.href}>
          <Inlines inlines={inline.children} inLink />
        </TextLink>
      );
    }
  }
}

/**
 * Every link in a text — the source's own and a bare address made one —
 * in one style, set in its sentence (WCAG 2.5.8's inline exception).
 */
function TextLink({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>): JSX.Element {
  return (
    <a
      data-target="inline"
      href={href}
      className="text-ink underline underline-offset-4"
    >
      {children}
    </a>
  );
}

/**
 * An `[OWNER: …]` note: what it says runs to the first closing bracket.
 */
const OWNER_NOTE = /\[OWNER:([^\]]*)\]/u;

/**
 * What can close a sentence or a bracket after an address, and is not
 * part of it.
 */
const TRAILING = new Set([".", ",", ";", ":", ")"]);

interface ProsePart {
  readonly kind: "text" | "owner" | "email";
  readonly text: string;
}

/**
 * A run of the text cut where the page draws something of its own: an
 * owner's note, or an address. `split` with the note's group puts what
 * each note says at the odd places, between the runs of text.
 */
function proseParts(text: string): readonly ProsePart[] {
  return named(text)
    .split(OWNER_NOTE)
    .flatMap((piece, index) =>
      index % 2 === 0
        ? addressParts(piece)
        : { kind: "owner" as const, text: piece.trim() },
    );
}

/**
 * Text, word by word, with each email address cut out of its word: the
 * word less what sits round it, when that holds an `@` with a dot after.
 */
function addressParts(text: string): readonly ProsePart[] {
  return text.split(" ").flatMap((word, index): ProsePart[] => {
    const before = index === 0 ? "" : " ";
    const address = withoutSurround(word);
    if (!isAddress(address)) return [{ kind: "text", text: before + word }];
    const start = word.indexOf(address);
    return [
      { kind: "text", text: before + word.slice(0, start) },
      { kind: "email", text: address },
      { kind: "text", text: word.slice(start + address.length) },
    ];
  });
}

/**
 * A word less an opening bracket before it and closing punctuation after.
 */
function withoutSurround(word: string): string {
  return withoutTrailing(word.startsWith("(") ? word.slice(1) : word);
}

function withoutTrailing(word: string): string {
  return TRAILING.has(word.slice(-1))
    ? withoutTrailing(word.slice(0, -1))
    : word;
}

function isAddress(word: string): boolean {
  const at = word.indexOf("@");
  return at > 0 && word.indexOf(".", at) > at + 1;
}
