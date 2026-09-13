import { describe, expect, it } from "vitest";

import { shopifyExtractor } from "../../src/modules/enrichment/rungs/shopify";

const PAGE = new URL("https://shop.example.com/products/rover-half-zip");

function withProductJson(product: Record<string, unknown>): string {
  return `<html><body><script type="application/json" id="ProductJson-12345">${JSON.stringify(
    product,
  )}</script></body></html>`;
}

describe("the Shopify rung", () => {
  it("reads the theme's inline product JSON", () => {
    const html = withProductJson({
      title: "Rover Half-Zip",
      vendor: "Janji",
      product_type: "Tops",
      featured_image: "https://cdn.shopify.com/rover.jpg",
    });

    expect(shopifyExtractor.extract(PAGE, html)).toStrictEqual({
      name: "Rover Half-Zip",
      brand: "Janji",
      categoryHint: "Tops",
      imageUrl: "https://cdn.shopify.com/rover.jpg",
    });
  });

  it("falls back to the analytics blob when there is no product script", () => {
    // Newer themes drop ProductJson and leave only this. It carries vendor
    // and type but not the description, which is most of why the rung still
    // wants the other shape when it is there.
    const html = `<html><script>var meta = {"product":{"vendor":"Janji","type":"Tops"},"page":{}};</script></html>`;
    expect(shopifyExtractor.extract(PAGE, html)).toStrictEqual({
      brand: "Janji",
      categoryHint: "Tops",
    });
  });

  it("prefers the product script over the analytics blob", () => {
    // Plenty of pages carry both, and only one of them has the description.
    const html = `${withProductJson({ title: "Rover Half-Zip", vendor: "Janji" })}
      <script>var meta = {"product":{"vendor":"Wrong Vendor"}};</script>`;
    expect(shopifyExtractor.extract(PAGE, html)?.brand).toBe("Janji");
  });

  it("takes `type` when the JSON uses that name instead", () => {
    const html = withProductJson({ title: "Rover", type: "Tops" });
    expect(shopifyExtractor.extract(PAGE, html)?.categoryHint).toBe("Tops");
  });

  it.each([
    ["Composition: 88% polyester, 12% elastane"],
    ["Fabric: 88% polyester, 12% elastane"],
    ["Material — 88% polyester, 12% elastane"],
    ["Made from 88% polyester, 12% elastane"],
  ])("reads a cued composition out of the description (%s)", (line) => {
    const html = withProductJson({
      title: "Rover Half-Zip",
      body_html: `<p>Built for cold mornings.</p><p>${line}</p>`,
    });
    expect(
      shopifyExtractor.extract(PAGE, html)?.fabricComposition?.parts?.[0]
        ?.materials,
    ).toStrictEqual([
      { material: "polyester", pct: 88 },
      { material: "elastane", pct: 12 },
    ]);
  });

  it("reads a cued multi-part composition", () => {
    const html = withProductJson({
      body_html: "<p>Fabric: Body: 100% nylon; Liner: 88% polyester</p>",
    });
    const parts = shopifyExtractor.extract(PAGE, html)?.fabricComposition
      ?.parts;
    expect(parts?.map((part) => part.part)).toStrictEqual(["Body", "Liner"]);
  });

  it("does NOT read a percentage with no cue in front of it", () => {
    // The rung's one rule, and the reason it exists: an uncued parse of a
    // description turns a sale into a fabric. "off" and "save" are not
    // fibres, and a typed column saying they are is worse than an empty one.
    const html = withProductJson({
      title: "Rover Half-Zip",
      body_html: "<p>20% off today! Save 15% with code RUN.</p>",
    });
    const extracted = shopifyExtractor.extract(PAGE, html);
    expect(extracted?.fabricComposition).toBeUndefined();
    expect(extracted?.name).toBe("Rover Half-Zip");
  });

  it("survives a description with no composition at all", () => {
    const html = withProductJson({
      title: "Rover Half-Zip",
      body_html: "<p>Built for cold mornings.</p>",
    });
    expect(
      shopifyExtractor.extract(PAGE, html)?.fabricComposition,
    ).toBeUndefined();
  });

  it("steps over a malformed product script", () => {
    const html = `<html><script type="application/json" id="ProductJson-1">{ not json </script></html>`;
    expect(shopifyExtractor.extract(PAGE, html)).toBeUndefined();
  });

  it("says nothing for a page that is not Shopify", () => {
    expect(
      shopifyExtractor.extract(PAGE, "<html><body>a page</body></html>"),
    ).toBeUndefined();
  });

  it("says nothing when the product object is empty", () => {
    expect(shopifyExtractor.extract(PAGE, withProductJson({}))).toBeUndefined();
  });

  it("is the shopify rung", () => {
    expect(shopifyExtractor.rung).toBe("shopify");
  });

  it("strips a tag with attributes, not just a bare one", () => {
    // Real descriptions are `<p class="desc">`, not `<p>`. A pattern that
    // allows exactly one character inside the tag matches the tidy fixture
    // and leaves the markup in on every real page — where the leftover
    // attribute text then sits between the cue and the composition.
    const html = withProductJson({
      body_html:
        '<div class="product-description"><p data-x="1">Fabric: 88% polyester, 12% elastane</p></div>',
    });
    expect(
      shopifyExtractor.extract(PAGE, html)?.fabricComposition?.parts?.[0]
        ?.materials,
    ).toStrictEqual([
      { material: "polyester", pct: 88 },
      { material: "elastane", pct: 12 },
    ]);
  });

  it("puts a space where a tag was, so neighbouring words stay apart", () => {
    // "Made" and "from" are in separate elements, which is ordinary markup.
    // Deleting the tag instead of replacing it yields "Madefrom", the cue
    // stops matching, and the composition is lost on a page that had one.
    const html = withProductJson({
      body_html: "<p>Made</p><p>from 88% merino</p>",
    });
    expect(
      shopifyExtractor.extract(PAGE, html)?.fabricComposition?.parts?.[0]
        ?.materials,
    ).toStrictEqual([{ material: "merino", pct: 88 }]);
  });

  it.each([
    ['id="ProductJson"', "no suffix on the id"],
    ['id="ProductJson-12345" data-section="main"', "attributes after the id"],
  ])("finds the product script when the tag has %s", (attributes) => {
    const html = `<html><script type="application/json" ${attributes}>${JSON.stringify(
      { title: "Rover Half-Zip" },
    )}</script></html>`;
    expect(shopifyExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it.each([
    ['var meta = {"product":{"vendor":"Janji"}};', "single spaces"],
    ['var  meta  =  {"product":{"vendor":"Janji"}};', "extra spaces"],
    ['var meta={"product":{"vendor":"Janji"}};', "no spaces"],
  ])("reads the analytics blob written with %s", (declaration) => {
    // Themes are minified to different degrees; the spacing is not a
    // convention anyone follows.
    expect(
      shopifyExtractor.extract(
        PAGE,
        `<html><script>${declaration}</script></html>`,
      )?.brand,
    ).toBe("Janji");
  });

  it("reads a cue with no separator after it at all", () => {
    // "Fabric 88% polyester" — no colon, no dash. The separator is optional,
    // and requiring exactly one loses every description written that way.
    const html = withProductJson({
      body_html: "<p>Fabric 88% polyester</p>",
    });
    expect(
      shopifyExtractor.extract(PAGE, html)?.fabricComposition?.parts?.[0]
        ?.materials,
    ).toStrictEqual([{ material: "polyester", pct: 88 }]);
  });

  it("eats the whole separator between cue and composition", () => {
    // "Fabric: - 88% polyester" is four characters of punctuation and space
    // before the fact starts. `verbatim` is what a runner reads and what a
    // later parser re-runs over, so leaving "- " on the front of it is a
    // real defect — and the only one that distinguishes consuming the whole
    // separator from consuming one character of it.
    const html = withProductJson({
      body_html: "<p>Fabric: - 88% polyester</p>",
    });
    expect(
      shopifyExtractor.extract(PAGE, html)?.fabricComposition?.verbatim,
    ).toBe("88% polyester");
  });
});
