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

  it("skips a node that does not fit and keeps reading past it", () => {
    // It used to `break` here, and that was the bug: one oversized node
    // stopped collection entirely. Tracksmith's page has three text nodes
    // over 100,000 characters, so it reached the model as 2,028 of its
    // 889,578 characters — and the model was then recorded as having
    // "found nothing" on a page nobody had shown it.
    const filler = `<p>${"x".repeat(7000)}</p>`.repeat(6);
    const text = pageTextFor(`${filler}<p>100% merino wool</p>`);
    expect(text).toContain("100% merino wool");
    expect(text.length).toBeLessThanOrEqual(40_000);
  });

  it("drops a node too long to be prose, however much budget is left", () => {
    // A single text node of 168,000 characters is data that survived
    // script-stripping, not words a person reads. Spending the budget on
    // one is the same failure by a different route.
    const blob = "x".repeat(8001);
    const text = pageTextFor(`<p>${blob}</p><p>100% merino wool</p>`);
    expect(text).toBe("100% merino wool");
  });

  it("keeps a node of exactly the per-node limit", () => {
    // The limit is a maximum, not one short of it.
    const text = pageTextFor(`<p>${"x".repeat(8000)}</p>`);
    expect(text).toHaveLength(8000);
  });

  it("keeps a node that lands the total exactly on the budget", () => {
    // `>` and `>=` differ on exactly this input and on no other. Two full
    // nodes plus their separators leave room for 7,998 more characters, so
    // the third node fits precisely.
    // Four full nodes plus their separators leave room for 7,996 more
    // characters, so the fifth node fits precisely.
    const full = `<p>${"x".repeat(8000)}</p>`.repeat(4);
    const exact = `<p>${"x".repeat(7996)}</p>`;
    expect(pageTextFor(`${full}${exact}`)).toHaveLength(40_000);
    // One more character and it is refused, leaving the four that fit.
    const over = `<p>${"x".repeat(7997)}</p>`;
    expect(pageTextFor(`${full}${over}`)).toHaveLength(32_003);
  });

  it("stops adding once the total budget is spent", () => {
    // Three nodes that each fit on their own, and together do not.
    const node = `<p>${"x".repeat(8000)}</p>`.repeat(6);
    const text = pageTextFor(node);
    expect(text.length).toBeLessThanOrEqual(40_000);
    expect(text.length).toBeGreaterThan(32_000);
  });

  it("keeps a page that fits entirely", () => {
    const text = pageTextFor(`<p>${"x".repeat(7000)}</p><p>tail</p>`);
    expect(text.endsWith("tail")).toBe(true);
  });

  it("returns nothing for a page with no prose at all", () => {
    expect(pageTextFor("<html><body><img src='x'></body></html>")).toBe("");
  });
});
