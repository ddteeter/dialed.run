import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runs, userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  fillMissingTimeZones,
  runnerTimeZone,
  savePlace,
  type ZoneDeps,
} from "../../src/modules/onboarding";
import { saveCalibration } from "../../src/modules/onboarding/profile";
import { zoneForPlace } from "../../src/modules/onboarding/time-zone";
import {
  NOW,
  makeObservation,
  makeRun,
  makeUser,
  resetTables,
} from "../feed/helpers";
import { NO_ZONE, zonesAnswering } from "./zone-deps";

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

async function zoneOf(userId: string): Promise<string | null | undefined> {
  const [row] = await coreDb()
    .select({ timeZone: userProfiles.timeZone })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return row?.timeZone;
}

const PORTLAND = {
  cityLabel: "Portland, OR, United States",
  lat: 45.52,
  lng: -122.68,
};
const AUSTIN = {
  cityLabel: "Austin, TX, United States",
  lat: 30.27,
  lng: -97.74,
};

/**
A lookup that fails as an unavailable provider does.
*/
function zonesFailing() {
  const outage = new Error("Visual Crossing place request failed");
  return {
    outage,
    zoneAt: vi.fn<ZoneDeps["zoneAt"]>(() => Promise.reject(outage)),
    report: vi.fn<ZoneDeps["report"]>(),
  };
}

beforeEach(async () => {
  await resetTables();
});

describe("saving a place stores the zone it is in (design 142)", () => {
  it("stores the zone looked up for Your conditions' place, asking for its coordinates", async () => {
    const userId = newUlid();
    const zones = zonesAnswering("America/Los_Angeles");

    await savePlace(coreDb(), userId, PORTLAND, zones);

    expect(zones.zoneAt).toHaveBeenCalledExactlyOnceWith(45.52, -122.68);
    expect(await zoneOf(userId)).toBe("America/Los_Angeles");
  });

  it("stores the zone with O1's place, in the calibration's batch", async () => {
    const userId = newUlid();

    await saveCalibration(
      coreDb(),
      userId,
      { thermalLevel: 0, ...PORTLAND },
      zonesAnswering("America/Los_Angeles"),
    );

    expect(await zoneOf(userId)).toBe("America/Los_Angeles");
  });

  it("stores a zone for the browser's location alone, which has no label", async () => {
    const userId = newUlid();

    await saveCalibration(
      coreDb(),
      userId,
      { thermalLevel: 0, lat: 45.52, lng: -122.68 },
      zonesAnswering("America/Los_Angeles"),
    );

    expect(await zoneOf(userId)).toBe("America/Los_Angeles");
  });

  it("asks nothing for a calibration that names no place, and keeps the stored zone", async () => {
    const userId = newUlid();
    await savePlace(
      coreDb(),
      userId,
      PORTLAND,
      zonesAnswering("America/Los_Angeles"),
    );
    const zones = zonesAnswering("Europe/London");

    await saveCalibration(coreDb(), userId, { thermalLevel: 1 }, zones);

    expect(zones.zoneAt).not.toHaveBeenCalled();
    expect(await zoneOf(userId)).toBe("America/Los_Angeles");
  });
});

describe("a failed lookup still saves the place (law 5)", () => {
  it("saves the city with no zone, and reports who it was for and nothing else", async () => {
    const userId = newUlid();
    const zones = zonesFailing();

    expect(await savePlace(coreDb(), userId, PORTLAND, zones)).toStrictEqual(
      PORTLAND,
    );

    const [row] = await coreDb()
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(row).toMatchObject(PORTLAND);
    expect(row?.timeZone).toBeNull();
    expect(zones.report).toHaveBeenCalledExactlyOnceWith(zones.outage, {
      surface: "onboarding.zoneForPlace",
      userId,
    });
  });

  it("saves O1's calibration and place with no zone", async () => {
    const userId = newUlid();

    await saveCalibration(
      coreDb(),
      userId,
      { thermalLevel: 2, ...PORTLAND },
      zonesFailing(),
    );

    const [row] = await coreDb()
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(row).toMatchObject({ thermalLevel: 2, ...PORTLAND });
    expect(row?.timeZone).toBeNull();
  });
});

