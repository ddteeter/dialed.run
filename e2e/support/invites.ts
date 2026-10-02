import type { Page } from "@playwright/test";
import { sql } from "drizzle-orm";

import { inviteCodes } from "../../src/db/schema-core";
import { nowSeconds } from "../../src/lib/now";
import { withLocalDb } from "./local-db";

/**
 * The way in for e2e (task 126, ACC-5): sign-up needs an invite code and a
 * Turnstile answer, email and Google alike.
 *
 * **The code** is one the harness keeps in the local database with more
 * uses than any run needs, so every demo account and the Desk's operator
 * can sign up with it. Made here rather than in a migration: a code in a
 * migration would be a way in on every real deployment too.
 *
 * **Turnstile** runs on Cloudflare's documented always-pass test keys in
 * CI (`.github/workflows/ci.yml` writes them into `.dev.vars`): the
 * widget answers on its own, and the server accepts that answer. A
 * sign-up through the API has no widget, and sends the token Cloudflare
 * documents for its test secret instead.
 */
export const E2E_INVITE_CODE = "DIAL-TEST";

/**
Cloudflare's dummy token, which its always-pass test secret accepts.
*/
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/**
 * Makes sure the harness's code exists and works: inserted once, and put
 * back if a demo revoked it.
 */
export async function ensureInviteCode(): Promise<string> {
  await withLocalDb(async ({ core }) => {
    await core
      .insert(inviteCodes)
      .values({
        id: "e2e-invite-code",
        code: E2E_INVITE_CODE,
        label: "e2e harness",
        maxUses: 1_000_000,
        createdAt: nowSeconds(),
      })
      .onConflictDoUpdate({
        target: inviteCodes.code,
        set: { revokedAt: sql`NULL`, maxUses: 1_000_000 },
      });
  });
  return E2E_INVITE_CODE;
}

/**
 * The headers Better Auth's before-hook reads a sign-up's way in from
 * (`lib/contracts/access.ts`'s `ACCESS_HEADERS`), for a sign-up through the API.
 */
export function admissionHeaders(): Record<string, string> {
  return {
    "x-invite-code": E2E_INVITE_CODE,
    "x-turnstile-token": TURNSTILE_TEST_TOKEN,
  };
}

/**
 * Waits for the Turnstile widget on the page to have answered, so a
 * submit carries its token. The widget writes the answer into a hidden
 * `cf-turnstile-response` input in its own element.
 */
export async function turnstileAnswered(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      [
        ...document.querySelectorAll<HTMLInputElement>(
          "input[name='cf-turnstile-response']",
        ),
      ].some((input) => input.value !== ""),
    undefined,
    { timeout: 15_000 },
  );
}
