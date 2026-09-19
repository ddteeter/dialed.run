import { describe, expect, it } from "vitest";

import {
  parseJson,
  readableText,
  readPage,
} from "../../src/modules/enrichment/html";

/**
 * The page as three lists: scripts with their attributes, meta tags, and
 * the prose between tags. Read through a tokenizer rather than patterns,
 * because the PR #72 review asked whether the patterns were good enough
 * and the eval corpus said no — nine of 22 names cut at an apostrophe.
 */

describe("readPage: scripts", () => {
  it("returns each script's payload with its attributes, in order", () => {
    const html = `<script type="a">one</script><p>x</p><script id="b">two</script>`;
    expect(readPage(html).scripts).toStrictEqual([
      { attribs: { type: "a" }, body: "one" },
      { attribs: { id: "b" }, body: "two" },
    ]);
  });

  it("keeps markup inside a payload, which a capture group could not", () => {
    // The whole reason this exists: `>([^<]*)</script>` stops at the first
    // `<` inside the body, truncating any JSON that carries HTML.
    const html = `<script>{"body":"<p>cold mornings</p>"}</script>`;
    expect(readPage(html).scripts[0]?.body).toBe(
      `{"body":"<p>cold mornings</p>"}`,
    );
  });

  it("keeps a script body exactly as written, entities included", () => {
    // A JSON payload is not prose: `&amp;` inside it is the shop's bytes,
    // and decoding them would corrupt a string the JSON parser then reads.
    const html = `<script>{"a":"x &amp; y"}</script>`;
    expect(readPage(html).scripts[0]?.body).toBe(`{"a":"x &amp; y"}`);
  });

  it("closes a script that is never closed at the end of the document", () => {
    // The tokenizer ends the open script when the input ends. The body is
    // whatever followed the tag — a rung then fails to parse it, which is
    // the same outcome as before, reached without pretending the tag was
    // closed somewhere it was not.
    const { scripts, text } = readPage(`<p>kept</p><script>{"a":1}`);
    expect(text).toStrictEqual(["kept"]);
    expect(scripts).toStrictEqual([{ attribs: {}, body: `{"a":1}` }]);
  });

  it("does not re-read an opening tag that is only text inside a body", () => {
    // What the regex version could not do and documented instead: a
    // `<script` inside a script body is content, and the tokenizer knows
    // it — so the inner payload comes back once, inside its parent.
    const html = `<script>first</script><script>outer<script>inner</script>`;
    expect(readPage(html).scripts.map((s) => s.body)).toStrictEqual([
      "first",
      "outer<script>inner",
    ]);
  });

  it("returns nothing when the page has no scripts", () => {
    expect(readPage("<html><body>a page</body></html>").scripts).toStrictEqual(
      [],
    );
  });

  it("keeps a script's text out of the prose", () => {
    const { text } = readPage(
      "<p>before</p><script>var x = 1;</script><p>after</p>",
    );
    expect(text).toStrictEqual(["before", "after"]);
  });
});

describe("readPage: meta tags", () => {
  it("returns every meta tag's attributes, decoded, in any order", () => {
    const html = `<meta charset="utf8"><meta content='Men&#39;s Tee' property="og:title">`;
    expect(readPage(html).metas).toStrictEqual([
      { charset: "utf8" },
      { content: "Men's Tee", property: "og:title" },
    ]);
  });

  it("reads a value containing the other quote character whole", () => {
    // The regex bug, exactly: `[^"']*` stopped at the apostrophe, and
    // `Men's WoolTech Half Tights` reached the row as `Men`.
    const html = `<meta property="og:title" content="Men's WoolTech Half Tights">`;
    expect(readPage(html).metas[0]?.content).toBe("Men's WoolTech Half Tights");
  });

  it("reads meta tags only, whatever attributes another element carries", () => {
    // `property` and `content` on a div are a div's attributes; only a
    // meta tag is a declaration.
    const html = `<div property="og:title" content="Not a meta"></div><meta property="og:title" content="Rover">`;
    expect(readPage(html).metas).toStrictEqual([
      { property: "og:title", content: "Rover" },
    ]);
  });

  it("does not read a meta tag that is inside a comment", () => {
    const html = `<!-- <meta property="og:title" content="old"> --><meta property="og:title" content="new">`;
    expect(readPage(html).metas).toStrictEqual([
      { property: "og:title", content: "new" },
    ]);
  });
});

