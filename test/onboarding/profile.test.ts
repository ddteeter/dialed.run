import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { calibrationInput } from "../../src/modules/onboarding/inputs";
import {
  completeOnboarding,
  currentSettings,
  hasOnboarded,
  saveCalibration,
  savePreferences,
} from "../../src/modules/onboarding/profile";
import { makeUser, resetTables } from "../feed/helpers";

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

describe("saveCalibration", () => {
  it("creates the profile row for an account that has none", async () => {
    // The common case, and the reason this is an upsert: nothing else in
    // the app writes user_profiles, so a runner reaching O1 has no row and
    // an UPDATE would affect nothing while reporting success.
    const userId = newUlid();

    await saveCalibration(coreDb(), userId, {
      thermalLevel: 2,
      cityLabel: "Minneapolis, MN",
      lat: 44.98,
      lng: -93.27,
      tempUnit: "f",
      distanceUnit: "mi",
    });

    expect(await profileOf(userId)).toMatchObject({
      thermalLevel: 2,
      cityLabel: "Minneapolis, MN",
      lat: 44.98,
      tempUnit: "f",
    });
  });

  it("recalibrates an existing profile without resetting anything else", async () => {
    // Settings "recalibrate" reaches O1 again. A display name, a share
    // preference and a completed flag are other people's business.
    const userId = await makeUser({ displayName: "Ada", shareDefault: false });
    await completeOnboarding(coreDb(), userId);

    await saveCalibration(coreDb(), userId, { thermalLevel: -1 });

    expect(await profileOf(userId)).toMatchObject({
      displayName: "Ada",
      shareDefault: false,
      onboardingComplete: true,
      thermalLevel: -1,
    });
  });

  it("finishes with the one answer that is required", async () => {
    // A denied geolocation permission must not block O1, so everything
    // except the thermal level is optional.
    const userId = newUlid();

    await saveCalibration(coreDb(), userId, { thermalLevel: 0 });

    const row = await profileOf(userId);
    expect(row?.thermalLevel).toBe(0);
    // `toBeNull` rather than the literal, which `unicorn/no-null` forbids.
    expect(row?.cityLabel).toBeNull();
    expect(row?.lat).toBeNull();
  });
});

describe("completeOnboarding and hasOnboarded", () => {
  it("reads false for an account that has never reached O1", async () => {
    expect(await hasOnboarded(coreDb(), newUlid())).toBe(false);
  });

  it("reads false for a calibrated runner who has not finished", async () => {
    // The flag flips at P3, not at O1 — someone who bails halfway is
    // offered the rest again.
    const userId = newUlid();
    await saveCalibration(coreDb(), userId, { thermalLevel: 1 });

    expect(await hasOnboarded(coreDb(), userId)).toBe(false);
  });

  it("reads true once, and stays true", async () => {
    const userId = await makeUser();
    await completeOnboarding(coreDb(), userId);
    await completeOnboarding(coreDb(), userId);

    expect(await hasOnboarded(coreDb(), userId)).toBe(true);
  });

  it("completes for an account with no row yet", async () => {
    const userId = newUlid();
    await completeOnboarding(coreDb(), userId);

    expect(await hasOnboarded(coreDb(), userId)).toBe(true);
  });
});

describe("calibrationInput", () => {
  it("requires a thermal level the contract admits", () => {
    expect(calibrationInput.safeParse({ thermalLevel: 3 }).success).toBe(false);
    expect(calibrationInput.safeParse({}).success).toBe(false);
    expect(calibrationInput.safeParse({ thermalLevel: -2 }).success).toBe(true);
  });

  it("refuses an empty city with the sentence the form shows", () => {
    // Error copy lives in the schema, not the component.
    const parsed = calibrationInput.safeParse({ thermalLevel: 0, cityLabel: "  " });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      "Tell us where you run, or skip this.",
    );
  });

  it("refuses coordinates that are not on the globe", () => {
    // Both ends of both ranges. Only the southern and western cases catch
    // a bound whose sign has flipped, and half the planet is south or west
    // of zero.
    for (const bad of [
      { lat: 91, lng: 0 },
      { lat: -91, lng: 0 },
      { lat: 0, lng: 181 },
      { lat: 0, lng: -181 },
    ]) {
      expect(
        calibrationInput.safeParse({ thermalLevel: 0, ...bad }).success,
      ).toBe(false);
    }
  });

  it("accepts the southern and western extremes themselves", () => {
    // Wellington and Anchorage are real places people run in.
    for (const good of [
      { lat: -90, lng: -180 },
      { lat: 90, lng: 180 },
      { lat: -41.29, lng: 174.78 },
    ]) {
      expect(
        calibrationInput.safeParse({ thermalLevel: 0, ...good }).success,
      ).toBe(true);
    }
  });

  it("trims a typed city, because people type trailing spaces", () => {
    const parsed = calibrationInput.parse({
      thermalLevel: 0,
      cityLabel: "  Seattle, WA  ",
    });

    expect(parsed.cityLabel).toBe("Seattle, WA");
  });
});

