import type { ExtractedProduct, PageExtractor } from "../../../lib/contracts";
import { readPage } from "../html";

/**
 * The Open Graph rung: the last deterministic one, and the least ambitious.
 *
 * OG tags exist so a link renders nicely in a chat app, which is why almost
 * every page has them and why they carry so little — a title, an image, a
 * description written for a preview card. There is no `material`, no brand
 * field, no composition. This rung is what stops a page yielding *nothing*.
 *
 * **It does not read `og:description`, deliberately.** A description is
 * marketing prose, and a composition parser asked only for a percentage beside
 * words — "20% off" would become a fibre called `off`. Telling a composition
 * from a discount is a semantic judgement, so prose belongs to the model
 * rung and this one stays with what is declared.
 *
 * **Read through the tokenizer, not a pattern** — see `../html.ts` for the
 * measurement. `content=["']([^"']*)["']` stopped at the first apostrophe,
 * so `Men's WoolTech Half Tights` reached the row as `Men` on nine of the
 * 22 eval pages, and `Arc'teryx` as `Arc`. A meta tag's attributes come
 * out of the tokenizer in any order, in either quote, decoded.
 */

const OG = "og:";

/**
Every og:* value on the page, first occurrence winning.
*/
function openGraph(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const attribs of readPage(html).metas) {
    // The whole property is read and the `og:` prefix checked here, rather
    // than matched loosely: a page carrying `property="title"` would
    // otherwise land under the same key `og:title` uses and win, because
    // first occurrence wins.
    const property = attribs.property;
    if (!property?.startsWith(OG)) continue;
    const key = property.slice(OG.length);
    // A property with no content attribute is not a value, and neither is an
    // empty one — storing either would block a later tag that has one.
    const value = attribs.content ?? "";
    if (value !== "" && !tags.has(key)) tags.set(key, value);
  }
  return tags;
}

export const openGraphExtractor: PageExtractor = {
  rung: "og",
  extract(_url, html) {
    const tags = openGraph(html);
    const name = tags.get("title");
    // `og:site_name` is the shop, which is the brand often enough to be
    // worth taking and wrong often enough to be worth saying so: on a
    // multi-brand retailer it is the retailer. A later rung, or a human,
    // overrides it — extraction only ever fills what is blank.
    const brand = tags.get("site_name");
    const imageUrl = tags.get("image");

    const extracted: ExtractedProduct = {
      ...(name !== undefined && { name }),
      ...(brand !== undefined && { brand }),
      ...(imageUrl !== undefined && { imageUrl }),
    };
    return Object.keys(extracted).length > 0 ? extracted : undefined;
  },
};