describe("readPage: text", () => {
  it("returns the prose between tags, whole and in order", () => {
    expect(readPage("<p>one</p><p>two</p>").text).toStrictEqual(["one", "two"]);
  });

  it("keeps text before the first tag and after the last", () => {
    expect(readPage("before<br>after").text).toStrictEqual(["before", "after"]);
  });

  it("ends a node at an opening tag, not only at a closing one", () => {
    // `a` and `b` are different nodes; joining them across the tag would
    // make one string of two facts.
    expect(readPage("a<div>b").text).toStrictEqual(["a", "b"]);
  });

  it("ends a node at a closing tag, not only at an opening one", () => {
    expect(readPage("<p>a</p>b<p>c</p>").text).toStrictEqual(["a", "b", "c"]);
  });

  it("joins a node the tokenizer delivered in fragments", () => {
    // An entity ends one text event and starts the next. A node is the
    // whole run between two tags, or a composition arrives as three.
    expect(readPage("<p>Arc&#39;teryx &amp; co</p>").text).toStrictEqual([
      "Arc'teryx & co",
    ]);
  });

  it("treats a tag longer than any bound as a tag", () => {
    // The regression this function exists for. Every one of the eight
    // sampled product pages carries a tag over 2,000 characters — a Shopify
    // theme renders the whole product JSON into `data-product` — and a
    // bounded split read that blob as prose.
    const blob = "x".repeat(50_000);
    const html = `<div data-product="${blob}">100% merino wool</div>`;
    expect(readPage(html).text).toStrictEqual(["100% merino wool"]);
  });

  it("keeps an attribute value containing a closing bracket out of the prose", () => {
    // `<[^>]*>` ended the tag at the `>` inside the JSON, and the rest of
    // the attribute — quotes, escapes and all — arrived as text.
    const html = String.raw`<div data-p='{"a":">","b":"\u0026amp;"}'>100% merino wool</div>`;
    expect(readPage(html).text).toStrictEqual(["100% merino wool"]);
  });

  it("keeps a comment out of the prose", () => {
    expect(readPage("<!-- a > b --><p>kept</p>").text).toStrictEqual(["kept"]);
  });

  it("keeps a style body out of the prose, and resumes after it", () => {
    const page = readPage("<p>a</p><style>.x{color:red}</style><p>b</p>");
    expect(page.text).toStrictEqual(["a", "b"]);
    // A style is dropped, not kept as a script.
    expect(page.scripts).toStrictEqual([]);
  });

  it("does not mistake an ordinary element for a script", () => {
    const page = readPage("<p>prose</p><div>more</div>");
    expect(page.scripts).toStrictEqual([]);
    expect(page.text).toStrictEqual(["prose", "more"]);
  });

  it("returns the whole string when there are no tags at all", () => {
    expect(readPage("100% merino wool").text).toStrictEqual([
      "100% merino wool",
    ]);
  });

  it("returns nothing for an empty document", () => {
    expect(readPage("").text).toStrictEqual([]);
  });
});

describe("parseJson", () => {
  it("returns the parsed value", () => {
    expect(parseJson(`{"a":1}`)).toStrictEqual({ a: 1 });
  });

  it("returns nothing for text that is not JSON", () => {
    expect(parseJson("{ not json")).toBeUndefined();
  });
});

describe("readableText", () => {
  /**
   * A text node as a reader would see it. The tokenizer decodes once on the
   * way through; real pages are encoded deeper than that, and a model shown
   * `&amp;` copies `&amp;` into `verbatim`, exactly as it is told to.
   */

  it("decodes an ampersand that arrived encoded", () => {
    expect(readableText("91% polyester &amp; 9% spandex")).toBe(
      "91% polyester & 9% spandex",
    );
  });

  it("keeps decoding until it stops changing", () => {
    // Double and triple encoding are both real: a description round-tripped
    // through JSON and then through a template arrives as `&amp;amp;`.
    expect(readableText("a &amp;amp; b")).toBe("a & b");
    expect(readableText("a &amp;amp;amp; b")).toBe("a & b");
  });

  it("decodes an entity to its character rather than to a space", () => {
    // The regex version stripped every entity to a space, so `Men&#39;s`
    // became `Men s` and a dash disappeared. A model asked to copy the
    // page exactly has to be shown the page.
    expect(readableText("Men&#39;s Tee")).toBe("Men's Tee");
    expect(readableText("a&mdash;b")).toBe("a—b");
    expect(readableText("a&#8212;b")).toBe("a—b");
  });

  it("treats a non-breaking space as a space", () => {
    // `&nbsp;` between two words is a word boundary, and collapsing it with
    // the rest of the whitespace is what stops "cold mornings" arriving as
    // one word.
    expect(readableText("cold&nbsp;mornings")).toBe("cold mornings");
  });

  it("leaves a bare ampersand and a stray semicolon alone", () => {
    // `&` is not an entity and `;` ends a sentence.
    expect(readableText("Body & liner; both merino")).toBe(
      "Body & liner; both merino",
    );
  });

  it("collapses whitespace and trims, so nodes compare as text", () => {
    expect(readableText("  100%   merino \n  wool  ")).toBe("100% merino wool");
  });
});
