import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { termsAcceptances } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { accessGate } from "../../src/modules/account/access";
import {
  acceptTerms,
  acceptanceOf,
  currentTermsVersion,
  termsStanding,
} from "../../src/modules/account/terms-acceptance";
import { createAuth } from "../../src/modules/auth/create-auth";
import { agreedUserId } from "../../src/modules/auth/terms-gate";
import { recordingMail } from "./mail-recorder";
import { OPEN_ACCESS } from "./open-access";

/**
 * ACC-6 at the one auth gate: a new account accepts the terms as it is
 * made, and a runner behind on them is refused every write but Accept.
 */
const db = drizzle(env.DIALED_CORE);

const REFUSAL = {
  // Written out: the client tells this refusal apart by these words.
  code: "TERMS_NOT_ACCEPTED",
  message: "Accept the current terms first.",
  name: "TermsNotAcceptedError",
};

describe("agreedUserId — every server function's terms rule", () => {
  it("refuses a write from a runner with no acceptance, or an old one", async () => {
    const never = newUlid();
    const old = newUlid();
    await acceptanceOf(db, old, currentTermsVersion() - 1, 100);
    for (const userId of [never, old]) {
      await expect(agreedUserId(db, userId, "POST")).rejects.toMatchObject(
        REFUSAL,
      );
    }
  });

  it("lets a runner behind on the terms read", async () => {
    const userId = newUlid();
    await expect(agreedUserId(db, userId, "GET")).resolves.toBe(userId);
  });

  it("lets a runner who accepted the current terms write — and Accept is what gets them there", async () => {
    const userId = newUlid();
    await expect(agreedUserId(db, userId, "POST")).rejects.toMatchObject(
      REFUSAL,
    );
    expect(await acceptTerms(db, userId, currentTermsVersion())).toBe(
      "accepted",
    );
    await expect(agreedUserId(db, userId, "POST")).resolves.toBe(userId);
  });
});

const PASSWORD = ["terms", "account", "fixture"].join("-");

describe("sign-up records the terms (ACC-6)", () => {
  it("records the current version for a new account, in the create hook", async () => {
    const auth = createAuth({
      db,
      secret: "test-secret-not-for-production",
      baseUrl: "http://localhost",
      passwordScreen: {
        verdict: () => Promise.resolve("clean" as const),
        report: () => {
          // this screen always answers
        },
      },
      mail: recordingMail(),
      // Open sign-up, but the real account-side `confirm`: what the user
      // create hook does for every account, email or Google.
      access: {
        ...OPEN_ACCESS,
        confirm: accessGate(db, () => Promise.resolve({ ok: true })).confirm,
      },
    });
    const email = `${newUlid().toLowerCase()}@example.test`;
    const signUp = await auth.api.signUpEmail({
      body: { name: "Runner", email, password: PASSWORD },
    });
    const userId = signUp.user.id;
    expect(
      await db
        .select({ version: termsAcceptances.version })
        .from(termsAcceptances)
        .where(eq(termsAcceptances.userId, userId)),
    ).toStrictEqual([{ version: currentTermsVersion() }]);
    expect(await termsStanding(db, userId)).toBe("current");
    await expect(agreedUserId(db, userId, "POST")).resolves.toBe(userId);
  });
});
