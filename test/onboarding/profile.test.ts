import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  CITY_UNCONFIRMED,
  calibrationInput,
  sharingInput,
} from "../../src/modules/onboarding/inputs";
import { placeInput, savePlace } from "../../src/modules/onboarding";
import {
  completeOnboarding,
  currentSettings,
  hasOnboarded,
  requiresOnboarding,
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
    const userId = await makeUser({
      username: "Ada",
      defaultAudience: "private",
    });
    await completeOnboarding(coreDb(), userId);

    await saveCalibration(coreDb(), userId, { thermalLevel: -1 });

    expect(await profileOf(userId)).toMatchObject({
      username: "Ada",
      defaultAudience: "private",
      onboardingComplete: true,
      thermalLevel: -1,
    });
  });

  it("replaces a place whole: a new label never keeps the old coordinates", async () => {
    const userId = newUlid();
    await saveCalibration(coreDb(), userId, {
      thermalLevel: 0,
      cityLabel: "Minneapolis, MN",
      lat: 44.98,
      lng: -93.27,
    });

    await saveCalibration(coreDb(), userId, {
      thermalLevel: 0,
      cityLabel: "Austin, TX",
    });

    const row = await profileOf(userId);
    expect(row?.cityLabel).toBe("Austin, TX");
    expect(row?.lat).toBeNull();
    expect(row?.lng).toBeNull();
  });

  it("replaces a place whole: located coordinates never keep the old label", async () => {
    const userId = newUlid();
    await saveCalibration(coreDb(), userId, {
      thermalLevel: 0,
      cityLabel: "Minneapolis, MN",
      lat: 44.98,
      lng: -93.27,
    });

    await saveCalibration(coreDb(), userId, {
      thermalLevel: 0,
      lat: 30.27,
      lng: -97.74,
    });

    const row = await profileOf(userId);
    expect(row?.cityLabel).toBeNull();
    expect(row).toMatchObject({ lat: 30.27, lng: -97.74 });
  });

  it("keeps the stored place when a recalibration names none", async () => {
    const userId = newUlid();
    await saveCalibration(coreDb(), userId, {
      thermalLevel: 0,
      cityLabel: "Minneapolis, MN",
      lat: 44.98,
      lng: -93.27,
    });

    await saveCalibration(coreDb(), userId, { thermalLevel: 2 });

    expect(await profileOf(userId)).toMatchObject({
      thermalLevel: 2,
      cityLabel: "Minneapolis, MN",
      lat: 44.98,
      lng: -93.27,
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

function isCityLengthTaken(length: number): boolean {
  return calibrationInput.safeParse({
    thermalLevel: 0,
    cityLabel: "a".repeat(length),
    lat: 0,
    lng: 0,
  }).success;
}

const PORTLAND = {
  cityLabel: "Portland, OR, United States",
  lat: 45.52,
  lng: -122.68,
};

describe("savePlace — the one writer of the profile's place (FEED-5)", () => {
  it("creates the profile row with all three columns, and answers with them", async () => {
    const userId = newUlid();

    expect(await savePlace(coreDb(), userId, PORTLAND)).toStrictEqual(PORTLAND);

    expect(await profileOf(userId)).toMatchObject(PORTLAND);
  });

  it("replaces a place whole, and leaves everything O1 saved beside it alone", async () => {
    const userId = await makeUser({
      username: "Ada",
      defaultAudience: "private",
    });
    await saveCalibration(coreDb(), userId, {
      thermalLevel: 1,
      cityLabel: "Minneapolis, MN, United States",
      lat: 44.98,
      lng: -93.27,
      tempUnit: "c",
      distanceUnit: "km",
    });

    await savePlace(coreDb(), userId, PORTLAND);

    expect(await profileOf(userId)).toMatchObject({
      ...PORTLAND,
      thermalLevel: 1,
      tempUnit: "c",
      distanceUnit: "km",
      username: "Ada",
      defaultAudience: "private",
    });
  });

  it("writes the same three columns O1's calibration does, from either path", async () => {
    const fromConditions = newUlid();
    const fromO1 = newUlid();

    await savePlace(coreDb(), fromConditions, PORTLAND);
    await saveCalibration(coreDb(), fromO1, { thermalLevel: 0, ...PORTLAND });

    const [a, b] = [await profileOf(fromConditions), await profileOf(fromO1)];
    const place = (row: typeof a) => ({
      cityLabel: row?.cityLabel,
      lat: row?.lat,
      lng: row?.lng,
    });
    expect(place(a)).toStrictEqual(PORTLAND);
    expect(place(b)).toStrictEqual(place(a));
  });
});

describe("placeInput", () => {
  it("takes a found place: the provider's name, trimmed, and where it is", () => {
    expect(
      placeInput.parse({ ...PORTLAND, cityLabel: `  ${PORTLAND.cityLabel} ` }),
    ).toStrictEqual(PORTLAND);
  });

  it("refuses a place with no name, a name past the provider's cap, or no coordinates", () => {
    for (const bad of [
      { ...PORTLAND, cityLabel: " " },
      { ...PORTLAND, cityLabel: "a".repeat(201) },
      { cityLabel: PORTLAND.cityLabel, lat: PORTLAND.lat },
      { ...PORTLAND, lat: 91 },
      { ...PORTLAND, lng: -181 },
    ]) {
      expect(placeInput.safeParse(bad).success).toBe(false);
    }
    expect(
      placeInput.safeParse({ ...PORTLAND, cityLabel: "a".repeat(200) }).success,
    ).toBe(true);
  });
});

describe("a profile's coordinates are rounded where they are parsed (STR-14, R-110)", () => {
  const PRECISE = { ...PORTLAND, lat: 45.523456, lng: -122.676789 };

  it("rounds a place from Your conditions to two decimal places", () => {
    expect(placeInput.parse(PRECISE)).toStrictEqual(PORTLAND);
  });

  it("rounds O1's calibration the same way, and leaves absent coordinates absent", () => {
    expect(
      calibrationInput.parse({ thermalLevel: 0, ...PRECISE }),
    ).toMatchObject({ lat: PORTLAND.lat, lng: PORTLAND.lng });
    const noPlace = calibrationInput.parse({ thermalLevel: 0 });
    expect(noPlace).not.toHaveProperty("lat");
    expect(noPlace).not.toHaveProperty("lng");
  });
});

describe("CITY_UNCONFIRMED", () => {
  it("says the two ways on, as round 26 #12 draws it", () => {
    expect(CITY_UNCONFIRMED).toBe("Press Find, or clear the field to skip.");
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
    const parsed = calibrationInput.safeParse({
      thermalLevel: 0,
      cityLabel: "  ",
    });

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

  it("takes the provider's name for a place, up to its cap of 200", () => {
    expect(isCityLengthTaken(200)).toBe(true);
    expect(isCityLengthTaken(201)).toBe(false);
  });

  it("trims a typed city, because people type trailing spaces", () => {
    const parsed = calibrationInput.parse({
      thermalLevel: 0,
      cityLabel: "  Seattle, WA  ",
      lat: 47.61,
      lng: -122.33,
    });

    expect(parsed.cityLabel).toBe("Seattle, WA");
  });
});

/**
What the server function's validator refuses a calibration with, if anything.
*/
function refusal(input: Record<string, unknown>) {
  const parsed = calibrationInput.safeParse({ thermalLevel: 0, ...input });
  return parsed.success ? undefined : parsed.error.issues;
}

// The server function's validator is `calibrationInput.parse` itself
// (`onboarding/functions.ts`), so what it refuses here the server refuses.
describe("calibrationInput refuses a city nobody pressed Find on (FEED-5 review)", () => {
  it("says the two ways on, on the city field, for a label with no coordinates", () => {
    expect(refusal({ cityLabel: "Portland" })).toStrictEqual([
      expect.objectContaining({
        path: ["cityLabel"],
        message: CITY_UNCONFIRMED,
      }),
    ]);
    expect(() =>
      calibrationInput.parse({ thermalLevel: 0, cityLabel: "Portland" }),
    ).toThrow(CITY_UNCONFIRMED);
  });

  it("refuses a label with half a coordinate, either half", () => {
    expect(refusal({ cityLabel: "Portland", lat: 45.52 })).toHaveLength(1);
    expect(refusal({ cityLabel: "Portland", lng: -122.68 })).toHaveLength(1);
  });

  it("takes a found city, the browser's location alone, and no place at all", () => {
    expect(refusal(PORTLAND)).toBeUndefined();
    expect(refusal({ lat: 45.52, lng: -122.68 })).toBeUndefined();
    expect(refusal({})).toBeUndefined();
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
      defaultAudience: "private",
    });

    expect(await currentSettings(coreDb(), userId)).toMatchObject({
      tempUnit: "c",
      distanceUnit: "km",
      defaultAudience: "private",
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
      defaultAudience: "private",
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
      defaultAudience: "private",
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
      defaultAudience: "private",
    });
  });

  it("writes only the sub-page's own fields (round 22, item 20)", async () => {
    // Each sub-page is its own small form: saving units cannot reset the
    // sharing default, and saving sharing cannot reset the units.
    const userId = newUlid();
    await savePreferences(coreDb(), userId, { defaultAudience: "private" });
    await savePreferences(coreDb(), userId, {
      tempUnit: "c",
      distanceUnit: "km",
    });
    expect(await currentSettings(coreDb(), userId)).toMatchObject({
      tempUnit: "c",
      distanceUnit: "km",
      defaultAudience: "private",
    });

    await savePreferences(coreDb(), userId, { defaultAudience: "runners" });
    expect(await currentSettings(coreDb(), userId)).toMatchObject({
      tempUnit: "c",
      distanceUnit: "km",
      defaultAudience: "runners",
    });

    // And units again, now that the default is shared: a units save that
    // wrote a sharing column at all would turn it off.
    await savePreferences(coreDb(), userId, {
      tempUnit: "f",
      distanceUnit: "mi",
    });
    expect(await profileOf(userId)).toMatchObject({
      tempUnit: "f",
      defaultAudience: "runners",
    });
  });

  it("writes the default audience, both ways", async () => {
    const userId = newUlid();
    await savePreferences(coreDb(), userId, { defaultAudience: "private" });
    expect(await profileOf(userId)).toMatchObject({
      defaultAudience: "private",
    });

    await savePreferences(coreDb(), userId, { defaultAudience: "runners" });
    expect(await profileOf(userId)).toMatchObject({
      defaultAudience: "runners",
    });
  });

  it("reads the stored default audience", async () => {
    const quiet = newUlid();
    const open = newUlid();
    const grouped = newUlid();
    await coreDb()
      .insert(userProfiles)
      .values([
        { userId: quiet, defaultAudience: "private" },
        { userId: open, defaultAudience: "runners" },
        // Nothing can write `groups` yet; the switch shows it as off.
        { userId: grouped, defaultAudience: "groups" },
      ]);

    expect(await currentSettings(coreDb(), quiet)).toMatchObject({
      defaultAudience: "private",
    });
    expect(await currentSettings(coreDb(), open)).toMatchObject({
      defaultAudience: "runners",
    });
    expect(await currentSettings(coreDb(), grouped)).toMatchObject({
      defaultAudience: "private",
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
      defaultAudience: "runners",
    });
  });

  it("reports no thermal level rather than a made-up one", async () => {
    // A row can exist with the question unanswered — O1's units are
    // optional and so is everything after the first question.
    const userId = newUlid();
    await savePreferences(coreDb(), userId, {
      tempUnit: "f",
      distanceUnit: "mi",
      defaultAudience: "runners",
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
    expect(settings.defaultAudience).toBe("runners");
  });
});

describe("sharingInput", () => {
  it("takes either writable default audience and refuses groups (D-109)", () => {
    expect(sharingInput.parse({ defaultAudience: "runners" })).toEqual({
      defaultAudience: "runners",
    });
    expect(sharingInput.parse({ defaultAudience: "private" })).toEqual({
      defaultAudience: "private",
    });
    expect(sharingInput.safeParse({ defaultAudience: "groups" }).success).toBe(
      false,
    );
    // The previous bundle's boolean is refused, not guessed at.
    expect(sharingInput.safeParse({ shareDefault: true }).success).toBe(false);
  });
});

describe("requiresOnboarding", () => {
  it("says no for a signed-out visitor", async () => {
    // `/` is the only page a logged-out reader can see. Sending them to a
    // screen that requires a session would be a redirect loop.
    expect(await requiresOnboarding(coreDb(), undefined)).toBe(false);
  });

  it("says yes for an account that has never started", async () => {
    expect(await requiresOnboarding(coreDb(), newUlid())).toBe(true);
  });

  it("keeps saying yes to someone who bailed halfway", async () => {
    // The case R-52 exists for, and the one a signup-only redirect
    // strands: O1 answered, tab closed, `onboarding_complete` still false.
    // Every step past O1 is skippable, so bailing has to be recoverable.
    const userId = newUlid();
    await saveCalibration(coreDb(), userId, { thermalLevel: 1 });

    expect(await requiresOnboarding(coreDb(), userId)).toBe(true);
  });

  it("stops once they reach P3", async () => {
    const userId = newUlid();
    await completeOnboarding(coreDb(), userId);

    expect(await requiresOnboarding(coreDb(), userId)).toBe(false);
  });
});
