import { describe, expect, it } from "vitest";

import { jsonLdExtractor } from "../../src/modules/enrichment/rungs/jsonld";

const PAGE = new URL("https://shop.example.com/p");

function pageWith(...blocks: readonly string[]): string {
  const scripts = blocks
    .map((block) => `<script type="application/ld+json">${block}</script>`)
    .join("");
  return `<html><head>${scripts}</head><body>a page</body></html>`;
}

describe("the JSON-LD rung", () => {
  it("reads a plain Product node", () => {
    const html = pageWith(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Rover Half-Zip",
        brand: "Janji",
        image: "https://cdn.example.com/rover.jpg",
        material: "88% polyester, 12% elastane",
        category: "Tops",
      }),
    );

    expect(jsonLdExtractor.extract(PAGE, html)).toStrictEqual({
      name: "Rover Half-Zip",
      brand: "Janji",
      categoryHint: "Tops",
      imageUrl: "https://cdn.example.com/rover.jpg",
      fabricComposition: {
        verbatim: "88% polyester, 12% elastane",
        parts: [
          {
            materials: [
              { material: "polyester", pct: 88 },
              { material: "elastane", pct: 12 },
            ],
          },
        ],
      },
    });
  });

  it.each([
    ["a brand object", { brand: { name: "Janji" } }],
    ["a brand list", { brand: ["Janji", "Other"] }],
    ["a brand string", { brand: "Janji" }],
  ])("accepts %s, because schema.org permits all three", (_label, fields) => {
    const html = pageWith(JSON.stringify({ "@type": "Product", ...fields }));
    expect(jsonLdExtractor.extract(PAGE, html)?.brand).toBe("Janji");
  });

  it("takes the first image when a page lists several", () => {
    const html = pageWith(
      JSON.stringify({
        "@type": "Product",
        image: [{ url: "https://cdn.example.com/a.jpg" }, "https://b.jpg"],
      }),
    );
    expect(jsonLdExtractor.extract(PAGE, html)?.imageUrl).toBe(
      "https://cdn.example.com/a.jpg",
    );
  });

  it("finds the Product inside an @graph of other things", () => {
    // The common real shape: Organization, BreadcrumbList and WebPage share
    // the block, and the Product is somewhere among them.
    const html = pageWith(
      JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Organization", name: "Example Shop" },
          { "@type": "BreadcrumbList", itemListElement: [] },
          { "@type": "Product", name: "Rover Half-Zip" },
        ],
      }),
    );
    expect(jsonLdExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("matches a namespaced type", () => {
    // Some shops emit "schema:Product" or a full URL — it ends with Product
    // rather than starting with it.
    const html = pageWith(
      JSON.stringify({ "@type": "schema:Product", name: "Rover Half-Zip" }),
    );
    expect(jsonLdExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("matches when @type is a list, on any entry", () => {
    // Deliberately a list where only ONE entry is a Product, and it is not
    // the first — "every" instead of "some" would reject it, and a list of
    // Product-ish names would hide the difference.
    const html = pageWith(
      JSON.stringify({
        "@type": ["ItemPage", "schema:Product"],
        name: "Rover Half-Zip",
      }),
    );
    expect(jsonLdExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("ignores a non-string entry in an @type list", () => {
    const html = pageWith(
      JSON.stringify({ "@type": [42, "Product"], name: "Rover Half-Zip" }),
    );
    expect(jsonLdExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("is not derailed by a null in the graph", () => {
    // `typeof null === "object"`, so a walk that skips the null check reads
    // a property off it and throws — losing the rung to a page that merely
    // had a hole in its list.
    // `JSON.stringify` writes the hole as a literal null, which is the
    // point — the document really does contain one.
    const html = pageWith(
      JSON.stringify({
        "@graph": [undefined, { "@type": "Product", name: "Rover Half-Zip" }],
      }),
    );
    expect(html).toContain("null");
    expect(jsonLdExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("steps over a broken block to reach a good one", () => {
    // Pages routinely ship one malformed script beside a working one, and a
    // throw here would lose the rung entirely.
    const html = pageWith(
      "{ not json at all ",
      JSON.stringify({ "@type": "Product", name: "Rover Half-Zip" }),
    );
    expect(jsonLdExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("drops a bad field without losing the good ones", () => {
    // The reason each field is parsed alone: a shop publishing `name: 42`
    // must not cost us the brand and the material as well.
    const html = pageWith(
      JSON.stringify({
        "@type": "Product",
        name: 42,
        brand: "Janji",
        material: "100% merino",
      }),
    );
    const extracted = jsonLdExtractor.extract(PAGE, html);
    expect(extracted?.name).toBeUndefined();
    expect(extracted?.brand).toBe("Janji");
    expect(extracted?.fabricComposition?.verbatim).toBe("100% merino");
  });

  it("says nothing rather than something empty", () => {
    const bare = pageWith(JSON.stringify({ "@type": "Product" }));
    const notAProduct = pageWith(
      JSON.stringify({ "@type": "Organization", name: "Shop" }),
    );
    expect(jsonLdExtractor.extract(PAGE, "<html></html>")).toBeUndefined();
    // A Product with no readable field is nothing, not an empty object: the
    // ladder would otherwise treat it as a rung that succeeded.
    expect(jsonLdExtractor.extract(PAGE, bare)).toBeUndefined();
    expect(jsonLdExtractor.extract(PAGE, notAProduct)).toBeUndefined();
  });

  it("does not follow a document into an infinite nest", () => {
    // A hostile page can nest as deep as it likes; the walk is bounded and
    // simply does not find the Product buried past the limit.
    let nested: Record<string, unknown> = {
      "@type": "Product",
      name: "Too deep",
    };
    for (let depth = 0; depth < 12; depth += 1) nested = { inner: nested };
    const buried = pageWith(JSON.stringify(nested));
    expect(jsonLdExtractor.extract(PAGE, buried)).toBeUndefined();
  });

  it("is the jsonld rung", () => {
    expect(jsonLdExtractor.rung).toBe("jsonld");
  });

  it("rejects an @type list with no Product in it", () => {
    // The other side of "some": a list of types we do not want must not
    // match, and a predicate that ignores its argument would match them all.
    const html = pageWith(
      JSON.stringify({
        "@type": ["ItemPage", "WebPage"],
        name: "Not a product",
      }),
    );
    expect(jsonLdExtractor.extract(PAGE, html)).toBeUndefined();
  });

  it.each([
    [6, "Rover Half-Zip"],
    [7, undefined],
  ])("walks %i levels deep and no further", (levels, expected) => {
    // The bound exists so a hostile document cannot cost us the isolate, and
    // an off-by-one either loses real pages or walks one level too far.
    let nested: Record<string, unknown> = {
      "@type": "Product",
      name: "Rover Half-Zip",
    };
    for (let depth = 0; depth < levels; depth += 1) nested = { inner: nested };
    const html = pageWith(JSON.stringify(nested));
    expect(jsonLdExtractor.extract(PAGE, html)?.name).toBe(expected);
  });

  it("keeps looking when the first Product block says nothing", () => {
    // A page can carry a stub Product node before the real one. Returning on
    // the first node found — rather than the first that yields a field —
    // would stop at the stub and report nothing.
    const html = pageWith(
      JSON.stringify({ "@type": "Product" }),
      JSON.stringify({ "@type": "Product", name: "Rover Half-Zip" }),
    );
    expect(jsonLdExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it.each([
    ['<script id="seo" type="application/ld+json">', "before the type"],
    ['<script type="application/ld+json" data-schema="product">', "after it"],
    ["<script type='application/ld+json'>", "single-quoted"],
  ])("reads a block with attributes %s", (openTag) => {
    // Real shops put ids, data attributes and single quotes on these tags. A
    // pattern that only allows exactly one character either side of `type`
    // matches the tidy fixture and nothing in the wild.
    const html = `<html><head>${openTag}${JSON.stringify({
      "@type": "Product",
      name: "Rover Half-Zip",
    })}</script></head></html>`;
    expect(jsonLdExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });
});
