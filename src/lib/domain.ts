/**
 * The domain of a product link, for the two places that need one: the
 * denylist check on the server, and the bare host a component renders
 * beside the link text so a runner can see where it goes before following
 * it (packet §3).
 *
 * In `lib/` because a component cannot import the denylist — that file
 * reaches D1, and a route is in the client bundle. Copying the function
 * instead would be the rival truth CLAUDE.md warns about, on the one
 * function where a disagreement means a denied domain rendering as
 * allowed.
 */
/**
 * The host of a URL, lowercased and without a leading `www.`, or
 * `undefined` when the string is not a parseable https URL.
 *
 * **`www.` is stripped, and that is a judgement.** A denylist entry for
 * `example.com` should catch `www.example.com`, because a runner reading
 * the rendered domain cannot tell them apart and an operator adding one
 * entry means both. It does *not* strip other subdomains: `shop.example.com`
 * stays distinct, because those genuinely are different sites.
 *
 * Non-https returns undefined rather than throwing: 101 already rejected
 * those at save, so reaching here with one means a stored value predating
 * that rule, and a stored oddity should render as "no domain" rather than
 * take down the page.
 *
 * **An absent URL is one of the answers, not a case for the caller.**
 * `productUrl` is optional on every garment, so the callers were each
 * guarding for it first — and that guard was a branch no test could
 * reach, since an unparseable string and a missing one leave here by the
 * same `catch` with the same `undefined`.
 *
 * Which is also why there is no `=== undefined` check here: it would be
 * the same unreachable branch moved one level down. `String(undefined)`
 * is `"undefined"`, which is not a URL, so the parse refuses it exactly
 * as it refuses any other rubbish — one path, and the one the tests
 * already cover.
 */
export function domainOf(url: string | undefined): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  const host = parsed.hostname.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}
