import { z } from "zod";

import type { ExtractedProduct, PageExtractor } from "../../../lib/contracts";
import { parseComposition } from "../composition";
import { someExtracted, textAt } from "../extracted";
import { parseJson, scriptBodies } from "../html";

/**
 * The JSON-LD rung: schema.org `Product`, which is the closest a product page
 * comes to telling us the truth on purpose.
 *
 * It is first in the ladder because it is *declared* rather than inferred — a
 * shop publishing it has said "this is the name, this is the brand", where
 * every other rung is us guessing from markup.
 *
 * **Every field is a trust boundary and each is parsed alone.** This is JSON
 * from a page we do not control. Parsing the node as one object would mean a
 * shop that publishes `name: 42` loses its brand, image and material too;
 * per-field parsing drops the bad value and keeps the rest.
 */

/**
`<script type="application/ld+json">…</script>`, attributes in any order.
*/
const LD_BLOCK =
  /<script[^>]{0,500}type=["']application\/ld\+json["'][^>]{0,500}>/giu;

/**
 * schema.org is permissive about shape: a value may be a string, an object
 * carrying `name`/`url`, or a list of either. Each reduces to one string.
 */
const NAMED = z.union([
  z.string(),
  z.object({ name: z.string() }).transform((value) => value.name),
]);

const LINKED = z.union([
  z.string(),
  z.object({ url: z.string() }).transform((value) => value.url),
]);

function firstOf<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const one = schema.safeParse(value);
  if (one.success) return one.data;
  const many = z.array(schema).nonempty().safeParse(value);
  return many.success ? many.data[0] : undefined;
}

/**
Is this node a Product? `@type` may be a string or a list of them.
*/
function isProduct(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const type: unknown = Reflect.get(value, "@type");
  if (typeof type === "string") return type.endsWith("Product");
  return (
    Array.isArray(type) &&
    type.some((one) => typeof one === "string" && one.endsWith("Product"))
  );
}

/**
 * Find the Product node anywhere in a document.
 *
 * A page may publish one node, a list, or an `@graph` holding a dozen —
 * Organization, BreadcrumbList, WebPage, and the Product among them. Walking
 * is the only shape-agnostic way, and the depth bound keeps a hostile
 * document from costing us the isolate.
 */
function findProduct(value: unknown, depth = 0): object | undefined {
  if (depth > 6) return undefined;
  if (isProduct(value)) return value;
  if (typeof value !== "object" || value === null) return undefined;
  for (const item of Object.values(value)) {
    const found = findProduct(item, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function productFrom(node: object): ExtractedProduct | undefined {
  const name = textAt(node, "name");
  const categoryHint = textAt(node, "category");
  const material = textAt(node, "material");
  const brand = firstOf(NAMED, Reflect.get(node, "brand"));
  const imageUrl = firstOf(LINKED, Reflect.get(node, "image"));
  const fabricComposition =
    material === undefined ? undefined : parseComposition(material);

  return someExtracted({
    name,
    brand,
    categoryHint,
    imageUrl,
    fabricComposition,
  });
}

export const jsonLdExtractor: PageExtractor = {
  rung: "jsonld",
  extract(_url, html) {
    // Sliced to the closing tag rather than captured: a `([^<]*)` group
    // stops at the first `<` inside the payload, so any block carrying
    // markup in a description truncated and failed to parse. See ../html.
    for (const json of scriptBodies(html, LD_BLOCK)) {
      const node = findProduct(parseJson(json));
      if (node === undefined) continue;
      const extracted = productFrom(node);
      if (extracted !== undefined) return extracted;
    }
    // Falls off the end: no block held a Product this rung could read.
  },
};
