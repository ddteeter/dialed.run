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
