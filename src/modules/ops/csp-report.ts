/**
 * The CSP report collector (SA-L19, owner 2026-11-15): `POST
 * /api/csp-report`, where every policy the Worker sends points its
 * `report-uri`. A report is posted by the browser, so what it carries is
 * the visitor's: the page's full URL and their address. Here, on our own
 * origin, it is cut to what an operator needs: the directive, the page's
 * path with no query, and the origin of what was blocked. Only that goes
 * to Sentry, through the Worker, so no query string, token or IP address
 * leaves. Always answers 204, so a probe learns nothing.
 */
import { z } from "zod";

import { readCappedText } from "../../lib/read-capped";
import { captureException } from "./sentry";

/**
Where the policy sends its reports: our own origin, never a third party.
*/
export const CSP_REPORT_PATH = "/api/csp-report";

/**
 * A report is a few hundred bytes; anything far past it is not one, and
 * is refused before it is held.
 */
const MAX_REPORT_BYTES = 8 * 1024;

const reportSchema = z.object({
  "csp-report": z.object({
    "document-uri": z.string().max(2048),
    "effective-directive": z.string().max(64).optional(),
    "violated-directive": z.string().max(256).optional(),
    "blocked-uri": z.string().max(2048).optional(),
  }),
});

/**
What is forwarded: nothing that names the visitor, or carries a query.
*/
export interface ForwardedReport {
  readonly directive: string;
  readonly page: string;
  readonly blocked: string;
}

export interface CspReportDeps {
  readonly forward: (report: ForwardedReport) => void;
}

export function cspReportDepsFromEnv(): CspReportDeps {
  return {
    forward: (report) => {
      captureException(new Error("csp violation"), { ...report });
    },
  };
}

export async function receiveCspReport(
  request: Request,
  deps: CspReportDeps,
): Promise<Response> {
  const report = await readReport(request);
  if (report !== undefined) deps.forward(report);
  return new Response(undefined, { status: 204 });
}

async function readReport(
  request: Request,
): Promise<ForwardedReport | undefined> {
  let text: string;
  try {
    text = await readCappedText(
      request,
      MAX_REPORT_BYTES,
      () => new Error("too large"),
    );
  } catch {
    return undefined;
  }
  const parsed = reportSchema.safeParse(parseJson(text));
  if (!parsed.success) return undefined;
  const body = parsed.data["csp-report"];
  return {
    directive:
      body["effective-directive"] ?? firstWord(body["violated-directive"]),
    page: pathOf(body["document-uri"]),
    blocked: originOf(body["blocked-uri"]),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function firstWord(value: string | undefined): string {
  return String(value).split(" ", 1)[0] ?? "";
}

/**
The page's path alone: no origin, no query, no fragment.
*/
function pathOf(uri: string): string {
  return URL.parse(uri)?.pathname ?? "";
}

/**
 * What was blocked, as its origin, or a keyword the browser sends in place
 * of a URL (`inline`, `eval`, `data`); never a path or query of another
 * site's, which could carry anything.
 */
function originOf(uri: string | undefined): string {
  const url = URL.parse(String(uri));
  if (url === null) return keywordOf(String(uri));
  return url.origin === "null" ? keywordOf(url.protocol.slice(0, -1)) : url.origin;
}

const KEYWORDS: ReadonlySet<string> = new Set([
  "inline",
  "eval",
  "data",
  "blob",
  "wasm-eval",
  "trusted-types-policy",
  "trusted-types-sink",
]);

function keywordOf(word: string): string {
  return KEYWORDS.has(word) ? word : "other";
}
