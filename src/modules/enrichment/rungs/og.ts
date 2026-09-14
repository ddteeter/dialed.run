import type { ExtractedProduct, PageExtractor } from "../../../lib/contracts";

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
 */

/**
 * Meta tags first, attributes second.
 *
 * The obvious shape is one pattern per attribute order — `property` before
 * `content` and the reverse — because themes emit both. That needs two
 * near-identical regexes, and it makes every "did the group participate"
 * check unreachable, since a match always binds both.
 *
 * Finding the tags and then asking each one for its attributes is shorter,
 * handles any attribute order for free, and makes those checks *real*: a
 * `<meta charset="utf-8">` genuinely has neither, and skipping it is
 * behaviour worth asserting rather than a branch nothing reaches.
 */
const META_TAG = /<meta\b[^>]*>/giu;
const PROPERTY = /property=["']([^"']*)["']/iu;
const CONTENT = /content=["']([^"']*)["']/iu;
const OG = "og:";

/**
Every og:* value on the page.
*/
function openGraph(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  // `matchAll` rather than `match`, because `match` returns null for a page
  // with no meta tags and the `?? []` that handles it is unkillable: the
  // only way a mutant could change that default is by supplying a string,
  // which the property guard below then skips anyway. `matchAll` yields
  // nothing instead of null, and `match[0]` is typed `string`, so the whole
  // branch stops existing.
  for (const match of html.matchAll(META_TAG)) {
    const tag = match[0];
    // The whole property is captured and the `og:` prefix checked here,
    // rather than baked into the pattern. That is what makes the filter
    // real: a page carrying `property="title"` would otherwise land under
    // the same key `og:title` uses and win, because first occurrence wins.
    const property = PROPERTY.exec(tag)?.[1];
    if (!property?.startsWith(OG)) continue;
    const key = property.slice(OG.length);
    // A property with no content attribute is not a value, and neither is an
    // empty one — storing either would block a later tag that has one.
    const value = CONTENT.exec(tag)?.[1] ?? "";
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
