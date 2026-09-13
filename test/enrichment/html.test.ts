import { describe, expect, it } from "vitest";

import { scriptBodies } from "../../src/modules/enrichment/html";

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
