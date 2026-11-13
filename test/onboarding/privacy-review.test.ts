import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { user } from "../../src/db/schema-auth";
import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  PRIVACY_SETTINGS_CHANGED,
  isPrivacyReviewDue,
  isReviewDueBy,
  markPrivacySeen,
} from "../../src/modules/onboarding/privacy-review";
import { resetTables } from "../feed/helpers";

/**
 * R55·230: U1's REVIEW tag on the Privacy row, due while the runner last
 * opened Privacy before its settings last changed.
 */
function coreDb() {
  return drizzle(env.DIALED_CORE);
}

const BEFORE = PRIVACY_SETTINGS_CHANGED - 1;
const AFTER = PRIVACY_SETTINGS_CHANGED + 1;

async function accountMadeAt(seconds: number): Promise<string> {
  const id = newUlid();
  const at = new Date(seconds * 1000);
  await coreDb()
    .insert(user)
    .values({
      id,
      name: "",
      email: `${id.toLowerCase()}@example.test`,
      emailVerified: true,
      createdAt: at,
      updatedAt: at,
    });
  return id;
}

beforeEach(async () => {
  await resetTables();
});

describe("PRIVACY_SETTINGS_CHANGED", () => {
  it("is the day PUBLIC PROFILE arrived, 2026-10-27, in seconds", () => {
    expect(PRIVACY_SETTINGS_CHANGED).toBe(1_793_059_200);
  });
});

describe("isReviewDueBy", () => {
  it("is due when Privacy was last opened before the change", () => {
    expect(isReviewDueBy(BEFORE, BEFORE)).toBe(true);
  });

  it("is not due when Privacy was opened at or after the change", () => {
    expect(isReviewDueBy(PRIVACY_SETTINGS_CHANGED, BEFORE)).toBe(false);
    expect(isReviewDueBy(AFTER, BEFORE)).toBe(false);
  });

  it("reads never opened as seen when the account was made", () => {
    expect(isReviewDueBy(undefined, BEFORE)).toBe(true);
    expect(isReviewDueBy(undefined, PRIVACY_SETTINGS_CHANGED)).toBe(
      false,
    );
    expect(isReviewDueBy(undefined, AFTER)).toBe(false);
  });

  it("goes by when Privacy was opened, not when the account was made", () => {
    expect(isReviewDueBy(AFTER, BEFORE)).toBe(false);
    expect(isReviewDueBy(BEFORE, AFTER)).toBe(true);
  });
});

describe("isPrivacyReviewDue", () => {
  it("tags an account made before the change that has never opened Privacy, and has no profile row", async () => {
    expect(await isPrivacyReviewDue(coreDb(), await accountMadeAt(BEFORE))).toBe(
      true,
    );
  });

  it("leaves a new account untagged", async () => {
    expect(await isPrivacyReviewDue(coreDb(), await accountMadeAt(AFTER))).toBe(
      false,
    );
  });

  it("clears once Privacy is opened, and reads the stamp over the account's age", async () => {
    const id = await accountMadeAt(BEFORE);
    await markPrivacySeen(coreDb(), id, AFTER);
    expect(await isPrivacyReviewDue(coreDb(), id)).toBe(false);
    await markPrivacySeen(coreDb(), id, BEFORE);
    expect(await isPrivacyReviewDue(coreDb(), id)).toBe(true);
  });

  it("answers no tag for an id with no account", async () => {
    expect(await isPrivacyReviewDue(coreDb(), newUlid())).toBe(false);
  });
});

describe("markPrivacySeen", () => {
  it("creates the profile row when there is none, and touches nothing else on one", async () => {
    const id = await accountMadeAt(BEFORE);
    await markPrivacySeen(coreDb(), id, AFTER);
    await coreDb()
      .update(userProfiles)
      .set({ countInTotals: false })
      .where(eq(userProfiles.userId, id));
    await markPrivacySeen(coreDb(), id, AFTER + 5);
    const [row] = await coreDb()
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, id));
    expect(row?.privacySeenAt).toBe(AFTER + 5);
    expect(row?.countInTotals).toBe(false);
  });
});
