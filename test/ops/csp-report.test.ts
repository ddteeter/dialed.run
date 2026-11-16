import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rateLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { nowSeconds } from "../../src/lib/now";
import {
  CSP_REPORT_PATH,
  CSP_REPORTS_PER_HOUR,
  cspReportDepsFromEnv,
  receiveCspReport,
  reportTooLarge,
  type ForwardedReport,
} from "../../src/modules/ops/csp-report";
import { countedKeys, countRow } from "../rate-limit-rows";

function nothing(): void {
  // Swallows the console line the disabled reporter writes.
}

/**
 * The CSP report collector (SA-L19): what a browser posts is cut to the
 * directive, the page's path and the blocked origin before anything is
 * forwarded, and every request answers 204.
 */
function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://dialed.run${CSP_REPORT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/csp-report", ...headers },
    body,
  });
}

interface Received {
  readonly forwarded: ForwardedReport[];
  readonly counted: string[];
}

async function receivedFrom(
  request: Request,
  isWithin = true,
): Promise<Received> {
  const forwarded: ForwardedReport[] = [];
  const counted: string[] = [];
  const response = await receiveCspReport(request, {
    forward: (report) => {
      forwarded.push(report);
    },
    isWithinLimit: (address) => {
      counted.push(address);
      return Promise.resolve(isWithin);
    },
  });
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  return { forwarded, counted };
}

async function received(body: string): Promise<ForwardedReport[]> {
  const { forwarded } = await receivedFrom(post(body));
  return forwarded;
}

const A_REPORT = JSON.stringify({
  "csp-report": {
    "document-uri": "https://dialed.run/feed",
    "effective-directive": "img-src",
    "blocked-uri": "inline",
  },
});

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

  it("prefers the effective directive over the violated one", async () => {
    const [forwarded] = await received(
      report({
        "document-uri": "https://dialed.run/feed",
        "effective-directive": "img-src",
        "violated-directive": "script-src 'self'",
        "blocked-uri": "inline",
      }),
    );
    expect(forwarded?.directive).toBe("img-src");
  });

  it("forwards an empty page when the document is not a URL", async () => {
    const [forwarded] = await received(
      report({
        "document-uri": "not a url",
        "effective-directive": "img-src",
        "blocked-uri": "inline",
      }),
    );
    expect(forwarded?.page).toBe("");
  });

  it.each([
    "inline",
    "eval",
    "data",
    "blob",
    "wasm-eval",
    "trusted-types-policy",
    "trusted-types-sink",
  ])(
    "keeps the keyword %s the browser sends for a blocked load",
    async (keyword) => {
      const [forwarded] = await received(
        report({
          "document-uri": "https://dialed.run/feed",
          "effective-directive": "img-src",
          "blocked-uri": keyword,
        }),
      );
      expect(forwarded?.blocked).toBe(keyword);
    },
  );

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
    [
      "a page that is not a URL string",
      report({}).replace("{}", '{"document-uri":1}'),
    ],
    ["over the size cap", report({ "document-uri": "x".repeat(9000) })],
  ])("forwards nothing for %s, and still answers 204", async (_case, body) => {
    expect(await receivedFrom(post(body))).toStrictEqual({
      forwarded: [],
      counted: [],
    });
  });

  it("counts a report by the address the edge saw", async () => {
    const { forwarded, counted } = await receivedFrom(
      post(A_REPORT, { "cf-connecting-ip": "203.0.113.9" }),
    );
    expect(counted).toStrictEqual(["203.0.113.9"]);
    expect(forwarded).toHaveLength(1);
  });

  it("counts a report with no address under one shared subject", async () => {
    const { counted } = await receivedFrom(post(A_REPORT));
    expect(counted).toStrictEqual(["unknown"]);
  });

  it("drops a report past the address's limit, and still answers 204", async () => {
    const { forwarded, counted } = await receivedFrom(post(A_REPORT), false);
    expect(counted).toHaveLength(1);
    expect(forwarded).toStrictEqual([]);
  });
});

describe("cspReportDepsFromEnv", () => {
  const db = drizzle(env.DIALED_CORE);

  beforeEach(async () => {
    await db.delete(rateLimits);
  });

  it("allows an address 20 reports an hour, counted apart from another's", async () => {
    const deps = cspReportDepsFromEnv();
    expect(CSP_REPORTS_PER_HOUR).toBe(20);
    const answers: boolean[] = [];
    for (let i = 0; i <= CSP_REPORTS_PER_HOUR; i++) {
      answers.push(await deps.isWithinLimit("203.0.113.9"));
    }
    expect(answers.filter(Boolean)).toHaveLength(CSP_REPORTS_PER_HOUR);
    expect(answers.at(-1)).toBe(false);

    expect(await deps.isWithinLimit("198.51.100.4")).toBe(true);
    expect(await countedKeys(db)).toStrictEqual([
      "csp-report:198.51.100.4",
      "csp-report:203.0.113.9",
    ]);
  });

  it("keeps an address's count for an hour, and starts over after it", async () => {
    const deps = cspReportDepsFromEnv();
    const now = nowSeconds();
    await db
      .insert(rateLimits)
      .values([
        countRow("csp-report", "full-recent", CSP_REPORTS_PER_HOUR, now - 3000),
        countRow("csp-report", "full-old", CSP_REPORTS_PER_HOUR, now - 3700),
      ]);

    expect(await deps.isWithinLimit("full-recent")).toBe(false);
    expect(await deps.isWithinLimit("full-old")).toBe(true);
  });

  it("forwards a report to Sentry as a csp violation, with the report as its context", () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const forwarded: ForwardedReport = {
      directive: "img-src",
      page: "/feed",
      blocked: "inline",
    };
    cspReportDepsFromEnv().forward(forwarded);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[sentry-disabled]",
      { directive: "img-src", page: "/feed", blocked: "inline" },
      expect.objectContaining({ message: "csp violation" }),
    );
  });
});

describe("reportTooLarge", () => {
  it("names what went over the cap", () => {
    const error = reportTooLarge("exceeded 8192 bytes");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("csp report exceeded 8192 bytes");
  });
});
