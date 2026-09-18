import { z } from "zod";

import type { ExtractedProduct, PageExtractor } from "../../../lib/contracts";
import { someExtracted, textAt } from "../extracted";
import { parseJson, readPage } from "../html";

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

const LD_TYPE = "application/ld+json";

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
 * The schema.org types that describe a product we can read.
 *
 * **`ProductGroup` is the one that matters and the one this first missed.**
 * It is the type for a product with variants — sizes and colours — which is
 * every garment. Nike, Arc'teryx and Smartwool all publish it, and a check
 * for `Product` alone rejected all three: the rung fell through to Open
 * Graph on exactly the pages carrying the richest declared data, silently
 * and on the majors rather than the indies.
 */
const PRODUCT_TYPES = new Set(["product", "productgroup", "productmodel"]);

/**
 * The local name of a schema.org type, with any namespace removed.
 *
 * Shops write it as `Product`, `schema:Product`, or a full
 * `https://schema.org/Product`, so the last colon- or slash-separated
 * segment is the only part that identifies it.
 */
function localType(value: string): string {
  // Index arithmetic rather than `split(...).pop() ?? ""`: split always
  // returns at least one element, so that default is a branch nothing can
  // reach. `lastIndexOf` returns -1 when the separator is absent, and
  // slicing from 0 is exactly the right answer for a bare `Product`.
  const cut = Math.max(value.lastIndexOf(":"), value.lastIndexOf("/"));
  return value.slice(cut + 1).toLowerCase();
}

/**
Is this node a product? `@type` may be a string or a list of them.
*/
function isProduct(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const type: unknown = Reflect.get(value, "@type");
  if (typeof type === "string") return PRODUCT_TYPES.has(localType(type));
  return (
    Array.isArray(type) &&
    type.some(
      (one) => typeof one === "string" && PRODUCT_TYPES.has(localType(one)),
    )
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

/**
 * Name, brand, category and image — and **not** `material`.
 *
 * The rung read `material` into a composition until 2026-09-14 (owner's
 * call). It answered on 2 of 22 real pages, the model answered on 22, and
 * on both of those two it said the same thing; meanwhile the parser behind
 * it had grown visibly weaker than the model — with the fibre gate off,
 * `88% PA 12% EL` parses as one material called `pa el`.
 *
 * So composition has one source now. What this rung is *for* is the cheap
 * declared facts, and there it is carrying the work: name on 19 of 22
 * pages and image on 21, read straight out of a payload the shop
 * published, in microseconds and for nothing. Asking a model what a page's
 * title is would be paying tokens and seconds to learn something stated in
 * a tag.
 */
function productFrom(node: object): ExtractedProduct | undefined {
  return someExtracted({
    name: textAt(node, "name"),
    brand: firstOf(NAMED, Reflect.get(node, "brand")),
    categoryHint: textAt(node, "category"),
    imageUrl: firstOf(LINKED, Reflect.get(node, "image")),
  });
}

export const jsonLdExtractor: PageExtractor = {
  rung: "jsonld",
  extract(_url, html) {
    for (const { attribs, body } of readPage(html).scripts) {
      // Case-folded: the type is a MIME string, and shops write it both ways.
      if (attribs.type?.toLowerCase() !== LD_TYPE) continue;
      const node = findProduct(parseJson(body));
      if (node === undefined) continue;
      const extracted = productFrom(node);
      if (extracted !== undefined) return extracted;
    }
    // Falls off the end: no block held a Product this rung could read.
  },
};
