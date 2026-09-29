import type { JSX, ReactNode } from "react";

import { Layout, Mono, SignedOutLayout } from "../../../ui";
import type { Block, Inline, LegalDoc } from "../legal-markdown";

/**
 * A legal text as a reading page (task 126, ACC-13; round 26 #14, round
 * 27 #5 and #12; D-52): `/privacy` now, `/terms` and `/copyright` when
 * their texts exist.
 *
 * **Contract values, not the board's**: the 620 document measure
 * (`max-w-column`) and the `lead` step. At the desk the contents sit in a
 * sticky column to the left; on the phone they are a plain list under the
 * heading. Every H2 has an id and ends with "↑ Contents". No accordions;
 * inline links are underlined. A signed-in reader reads in the signed-in
 * shell, anyone else in the signed-out one.
 */
export function LegalPage({
  doc,
  unreadCount,
  bell,
}: Readonly<{
  doc: LegalDoc;
  /**
  The bell's count for a signed-in reader; absent for a signed-out one.
  */
  unreadCount: number | undefined;
  /**
  The bell for the signed-in shell, given its count (the route's to wire).
  */
  bell: (unreadCount: number) => ReactNode;
}>): JSX.Element {
  const page = <ReadingPage doc={doc} />;
  return unreadCount === undefined ? (
    <SignedOutLayout action="log-in">{page}</SignedOutLayout>
  ) : (
    <Layout bell={bell(unreadCount)}>{page}</Layout>
  );
}

function ReadingPage({ doc }: Readonly<{ doc: LegalDoc }>): JSX.Element {
  const { preamble, sections } = sectionsOf(doc.blocks);
  return (
    <main className="px-5 pt-8 pb-16 desk:grid desk:grid-cols-[auto_1fr] desk:gap-x-12">
      <h1 className="m-0 font-display text-display uppercase desk:col-start-2 desk:row-start-1">
        {doc.title}
      </h1>
      <nav
        id="contents"
        aria-label="Contents"
        className="mt-6 desk:sticky desk:top-8 desk:col-start-1 desk:row-span-2 desk:row-start-1 desk:mt-0 desk:self-start"
      >
        <h2 className="m-0 text-muted">
          <Mono step="xs">Contents</Mono>
        </h2>
        <ol className="m-0 mt-2 flex list-none flex-col gap-2 p-0 text-body">
          {doc.contents.map((entry) => (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                className="target text-ink underline underline-offset-4"
              >
                {entry.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <article className="mt-8 flex max-w-column flex-col gap-4 text-lead desk:col-start-2">
        {preamble.map((block, index) => (
          <BlockView key={index} block={block} />
        ))}
        {sections.map((section) => (
          <section
            key={section.id}
            aria-labelledby={section.id}
            className="flex flex-col gap-4 pt-4"
          >
            <h2 id={section.id} className="m-0 text-heading font-semibold">
              <Inlines inlines={section.heading} />
            </h2>
            {section.blocks.map((block, index) => (
              <BlockView key={index} block={block} />
            ))}
            <a
              href="#contents"
              className="target self-start text-small text-muted underline underline-offset-4"
            >
              ↑ Contents
            </a>
          </section>
        ))}
      </article>
    </main>
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
 * follows it up to the next — so "↑ Contents" closes a section rather than
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
          {block.items.map((item, index) => (
            <li key={index}>
              <Inlines inlines={item} />
            </li>
          ))}
        </ul>
      );
    }
    case "table": {
      return <TableView head={block.head} rows={block.rows} />;
    }
  }
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
