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

  it("does not take a script merely because it has an id", () => {
    // Only `ProductJson…` is the product; a theme's other JSON islands
    // carry ids too, and the analytics blob behind them is the real answer.
    const html = `<html><script type="application/json" id="cart-data">${JSON.stringify(
      { title: "Not the product", vendor: "Wrong" },
    )}</script><script>var meta = {"product":{"vendor":"Janji"}};</script></html>`;
    expect(shopifyExtractor.extract(PAGE, html)).toStrictEqual({
      brand: "Janji",
    });
  });

  it("finds the analytics blob in a later script, not only the first", () => {
    // Themes ship many scripts before ShopifyAnalytics; the first without
    // a `var meta` must not end the search.
    const html = `<html><script>var x = 1;</script><script>var meta = {"product":{"vendor":"Janji"}};</script></html>`;
    expect(shopifyExtractor.extract(PAGE, html)?.brand).toBe("Janji");
  });

  it("takes `type` when the JSON uses that name instead", () => {
    const html = withProductJson({ title: "Rover", type: "Tops" });
    expect(shopifyExtractor.extract(PAGE, html)?.categoryHint).toBe("Tops");
  });

  it("reads no composition at all, cued or not", () => {
    // **The rung stopped reading `body_html` for a composition**
    // (2026-09-14). It was the last prose parse left after the text search
    // was retired, and it was never earning its keep: measured over 14 real
    // pages it found a composition on none, because shops put it in
    // metafields and spec panels rather than the description. What it could
    // still do was turn a sale into a fabric once the known-fibre gate came
    // off, so it went too. Composition comes from a declared `material`
    // field or from the model.
    const cued = withProductJson({
      title: "Rover Half-Zip",
      body_html: "<p>Fabric: 88% polyester, 12% elastane</p>",
    });
    const sale = withProductJson({
      title: "Rover Half-Zip",
      body_html: "<p>20% off today! Save 15% with code RUN.</p>",
    });

    for (const html of [cued, sale]) {
      const extracted = shopifyExtractor.extract(PAGE, html);
      expect(extracted?.fabricComposition).toBeUndefined();
      // Everything the rung is still for survives.
      expect(extracted?.name).toBe("Rover Half-Zip");
    }
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
});
