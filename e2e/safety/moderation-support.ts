import { readFile } from "node:fs/promises";

import type { Locator, Page } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { user } from "../../src/db/schema-auth";
import { userProfiles } from "../../src/db/schema-core";
import { nowSeconds } from "../../src/lib/now";
import { storageStateFor } from "../support/accounts";
import type { DemoAccount } from "../support/accounts";
import { withLocalDb } from "../support/local-db";

/**
 * What the moderation journey and its edge cases share: the runners the
 * Desk acts on, Review's rows, and the way back to a demo account's own
 * session after the operator's.
 */

/**
 * A confirmed runner with a handle and no session, as sign-up and the
 * confirm link leave one. `profile` adds the columns a spec reads, such
 * as a city or the hourly re-check's flag.
 */
export async function seedRunnerRow(
  id: string,
  handle: string,
  profile: Partial<typeof userProfiles.$inferInsert> = {},
): Promise<void> {
  const joined = new Date(nowSeconds() * 1000);
  await withLocalDb(async ({ core }) => {
    await core.insert(user).values({
      id,
      name: handle,
      email: `${handle}@example.com`,
      emailVerified: true,
      createdAt: joined,
      updatedAt: joined,
    });
    await core
      .insert(userProfiles)
      .values({ ...profile, userId: id, username: handle });
  });
}

export async function removeRunnerRows(ids: readonly string[]): Promise<void> {
  await withLocalDb(async ({ core }) => {
    await core
      .delete(userProfiles)
      .where(inArray(userProfiles.userId, [...ids]));
    await core.delete(user).where(inArray(user.id, [...ids]));
  });
}

/**
 * A handle no earlier run of the suite holds.
 */
export function handleOf(prefix: string): string {
  return `${prefix}_${String(Date.now()).slice(-8)}`;
}

/**
 * Opens a Review row by its name, unless it opened itself (round 28 #8:
 * the row's name opens it; there is no "Decide this one"). It is the
 * row's first fold: a reported row's WHO REPORTED comes after.
 */
export async function openRow(row: Locator): Promise<void> {
  const opener = row.locator("button[aria-expanded]").first();
  if ((await opener.getAttribute("aria-expanded")) === "false") {
    await opener.click();
  }
}

/**
One cookie of a saved Playwright session.
*/
const savedCookie = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(["Strict", "Lax", "None"]),
});

/**
The cookies of a saved Playwright session, parsed rather than trusted.
*/
const storageState = z.object({ cookies: z.array(savedCookie) });

/**
 * The same browser, signed in as a demo account instead of the operator,
 * so a journey stays one video.
 */
export async function signInAsAccount(
  page: Page,
  account: DemoAccount,
): Promise<void> {
  const saved: unknown = JSON.parse(
    await readFile(storageStateFor(account), "utf8"),
  );
  const { cookies } = storageState.parse(saved);
  await page.context().clearCookies();
  await page.context().addCookies(cookies);
}
