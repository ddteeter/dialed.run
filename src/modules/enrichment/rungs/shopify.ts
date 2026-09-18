import { z } from "zod";

import type { PageExtractor } from "../../../lib/contracts";
import { someExtracted, textAt } from "../extracted";
import { parseJson, readPage, type ScriptBlock } from "../html";

/**
 * The Shopify rung: the platform's own product JSON, which most themes leave
 * inline in the page.
 *
 * It sits between JSON-LD and Open Graph because it is declared like the
 * first but platform-specific like neither. What it adds over JSON-LD is
 * `vendor` and `product_type` — fields schema.org has no good home for — and
 * `body_html`, which is where composition usually ends up.
 *
 * **No second fetch.** `/products/{handle}.json` would be better structured
 * data, and the packet allows one fetch per job. Whether that trade is worth
 * making is left to the fixture capture (design doc, "Open"), because the
 * answer depends on where composition actually lives on the pages we care
 * about — and it would not improve fetch *reliability* at all, being the same
 * origin behind the same bot protection.
 */

/**
`<script type="application/json" id="ProductJson-…">` — the full product.
*/
const PRODUCT_JSON_ID = "ProductJson";

/**
 * `var meta = {…};` — ShopifyAnalytics, carrying rather less.
 *
 * Still a pattern, and rightly: this is JavaScript inside a script body,
 * which no HTML tokenizer reads. The tokenizer's job ends at handing over
 * the body.
 */
const ANALYTICS_META = /var\s+meta\s*=\s*(\{[^\n]*?\});/iu;

/**
The product object, wherever the theme put it.
*/
const analyticsMeta = z.object({ product: z.unknown() });

function isProductJson(script: ScriptBlock): boolean {
  return script.attribs.id?.startsWith(PRODUCT_JSON_ID) ?? false;
}

function productFrom(html: string): unknown {
  const { scripts } = readPage(html);
  const inline = scripts.find((script) => isProductJson(script));
  if (inline !== undefined) return parseJson(inline.body);

  // The analytics path is a parse rather than three guards. Checking the blob
  // was found, then that it parsed, then that the result is a non-null
  // object, is three branches of which only the middle is reachable —
  // `parseJson` already answers the others by failing. `String()` makes a
  // missing blob unparseable text, and zod makes "not an object" a failed
  // parse, so only the reachable case is written down.
  const blob = scripts
    .map((script) => ANALYTICS_META.exec(script.body)?.[1])
    .find((match) => match !== undefined);
  const meta = analyticsMeta.safeParse(parseJson(String(blob)));
  return meta.success ? meta.data.product : undefined;
}

export const shopifyExtractor: PageExtractor = {
  rung: "shopify",
  extract(_url, html) {
    // Per field, like the JSON-LD rung and for the same reason: a shop
    // publishing `title: 42` must not cost us its vendor and description.
    // A zod object over the whole payload would have, and it also read as a
    // near-copy of the garment contract to the clone detector while being a
    // different idea entirely.
    const product = productFrom(html);

    return someExtracted({
      name: textAt(product, "title"),
      brand: textAt(product, "vendor"),
      categoryHint: textAt(product, "product_type") ?? textAt(product, "type"),
      imageUrl: textAt(product, "featured_image"),
    });
  },
};
