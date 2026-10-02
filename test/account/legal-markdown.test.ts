import { describe, expect, it } from "vitest";

import privacyDraft from "../../docs/legal/privacy-policy.md?raw";
import {
  headingId,
  parseLegalDoc,
  plainText,
  publishedText,
} from "../../src/modules/account/legal-markdown";

/**
 * The owner's published mark, written out rather than imported: the test
 * pins the three lines the source comment tells the owner to type.
 */
const MARK = "---\npublished: true\n---\n";

/**
 * The legal texts' markdown (ACC-13): the subset `docs/legal/` uses, read
 * into the blocks the reading page renders.
 */

describe("headingId", () => {
  it("is GitHub's: lowercase, punctuation dropped, spaces to hyphens", () => {
    expect(headingId("What we keep, and why")).toBe("what-we-keep-and-why");
    expect(headingId("Cookies and browser storage")).toBe(
      "cookies-and-browser-storage",
    );
    expect(headingId("Who we are?")).toBe("who-we-are");
    expect(headingId("Opt-in  twice")).toBe("opt-in-twice");
    expect(headingId("Year 2026")).toBe("year-2026");
    expect(headingId("Café")).toBe("café");
    // A heading line's trailing spaces are not part of it.
    expect(headingId("Who we are  ")).toBe("who-we-are");
  });
});

/**
One cell's words, as a table reads them.
*/
function text(value: string) {
  return [{ kind: "text", text: value }];
}

/**
 * Every file in `docs/legal/`, as written — the texts and their sources
 * alike, so a construct the owner adds to any of them fails here, not on
 * the page.
 */
const LEGAL_FILES: Record<string, string> = import.meta.glob(
  "../../docs/legal/*.md",
  { query: "?raw", import: "default", eager: true },
);

/**
 * A file as the page would read it once the owner marks it published:
 * the mark is what the owner's edit adds, so a file that already has it
 * is read as it stands.
 */
function asPublished(source: string): string {
  const text = publishedText(
    source.startsWith(MARK) ? source : `${MARK}${source}`,
  );
  if (text === undefined) throw new Error("the marked text was refused");
  return text;
}

