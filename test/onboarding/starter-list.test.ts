import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import type { ClimateNormals } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import { TAP_LIST, TAP_LIST_FOLD } from "../../src/modules/closet";
import { saveCalibration } from "../../src/modules/onboarding/profile";
import { starterList } from "../../src/modules/onboarding/starter-list";
import { resetTables } from "../feed/helpers";

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

const MINNEAPOLIS = { lat: 44.98, lng: -93.27 };
const PHOENIX = { lat: 33.45, lng: -112.07 };

const COLD_NORMALS: ClimateNormals = { winterLowC: -12.1, summerHighC: 28.7 };
const HOT_NORMALS: ClimateNormals = { winterLowC: 6.5, summerHighC: 42 };

/**
 * A profile with coordinates, via the same write O1 makes. Built through
 * `saveCalibration` rather than an `insert` so this test breaks if O1 ever
 * stops storing a location — which would leave the band silently
 * defaulting for everyone.
 */
async function calibratedAt(at: { lat: number; lng: number }) {
  const userId = newUlid();
  await saveCalibration(coreDb(), userId, { thermalLevel: 0, ...at });
  return userId;
}

beforeEach(async () => {
  await resetTables();
});

describe("starterList", () => {
  it("orders the list for a cold runner without shortening it", async () => {
    // Design round 6 §AA's first two rules together: the band sorts, and
    // *no row is ever absent*. The second is the one worth a test — a
    // filter would have been the easy thing to write.
    const userId = await calibratedAt(MINNEAPOLIS);

    const { entries, fold } = await starterList(coreDb(), userId, () =>
      Promise.resolve(COLD_NORMALS),
    );

    expect(entries).toHaveLength(TAP_LIST.length);
    expect(fold).toBe(TAP_LIST_FOLD);
    expect(entries[0]?.key).toBe("tights");
    // The July row is still on offer, further down. That sentence is the
    // artboard's whole argument for one list.
    expect(entries.map((row) => row.key)).toContain("singlet");
  });

  it("orders the same rows differently for a hot one", async () => {
    const userId = await calibratedAt(PHOENIX);

    const { entries } = await starterList(coreDb(), userId, () =>
      Promise.resolve(HOT_NORMALS),
    );

    expect(entries).toHaveLength(TAP_LIST.length);
    expect(entries[0]?.key).toBe("shorts-5");
    // Mittens fall behind the fold, not out of existence.
    const mittens = entries.findIndex((row) => row.key === "mittens");
    expect(mittens).toBeGreaterThanOrEqual(TAP_LIST_FOLD);
  });

  it("falls back to latitude when the provider fails", async () => {
    // Law 5: onboarding must not block on a third party. Minneapolis is at
    // 44.98, which `climateBandFor` reads as cold — so a provider outage
    // costs ordering accuracy and nothing else.
    const userId = await calibratedAt(MINNEAPOLIS);

    const { entries } = await starterList(coreDb(), userId, () =>
      Promise.reject(new Error("provider down")),
    );

    expect(entries).toHaveLength(TAP_LIST.length);
    expect(entries[0]?.key).toBe("tights");
  });

  it("never asks the provider about a runner who shared no location", async () => {
    // O1's location step is refusable, so "no coordinates" is an ordinary
    // outcome. Asking about `null` would be a wasted record and a rejection
    // to catch, and the mild ordering is the answer either way.
    const userId = newUlid();
    await saveCalibration(coreDb(), userId, { thermalLevel: 0 });
    const normalsFor = vi.fn(() => Promise.resolve(COLD_NORMALS));

    const { entries } = await starterList(coreDb(), userId, normalsFor);

    expect(normalsFor).not.toHaveBeenCalled();
    expect(entries).toHaveLength(TAP_LIST.length);
    // The mild ordering: a tee first, not tights and not 5" shorts.
    expect(entries[0]?.key).toBe("tee");
  });

  it("treats an account with no profile row at all the same way", async () => {
    // Reaching O3 without O1 is possible — the steps are separate routes so
    // a bail keeps what was answered — and it must not throw.
    const normalsFor = vi.fn(() => Promise.resolve(COLD_NORMALS));

    const { entries } = await starterList(coreDb(), newUlid(), normalsFor);

    expect(normalsFor).not.toHaveBeenCalled();
    expect(entries[0]?.key).toBe("tee");
  });

  it("treats half a coordinate as no coordinate", async () => {
    // `calibrationInput` takes `lat` and `lng` independently, so a row with
    // one and not the other is expressible — and a latitude without a
    // longitude is not a place. Written directly rather than through
    // `saveCalibration`, because the point is a row the app did not build
    // coherently: an interrupted write, or a client that sent one field.
    // Both directions, because the guard is two checks joined by `||` and
    // a test for one of them leaves the other free to be deleted.
    for (const half of [{ lat: 44.98 }, { lng: -93.27 }]) {
      const userId = newUlid();
      await coreDb().insert(userProfiles).values({ userId, ...half });
      const normalsFor = vi.fn(() => Promise.resolve(COLD_NORMALS));

      const { entries } = await starterList(coreDb(), userId, normalsFor);

      expect(normalsFor).not.toHaveBeenCalled();
      expect(entries[0]?.key).toBe("tee");
    }
  });

  it("asks about the place the runner actually gave", async () => {
    const userId = await calibratedAt(PHOENIX);
    const normalsFor = vi.fn(() => Promise.resolve(HOT_NORMALS));

    await starterList(coreDb(), userId, normalsFor);

    expect(normalsFor).toHaveBeenCalledWith(PHOENIX.lat, PHOENIX.lng);
  });
});
