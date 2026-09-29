import { describe, expect, it } from "vitest";

import privacyDraft from "../../docs/legal/privacy-policy.md?raw";
import {
  headingId,
  isFinished,
  parseInline,
  parseLegalDoc,
  plainText,
} from "../../src/modules/account/legal-markdown";

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
  });
});

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

  it("refuses a text with no title", () => {
    expect(() => parseLegalDoc("## Only a section\n\nWords.")).toThrow(
      "a legal text needs a # title",
    );
  });

  it("reads the privacy draft end to end: every H2 in the contents, every link's anchor on one", () => {
    const doc = parseLegalDoc(privacyDraft);
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

describe("isFinished", () => {
  it("is false for a text carrying an owner's note or the draft banner", () => {
    expect(isFinished("# T\n\nEffective: [OWNER: a date]")).toBe(false);
    expect(isFinished("> **DRAFT: not reviewed.**\n\n# T")).toBe(false);
    expect(isFinished(privacyDraft)).toBe(false);
  });

  it("is true for a text with neither", () => {
    expect(isFinished("# T\n\nThe owner's words, with an OWNER mention.")).toBe(
      true,
    );
  });
});
