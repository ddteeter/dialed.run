import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  countsInTotals,
  setCountInTotals,
  setRegion,
} from "../../src/modules/onboarding/aggregate-prefs";
import { countInTotalsInput } from "../../src/modules/onboarding/inputs";
import {
  completeOnboarding,
  currentSettings,
  saveCalibration,
} from "../../src/modules/onboarding/profile";
import { addAccount, makeUser, resetTables } from "../feed/helpers";

/**
 * D-108's two per-runner settings, written by one writer each and read by
 * Settings: whether the runner's runs count in anonymous totals (D), and
 * the optional region a total may group them under (round 30 (d)).
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

/**
The stored region, as the two columns hold it.
*/
async function storedRegion(userId: string) {
  const row = await profileOf(userId);
  return [row?.regionCountry, row?.regionSubdivision];
}

beforeEach(async () => {
  await resetTables();
});

describe("add_profile_aggregate_prefs", () => {
  it("counts a fresh profile in totals, with no region", async () => {
    // The migration's defaults, read back: on by default (D-108 D), and
    // region off by default (round 30 (d)).
    const userId = await makeUser();
    const row = await profileOf(userId);
    expect(row?.countInTotals).toBe(true);
    expect(row?.regionCountry).toBeNull();
    expect(row?.regionSubdivision).toBeNull();
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
    await setRegion(coreDb(), userId, { country: "CA", subdivision: "CA-ON" });

    await setCountInTotals(coreDb(), userId, { countInTotals: false });
    await setCountInTotals(coreDb(), userId, { countInTotals: true });

    expect(await profileOf(userId)).toMatchObject({
      username: "ada",
      defaultAudience: "private",
      thermalLevel: 1,
      onboardingComplete: true,
      countInTotals: true,
      regionCountry: "CA",
      regionSubdivision: "CA-ON",
    });
  });

  it("saves for a runner whose address is not confirmed yet (owner, 2026-10-11)", async () => {
    // Opting out never waits on the confirm sheet: the server functions
    // take `requireUserId` (pinned in verification-class.test.ts), and the
    // writer itself asks nothing of the address.
    const userId = await makeUser();
    await addAccount(userId, false);

    await setCountInTotals(coreDb(), userId, { countInTotals: false });
    await setRegion(coreDb(), userId, { country: "NO" });

    const row = await profileOf(userId);
    expect(row?.regionCountry).toBe("NO");
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

describe("setRegion", () => {
  it("creates the profile row for an account that has none, and answers with what it saved", async () => {
    const userId = newUlid();
    const region = { country: "US", subdivision: "US-MN" };
    expect(await setRegion(coreDb(), userId, region)).toStrictEqual(region);
    expect(await storedRegion(userId)).toStrictEqual(["US", "US-MN"]);
    const row = await profileOf(userId);
    expect(row?.countInTotals).toBe(true);
  });

  it("writes both columns together, so a new country never keeps the old state", async () => {
    const userId = await makeUser();
    await setRegion(coreDb(), userId, { country: "US", subdivision: "US-MN" });

    await setRegion(coreDb(), userId, { country: "NO" });

    const [country, subdivision] = await storedRegion(userId);
    expect(country).toBe("NO");
    expect(subdivision).toBeNull();
  });

  it("clears both, and leaves the totals setting alone", async () => {
    const userId = await makeUser();
    await setCountInTotals(coreDb(), userId, { countInTotals: false });
    await setRegion(coreDb(), userId, { country: "US", subdivision: "US-MN" });

    await setRegion(coreDb(), userId, {});

    const row = await profileOf(userId);
    expect(row?.regionCountry).toBeNull();
    expect(row?.regionSubdivision).toBeNull();
    expect(row?.countInTotals).toBe(false);
  });
});

describe("countsInTotals", () => {
  it("counts a runner with no profile row, as the column's default does", async () => {
    expect(await countsInTotals(coreDb(), newUlid())).toStrictEqual({
      countInTotals: true,
    });
  });

  it("says what was saved, and carries nothing else — never the region", async () => {
    const userId = await makeUser();
    await setRegion(coreDb(), userId, { country: "US", subdivision: "US-MN" });
    await setCountInTotals(coreDb(), userId, { countInTotals: false });
    expect(await countsInTotals(coreDb(), userId)).toStrictEqual({
      countInTotals: false,
    });
  });
});

describe("currentSettings reads both", () => {
  it("says counted and no region for an account with no row", async () => {
    const settings = await currentSettings(coreDb(), newUlid());
    expect(settings.countInTotals).toBe(true);
    expect(settings.region).toStrictEqual({
      country: undefined,
      subdivision: undefined,
    });
  });

  it("says no region, not NULLs, for a row with none set", async () => {
    const settings = await currentSettings(coreDb(), await makeUser());
    expect(settings.region).toStrictEqual({
      country: undefined,
      subdivision: undefined,
    });
  });

  it("says what was saved", async () => {
    const userId = await makeUser();
    await setCountInTotals(coreDb(), userId, { countInTotals: false });
    await setRegion(coreDb(), userId, { country: "CA", subdivision: "CA-QC" });

    const settings = await currentSettings(coreDb(), userId);
    expect(settings.countInTotals).toBe(false);
    expect(settings.region).toStrictEqual({
      country: "CA",
      subdivision: "CA-QC",
    });
  });
});
