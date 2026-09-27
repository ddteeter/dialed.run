import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { eq } from "drizzle-orm";

import { user, verification } from "../../src/db/schema-auth";
import { emailVerifications } from "../../src/db/schema-core";
import { firstColumnWhere } from "../../src/lib/keyed-read";
import { nowSeconds } from "../../src/lib/now";
import { unsubscribeUrl } from "../../src/modules/email/unsubscribe";
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
 *   opening it on is the app's own (`/account/verify`, the landing);
 * - **the reset link** is Better Auth's own token, read from its
 *   `verification` row, which is where the email's link came from;
 * - **the unsubscribe link** is signed with the dev server's secret by the
 *   app's own signer.
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
        set: values,
      });
  });
  const token = `verify.${userId}.${secret}`;
  return `/account/verify?token=${encodeURIComponent(token)}`;
}

export async function resetLinkFor(email: string): Promise<string> {
  const userId = await userIdOf(email);
  return withLocalDb(async ({ core }) => {
    const [row] = await core
      .select({ identifier: verification.identifier })
      .from(verification)
      .where(eq(verification.value, userId));
    const token = row?.identifier.replace(/^reset-password:/u, "");
    if (token === undefined) throw new Error(`no reset link for ${email}`);
    return `/account/reset?token=${encodeURIComponent(token)}`;
  });
}

/**
 * The dev server's auth secret, which signs unsubscribe links. Read from
 * `.dev.vars` the way Wrangler reads it; a missing file is a broken local
 * setup, and says so.
 */
function devSecret(): string {
  const vars = readFileSync(".dev.vars", "utf8");
  const found = /^BETTER_AUTH_SECRET=(?<secret>.+)$/mu.exec(vars)?.groups
    ?.secret;
  if (found === undefined)
    throw new Error("no BETTER_AUTH_SECRET in .dev.vars");
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
