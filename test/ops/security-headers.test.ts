import { afterEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";

import { secureResponse } from "../../src/modules/ops/secure-response";
import {
  contentSecurityPolicy,
  sentryReportUri,
  withSecurityHeaders,
} from "../../src/modules/ops/security-headers";

/**
 * The headers every response leaves with (OPS-8, audit §3.9).
 */

const REPORT = "https://o1.ingest.sentry.io/api/42/security/?sentry_key=abc";

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values.join(" ")];
    }),
  );
}

describe("withSecurityHeaders", () => {
  it("sets every header on an HTML page", async () => {
    const page = new Response("<!doctype html><p>hi</p>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

    const secured = withSecurityHeaders(page, REPORT);

    expect(Object.fromEntries(secured.headers)).toStrictEqual({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy-report-only": contentSecurityPolicy(REPORT),
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy":
        "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
      "strict-transport-security": "max-age=31536000",
    });
    // The page itself is untouched.
    expect(secured.status).toBe(200);
    expect(await secured.text()).toBe("<!doctype html><p>hi</p>");
  });

  it("reports the CSP rather than enforcing it, for now", () => {
    const secured = withSecurityHeaders(new Response("x"), REPORT);

    expect(secured.headers.has("Content-Security-Policy")).toBe(false);
    expect(secured.headers.has("Content-Security-Policy-Report-Only")).toBe(
      true,
    );
  });

  it("secures a response whose headers cannot be edited", async () => {
    // What `fetch` hands back: immutable headers. Setting on it would throw.
    const upstream = Response.redirect("https://dialed.run/feed", 302);

    const secured = withSecurityHeaders(upstream, undefined);

    expect(secured.status).toBe(302);
    expect(secured.headers.get("Location")).toBe("https://dialed.run/feed");
    expect(secured.headers.get("X-Frame-Options")).toBe("DENY");
    expect(await secured.text()).toBe("");
  });

  it("keeps a header the route set itself", () => {
    const own = new Response("card", {
      headers: { "Referrer-Policy": "no-referrer" },
    });

    const secured = withSecurityHeaders(own, undefined);

    expect(secured.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(secured.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("streams a photo's bytes through unchanged", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const photo = new Response(bytes, {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private" },
    });

    const secured = withSecurityHeaders(photo, undefined);

    expect(new Uint8Array(await secured.arrayBuffer())).toStrictEqual(bytes);
    expect(secured.headers.get("Content-Type")).toBe("image/jpeg");
    expect(secured.headers.get("Cache-Control")).toBe("private");
  });
});

describe("contentSecurityPolicy", () => {
  it("names every directive the app needs, and nothing looser", () => {
    const policy = directives(contentSecurityPolicy(REPORT));

    expect(Object.fromEntries(policy)).toStrictEqual({
      "default-src": "'self'",
      // MediaPipe compiles wasm; Turnstile's script comes from Cloudflare.
      "script-src":
        "'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' blob: data:",
      "font-src": "'self'",
      "connect-src": "'self'",
      "worker-src": "'self' blob:",
      "frame-src": "https://challenges.cloudflare.com",
      // Clickjacking, the finding that started this.
      "frame-ancestors": "'none'",
      "object-src": "'none'",
      "base-uri": "'self'",
      "form-action":
        "'self' https://accounts.google.com https://www.strava.com",
      "report-uri": REPORT,
    });
  });

  it("leaves out the report-uri when there is nowhere to report", () => {
    expect(directives(contentSecurityPolicy(undefined)).has("report-uri")).toBe(
      false,
    );
  });
});

describe("sentryReportUri", () => {
  it("derives Sentry's security endpoint from a DSN", () => {
    expect(sentryReportUri("https://abc@o1.ingest.sentry.io/42")).toBe(REPORT);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["not a URL", "not a dsn"],
    ["without a key", "https://o1.ingest.sentry.io/42"],
    ["without a project", "https://abc@o1.ingest.sentry.io/"],
  ])("has none for a DSN that is %s", (_label, dsn) => {
    expect(sentryReportUri(dsn)).toBeUndefined();
  });
});

describe("secureResponse, as server.ts calls it", () => {
  const ORIGINAL: unknown = env.SENTRY_DSN;

  afterEach(() => {
    Reflect.set(env, "SENTRY_DSN", ORIGINAL);
  });

  it("reports CSP violations to the deployed DSN's project", () => {
    Reflect.set(env, "SENTRY_DSN", "https://abc@o1.ingest.sentry.io/42");

    const secured = secureResponse(new Response("<p>page</p>"));

    const policy = secured.headers.get("Content-Security-Policy-Report-Only");
    expect(policy).toBe(contentSecurityPolicy(REPORT));
  });

  it("still secures every response when there is no DSN", () => {
    Reflect.deleteProperty(env, "SENTRY_DSN");

    const secured = secureResponse(new Response("<p>page</p>"));

    expect(secured.headers.get("Content-Security-Policy-Report-Only")).toBe(
      contentSecurityPolicy(undefined),
    );
    expect(secured.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
