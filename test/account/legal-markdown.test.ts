import { describe, expect, it } from "vitest";

import privacyDraft from "../../docs/legal/privacy-policy.md?raw";
import {
  headingId,
  parseInline,
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

describe("parseInline", () => {
  it("reads plain text as one run", () => {
    expect(parseInline("Plain words.")).toEqual([
      { kind: "text", text: "Plain words." },
    ]);
  });

  it("reads bold, code and links between the text around them", () => {
    expect(
      parseInline("A **bold** word, `code`, and [a link](#here) end."),
    ).toEqual([
      { kind: "text", text: "A " },
      { kind: "strong", children: [{ kind: "text", text: "bold" }] },
      { kind: "text", text: " word, " },
      { kind: "code", text: "code" },
      { kind: "text", text: ", and " },
      {
        kind: "link",
        href: "#here",
        children: [{ kind: "text", text: "a link" }],
      },
      { kind: "text", text: " end." },
    ]);
  });

  it("reads marks inside bold and inside a link's words", () => {
    expect(parseInline("**[in](/x)** and [**b** `c`](https://x.test)")).toEqual(
      [
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
      ],
    );
  });

  it("starts with a mark and ends with one, leaving no empty text runs", () => {
    expect(parseInline("**a**`b`")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "a" }] },
      { kind: "code", text: "b" },
    ]);
  });

  it("reads a mark that never closes, or closes on nothing, as text", () => {
    expect(parseInline("a ** b")).toEqual([{ kind: "text", text: "a ** b" }]);
    expect(parseInline("a ` b")).toEqual([{ kind: "text", text: "a ` b" }]);
    expect(parseInline("a **** b")).toEqual([
      { kind: "text", text: "a **** b" },
    ]);
    expect(parseInline("a `` b")).toEqual([{ kind: "text", text: "a `` b" }]);
  });

  it("reads brackets that are not a link as text", () => {
    expect(parseInline("[dialed.run] is")).toEqual([
      { kind: "text", text: "[dialed.run] is" },
    ]);
    expect(parseInline("[x](y")).toEqual([{ kind: "text", text: "[x](y" }]);
    expect(parseInline("see [x]")).toEqual([{ kind: "text", text: "see [x]" }]);
  });

  it("finds a link's close after its middle, not a bracket before it", () => {
    expect(parseInline("(a) [b](c)")).toEqual([
      { kind: "text", text: "(a) " },
      { kind: "link", href: "c", children: [{ kind: "text", text: "b" }] },
    ]);
  });
});

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

describe("parseLegalDoc", () => {
  it("takes the first # as the title and the rest as blocks", () => {
    const doc = parseLegalDoc(
      [
        "# The title",
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
        "> A quoted",
        "> note.",
        "",
        "| What | How long |",
        "| ---- | :------: |",
        "| Runs | **Kept** |",
        "| Files | 30 days |",
        "",
        "# A second title",
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
        kind: "quote",
        inlines: [{ kind: "text", text: "A quoted note." }],
      },
      {
        kind: "table",
        head: [
          [{ kind: "text", text: "What" }],
          [{ kind: "text", text: "How long" }],
        ],
        rows: [
          [
            [{ kind: "text", text: "Runs" }],
            [{ kind: "strong", children: [{ kind: "text", text: "Kept" }] }],
          ],
          [
            [{ kind: "text", text: "Files" }],
            [{ kind: "text", text: "30 days" }],
          ],
        ],
      },
    ]);
    expect(doc.contents).toEqual([{ id: "who-we-are", title: "Who we are" }]);
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

  it("ends a block at a line of only spaces, which belongs to neither", () => {
    const doc = parseLegalDoc("# T\n\nOne\n   \nTwo\n");
    expect(doc.blocks).toEqual([
      { kind: "paragraph", inlines: [{ kind: "text", text: "One" }] },
      { kind: "paragraph", inlines: [{ kind: "text", text: "Two" }] },
    ]);
  });

  it("reads a quote's > with or without its space, and only at the start of a line", () => {
    const doc = parseLegalDoc("# T\n\n> One\n>two\nthree > four\n");
    expect(doc.blocks).toEqual([
      {
        kind: "quote",
        inlines: [{ kind: "text", text: "One two three > four" }],
      },
    ]);
  });

  it("is a table only when the block starts with a pipe, not when it ends with one", () => {
    const doc = parseLegalDoc("# T\n\nEither a | b |\n");
    expect(doc.blocks).toEqual([
      {
        kind: "paragraph",
        inlines: [{ kind: "text", text: "Either a | b |" }],
      },
    ]);
  });

  it("keeps a row that only looks like a rule at one end, and reads rows with loose pipes", () => {
    const doc = parseLegalDoc(
      [
        "# T",
        "",
        "| A | B |",
        "| - | - |",
        "| Runs | - |",
        "| - | Kept |",
        "| Files | 30 days |  ",
        "Photos | 30 days |",
      ].join("\n"),
    );
    expect(doc.blocks).toEqual([
      {
        kind: "table",
        head: [text("A"), text("B")],
        rows: [
          [text("Runs"), text("-")],
          [text("-"), text("Kept")],
          [text("Files"), text("30 days")],
          [text("Photos"), text("30 days")],
        ],
      },
    ]);
  });

  it("refuses a text with no title", () => {
    expect(() => parseLegalDoc("## Only a section\n\nWords.")).toThrow(
      "a legal text needs a # title",
    );
  });

  it("reads the privacy draft end to end, once marked: every H2 in the contents, every link's anchor on one, and none of the source's note", () => {
    const text = publishedText(`${MARK}${privacyDraft}`);
    if (text === undefined) throw new Error("the marked draft was refused");
    const doc = parseLegalDoc(text);
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
    expect(plainText(parseInline("A **b** `c` [d **e**](#f)"))).toBe(
      "A b c d e",
    );
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
