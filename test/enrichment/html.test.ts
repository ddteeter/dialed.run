import { describe, expect, it } from "vitest";

import {
  readableText,
  scriptBodies,
  textNodes,
  withoutCode,
} from "../../src/modules/enrichment/html";

const ANY_SCRIPT = /<script[^>]{0,500}>/giu;

describe("scriptBodies", () => {
  it("returns each script's payload, in order", () => {
    const html = `<script>one</script><p>x</p><script>two</script>`;
    expect(scriptBodies(html, ANY_SCRIPT)).toStrictEqual(["one", "two"]);
  });

  it("keeps markup inside a payload, which a capture group could not", () => {
    // The whole reason this exists: `>([^<]*)</script>` stops at the first
    // `<` inside the body, truncating any JSON that carries HTML.
    const html = `<script>{"body":"<p>cold mornings</p>"}</script>`;
    expect(scriptBodies(html, ANY_SCRIPT)).toStrictEqual([
      `{"body":"<p>cold mornings</p>"}`,
    ]);
  });

  it("yields nothing for a script that is never closed", () => {
    // Slicing to a -1 index would quietly return the payload minus its last
    // character — valid-looking JSON one byte short, which is worse than
    // nothing because it parses sometimes.
    expect(scriptBodies(`<script>{"a":1}`, ANY_SCRIPT)).toStrictEqual([]);
  });

  it("re-reads an opening tag that is only text inside another body", () => {
    // `matchAll` finds every `<script` in the document, including one that is
    // content rather than markup — so the inner payload comes back twice,
    // once inside its parent and once alone.
    //
    // Documented rather than prevented: telling markup from text needs a
    // parser, and the cost is an extra payload that either parses to
    // something the rung ignores or does not parse at all. Asserted so the
    // next reader knows it was seen and priced, not missed.
    const html = `<script>first</script><script>outer<script>inner</script>`;
    expect(scriptBodies(html, ANY_SCRIPT)).toStrictEqual([
      "first",
      "outer<script>inner",
      "inner",
    ]);
  });

  it("returns nothing when the page has no scripts", () => {
    expect(
      scriptBodies("<html><body>a page</body></html>", ANY_SCRIPT),
    ).toStrictEqual([]);
  });

  it("only matches the tags the caller asked for", () => {
    const html = `<script>skipped</script><script id="wanted">taken</script>`;
    const wanted = /<script[^>]{0,500}id=["']wanted["'][^>]{0,500}>/giu;
    expect(scriptBodies(html, wanted)).toStrictEqual(["taken"]);
  });
});

describe("withoutCode", () => {
  it("removes a script body and leaves the prose", () => {
    expect(
      withoutCode("<p>before</p><script>var x = 1;</script><p>after</p>"),
    ).toBe("<p>before</p> <p>after</p>");
  });

  it("removes a style body too", () => {
    expect(withoutCode("<p>a</p><style>.x{color:red}</style><p>b</p>")).toBe(
      "<p>a</p> <p>b</p>",
    );
  });

  it("leaves a space where the block was", () => {
    // Same reason a stripped tag becomes a space: "Made" and "from" either
    // side of a removed block must not become "Madefrom", which stops a
    // composition being read out of the text that remains.
    expect(withoutCode("Made<script>x</script>from 88% merino")).toBe(
      "Made from 88% merino",
    );
  });

  it("does not re-enter an opening tag that was inside a removed body", () => {
    // `matchAll` finds every `<script` in the document, including one that is
    // content rather than markup. Processing it again would copy the tail of
    // the first block back into the output.
    expect(withoutCode("a<script>x<script>y</script>b")).toBe("a b");
  });

  it("drops everything after a script that is never closed", () => {
    // There is no more document: whatever follows is inside that script.
    expect(withoutCode("keep<script>lost and everything after")).toBe("keep ");
  });

  it("leaves a page with no code untouched", () => {
    expect(withoutCode("<p>88% merino wool</p>")).toBe(
      "<p>88% merino wool</p>",
    );
  });

  it("removes the closing tag along with the body", () => {
    // Resuming at the start of `</script>` rather than past it would leak
    // the tag into the text, and a text-node split would then see it.
    expect(withoutCode("<script>x</script>tail")).not.toContain("script");
  });

  it("looks for the closing tag after the opening one, not before it", () => {
    // The fixture is odd on purpose: a literal `</script>` in the prose
    // ahead of a real block. Searching from before the opening tag finds
    // that one, ends the block at the wrong place, and copies the script's
    // whole body back into the text — which is how JSON ends up being
    // searched for fabric. The opening tag is deliberately long, so
    // "before" and "after" land either side of the stray one.
    const html = `X</script><script type="application/json">y</script>`;
    expect(withoutCode(html)).toBe("X</script> ");
  });
});

describe("textNodes", () => {
  it("returns what is between the tags, in order", () => {
    expect(textNodes("<p>one</p><p>two</p>")).toStrictEqual([
      "",
      "one",
      "",
      "two",
      "",
    ]);
  });

  it("keeps text before the first tag and after the last", () => {
    expect(textNodes("before<br>after")).toStrictEqual([
      "before",
      "after",
    ]);
  });

  it("treats a tag longer than any bound as a tag", () => {
    // The regression this function exists for. Every one of the eight
    // sampled product pages carries a tag over 2,000 characters — a Shopify
    // theme renders the whole product JSON into `data-product` — and a
    // bounded split read that blob as prose.
    const blob = "x".repeat(50_000);
    const html = `<div data-product="${blob}">100% merino wool</div>`;
    expect(textNodes(html)).toStrictEqual(["", "100% merino wool", ""]);
  });

  it("ends the document at a `<` that is never closed", () => {
    // Everything after it sits inside that tag, so far as a parser can
    // tell, so it is not text and must not be offered as text.
    expect(textNodes("kept<div class=\"unclosed")).toStrictEqual(["kept"]);
  });

  it("returns the whole string when there are no tags at all", () => {
    expect(textNodes("100% merino wool")).toStrictEqual(["100% merino wool"]);
  });

  it("does not leave the closing angle bracket on the next node", () => {
    expect(textNodes("<b>x")).toStrictEqual(["", "x"]);
  });
});

describe("readableText", () => {
  /**
   * A text node as a reader would see it. These cases lived in
   * `composition.test.ts` until the composition parser was retired
   * (2026-09-14); the function outlived it because the *prompt* needs the
   * same decode — a model shown `&amp;` copies `&amp;` into `verbatim`,
   * exactly as it is told to.
   */

  it("decodes an ampersand that arrived encoded", () => {
    expect(readableText("91% polyester &amp; 9% spandex")).toBe(
      "91% polyester & 9% spandex",
    );
  });

  it("keeps decoding until it stops changing", () => {
    // Double and triple encoding are both real: a description round-tripped
    // through JSON and then through a template arrives as `&amp;amp;`.
    // Stopping one pass short leaves an entity the strip below eats, taking
    // the separator between two fibres with it.
    expect(readableText("a &amp;amp; b")).toBe("a & b");
    // And the JSON-escaped form, which is how it arrives from an attribute.
    expect(readableText(String.raw`a \u0026amp;amp; b`)).toBe("a & b");
  });

  it("replaces a leftover entity with a space, not with nothing", () => {
    // `&nbsp;` between two words is a word boundary. Deleted rather than
    // replaced, "cold&nbsp;mornings" becomes "coldmornings" — and a cue or
    // a fibre name stops matching on a page that had one.
    expect(readableText("cold&nbsp;mornings")).toBe("cold mornings");
  });

  it("strips a named entity, not only a numeric one", () => {
    // `&#8212;` and `&mdash;` are the same character written two ways, and
    // a pattern that requires the `#` leaves half of them in the text.
    expect(readableText("a&mdash;b")).toBe("a b");
    expect(readableText("a&#8212;b")).toBe("a b");
  });

  it("strips an entity longer than one character", () => {
    // The shortest real entity is `&lt;`; `&thinsp;` is seven. A pattern
    // matching a single character inside the semicolons leaves every one of
    // them behind.
    expect(readableText("a&thinsp;b")).toBe("a b");
  });

  it("leaves a bare ampersand and a stray semicolon alone", () => {
    // `&` is not an entity and `;` ends a sentence. A pattern that matched
    // non-alphanumerics between them would eat punctuation a shop wrote.
    expect(readableText("Body & liner; both merino")).toBe(
      "Body & liner; both merino",
    );
  });

  it("collapses whitespace and trims, so nodes compare as text", () => {
    expect(readableText("  100%   merino \n  wool  ")).toBe("100% merino wool");
  });
});
