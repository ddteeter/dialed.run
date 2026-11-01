import { env } from "../../env";
import { withInlineScriptHashes } from "./inline-script-hashes";
import { isPubliclyStorable } from "./public-cache";
import { sentryReportUri, withSecurityHeaders } from "./security-headers";

/**
 * What `server.ts` calls: every response the Worker generates, with the
 * security headers, reporting CSP violations to the deployed DSN.
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
  const reportUri = sentryReportUri(env.SENTRY_DSN);
  if (nonce !== undefined && !isPubliclyStorable(response)) {
    return withSecurityHeaders(response, reportUri, { nonce });
  }
  const { page, hashes } = await withInlineScriptHashes(response);
  return withSecurityHeaders(page, reportUri, { hashes });
}