describe("changing the place replaces or clears its zone", () => {
  it("replaces the zone when the place changes", async () => {
    const userId = newUlid();
    await savePlace(
      coreDb(),
      userId,
      PORTLAND,
      zonesAnswering("America/Los_Angeles"),
    );

    await savePlace(
      coreDb(),
      userId,
      AUSTIN,
      zonesAnswering("America/Chicago"),
    );

    expect(await zoneOf(userId)).toBe("America/Chicago");
  });

  it("clears the old zone when the new place's lookup fails, rather than keeping the old city's", async () => {
    const userId = newUlid();
    await savePlace(
      coreDb(),
      userId,
      PORTLAND,
      zonesAnswering("America/Los_Angeles"),
    );

    await savePlace(coreDb(), userId, AUSTIN, zonesFailing());

    expect(await zoneOf(userId)).toBeNull();
  });

  it("clears the zone when the new place has no coordinates", async () => {
    const userId = newUlid();
    await savePlace(
      coreDb(),
      userId,
      PORTLAND,
      zonesAnswering("America/Los_Angeles"),
    );

    // Half a coordinate is all calibrationInput lets through without a
    // label: written whole, as a place with no where.
    await saveCalibration(
      coreDb(),
      userId,
      { thermalLevel: 0, lat: 30.27 },
      zonesAnswering("America/Chicago"),
    );

    expect(await zoneOf(userId)).toBeNull();
  });
});

describe("zoneForPlace", () => {
  it("asks nothing for a place missing either coordinate", async () => {
    const zones = zonesAnswering("America/Chicago");

    expect(await zoneForPlace({ lat: 30.27 }, zones, "u")).toBeUndefined();
    expect(await zoneForPlace({ lng: -97.74 }, zones, "u")).toBeUndefined();
    expect(zones.zoneAt).not.toHaveBeenCalled();
  });

  it("asks for a place at zero, zero, which is a place", async () => {
    const zones = zonesAnswering("Etc/GMT");

    expect(await zoneForPlace({ lat: 0, lng: 0 }, zones, "u")).toBe("Etc/GMT");
  });
});

/**
A profile with coordinates and no zone, as a failed lookup leaves it.
*/
async function owedAt(place: { lat?: number; lng?: number }) {
  const userId = await makeUser();
  await coreDb()
    .update(userProfiles)
    .set({ cityLabel: "Somewhere", ...place })
    .where(eq(userProfiles.userId, userId));
  return userId;
}

describe("fillMissingTimeZones, the hourly re-drive", () => {
  it("fills a zone a failed lookup left NULL, asking for the stored coordinates", async () => {
    const userId = await owedAt({ lat: 45.52, lng: -122.68 });
    const zones = zonesAnswering("America/Los_Angeles");

    await fillMissingTimeZones(coreDb(), zones);

    expect(zones.zoneAt).toHaveBeenCalledExactlyOnceWith(45.52, -122.68);
    expect(await zoneOf(userId)).toBe("America/Los_Angeles");
  });

  it("asks nothing for a profile that already has its zone", async () => {
    const userId = newUlid();
    await savePlace(
      coreDb(),
      userId,
      PORTLAND,
      zonesAnswering("America/Los_Angeles"),
    );
    const zones = zonesAnswering("Europe/London");

    await fillMissingTimeZones(coreDb(), zones);

    expect(zones.zoneAt).not.toHaveBeenCalled();
    expect(await zoneOf(userId)).toBe("America/Los_Angeles");
  });

  it("is not spent on profiles without both coordinates", async () => {
    // A full batch of runners who skipped the place, or answered half of
    // one, ahead of the one it is for.
    for (let index = 0; index < 10; index += 1) {
      await makeUser();
      await owedAt({ lat: 10 + index });
      await owedAt({ lng: 10 + index });
    }
    const userId = await owedAt({ lat: 45.52, lng: -122.68 });

    await fillMissingTimeZones(coreDb(), zonesAnswering("America/Los_Angeles"));

    expect(await zoneOf(userId)).toBe("America/Los_Angeles");
  });

  it("leaves the marker for the next firing when the lookup fails again, and reports it", async () => {
    const userId = await owedAt({ lat: 45.52, lng: -122.68 });
    const zones = zonesFailing();

    await fillMissingTimeZones(coreDb(), zones);

    expect(await zoneOf(userId)).toBeNull();
    expect(zones.report).toHaveBeenCalledExactlyOnceWith(zones.outage, {
      surface: "onboarding.zoneForPlace",
      userId,
    });
  });

  it("leaves the marker when the provider names no zone", async () => {
    const userId = await owedAt({ lat: 45.52, lng: -122.68 });

    await fillMissingTimeZones(coreDb(), NO_ZONE);

    expect(await zoneOf(userId)).toBeNull();
  });

  it.each([
    ["latitude", { lat: 30.27, lng: -122.68 }],
    ["longitude", { lat: 45.52, lng: -97.74 }],
  ])(
    "never gives a place the zone looked up for the one it replaced (a new %s)",
    async (_part, moved) => {
      const userId = await owedAt({ lat: 45.52, lng: -122.68 });
      // The runner saves a new place while the fill is still asking about
      // the old one, and the new place's own lookup fails.
      const zones = {
        zoneAt: vi.fn<ZoneDeps["zoneAt"]>(async () => {
          await savePlace(
            coreDb(),
            userId,
            { cityLabel: "Elsewhere", ...moved },
            zonesFailing(),
          );
          return "America/Los_Angeles";
        }),
        report: vi.fn<ZoneDeps["report"]>(),
      };

      await fillMissingTimeZones(coreDb(), zones);

      expect(await zoneOf(userId)).toBeNull();
    },
  );

  it("never overwrites a zone written while it was asking", async () => {
    const userId = await owedAt({ lat: 45.52, lng: -122.68 });
    const zones = {
      zoneAt: vi.fn<ZoneDeps["zoneAt"]>(async () => {
        await coreDb()
          .update(userProfiles)
          .set({ timeZone: "America/Vancouver" })
          .where(eq(userProfiles.userId, userId));
        return "America/Los_Angeles";
      }),
      report: vi.fn<ZoneDeps["report"]>(),
    };

    await fillMissingTimeZones(coreDb(), zones);

    expect(await zoneOf(userId)).toBe("America/Vancouver");
  });

  it("fills only its own row, even beside a runner at the same place", async () => {
    const first = await owedAt({ lat: 45.52, lng: -122.68 });
    const second = await owedAt({ lat: 45.52, lng: -122.68 });
    // The first lookup answers and the second does not.
    const zones = zonesAnswering(undefined);
    zones.zoneAt.mockResolvedValueOnce("America/Los_Angeles");

    await fillMissingTimeZones(coreDb(), zones);

    expect(await zoneOf(first)).toBe("America/Los_Angeles");
    expect(await zoneOf(second)).toBeNull();
  });
});

