import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";

import { user, verification } from "../../src/db/schema-auth";
import { accessAsks, emailVerifications } from "../../src/db/schema-core";
import { firstColumnWhere } from "../../src/lib/sql/keyed-read";
import { nowSeconds } from "../../src/lib/now";
import { unsubscribeUrl } from "../../src/modules/email/unsubscribe";
import { hydrated } from "./demo";
import { withLocalDb } from "./local-db";

/**
 * The links an email would carry, for journeys that follow one.
 *
 * Local dev sends through Miniflare's simulated binding, which writes each
 * message to a temp file named only in the dev server's log — nothing a
 * spec can find. So these stand in for opening the inbox, and each says
 * which part of the real path it skips:
 *
 * - **the confirm link** is issued here as the app issues it — a fresh
 *   secret whose SHA-256 replaces the runner's row — and everything from
 *   opening it on is the app's own (`/account/verify`, the landing, and
 *   its Confirm email button: `confirmAddress`);
 * - **the reset link** is minted here, as a `verification` row of Better
 *   Auth's own shape: the one the email carried cannot be read back,
 *   because only its hash is stored (`storeIdentifier: "hashed"`). The
 *   row is written with the identifier plain, which Better Auth's consume
 *   still tries after the hashed one — so everything from opening the
 *   link on (the page, the endpoint, the single use) is the app's own;
 * - **the unsubscribe link** is signed with the dev server's secret by the
 *   app's own signer;
 * - **an access request's confirm link** is a fresh token whose SHA-256
 *   replaces the address's newest ask's, as the app's own ask makes it;
 *   everything from opening it on (`/account/confirm-access`, its one
 *   button) is the app's own;
 * - **the Desk's deletion link** (round 64) is a fresh secret whose
 *   SHA-256 replaces the one the Desk's Send wrote, keeping that row's
 *   expiry; everything from opening it on (`/account/deletion`, its one
 *   button) is the app's own.
 */

async function userIdOf(email: string): Promise<string> {
  const id = await withLocalDb(({ core }) =>
    firstColumnWhere(core, user, user.id, eq(user.email, email.toLowerCase())),
  );
  if (id === undefined) throw new Error(`no account for ${email}`);
  return id;
}

export async function confirmLinkFor(email: string): Promise<string> {
  const userId = await userIdOf(email);
  const secret = randomBytes(32).toString("base64url");
  const values = {
    email: email.toLowerCase(),
    tokenHash: createHash("sha256").update(secret).digest("base64url"),
    expiresAt: nowSeconds() + 86_400,
  };
  await withLocalDb(async ({ core }) => {
    await core
      .insert(emailVerifications)
      .values({ userId, purpose: "verify", ...values })
      .onConflictDoUpdate({
        target: [emailVerifications.userId, emailVerifications.purpose],
        // A fresh link is unspent, as the app's own issue makes it.
        set: { ...values, usedAt: sql`NULL` },
      });
  });
  const token = `verify.${userId}.${secret}`;
  return `/account/verify?token=${encodeURIComponent(token)}`;
}

/**
 * Open the confirm link and press its one button, as a runner does:
 * opening it only asks (owner, 2026-11-15).
 */
export async function confirmAddress(page: Page, email: string): Promise<void> {
  await page.goto(await confirmLinkFor(email));
  await expect(
    page.getByRole("heading", { name: "Confirm your email" }),
  ).toBeVisible({ timeout: 15_000 });
  await hydrated(page);
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(
    page.getByRole("heading", { name: "Email confirmed" }),
  ).toBeVisible({ timeout: 15_000 });
}

export async function accessConfirmLinkFor(email: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await withLocalDb(async ({ core }) => {
    const newest = core
      .select({ id: accessAsks.id })
      .from(accessAsks)
      .where(eq(accessAsks.email, email.toLowerCase()))
      .orderBy(sql`${accessAsks.createdAt} DESC`)
      .limit(1);
    await core
      .update(accessAsks)
      .set({ tokenHash })
      .where(sql`${accessAsks.id} IN ${newest}`);
  });
  return `/account/confirm-access?token=${token}`;
}

export async function resetLinkFor(email: string): Promise<string> {
  const userId = await userIdOf(email);
  const token = randomBytes(18).toString("base64url");
  const now = new Date();
  await withLocalDb(async ({ core }) => {
    await core.insert(verification).values({
      id: randomBytes(12).toString("hex"),
      identifier: `reset-password:${token}`,
      value: userId,
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    });
  });
  return `/account/reset?token=${encodeURIComponent(token)}`;
}

/**
 * The dev server's auth secret, which signs unsubscribe links. Read from
 * `.dev.vars` the way Wrangler reads it; a missing file is a broken local
 * setup, and says so.
 */
function devSecret(): string {
  const vars = readFileSync(".dev.vars", "utf8");
  const found = /^UNSUBSCRIBE_SECRET=(?<secret>.+)$/mu.exec(vars)?.groups
    ?.secret;
  if (found === undefined)
    throw new Error("no UNSUBSCRIBE_SECRET in .dev.vars");
  return found.trim().replaceAll(/^"|"$/gu, "");
}

export async function unsubscribeLinkFor(email: string): Promise<string> {
  const url = await unsubscribeUrl(
    "http://localhost",
    devSecret(),
    await userIdOf(email),
    "run_reminder",
  );
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * The deletion link the Desk just sent this closed account (round 64
 * #372), re-keyed to a secret the spec knows: the row the app wrote stays,
 * with its expiry, and only its hash is replaced.
 */
export async function deletionLinkFor(email: string): Promise<string> {
  const userId = await userIdOf(email);
  const secret = randomBytes(32).toString("base64url");
  await withLocalDb(async ({ core }) => {
    const sent = await core
      .update(emailVerifications)
      .set({
        tokenHash: createHash("sha256").update(secret).digest("base64url"),
      })
      .where(
        sql`${emailVerifications.userId} = ${userId} AND ${emailVerifications.purpose} = 'delete'`,
      )
      .returning({ userId: emailVerifications.userId });
    expect(sent, "the Desk sent no deletion link").toHaveLength(1);
  });
  const token = `delete.${userId}.${secret}`;
  return `/account/deletion?token=${encodeURIComponent(token)}`;
}
