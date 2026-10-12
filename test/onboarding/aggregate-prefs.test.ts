import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  countsInTotals,
  setCountInTotals,
} from "../../src/modules/onboarding/aggregate-prefs";
import { countInTotalsInput } from "../../src/modules/onboarding/inputs";
import {
  completeOnboarding,
  currentSettings,
  saveCalibration,
} from "../../src/modules/onboarding/profile";
import { addAccount, makeUser, resetTables } from "../feed/helpers";

/**
 * D-108 D's per-runner setting: whether the runner's runs count in
 * published anonymous totals. One writer, Settings › Sharing's switch, and
 * one narrow reader, A3's private line.
 */
function coreDb() {
  return drizzle(env.DIALED_CORE);
}

async function profileOf(userId: string) {
  const [row] = await coreDb()
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return row;
}

beforeEach(async () => {
  await resetTables();
});

describe("add_profile_count_in_totals", () => {
  it("counts a fresh profile in totals", async () => {
    // The migration's default, read back: on by default (D-108 D).
    const row = await profileOf(await makeUser());
    expect(row?.countInTotals).toBe(true);
  });
});

describe("setCountInTotals", () => {
  it("creates the profile row for an account that has none, and answers with what it saved", async () => {
    const userId = newUlid();
    expect(
      await setCountInTotals(coreDb(), userId, { countInTotals: false }),
    ).toStrictEqual({ countInTotals: false });
    const row = await profileOf(userId);
    expect(row?.countInTotals).toBe(false);
  });

  it("turns back on, and touches nothing else on the row", async () => {
    const userId = await makeUser({
      username: "ada",
      defaultAudience: "private",
    });
    await saveCalibration(coreDb(), userId, { thermalLevel: 1 });
    await completeOnboarding(coreDb(), userId);

    await setCountInTotals(coreDb(), userId, { countInTotals: false });
    await setCountInTotals(coreDb(), userId, { countInTotals: true });

    expect(await profileOf(userId)).toMatchObject({
      username: "ada",
      defaultAudience: "private",
      thermalLevel: 1,
      onboardingComplete: true,
      countInTotals: true,
    });
  });

  it("saves for a runner whose address is not confirmed yet (owner, 2026-10-11)", async () => {
    // Opting out never waits on the confirm sheet: the server function
    // takes `requireUserId` (pinned in verification-class.test.ts), and the
    // writer itself asks nothing of the address.
    const userId = await makeUser();
    await addAccount(userId, false);

    await setCountInTotals(coreDb(), userId, { countInTotals: false });

    const row = await profileOf(userId);
    expect(row?.countInTotals).toBe(false);
  });

  it("takes a boolean and nothing else", () => {
    expect(countInTotalsInput.parse({ countInTotals: false })).toStrictEqual({
      countInTotals: false,
    });
    expect(countInTotalsInput.safeParse({ countInTotals: "no" }).success).toBe(
      false,
    );
    expect(countInTotalsInput.safeParse({}).success).toBe(false);
  });
});

describe("countsInTotals", () => {
  it("counts a runner with no profile row, as the column's default does", async () => {
    expect(await countsInTotals(coreDb(), newUlid())).toStrictEqual({
      countInTotals: true,
    });
  });

  it("says what was saved, and carries nothing else", async () => {
    const userId = await makeUser();
    await setCountInTotals(coreDb(), userId, { countInTotals: false });
    expect(await countsInTotals(coreDb(), userId)).toStrictEqual({
      countInTotals: false,
    });
  });
});

describe("currentSettings reads it", () => {
  it("says counted for an account with no row", async () => {
    const settings = await currentSettings(coreDb(), newUlid());
    expect(settings.countInTotals).toBe(true);
  });

  it("says what was saved", async () => {
    const userId = await makeUser();
    await setCountInTotals(coreDb(), userId, { countInTotals: false });
    const settings = await currentSettings(coreDb(), userId);
    expect(settings.countInTotals).toBe(false);
  });
});