/**
A located run of the runner's, observed in `timeZone` (or unobserved).
*/
async function observedRun(
  userId: string,
  startedAt: number,
  timeZone: string | undefined,
) {
  const lat = 40 + (startedAt % 1000) / 100;
  await makeRun({ userId, lat, lng: -90, startedAt });
  if (timeZone !== undefined) {
    await makeObservation({
      lat,
      lng: -90,
      startedAt,
      tempC: 5,
      feelsLikeC: 3,
      timeZone,
    });
  }
}

/**
An indoor run: no place, so no observation and no zone.
*/
async function indoorRun(userId: string, startedAt: number) {
  await coreDb().insert(runs).values({
    id: newUlid(),
    userId,
    source: "manual",
    startedAt,
    durationS: 1800,
    distanceM: 5000,
    indoor: true,
    title: "Treadmill",
  });
}

describe("runnerTimeZone: the profile, then the latest observed run, then UTC", () => {
  it("answers the profile's zone first, over any run's", async () => {
    const userId = newUlid();
    await savePlace(
      coreDb(),
      userId,
      PORTLAND,
      zonesAnswering("America/Los_Angeles"),
    );
    await observedRun(userId, NOW, "America/Chicago");

    expect(await runnerTimeZone(coreDb(), userId)).toBe("America/Los_Angeles");
  });

  it("answers the latest observed run's zone for a profile with none", async () => {
    const userId = await owedAt({ lat: 45.52, lng: -122.68 });
    await observedRun(userId, NOW - 7200, "America/New_York");
    await observedRun(userId, NOW, "America/Chicago");

    expect(await runnerTimeZone(coreDb(), userId)).toBe("America/Chicago");
  });

  it("answers a run's zone for a runner with no profile row at all", async () => {
    const userId = newUlid();
    await observedRun(userId, NOW, "America/Chicago");

    expect(await runnerTimeZone(coreDb(), userId)).toBe("America/Chicago");
  });

  it("passes over a newer run whose weather never arrived", async () => {
    const userId = await makeUser();
    await observedRun(userId, NOW - 7200, "America/New_York");
    await observedRun(userId, NOW, undefined);

    expect(await runnerTimeZone(coreDb(), userId)).toBe("America/New_York");
  });

  it("passes over newer indoor runs, which have no place to have a zone", async () => {
    const userId = await makeUser();
    await observedRun(userId, NOW - 86_400, "America/New_York");
    for (let index = 1; index <= 5; index += 1) {
      await indoorRun(userId, NOW - 86_400 + index * 3600);
    }

    expect(await runnerTimeZone(coreDb(), userId)).toBe("America/New_York");
  });

  it("never answers another runner's run", async () => {
    const userId = await makeUser();
    const other = await makeUser();
    await observedRun(other, NOW, "America/Chicago");

    expect(await runnerTimeZone(coreDb(), userId)).toBe("UTC");
  });

  it("answers UTC for a runner with no zone and no observed run", async () => {
    expect(await runnerTimeZone(coreDb(), newUlid())).toBe("UTC");
  });
});
