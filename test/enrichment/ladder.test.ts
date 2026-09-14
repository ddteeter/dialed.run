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
    // The rule the whole ladder exists for. JSON-LD names the product and
    // declares the material; Shopify's payload has the vendor; the only
    // image is an og tag. A ladder that stopped at the first rung to return
    // anything would have the name and nothing else.
    const html = `<html><head>
      ${ldBlock({
        name: "Rover Half-Zip",
        material: "88% polyester, 12% elastane",
      })}
      ${ogBlock("og:image", "https://cdn.example.com/rover.jpg")}
    </head><body>
      ${shopifyBlock({ vendor: "Janji" })}
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
    // The column's job is to say whether re-running could help. The name
    // came from JSON-LD and the vendor from Shopify's payload — recording
    // "jsonld" would hide the rung that actually added something.
    const html = `${ldBlock({ name: "Rover Half-Zip" })}
      ${shopifyBlock({ vendor: "Janji" })}`;
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

  it("leaves composition alone when no rung declares one", () => {
    // **The prose search used to answer here, and was retired** (owner,
    // 2026-09-14). It lost every section after the first on a
    // multi-component garment, could not read `88% PA 12% EL`, and on one
    // page answered with marketing copy. Composition now comes from the
    // model rung, and an empty column is the honest state until it does —
    // a product with no composition is one the app renders and a person can
    // correct, where a plausible wrong one is neither.
    const html = `${ldBlock({ name: "Rover Half-Zip" })}
      <div class="specs"><p>Fabric: 88% polyester, 12% elastane</p></div>`;
    const { extracted, rung } = runLadder(PAGE, html);
    expect(extracted.name).toBe("Rover Half-Zip");
    expect(extracted.fabricComposition).toBeUndefined();
    expect(rung).toBe("jsonld");
  });

  it("still takes a composition a shop declares in JSON-LD", () => {
    // What is left is declared data: a `material` field a shop published,
    // handed to the same `parseComposition` as before. Reading a published
    // field is not the act that was retired.
    const html = ldBlock({
      name: "Rover Half-Zip",
      material: "88% polyester, 12% elastane",
    });
    const { extracted, rung } = runLadder(PAGE, html);
    expect(extracted.fabricComposition?.parts?.[0]?.materials).toStrictEqual([
      { material: "polyester", pct: 88 },
      { material: "elastane", pct: 12 },
    ]);
    expect(rung).toBe("jsonld");
  });

  it("prefers a declared material over one found in prose", () => {
    // JSON-LD's `material` is a shop stating the composition; the page text
    // is us inferring it. When both exist the declared one wins, and the
    // recorded rung does not drop to "text" for a field already filled.
    const html = `${ldBlock({
      name: "Rover Half-Zip",
      material: "100% merino wool",
    })}<p>Fabric: 88% polyester, 12% elastane</p>`;
    const { extracted, rung } = runLadder(PAGE, html);
    expect(extracted.fabricComposition?.verbatim).toBe("100% merino wool");
    expect(rung).toBe("jsonld");
  });
});