describe("parseLegalDoc", () => {
  it("takes the # as the title and the rest as blocks", () => {
    const doc = parseLegalDoc(
      [
        "# The **title**",
        "",
        "First paragraph,",
        "  carried on.",
        "",
        "## Who we are",
        "Straight after a heading.",
        "### A smaller one",
        "",
        "- one",
        "  still one",
        "- two",
        "",
        "3. third",
        "4. fourth",
        "",
        "> A quoted",
        "> note.",
        "",
        "| What | How long |",
        "| ---- | :------: |",
        "| Runs | **Kept** |",
        "| Files | 30 days |",
      ].join("\n"),
    );
    expect(doc.title).toBe("The title");
    expect(doc.blocks).toEqual([
      {
        kind: "paragraph",
        inlines: [{ kind: "text", text: "First paragraph, carried on." }],
      },
      {
        kind: "section",
        id: "who-we-are",
        inlines: [{ kind: "text", text: "Who we are" }],
      },
      {
        kind: "paragraph",
        inlines: [{ kind: "text", text: "Straight after a heading." }],
      },
      {
        kind: "subheading",
        inlines: [{ kind: "text", text: "A smaller one" }],
      },
      {
        kind: "list",
        items: [
          [{ kind: "text", text: "one still one" }],
          [{ kind: "text", text: "two" }],
        ],
      },
      {
        kind: "numbered",
        start: 3,
        items: [
          [{ kind: "text", text: "third" }],
          [{ kind: "text", text: "fourth" }],
        ],
      },
      {
        kind: "quote",
        inlines: [{ kind: "text", text: "A quoted note." }],
      },
      {
        kind: "table",
        head: [text("What"), text("How long")],
        rows: [
          [
            text("Runs"),
            [{ kind: "strong", children: [{ kind: "text", text: "Kept" }] }],
          ],
          [text("Files"), text("30 days")],
        ],
      },
    ]);
    expect(doc.contents).toEqual([{ id: "who-we-are", title: "Who we are" }]);
  });

  it("reads bold, code and links inside one another", () => {
    const doc = parseLegalDoc(
      "# T\n\nA **[in](/x)** and [**b** `c`](https://x.test) end.\n",
    );
    expect(doc.blocks).toEqual([
      {
        kind: "paragraph",
        inlines: [
          { kind: "text", text: "A " },
          {
            kind: "strong",
            children: [
              {
                kind: "link",
                href: "/x",
                children: [{ kind: "text", text: "in" }],
              },
            ],
          },
          { kind: "text", text: " and " },
          {
            kind: "link",
            href: "https://x.test",
            children: [
              { kind: "strong", children: [{ kind: "text", text: "b" }] },
              { kind: "text", text: " " },
              { kind: "code", text: "c" },
            ],
          },
          { kind: "text", text: " end." },
        ],
      },
    ]);
  });

  it("numbers a list from 1 when the source does", () => {
    const doc = parseLegalDoc("# T\n\n1. one\n2. two\n");
    expect(doc.blocks).toEqual([
      { kind: "numbered", start: 1, items: [text("one"), text("two")] },
    ]);
  });

  it("lists every H2 in the contents, as plain words, and no H3", () => {
    const doc = parseLegalDoc(
      "# T\n\n## The **short** version\n\n### Not listed\n\n## `Code` too\n",
    );
    expect(doc.contents).toEqual([
      { id: "the-short-version", title: "The short version" },
      { id: "code-too", title: "Code too" },
    ]);
  });

  it("reads a quote's lazy line as the quote's", () => {
    const doc = parseLegalDoc("# T\n\n> One\n>two\nthree > four\n");
    expect(doc.blocks).toEqual([
      { kind: "quote", inlines: text("One two three > four") },
    ]);
  });

  it("is a table only with its rule line", () => {
    const doc = parseLegalDoc("# T\n\n| a | b |\n| c | d |\n");
    expect(doc.blocks).toEqual([
      { kind: "paragraph", inlines: text("| a | b | | c | d |") },
    ]);
  });

  it("refuses a text with no title", () => {
    expect(() => parseLegalDoc("## Only a section\n\nWords.")).toThrow(
      "a legal text needs a # title",
    );
  });

  it.each([
    ["a second title", "# T\n\n# Again\n", "heading"],
    ["a fourth heading level", "# T\n\n#### Deep\n", "heading"],
    ["emphasis", "# T\n\nAn *aside*.\n", "emphasis"],
    ["an image", "# T\n\n![a](/a.png)\n", "image"],
    ["a hard line break", "# T\n\nOne  \ntwo\n", "break"],
    ["a code block", "# T\n\n```\ncode\n```\n", "code"],
    ["a thematic break", "# T\n\nOne\n\n***\n", "thematicBreak"],
    ["raw HTML", "# T\n\n<div>x</div>\n", "html"],
    ["a nested list", "# T\n\n- one\n  - two\n", "listItem"],
    ["a list item of two paragraphs", "# T\n\n- one\n\n  two\n", "listItem"],
    ["an empty list item", "# T\n\n-\n", "listItem"],
    ["a quote of two paragraphs", "# T\n\n> one\n>\n> two\n", "blockquote"],
    ["a quote holding a list", "# T\n\n> - one\n", "blockquote"],
  ])("refuses %s, by name", (_, source, type) => {
    expect(() => parseLegalDoc(source)).toThrow(
      `a legal text cannot use ${type}: the page does not draw it`,
    );
  });

  it.each(Object.keys(LEGAL_FILES))(
    "reads %s with nothing the page cannot draw",
    (path) => {
      const source = LEGAL_FILES[path] ?? "";
      expect(parseLegalDoc(asPublished(source)).title).not.toBe("");
    },
  );

  it("finds every file in docs/legal", () => {
    expect(Object.keys(LEGAL_FILES).length).toBeGreaterThanOrEqual(6);
  });

  it("reads copyright's numbered lists as numbered lists", () => {
    const source = LEGAL_FILES["../../docs/legal/copyright.md"] ?? "";
    const lists = parseLegalDoc(asPublished(source)).blocks.filter(
      (block) => block.kind === "numbered",
    );
    expect(lists.map((list) => list.items.length)).toEqual([6, 4]);
  });

  it("reads the privacy draft end to end, once marked: every H2 in the contents, every link's anchor on one, and none of the source's note", () => {
    const doc = parseLegalDoc(asPublished(privacyDraft));
    expect(JSON.stringify(doc)).not.toContain("Publishing this text");
    expect(JSON.stringify(doc)).not.toContain("<!--");
    expect(doc.title).toBe("[dialed.run] privacy policy");
    const ids = new Set(doc.contents.map((entry) => entry.id));
    expect(ids).toContain("your-choices");
    expect(ids).toContain("weather-and-location");
    const anchors = JSON.stringify(doc.blocks).match(/"href":"#[^"]+"/gu) ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(ids).toContain(anchor.slice(9, -1));
    }
    expect(doc.blocks.some((block) => block.kind === "table")).toBe(true);
  });
});

describe("plainText", () => {
  it("drops the marks and keeps the words", () => {
    const [paragraph] = parseLegalDoc(
      "# T\n\nA **b** `c` [d **e**](#f)\n",
    ).blocks;
    expect(
      paragraph?.kind === "paragraph" ? plainText(paragraph.inlines) : "",
    ).toBe("A b c d e");
  });
});

describe("publishedText", () => {
  it("publishes nothing without the owner's mark, whatever the text says", () => {
    // The draft as it stands: its banner and notes are no longer what
    // keeps it off the page — the missing mark is.
    expect(publishedText(privacyDraft)).toBeUndefined();
    // A finished-looking text with no mark, and ones a blacklist missed.
    expect(publishedText("# T\n\nThe owner's words.")).toBeUndefined();
    const reworded = "> Draft, reworded.\n\n# T\n\nA date goes here.";
    expect(publishedText(reworded)).toBeUndefined();
  });

  it("publishes nothing when the mark is anywhere but the first three lines, or not exactly the mark", () => {
    expect(publishedText(`\n${MARK}# T`)).toBeUndefined();
    expect(publishedText(`# T\n\n${MARK}`)).toBeUndefined();
    expect(publishedText("---\npublished: false\n---\n# T")).toBeUndefined();
    expect(publishedText("---\npublished: true\n# T")).toBeUndefined();
  });

  it("gives the text after the mark", () => {
    expect(publishedText(`${MARK}# T\n\nWords.`)).toBe("# T\n\nWords.");
  });

  it("drops every source comment, however many lines, and keeps what is between them", () => {
    expect(
      publishedText(
        `${MARK}<!--\n  a note, over\n  two lines -->\n# T\n\nKept.<!-- x -->\n\nKept too.`,
      ),
    ).toBe("\n# T\n\nKept.\n\nKept too.");
    expect(publishedText(`${MARK}<!---->Kept.`)).toBe("Kept.");
  });
});
