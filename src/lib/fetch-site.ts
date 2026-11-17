/**
 * Whether the runner's own browsing caused a request, read from the
 * browser's fetch metadata (`Sec-Fetch-Site`).
 *
 * A server function called over HTTP is checked by the CSRF middleware in
 * `src/start.ts`. A route loader's call during a server render is not: it
 * runs in-process, and the request it sees is the page's GET. An effect
 * that such a call has (a write, a billed lookup) asks this instead.
 *
 * - `same-origin`: a page of this app asked.
 * - `none`: the runner typed the address, or opened a bookmark.
 * - absent: a browser that sends no fetch metadata, or a client that is
 *   not a browser. Nothing can be told about it, and refusing it would
 *   refuse those browsers' runners.
 * - `same-site`, `cross-site`: another site, or another host under this
 *   domain, sent the runner here. Not the runner's own doing.
 *
 * Isomorphic and import-free: `getRequestHeaders()` on the server hands
 * it the request's headers.
 */
export function isFirstPartyRequest(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}
