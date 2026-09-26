/**
 * The Desk's door, and the headers every response leaves with (OPS-7,
 * OPS-8) — the half of `e2e/desk/` that needs no operator.
 *
 * An operator's journey needs `ADMIN_USER_IDS` in the dev server's
 * environment, which CI's `.dev.vars` line does not set until the owner
 * applies `docs/proposals/125-ci-migrate-before-deploy.md` (register
 * D-72). Until then it is `operator.demo.ts`, recorded locally.
 */
import { expect, test } from "@playwright/test";

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
