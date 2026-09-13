import { describe, expect, it } from "vitest";

import { runLadder } from "../../src/modules/enrichment/ladder";

const PAGE = new URL("https://shop.example.com/products/rover-half-zip");

function ldBlock(node: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    ...node,
  })}</script>`;
}

function shopifyBlock(product: Record<string, unknown>): string {
  return `<script type="application/json" id="ProductJson-1">${JSON.stringify(
    product,
  )}</script>`;
}

function ogBlock(property: string, content: string): string {
  return `<meta property="${property}" content="${content}">`;
}

describe("runLadder", () => {
  it("takes the best source for each field, not the first that answers", () => {
    // The rule the whole ladder exists for. JSON-LD names the product but
    // declares no material; the composition is in Shopify's description; the
    // only image is an og tag. A ladder that stopped at the first rung to
    // return anything would have the name and nothing else.
    const html = `<html><head>
      ${ldBlock({ name: "Rover Half-Zip" })}
      ${ogBlock("og:image", "https://cdn.example.com/rover.jpg")}
    </head><body>
      ${shopifyBlock({
        vendor: "Janji",
        body_html: "<p>Fabric: 88% polyester, 12% elastane</p>",
      })}
    </body></html>`;

    const { extracted } = runLadder(PAGE, html);
    expect(extracted.name).toBe("Rover Half-Zip");
    expect(extracted.brand).toBe("Janji");
    expect(extracted.imageUrl).toBe("https://cdn.example.com/rover.jpg");
    expect(extracted.fabricComposition?.verbatim).toBe(
      "88% polyester, 12% elastane",
    );
  });

  it("lets the earlier rung win a field both rungs have", () => {
    // Best-first: JSON-LD is a shop saying what the product is, Shopify's
    // blob is the platform saying it, and og is a preview card.
    const html = `${ldBlock({ name: "From JSON-LD" })}
      ${shopifyBlock({ title: "From Shopify" })}
      ${ogBlock("og:title", "From OG")}`;
    expect(runLadder(PAGE, html).extracted.name).toBe("From JSON-LD");
  });

  it("records the deepest rung that contributed, not the highest", () => {
    // The column's job is to say whether re-running could help. Everything
    // here came from JSON-LD except the composition, which needed Shopify's
    // description — recording "jsonld" would hide the part a later parser or
    // model could actually improve.
    const html = `${ldBlock({ name: "Rover Half-Zip", brand: "Janji" })}
      ${shopifyBlock({ body_html: "<p>Fabric: 100% merino</p>" })}`;
    expect(runLadder(PAGE, html).rung).toBe("shopify");
  });

  it("records the highest rung when nothing deeper adds anything", () => {
    // The other direction: a later rung that repeats what is already known
    // contributed nothing, so it must not claim the record.
    const html = `${ldBlock({ name: "Rover Half-Zip" })}
      ${ogBlock("og:title", "Rover Half-Zip")}`;
    expect(runLadder(PAGE, html).rung).toBe("jsonld");
  });

  it("says `none` for a page no rung could read", () => {
    // A real answer, not a failure: this is the page that needs the model
    // rung, and the one worth looking at by hand.
    const result = runLadder(PAGE, "<html><body>a page</body></html>");
    expect(result.rung).toBe("none");
    expect(result.extracted).toStrictEqual({});
  });

  it("reads an og-only page", () => {
    const html = ogBlock("og:title", "Rover Half-Zip");
    expect(runLadder(PAGE, html)).toStrictEqual({
      extracted: { name: "Rover Half-Zip" },
      rung: "og",
    });
  });
});
