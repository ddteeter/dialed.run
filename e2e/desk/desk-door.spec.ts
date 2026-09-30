/**
 * The Desk's door, and the headers every response leaves with (OPS-7,
 * OPS-8) — the half of `e2e/desk/` that needs no operator.
 *
 * The operator's journey is `operator.demo.spec.ts`.
 */
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

import { storageStateFor } from "../support/accounts";

test.describe("anyone who is not an operator", () => {
  test("gets not-found at /desk when signed out, never a refusal", async ({
    page,
  }) => {
    const response = await page.goto("/desk");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("navigation", { name: "Desk" })).toHaveCount(0);
  });

  test.describe("signed in as a runner", () => {
    test.use({ storageState: storageStateFor("closet") });

    test("gets the same not-found", async ({ page }) => {
      const response = await page.goto("/desk");

      expect(response?.status()).toBe(404);
      await expect(page.getByRole("navigation", { name: "Desk" })).toHaveCount(
        0,
      );
    });
  });
});

/**
The script nonce a response's CSP names, or "" for none.
*/
function nonceIn(headers: Record<string, string>): string {
  const policy = headers["content-security-policy-report-only"] ?? "";
  return /'nonce-([^']+)'/.exec(policy)?.[1] ?? "";
}

/**
The opening tag of every `<script>` without a `src`: the inline ones.
*/
function inlineScriptTags(html: string): string[] {
  return (html.match(/<script\b[^>]*>/g) ?? []).filter(
    (tag) => !/\ssrc=/.test(tag),
  );
}

/**
A tag's `nonce` attribute; React quotes it one way, the router another.
*/
function nonceAttribute(tag: string): string | undefined {
  return /\snonce=["']([^"']*)["']/.exec(tag)?.[1];
}

/**
Where the init script leaves what it saw, read back once the page is up.
*/
const VIOLATIONS_KEY = "__dialedCspViolations";

/**
Every CSP violation the browser raises while loading `path`, as one line
each, once the page answers with `status` and has hydrated.

Two witnesses, because each misses something. The
`securitypolicyviolation` event carries the directive and the source, and
the listener is registered by an init script, so it is in place before the
first byte of the document parses. Chromium's console line catches
whatever fires where no listener can see it. The page is read only after
`html[data-hydrated]`: a policy that blocked the framework's own scripts
would never get there, and that is a failure too.
*/
async function violationsVisiting(
  page: Page,
  path: string,
  status: number,
): Promise<string[]> {
  const logged: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) {
      logged.push(message.text());
    }
  });
  await page.addInitScript((key) => {
    const seen: string[] = [];
    Object.defineProperty(globalThis, key, { value: seen });
    globalThis.addEventListener(
      "securitypolicyviolation",
      (event) => {
        seen.push(
          `${event.disposition} ${event.effectiveDirective}: ${event.blockedURI} at ${event.sourceFile}:${String(event.lineNumber)}`,
        );
      },
      { capture: true },
    );
  }, VIOLATIONS_KEY);

  const response = await page.goto(path);
  expect(response?.status()).toBe(status);
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });

  const seen = z
    .array(z.string())
    .parse(
      await page.evaluate(
        (key): unknown => Reflect.get(globalThis, key),
        VIOLATIONS_KEY,
      ),
    );
  return [...seen, ...logged];
}

test.describe("security headers (OPS-8)", () => {
  test("a page carries every one", async ({ request }) => {
    const response = await request.get("/auth/login");
    const headers = response.headers();

    expect(response.status()).toBe(200);
    expect(headers["content-security-policy-report-only"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("geolocation=(self)");
    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
  });

  test("every inline script carries this response's nonce, and no other", async ({
    request,
  }) => {
    const first = await request.get("/auth/login");
    const second = await request.get("/auth/login");
    const nonce = nonceIn(first.headers());

    // One per response: a nonce two responses share is a nonce an attacker
    // who read one page can reuse on the next.
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(nonceIn(second.headers())).not.toBe(nonce);

    // The framework's hydration state and React's stream are inline
    // scripts; each one must carry the nonce or the policy reports it.
    const inline = inlineScriptTags(await first.text());
    expect(inline.length).toBeGreaterThan(0);
    expect(inline.map((tag) => nonceAttribute(tag))).toStrictEqual(
      inline.map(() => nonce),
    );
  });

  // The two checks above read markup; these ask the browser. A policy is
  // only as good as what Chromium does with it: a script the framework
  // writes without the nonce, an `eval` in a dependency, a font from an
  // origin nobody listed — each is a violation here and, once the header
  // is enforced, a broken page. Report-only still fires the event, so this
  // sees today what enforcement would block.
  test.describe("in a browser, no page raises a violation", () => {
    for (const { name, path, status } of [
      { name: "the landing", path: "/", status: 200 },
      { name: "sign-in", path: "/auth/login", status: 200 },
      {
        name: "a page that does not exist",
        path: "/no-such-page",
        status: 404,
      },
    ]) {
      test(`${name}, signed out`, async ({ page }) => {
        expect(await violationsVisiting(page, path, status)).toStrictEqual([]);
      });
    }

    test.describe("signed in", () => {
      test.use({ storageState: storageStateFor("closet") });

      test("the closet", async ({ page }) => {
        expect(await violationsVisiting(page, "/closet", 200)).toStrictEqual(
          [],
        );
      });
    });
  });

  test("the photo route still answers as itself", async ({ request }) => {
    // Wrapping a response must not change what it says: a missing photo
    // is still the route's own 404, now with the headers on it.
    const response = await request.get("/feed/photo/entries/not-a-photo.jpg");

    expect(response.status()).toBe(404);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("the default share card is a PNG, cached", async ({ request }) => {
    const response = await request.get("/og/default");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    expect(response.headers()["cache-control"]).toBe("public, max-age=3600");
  });
});
