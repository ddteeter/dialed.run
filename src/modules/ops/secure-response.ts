import { env } from "../../env";
import { sentryReportUri, withSecurityHeaders } from "./security-headers";

/**
 * What `server.ts` calls: every response the Worker generates, with the
 * security headers, reporting CSP violations to the deployed DSN.
 */
export function secureResponse(response: Response): Response {
  return withSecurityHeaders(response, sentryReportUri(env.SENTRY_DSN));
}