describe("savePreferences and currentSettings", () => {
  it("creates the profile row for an account that has none", async () => {
    // Same reason `saveCalibration` upserts: someone can reach settings
    // without having finished O1, and an UPDATE would report success
    // while writing nothing.
    const userId = newUlid();

    await savePreferences(coreDb(), userId, {
      tempUnit: "c",
      distanceUnit: "km",
      shareDefault: false,
    });

    expect(await currentSettings(coreDb(), userId)).toMatchObject({
      tempUnit: "c",
      distanceUnit: "km",
      shareDefault: false,
    });
  });

  it("leaves the calibration alone", async () => {
    // The two screens write disjoint column sets on purpose. Saving units
    // must not silently un-answer the one question O1 asks.
    const userId = newUlid();
    await saveCalibration(coreDb(), userId, {
      thermalLevel: 2,
      cityLabel: "Minneapolis",
    });

    await savePreferences(coreDb(), userId, {
      tempUnit: "c",
      distanceUnit: "km",
      shareDefault: false,
    });

    expect(await currentSettings(coreDb(), userId)).toMatchObject({
      thermalLevel: 2,
      tempUnit: "c",
    });
    const row = await profileOf(userId);
    expect(row?.cityLabel).toBe("Minneapolis");
  });

  it("is not reset by a later recalibration", async () => {
    // And the other direction, which is the one requirement 6 depends on:
    // "recalibrate" reaches O1, and O1 writes units too. It writes the
    // ones the form was showing, so a person who changed units in settings
    // and then recalibrated keeps them.
    const userId = newUlid();
    await savePreferences(coreDb(), userId, {
      tempUnit: "c",
      distanceUnit: "km",
      shareDefault: false,
    });

    await saveCalibration(coreDb(), userId, {
      thermalLevel: -1,
      tempUnit: "c",
      distanceUnit: "km",
    });

    expect(await currentSettings(coreDb(), userId)).toMatchObject({
      thermalLevel: -1,
      tempUnit: "c",
      distanceUnit: "km",
      shareDefault: false,
    });
  });

  it("answers with the app defaults for an account with no row", async () => {
    // Not a throw and not blanks: settings shows the same Fahrenheit and
    // miles a feed reader is already being shown, because `feed/units.ts`
    // falls back to exactly these.
    expect(await currentSettings(coreDb(), newUlid())).toEqual({
      thermalLevel: undefined,
      tempUnit: "f",
      distanceUnit: "mi",
      shareDefault: true,
    });
  });

  it("reports no thermal level rather than a made-up one", async () => {
    // A row can exist with the question unanswered — O1's units are
    // optional and so is everything after the first question.
    const userId = newUlid();
    await savePreferences(coreDb(), userId, {
      tempUnit: "f",
      distanceUnit: "mi",
      shareDefault: true,
    });

    const settings = await currentSettings(coreDb(), userId);
    expect(settings.thermalLevel).toBeUndefined();
  });

  it("keeps sharing on by default, per the product rule", async () => {
    // "Entries are public by default with a per-entry toggle and a
    // per-user default preference." The default half of that is a column
    // default, and this is what reads it.
    const userId = newUlid();
    await saveCalibration(coreDb(), userId, { thermalLevel: 0 });

    const settings = await currentSettings(coreDb(), userId);
    expect(settings.shareDefault).toBe(true);
  });
});
