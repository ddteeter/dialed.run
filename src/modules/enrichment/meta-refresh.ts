import { z } from "zod";

import { readPage } from "./html";

/**
 * `<meta http-equiv="refresh">`, read as the redirect it is (R-176, design
 * 171).
 *
 * A page that says `content="0; url=https://elsewhere"` sends a browser on
 * as surely as a 302 does, so a shortener or an open redirect can use one
 * to carry a link past the denylist. `fetchProductPage` follows it as one
 * more hop, under the same limit and the same checks as a 3xx.
 *
 * The page is read with the tokenizer every rung uses, never a pattern
 * over the markup (`html.ts` says why). Only the attribute's value is
 * parsed, through the schema below: a delay, a `;` or `,`, an optional
 * `url=`, and the target, optionally quoted. The delay is not read: a
 * browser follows a slow refresh too, and so does this.
 */

/**
 * The delay and its separator. Anchored and with no two runs that can
 * match the same character, so a hostile attribute cannot make it
 * backtrack.
 */
const DELAY = /^\s*\d+(?:\.\d*)?\s*[;,]/u;
const URL_LABEL = /^url\s*=/iu;
const QUOTED = /^(?<quote>["'])(?<inner>.*)\k<quote>$/su;

/**
 * The target in a refresh's `content`, or a failed parse when there is
 * none: `"5"` reloads the page itself, which is not a redirect.
 */
const refreshContent = z
  .string()
  .regex(DELAY)
  // The delay holds no separator, so the first one is the delay's.
  .transform((content) => content.slice(content.search(/[;,]/u) + 1).trim())
  .transform((rest) =>
    rest.replace(URL_LABEL, "").trim().replace(QUOTED, "$<inner>"),
  )
  .pipe(z.string().min(1));

/**
 * Where this page's refresh sends a browser, resolved against the page, or
 * nothing when it sends it nowhere new.
 *
 * The first refresh with a target wins, as in a browser. A refresh back
 * to the same page (a fragment aside) is a reload, not a hop: following it
 * would spend the hop limit and fail a page that is simply there. A target
 * that does not resolve leaves the page as the answer: a 3xx with no
 * usable target is a broken response, but this page loaded.
 */
export function refreshTarget(html: string, pageUrl: URL): URL | undefined {
  const here = withoutFragment(pageUrl.href);
  for (const meta of readPage(html).metas) {
    if (meta["http-equiv"]?.toLowerCase() !== "refresh") continue;
    const target = refreshContent.safeParse(meta.content).data;
    if (target === undefined) continue;
    const next = URL.parse(target, pageUrl);
    return next === null || withoutFragment(next.href) === here
      ? undefined
      : next;
  }
  return undefined;
}

function withoutFragment(href: string): string {
  const url = new URL(href);
  url.hash = "";
  return url.href;
}
