/**
 * Covers: `POST /api/access-requests` (round 31, design 187), the
 * marketing site's request-access form, on the real Worker: Turnstile
 * verified by the server on the test keys, the 303s round 31 names, and
 * the request waiting in Desk D7. A raw route through the real handler,
 * which a vitest cannot reach.
 */
import { expect, test } from "../support/a11y";

import { signInAsOperator } from "../desk/operator";
import { TURNSTILE_TEST_TOKEN } from "../support/invites";

async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("a request from the marketing site lands in D7, and the visitor goes to /invite/sent", async ({
  page,
}) => {
  const email = `marketing-${String(Date.now())}@example.com`;
  const response = await page.request.post("/api/access-requests", {
    form: {
      email,
      note: "From the marketing site.",
      "cf-turnstile-response": TURNSTILE_TEST_TOKEN,
    },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe("https://dialed.run/invite/sent");

  await signInAsOperator(page);
  await page.goto("/desk/access");
  await hydrated(page);
  await expect(
    page.getByRole("listitem").filter({ hasText: email }),
  ).toContainText("From the marketing site.");
});

test("a malformed address goes back to /invite with error=invalid_email", async ({
  request,
}) => {
  const response = await request.post("/api/access-requests", {
    form: { email: "not-an-address", "cf-turnstile-response": "x" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe(
    "https://dialed.run/invite?error=invalid_email",
  );
});
