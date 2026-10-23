import { Fragment, type ComponentType, type JSX } from "react";

import { Mono } from "../../../ui";
import type { Block, Inline, LegalDoc } from "../legal-markdown";
import type { BellState } from "../../notifications";
import { ReadingFrame, ReadingSection, ReadingShell } from "./ReadingFrame";

/**
 * A legal text as a reading page (task 126, ACC-13; round 26 #14, round
 * 27 #5 and #12, round 28 #16; D-52): `/privacy`, `/terms` and
 * `/copyright`, on the frame `./ReadingFrame` describes.
 */
export function LegalPage({
  doc,
  bellState,
  bell,
}: Readonly<{
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
  return (
    <ReadingShell bellState={bellState} bell={bell}>
      <ReadingFrame title={doc.title} contents={doc.contents}>
        {preamble.map((block, index) => (
          <BlockView key={index} block={block} />
        ))}
        {sections.map((section) => (
          <ReadingSection
            key={section.id}
            id={section.id}
            heading={<Inlines inlines={section.heading} />}
          >
            {section.blocks.map((block, index) => (
              <BlockView key={index} block={block} />
            ))}
          </ReadingSection>
        ))}
      </ReadingFrame>
    </ReadingShell>
  );
}

/**
 * A text's sections one level down, inside another page's section: each
 * H2 drawn as an H3, with its blocks, and nothing before the first one.
 * `/open-source` reads the third-party notices this way (D-137).
 */
export function LegalSubsections({
  doc,
}: Readonly<{ doc: LegalDoc }>): JSX.Element {
  return (
    <>
      {sectionsOf(doc.blocks).sections.map((section) => (
        <Fragment key={section.id}>
          <h3 id={section.id} className="m-0 pt-2 text-lead font-semibold">
            <Inlines inlines={section.heading} />
          </h3>
          {section.blocks.map((block, index) => (
            <BlockView key={index} block={block} />
          ))}
        </Fragment>
      ))}
    </>
  );
}

/**
A block inside a section: anything but the H2 that opens one.
*/
type BodyBlock = Exclude<Block, { kind: "section" }>;

interface Section {
  readonly id: string;
  readonly heading: readonly Inline[];
  readonly blocks: BodyBlock[];
}

/**
 * The blocks under the title before the first H2, then each H2 with what
 * follows it up to the next — so "Back to contents" closes a section rather than
 * being a block of its own in the text.
 */
function sectionsOf(blocks: readonly Block[]): {
  preamble: BodyBlock[];
  sections: Section[];
} {
  const preamble: BodyBlock[] = [];
  const sections: Section[] = [];
  for (const block of blocks) {
    if (block.kind === "section") {
      sections.push({ id: block.id, heading: block.inlines, blocks: [] });
    } else {
      (sections.at(-1)?.blocks ?? preamble).push(block);
    }
  }
  return { preamble, sections };
}

function BlockView({ block }: Readonly<{ block: BodyBlock }>): JSX.Element {
  switch (block.kind) {
    case "subheading": {
      return (
        <h3 className="m-0 pt-2 text-lead font-semibold">
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
      return <TableView head={block.head} rows={block.rows} />;
    }
  }
}

function Items({
  items,
}: Readonly<{ items: readonly (readonly Inline[])[] }>): JSX.Element {
  return (
    <>
      {items.map((item, index) => (
        <li key={index}>
          <Inlines inlines={item} />
        </li>
      ))}
    </>
  );
}

function TableView({
  head,
  rows,
}: Readonly<{
  head: readonly (readonly Inline[])[];
  rows: readonly (readonly (readonly Inline[])[])[];
}>): JSX.Element {
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
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td
                  key={index}
                  className="border-b border-hairline py-2 pr-4 align-top"
                >
                  <Inlines inlines={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Inlines({
  inlines,
}: Readonly<{ inlines: readonly Inline[] }>): JSX.Element {
  return (
    <>
      {inlines.map((inline, index) => (
        <InlineView key={index} inline={inline} />
      ))}
    </>
  );
}

function InlineView({ inline }: Readonly<{ inline: Inline }>): JSX.Element {
  switch (inline.kind) {
    case "text": {
      return <>{inline.text}</>;
    }
    case "strong": {
      return (
        <strong className="font-semibold">
          <Inlines inlines={inline.children} />
        </strong>
      );
    }
    case "code": {
      return (
        <code>
          <Mono step="md">{inline.text}</Mono>
        </code>
      );
    }
    case "link": {
      return (
        <a
          data-target="inline"
          href={inline.href}
          className="text-ink underline underline-offset-4"
        >
          <Inlines inlines={inline.children} />
        </a>
      );
    }
  }
}
