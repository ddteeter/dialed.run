/**
 * Reading `<script>` payloads out of a page.
 *
 * **A capture group cannot do this, and the first version of both rungs
 * tried.** `>([^<]*)</script>` stops at the first `<` inside the payload —
 * so a Shopify product whose `body_html` holds `<p>Built for cold
 * mornings.</p>` truncates mid-string, the JSON fails to parse, and the rung
 * reports nothing at all. The same is true of any JSON-LD block carrying
 * markup in a description.
 *
 * Lazy matching to `</script>` fixes it and backtracks super-linearly on a
 * page with an unclosed tag, which is markup someone else controls. Finding
 * the opening tag and slicing to the next `</script>` is linear and cannot
 * be fooled by content — a script body may hold anything except that
 * sequence, which is exactly what the HTML spec guarantees.
 */

const CLOSE = "</script>";

/**
 * JSON out of a page, or nothing.
 *
 * Shared by the rungs that read embedded payloads. A malformed block is
 * skipped rather than fatal: pages routinely ship one broken script beside a
 * good one, and a throw here would lose the whole rung.
 */
export function parseJson(json: string): unknown {
  /**
   * **Equivalent mutant: emptying the catch changes nothing.**
   *
   * `catch {}` falls off the end of the function, which is `undefined` — the
   * same value the explicit return produces. That is by design rather than
   * by accident: malformed JSON and "nothing useful in this block" must both
   * make the caller move on, so no caller can distinguish them. Making it
   * observable would mean inventing behaviour to satisfy a mutant.
   *
   * A block pair rather than `next-line`: the mutated line opens with
   * `} catch`, and `next-line` does not attach to a line beginning with a
   * closing brace.
   */
  // Stryker disable BlockStatement
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed;
  } catch {
    return undefined;
  }
  // Stryker restore BlockStatement
}

export function scriptBodies(html: string, openTag: RegExp): string[] {
  const bodies: string[] = [];
  for (const open of html.matchAll(openTag)) {
    const from = open.index + open[0].length;
    const to = html.indexOf(CLOSE, from);
    // An unclosed script is the end of the usable document, not a reason to
    // keep scanning: everything after it is inside that script.
    if (to === -1) break;
    bodies.push(html.slice(from, to));
  }
  return bodies;
}

/**
 * The page with its `<script>` and `<style>` bodies removed.
 *
 * **A bounded regex cannot do this either.** `<script[^>]*>[\s\S]{0,N}?</script>`
 * silently fails to match any block longer than N — and a product page ships
 * scripts far larger than a sane N. The consequence was specific: the rabbit
 * fixture's embedded JSON survived stripping, and a composition search over
 * it read `\u0026amp;amp;` as a fibre called "amp".
 *
 * One pass per tag name, so no capture group is needed to know which closing
 * tag to look for — and therefore no unreachable default on it.
 */
function withoutTag(html: string, tag: string): string {
  const open = new RegExp(String.raw`<${tag}\b[^>]{0,500}>`, "giu");
  const close = `</${tag}>`;
  let out = "";
  let cursor = 0;
  for (const match of html.matchAll(open)) {
    if (match.index < cursor) continue;
    const from = match.index + match[0].length;
    const end = html.indexOf(close, from);
    out += `${html.slice(cursor, match.index)} `;
    cursor = end === -1 ? html.length : end + close.length;
  }
  return out + html.slice(cursor);
}

export function withoutCode(html: string): string {
  return withoutTag(withoutTag(html, "script"), "style");
}

/**
 * The page's text nodes — everything that is not inside a tag.
 *
 * **A bounded regex cannot do this, and `<[^>]{0,2000}>` is the third time
 * that lesson has been paid for in this file.** Splitting on it means a tag
 * longer than the bound is not recognised as a tag at all, so the whole
 * opening tag — attribute names, quotes and value — arrives as prose.
 *
 * That is not a rare page. Measured against the eight sampled product pages,
 * **every one** carries a tag over the bound: 9,810 characters at the
 * shortest and 119,410 at the longest, because a Shopify theme renders the
 * entire product JSON into a `data-product` attribute. On the rabbit page
 * that blob was the first node a composition parsed out of, so `verbatim`
 * became ten kilobytes of markup and the parts were the same two fabrics
 * listed twice. On the other seven a real node happened to win first, which
 * is why it stayed invisible.
 *
 * Unbounding the quantifier is not the fix either — `<[^>]*>` over a page
 * with an unclosed quote is the backtracking shape the header warns about.
 * An index walk is linear and has no bound to outgrow.
 *
 * A `<` with no `>` after it ends the document: everything past it sits
 * inside that tag, so far as a parser can tell, and is not text.
 */
export function textNodes(html: string): string[] {
  const nodes: string[] = [];
  let cursor = 0;
  for (;;) {
    const open = html.indexOf("<", cursor);
    if (open === -1) {
      nodes.push(html.slice(cursor));
      return nodes;
    }
    nodes.push(html.slice(cursor, open));
    const close = html.indexOf(">", open);
    if (close === -1) return nodes;
    cursor = close + 1;
  }
}

/**
 * HTML entities, removed before anything reads the text.
 *
 * A description arrives with `&amp;` in it — often double-encoded, as
 * `&amp;amp;` — and a letter-run match turns that into a fibre called "amp".
 *
 * Decoded before stripping, and that order is the point: stripping
 * `&amp;amp;` twice leaves a bare `amp;`, because the second pass has no `&`
 * left to match. Decoding to `&` first collapses the nesting, and whatever
 * entities remain are then removed.
 *
 * `\u0026` is the same character arriving through JSON, which reaches this
 * from product data embedded in an *attribute* — a value containing `>`
 * spills past naive tag splitting and lands in the text. Stripping scripts
 * does not catch it, because it was never in a script.
 */
const AMPERSAND = /&amp;|\\u0026/giu;
const ENTITY = /&#?[a-z0-9]{1,8};/giu;

/**
 * A text node as a reader would see it: entities resolved, whitespace
 * collapsed.
 *
 * Decoded until it stops changing rather than a fixed number of passes. The
 * nesting is genuinely three deep in the wild — `\u0026amp;amp;` unwraps to
 * `&amp;amp;`, then `&amp;`, then `&` — and stopping one short leaves an
 * entity the strip below eats, taking the separator between two fibres with
 * it and merging them into one nonsense material.
 */
export function readableText(raw: string): string {
  // Until it stops changing, with no pass counter. Every decode strictly
  // shortens the string — `&amp;` and `\u0026` are both longer than the `&`
  // they become — so this terminates, and a bound would only be a number
  // nothing could distinguish from a larger one.
  let decoded = raw;
  let next = decoded.replaceAll(AMPERSAND, "&");
  // Compared against the *result* rather than a seeded previous value: any
  // seed is a string the first comparison can never depend on, which is a
  // mutant nothing distinguishes.
  while (next !== decoded) {
    decoded = next;
    next = decoded.replaceAll(AMPERSAND, "&");
  }
  return decoded.replaceAll(ENTITY, " ").replaceAll(/\s+/gu, " ").trim();
}
