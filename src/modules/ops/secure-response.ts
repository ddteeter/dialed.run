import { withInlineScriptHashes } from "./inline-script-hashes";
import { isPubliclyStorable } from "./public-cache";
import { CSP_REPORT_PATH } from "./csp-report";
import { withSecurityHeaders } from "./security-headers";

/**
 * What `server.ts` calls: every response the Worker generates, with the
 * security headers, reporting CSP violations to our own collector
 * (`./csp-report`).
 *
 * Inline scripts are admitted by this request's `nonce`, unless the page
 * may be stored at the edge (design 163): then by their hashes, read from
 * the page, so the stored copy names no nonce. The same happens when no
 * nonce was minted (an open-web path), whatever the response
 * turned out to be — a not-found or an error page on that path has
 * scripts too, and no nonce on them.
 */
export async function secureResponse(
  response: Response,
  nonce: string | undefined,
): Promise<Response> {
  // SA-L19: reports go to our own collector, never straight to Sentry.
  const reportUri = CSP_REPORT_PATH;
  if (nonce !== undefined && !isPubliclyStorable(response)) {
    return withSecurityHeaders(response, reportUri, { nonce });
  }
  if (nonce !== undefined && isHtml(response)) {
    return withSecurityHeaders(neverStored(response), reportUri, { nonce });
  }
  const { page, hashes } = await withInlineScriptHashes(response);
  return withSecurityHeaders(page, reportUri, { hashes });
}

/**
 * SA-M15: a nonce means `server.ts` did not read the path as the open web,
 * so the root route may have read the session into this page. Such a page
 * is never left for the edge to store, whatever a route set. Only an HTML
 * document carries the root's answer: a share card or a server function's
 * own response keeps its `public`.
 */
function isHtml(response: Response): boolean {
  return String(response.headers.get("Content-Type")).includes("text/html");
}

function neverStored(response: Response): Response {
  const page = new Response(response.body, response);
  page.headers.set("Cache-Control", "private, no-store");
  return page;
}
