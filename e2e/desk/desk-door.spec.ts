/**
 * The Desk's door, and the headers every response leaves with (OPS-7,
 * OPS-8) — the half of `e2e/desk/` that needs no operator.
 *
 * The operator's journey is `operator.demo.spec.ts`.
 */
import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

import { CSP_HEADER } from "../../src/modules/ops/security-headers";
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
  const policy = headers[CSP_HEADER.toLowerCase()] ?? "";
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
The text of every `<script>` without a `src`, as the browser hashes it.
*/
function inlineScriptBodies(html: string): string[] {
  // React escapes `>` in an attribute, so the first one ends the tag.
  return (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [])
    .filter((element) => !/^<script\b[^>]*\ssrc=/.test(element))
    .map((element) =>
      element
        .slice(element.indexOf(">") + 1, -"</script>".length)
        .replaceAll(/\r\n?/g, "\n"),
    );
}

/**
The base64 SHA-256 a CSP hash source names.
*/
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

/**
The digests a policy's `'sha256-…'` sources name, in order.
*/
function hashSources(policy: string): string[] {
  return (policy.match(/'sha256-[^']+'/g) ?? []).map((source) =>
    source.slice("'sha256-".length, -1),
  );
}

/**
The digests a policy must name for `html`: each distinct inline script's.
*/
function scriptHashes(html: string): string[] {
  return [...new Set(inlineScriptBodies(html).map((script) => sha256(script)))];
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
    expect(headers[CSP_HEADER.toLowerCase()]).toContain(
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

  test("an app page is never stored, by the edge or anyone", async ({
    request,
  }) => {
    const response = await request.get("/auth/login");

    expect(response.headers()["cache-control"]).toBe("private, no-store");
  });

  // Design 163: the edge stores a public page and hands the same bytes to
  // every visitor, so a nonce in it would be one nonce for all of them.
  // Its policy names its inline scripts' hashes instead, and the page
  // names no nonce anywhere.
  test.describe("a page the edge stores", () => {
    const NOT_PUBLIC = "/kit/no-such-kit";

    test("admits exactly its inline scripts by hash, and carries no nonce", async ({
      request,
    }) => {
      const response = await request.get(NOT_PUBLIC);
      const headers = response.headers();
      const html = await response.text();

      expect(response.status()).toBe(404);
      expect(headers["cache-control"]).toBe("public, max-age=60");
      const policy = headers[CSP_HEADER.toLowerCase()] ?? "";
      expect(policy).not.toContain("nonce");
      expect(html).not.toMatch(/\snonce=/);
      expect(html).not.toContain("csp-nonce");

      expect(inlineScriptBodies(html).length).toBeGreaterThan(0);
      expect(hashSources(policy)).toStrictEqual(scriptHashes(html));
    });

    test("differs between two renders only in the router's load times", async ({
      request,
    }) => {
      // The router's dehydrated state stamps each match with when it
      // loaded (`u:<ms>`), so two renders are not byte-identical; that is
      // all that differs, and each render's policy names its own scripts.
      // The edge keeps one render, headers and body together.
      const first = await request.get(NOT_PUBLIC);
      const second = await request.get(NOT_PUBLIC);
      const loadTimes = /\bu:\d+/g;

      const pages = [await first.text(), await second.text()];

      expect(pages[1]?.replaceAll(loadTimes, "u:0")).toBe(
        pages[0]?.replaceAll(loadTimes, "u:0"),
      );
      for (const [index, response] of [first, second].entries()) {
        const policy = response.headers()[CSP_HEADER.toLowerCase()] ?? "";
        expect(hashSources(policy)).toStrictEqual(
          scriptHashes(pages[index] ?? ""),
        );
      }
    });

    for (const path of [NOT_PUBLIC, "/@nosuchrunner"]) {
      test(`${path} raises no violation in a browser, and hydrates`, async ({
        page,
      }) => {
        expect(await violationsVisiting(page, path, 404)).toStrictEqual([]);
      });
    }

    test.describe("signed in", () => {
      test.use({ storageState: storageStateFor("closet") });

      test("runs the swap into the app, which only hydration can do", async ({
        page,
      }) => {
        expect(await violationsVisiting(page, NOT_PUBLIC, 404)).toStrictEqual(
          [],
        );
        await expect(
          page.getByRole("link", { name: "Look in the app" }),
        ).toBeVisible();
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
