/**
 * Covers: `POST /api/access-requests` (round 31, design 187), the
 * marketing site's request-access form, on the real Worker: Turnstile
 * verified by the server on the test keys, the 303s round 31 names, and
 * the request written where Desk D7 reads it. A raw route through the real
 * handler, which a vitest cannot reach. D7 drawing a request is the auth
 * journey's (Au5 → D7).
 */
import { eq } from "drizzle-orm";

import { accessRequests } from "../../src/db/schema-core";
import { expect, test } from "../support/a11y";
import { TURNSTILE_TEST_TOKEN } from "../support/invites";
import { withLocalDb } from "../support/local-db";

test("a request from the marketing site waits for D7, and the visitor goes to /invite/sent", async ({
  request,
}) => {
  const email = `marketing-${String(Date.now())}@example.com`;
  const response = await request.post("/api/access-requests", {
    form: {
      email,
      note: "From the marketing site.",
      "cf-turnstile-response": TURNSTILE_TEST_TOKEN,
    },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe("https://dialed.run/invite/sent");

  const rows = await withLocalDb(async ({ core }) =>
    core
      .select({ note: accessRequests.note, status: accessRequests.status })
      .from(accessRequests)
      .where(eq(accessRequests.email, email)),
  );
  expect(rows).toEqual([
    { note: "From the marketing site.", status: "pending" },
  ]);
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
