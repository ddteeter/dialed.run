import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { placeNameOf } from "../../src/modules/onboarding/place";
import { placeStamps } from "../../src/modules/onboarding/place-stamp";
import {
  UnstampedPlaceError,
  saveFoundCalibration,
  saveFoundPlace,
} from "../../src/modules/onboarding/profile";
import { resetTables } from "../feed/helpers";
import { NO_ZONE } from "./zone-deps";

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

async function placeOf(userId: string) {
  const [row] = await coreDb()
    .select({
      cityLabel: userProfiles.cityLabel,
      lat: userProfiles.lat,
      lng: userProfiles.lng,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return row;
}

async function thermalLevelOf(userId: string) {
  const [row] = await coreDb()
    .select({ thermalLevel: userProfiles.thermalLevel })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return row?.thermalLevel;
}

const stamps = placeStamps("test-secret");

const STREET = "12 Elm Street, Madison, WI 53703, United States";
const MADISON = { lat: 43.07, lng: -89.38 };

/**
A place as Use this sends it, carrying the stamp Find gave it.
*/
async function found(address: string = STREET) {
  return {
    cityLabel: address,
    ...MADISON,
    stamp: await stamps.stamp({ address, ...MADISON }),
  };
}

const deps = { verifyStamp: stamps.verifyStamp, zones: NO_ZONE };

beforeEach(async () => {
  await resetTables();
});

describe("placeNameOf: the provider's address as a place name", () => {
  it("keeps a city, region and country as they are", () => {
    expect(placeNameOf("Madison, WI, United States")).toBe(
      "Madison, WI, United States",
    );
  });

  it("keeps only the last three parts, without house numbers or postcodes", () => {
    expect(placeNameOf("12 Elm Street, Madison, WI 53703, United States")).toBe(
      "Madison, WI, United States",
    );
  });

  it("drops a street part that holds a house number whole", () => {
    expect(placeNameOf("10 Downing Street, London")).toBe("London");
    expect(placeNameOf("Hauptstraße 5, 10115 Berlin, Germany")).toBe(
      "Berlin, Germany",
    );
  });

  it("keeps a street part with no digit in it", () => {
    expect(placeNameOf("Downing Street, London")).toBe(
      "Downing Street, London",
    );
  });

  it("strips only the digit words from a later part", () => {
    expect(placeNameOf("Madison, 2nd Ward East, United States")).toBe(
      "Madison, Ward East, United States",
    );
  });

  it("keeps an answer of fewer parts whole", () => {
    expect(placeNameOf("Iceland")).toBe("Iceland");
    expect(placeNameOf("Paris,  France")).toBe("Paris, France");
  });

  it("drops a part left empty", () => {
    expect(placeNameOf("Madison, 53703, , United States")).toBe(
      "Madison, United States",
    );
  });

  it("is nothing for an answer that is only coordinates", () => {
    expect(placeNameOf("43.07,-89.38")).toBeUndefined();
  });
});

describe("saveFoundPlace: Your conditions' Use this", () => {
  it("stores a stamped place under the name placeNameOf keeps", async () => {
    const userId = newUlid();

    const saved = await saveFoundPlace(coreDb(), userId, await found(), deps);

    const expected = { cityLabel: "Madison, WI, United States", ...MADISON };
    expect(saved).toStrictEqual(expected);
    expect(await placeOf(userId)).toStrictEqual(expected);
  });

  it("stores a stamped place with no name left as coordinates alone", async () => {
    const userId = newUlid();

    const saved = await saveFoundPlace(
      coreDb(),
      userId,
      await found("43.07,-89.38"),
      deps,
    );

    expect(saved).toStrictEqual({ cityLabel: undefined, ...MADISON });
    const stored = await placeOf(userId);
    expect(stored?.cityLabel ?? undefined).toBeUndefined();
    expect(stored).toMatchObject(MADISON);
  });

  it.each([
    ["no stamp", { stamp: "" }],
    ["another place's stamp", { stamp: "0".repeat(64) }],
    ["a changed label", { cityLabel: "Anywhere I like" }],
    ["a changed latitude", { lat: 43.08 }],
    ["a changed longitude", { lng: -89.39 }],
  ])("refuses a place with %s, and writes nothing", async (_case, change) => {
    const userId = newUlid();

    await expect(
      saveFoundPlace(coreDb(), userId, { ...(await found()), ...change }, deps),
    ).rejects.toBeInstanceOf(UnstampedPlaceError);
    expect(await placeOf(userId)).toBeUndefined();
  });

  it("refuses a place stamped under another secret", async () => {
    const userId = newUlid();
    const place = await found();
    const elsewhere = await placeStamps("another-secret").stamp({
      address: place.cityLabel,
      ...MADISON,
    });

    await expect(
      saveFoundPlace(coreDb(), userId, { ...place, stamp: elsewhere }, deps),
    ).rejects.toBeInstanceOf(UnstampedPlaceError);
    expect(await placeOf(userId)).toBeUndefined();
  });

  it("names the refusal for the log", () => {
    const error = new UnstampedPlaceError();
    expect(error.name).toBe("UnstampedPlaceError");
    expect(error.message).toBe("the place does not carry Find's stamp");
  });
});

describe("saveFoundCalibration: O1's write", () => {
  it("stores a stamped city under the name placeNameOf keeps", async () => {
    const userId = newUlid();

    await saveFoundCalibration(
      coreDb(),
      userId,
      { thermalLevel: 1, ...(await found()) },
      deps,
    );

    expect(await thermalLevelOf(userId)).toBe(1);
    expect(await placeOf(userId)).toStrictEqual({
      cityLabel: "Madison, WI, United States",
      ...MADISON,
    });
  });

  it.each([
    ["no stamp", { stamp: undefined }],
    ["another place's stamp", { stamp: "0".repeat(64) }],
    ["a changed label", { cityLabel: "my words" }],
    ["a changed latitude", { lat: 1 }],
    ["a changed longitude", { lng: 2 }],
  ])("refuses a city with %s, and writes nothing", async (_case, change) => {
    const userId = newUlid();

    await expect(
      saveFoundCalibration(
        coreDb(),
        userId,
        { thermalLevel: 2, ...(await found()), ...change },
        deps,
      ),
    ).rejects.toBeInstanceOf(UnstampedPlaceError);
    expect(await placeOf(userId)).toBeUndefined();
  });

  it("refuses a city with no stamp without asking the checker", async () => {
    const userId = newUlid();
    const { cityLabel, lat, lng } = await found();

    await expect(
      saveFoundCalibration(
        coreDb(),
        userId,
        { thermalLevel: 2, cityLabel, lat, lng },
        { ...deps, verifyStamp: () => Promise.resolve(true) },
      ),
    ).rejects.toBeInstanceOf(UnstampedPlaceError);
    expect(await placeOf(userId)).toBeUndefined();
  });

  it("saves a calibration with no city as it came, keeping its coordinates", async () => {
    const userId = newUlid();

    await saveFoundCalibration(
      coreDb(),
      userId,
      { thermalLevel: 1, lat: 45.52, lng: -122.68 },
      deps,
    );

    expect(await thermalLevelOf(userId)).toBe(1);
    const stored = await placeOf(userId);
    expect(stored?.cityLabel ?? undefined).toBeUndefined();
    expect(stored).toMatchObject({ lat: 45.52, lng: -122.68 });
  });

  it.each([
    ["latitude", { thermalLevel: 0, cityLabel: "Madison", lng: -89.38 }],
    ["longitude", { thermalLevel: 0, cityLabel: "Madison", lat: 43.07 }],
  ])(
    "saves a city with no %s as it came, asking for no stamp",
    async (_missing, input) => {
      const userId = newUlid();

      await saveFoundCalibration(coreDb(), userId, input, deps);

      expect(await thermalLevelOf(userId)).toBe(0);
      const stored = await placeOf(userId);
      expect(stored?.cityLabel).toBe("Madison");
    },
  );

  it("saves a calibration with no place at all", async () => {
    const userId = newUlid();

    await saveFoundCalibration(coreDb(), userId, { thermalLevel: -1 }, deps);

    expect(await thermalLevelOf(userId)).toBe(-1);
  });
});
