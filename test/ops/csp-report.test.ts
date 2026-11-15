import { describe, expect, it } from "vitest";

import {
  CSP_REPORT_PATH,
  receiveCspReport,
  type ForwardedReport,
} from "../../src/modules/ops/csp-report";

/**
 * The CSP report collector (SA-L19): what a browser posts is cut to the
 * directive, the page's path and the blocked origin before anything is
 * forwarded, and every request answers 204.
 */
function post(body: string, type = "application/csp-report"): Request {
  return new Request(`https://dialed.run${CSP_REPORT_PATH}`, {
    method: "POST",
    headers: { "content-type": type },
    body,
  });
}

async function received(body: string): Promise<ForwardedReport[]> {
  const forwarded: ForwardedReport[] = [];
  const response = await receiveCspReport(post(body), {
    forward: (report) => {
      forwarded.push(report);
    },
  });
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  return forwarded;
}

function report(fields: Record<string, string>): string {
  return JSON.stringify({ "csp-report": fields });
}

describe("receiveCspReport", () => {
  it("is our own path", () => {
    expect(CSP_REPORT_PATH).toBe("/api/csp-report");
  });

  it("drops the query from every URL it forwards, and the referrer altogether", async () => {
    const forwarded = await received(
      report({
        "document-uri": "https://dialed.run/account/reset?token=SECRET#x",
        referrer: "https://mail.example/inbox?id=SECRET",
        "violated-directive": "script-src-elem 'self'",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://extension.example/inject.js?k=SECRET",
        "original-policy": "default-src 'self'",
      }),
    );

    expect(forwarded).toStrictEqual([
      {
        directive: "script-src-elem",
        page: "/account/reset",
        blocked: "https://extension.example",
      },
    ]);
    expect(JSON.stringify(forwarded)).not.toContain("SECRET");
  });

  it("reads the directive from violated-directive when no effective one is sent", async () => {
    const [forwarded] = await received(
      report({
        "document-uri": "https://dialed.run/feed",
        "violated-directive": "font-src 'self'",
        "blocked-uri": "inline",
      }),
    );
    expect(forwarded).toStrictEqual({
      directive: "font-src",
      page: "/feed",
      blocked: "inline",
    });
  });

  it.each([
    ["data:image/png;base64,AAAA", "data"],
    ["blob:https://dialed.run/1234", "https://dialed.run"],
    ["eval", "eval"],
    ["chrome-extension://abcdef/x.js", "other"],
    ["something odd", "other"],
  ])("names %s as %s", async (blockedUri, blocked) => {
    const [forwarded] = await received(
      report({
        "document-uri": "https://dialed.run/feed",
        "effective-directive": "img-src",
        "blocked-uri": blockedUri,
      }),
    );
    expect(forwarded?.blocked).toBe(blocked);
  });

  it.each([
    ["not JSON", "{"],
    ["not a report", JSON.stringify({ hello: "world" })],
    ["a page that is not a URL string", report({}).replace("{}", '{"document-uri":1}')],
    ["over the size cap", report({ "document-uri": "x".repeat(9000) })],
  ])("forwards nothing for %s, and still answers 204", async (_case, body) => {
    expect(await received(body)).toStrictEqual([]);
  });
});
