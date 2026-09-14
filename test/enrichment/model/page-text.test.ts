import { describe, expect, it } from "vitest";

import { pageTextFor } from "../../../src/modules/enrichment/model/page-text";

/**
 * What the model is shown. A product page is megabytes of markup around a
 * few kilobytes of words, and the words are what a token bill is spent on.
 */

describe("pageTextFor", () => {
  it("keeps the prose and drops the markup around it", () => {
    const html = "<html><body><h1>Rover Tee</h1><p>100% merino wool</p></body></html>";
    expect(pageTextFor(html)).toBe("Rover Tee\n100% merino wool");
  });

  it("drops scripts and styles, which are the bulk of a page", () => {
    const html = `<style>.a{color:red}</style><p>kept</p><script>var x = "not prose";</script>`;
    expect(pageTextFor(html)).toBe("kept");
  });

  it("decodes entities, so the model is not taught to copy them", () => {
    // Measured on the rabbit page: with `&amp;` in the prompt the model
    // copied `&amp;` into `verbatim`, character for character as asked.
    expect(pageTextFor("<p>91% polyester &amp;amp; 9% spandex</p>")).toBe(
      "91% polyester & 9% spandex",
    );
  });

  it("collapses whitespace, which is most of a formatted page", () => {
    expect(pageTextFor("<p>  100%   merino \n  wool  </p>")).toBe(
      "100% merino wool",
    );
  });

  it("skips nodes that are only whitespace rather than emitting blank lines", () => {
    expect(pageTextFor("<p>a</p>\n   \n<p>b</p>")).toBe("a\nb");
  });

  it("stops at the budget, and keeps whole nodes when it does", () => {
    // A composition arrives as one text node — that is why the composition
    // pass works on nodes — so cutting mid-node is the one way to turn a
    // fact into a fragment.
    const filler = `<p>${"x".repeat(12_000)}</p>`;
    const text = pageTextFor(`${filler}${filler}<p>100% merino wool</p>`);
    expect(text.length).toBeLessThanOrEqual(24_000);
    expect(text).not.toContain("merino");
    // Whole nodes: what survived is exactly one filler, not a cut one.
    expect(text).toBe("x".repeat(12_000));
  });

  it("keeps a node that lands exactly on the budget", () => {
    // The budget is a maximum, not one short of it: `>` and `>=` differ on
    // exactly this input and on no other.
    expect(pageTextFor(`<p>${"x".repeat(24_000)}</p>`)).toHaveLength(24_000);
    expect(pageTextFor(`<p>${"x".repeat(24_001)}</p>`)).toBe("");
  });

  it("keeps a page that fits entirely", () => {
    const text = pageTextFor(`<p>${"x".repeat(23_000)}</p><p>tail</p>`);
    expect(text.endsWith("tail")).toBe(true);
  });

  it("returns nothing for a page with no prose at all", () => {
    expect(pageTextFor("<html><body><img src='x'></body></html>")).toBe("");
  });
});
