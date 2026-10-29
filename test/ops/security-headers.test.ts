import { afterEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";

import { secureResponse } from "../../src/modules/ops/secure-response";
import {
  CSP_HEADER,
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

    const secured = withSecurityHeaders(page, REPORT, { nonce: "n0nce" });

    expect(Object.fromEntries(secured.headers)).toStrictEqual({
      "content-type": "text/html; charset=utf-8",
      [CSP_HEADER.toLowerCase()]: contentSecurityPolicy(REPORT, {
        nonce: "n0nce",
      }),
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy":
        "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
      "strict-transport-security": "max-age=31536000",
      "cache-control": "private, no-store",
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
    const policy = directives(
      contentSecurityPolicy(REPORT, { nonce: "n0nce+/=" }),
    );

    expect(Object.fromEntries(policy)).toStrictEqual({
      "default-src": "'self'",
      // MediaPipe compiles wasm; Turnstile's script comes from Cloudflare.
      // Never 'unsafe-inline': an inline script runs on the request's
      // nonce or not at all.
      "script-src":
        "'self' 'nonce-n0nce+/=' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
      "style-src": "'self' 'unsafe-inline'",
      // A PUBLIC kit's photos come from the public bucket's own domain
      // (D-151, design 160 step 8); nothing else off-site.
      "img-src": "'self' blob: data: https://photos.dialed.run",
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

  it("names no nonce, and still no 'unsafe-inline', for the static copy", () => {
    expect(directives(contentSecurityPolicy(undefined)).get("script-src")).toBe(
      "'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
    );
  });

  it("admits a stored page's inline scripts by their hashes, and by no nonce", () => {
    const policy = contentSecurityPolicy(undefined, {
      hashes: ["abc+/=", "def="],
    });

    expect(directives(policy).get("script-src")).toBe(
      "'self' 'sha256-abc+/=' 'sha256-def=' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
    );
    expect(policy).not.toContain("nonce");
  });

  it("admits no inline script at all for a stored page that has none", () => {
    expect(
      directives(contentSecurityPolicy(undefined, { hashes: [] })).get(
        "script-src",
      ),
    ).toBe("'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com");
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

  it("reports CSP violations to the deployed DSN's project", async () => {
    Reflect.set(env, "SENTRY_DSN", "https://abc@o1.ingest.sentry.io/42");

    const secured = await secureResponse(new Response("<p>page</p>"), "n0nce");

    const policy = secured.headers.get(CSP_HEADER);
    expect(policy).toBe(contentSecurityPolicy(REPORT, { nonce: "n0nce" }));
  });

  it("still secures every response when there is no DSN", async () => {
    Reflect.deleteProperty(env, "SENTRY_DSN");

    const secured = await secureResponse(new Response("<p>page</p>"), "n0nce");

    expect(secured.headers.get(CSP_HEADER)).toBe(
      contentSecurityPolicy(undefined, { nonce: "n0nce" }),
    );
    expect(secured.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("admits inline script by this request's nonce and no other way", async () => {
    const secured = await secureResponse(
      new Response("<p>page</p>"),
      "r3quest",
    );

    const policy = directives(secured.headers.get(CSP_HEADER) ?? "");
    expect(policy.get("script-src")).toBe(
      "'self' 'nonce-r3quest' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
    );
  });
});

describe("secureResponse, for a page the edge may store (design 160)", () => {
  // Fixed vectors, base64(sha256(text)), computed outside the app.
  const ALERT = "bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI=";
  const X = "D6IGS8VMvCoyaR/l0h9tERrBTATY01CoPS7l6xDv0kI=";
  const PAGE =
    '<html><head><script>alert(1)</script><script type="module" src="/app.js"></script></head><body><script>x()</script></body></html>';

  function page(cacheControl?: string, status = 200): Response {
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
    if (cacheControl !== undefined) headers.set("Cache-Control", cacheControl);
    return new Response(PAGE, { status, headers });
  }

  const ORIGINAL: unknown = env.SENTRY_DSN;

  afterEach(() => {
    Reflect.set(env, "SENTRY_DSN", ORIGINAL);
  });

  it("names the hashes of exactly its inline scripts, and no nonce, even when one was minted", async () => {
    Reflect.set(env, "SENTRY_DSN", "https://abc@o1.ingest.sentry.io/42");

    const secured = await secureResponse(page("public, max-age=60"), "n0nce");

    expect(secured.headers.get(CSP_HEADER)).toBe(
      contentSecurityPolicy(REPORT, { hashes: [ALERT, X] }),
    );
    expect(secured.headers.get(CSP_HEADER)).not.toContain("nonce");
    expect(secured.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await secured.text()).toBe(PAGE);
  });

  it("hashes an open-web page that turned out not to be public, and stores none of it", async () => {
    // No nonce was minted for the path, so a not-found or error page
    // rendered there has scripts with no nonce on them.
    const secured = await secureResponse(page(undefined, 500), undefined);

    expect(
      directives(secured.headers.get(CSP_HEADER) ?? "").get("script-src"),
    ).toBe(
      `'self' 'sha256-${ALERT}' 'sha256-${X}' 'wasm-unsafe-eval' https://challenges.cloudflare.com`,
    );
    expect(secured.status).toBe(500);
    expect(secured.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("names neither a nonce nor a hash for a stored card, which runs no script", async () => {
    const card = new Response(new Uint8Array([0x89, 0x50]), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public" },
    });

    const secured = await secureResponse(card, "n0nce");

    expect(
      directives(secured.headers.get(CSP_HEADER) ?? "").get("script-src"),
    ).toBe("'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com");
  });

  it("keeps the nonce for a page that is not stored", async () => {
    const secured = await secureResponse(page(), "n0nce");

    expect(
      directives(secured.headers.get(CSP_HEADER) ?? "").get("script-src"),
    ).toBe(
      "'self' 'nonce-n0nce' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
    );
    expect(secured.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
