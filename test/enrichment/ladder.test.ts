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
    // The rule the whole ladder exists for. JSON-LD names the product,
    // Shopify's payload has the vendor, and the only image is an og tag. A
    // ladder that stopped at the first rung to return anything would have
    // the name and nothing else.
    const html = `<html><head>
      ${ldBlock({ name: "Rover Half-Zip" })}
      ${ogBlock("og:image", "https://cdn.example.com/rover.jpg")}
    </head><body>
      ${shopifyBlock({ vendor: "Janji" })}
    </body></html>`;

    const { extracted } = runLadder(PAGE, html);
    expect(extracted.name).toBe("Rover Half-Zip");
    expect(extracted.brand).toBe("Janji");
    expect(extracted.imageUrl).toBe("https://cdn.example.com/rover.jpg");
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

  it("produces no composition at all, from any rung", () => {
    // **The ladder stopped answering this field** (owner, 2026-09-14). The
    // prose search went first, then the Shopify rung's cued read of
    // `body_html`, then the JSON-LD rung's `material` — which answered on
    // 2 of 22 real pages against the model's 22 and agreed with it on
    // both. Composition has one source, and the consumer runs it after
    // this.
    //
    // Both are in the page here, and neither is in the answer.
    const html = `${ldBlock({
      name: "Rover Half-Zip",
      material: "100% merino wool",
    })}<p>Fabric: 88% polyester, 12% elastane</p>`;
    const { extracted, rung } = runLadder(PAGE, html);
    expect(extracted.name).toBe("Rover Half-Zip");
    expect(extracted.fabricComposition).toBeUndefined();
    expect(rung).toBe("jsonld");
  });
});
