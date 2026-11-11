import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  entryPhotos,
  outfitEntries,
  runConditions,
  runs,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { AdminRequiredError } from "../../src/modules/safety";
import { deskKitFor } from "../../src/modules/safety/desk-kit";
import { deskKitInput } from "../../src/modules/safety/inputs";

import { makeObservation } from "../feed/helpers";
import {
  makeEntry,
  makeItem,
  makeRun,
  makeUser,
  NOW,
  resetSafetyTables,
} from "./helpers";

/**
 * R-154 (#388, design 188): an operator opens a kit in place whatever its
 * audience or state, and nobody else opens it this way.
 */

const core = () => drizzle(env.DIALED_CORE);

const ADMIN = "the-admin";

async function asAdmin<T>(body: () => Promise<T>): Promise<T> {
  const admins: unknown = env.ADMIN_USER_IDS;
  Reflect.set(env, "ADMIN_USER_IDS", ADMIN);
  try {
    return await body();
  } finally {
    Reflect.set(env, "ADMIN_USER_IDS", admins);
  }
}

async function photo(
  entryId: string,
  position: number,
  screenStatus: "pass" | "pending" | "removed",
): Promise<string> {
  const id = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id,
      entryId,
      photoKey: `entries/x/${entryId}/${id}`,
      position,
      screenStatus,
    });
  return id;
}

/**
A private kit, hidden pending review, with two garments and photos in two states.
*/
async function hiddenPrivateKit() {
  const userId = await makeUser({ username: "k_lopes" });
  const runId = await makeRun({ userId, startedAt: NOW - 3600 });
  const shell = await makeItem({ userId, name: "Wind shell", category: "top" });
  const tights = await makeItem({
    userId,
    name: "Thermal tights",
    category: "bottom",
  });
  const entryId = await makeEntry({
    userId,
    runId,
    audience: "private",
    verdict: -1,
    createdAt: NOW,
    itemIds: [tights, shell],
  });
  await core()
    .update(outfitEntries)
    .set({
      moderationStatus: "hidden_pending_review",
      caption: "Cold start",
    })
    .where(eq(outfitEntries.id, entryId));
  // Out of order on purpose: the read orders by position.
  const second = await photo(entryId, 1, "pending");
  const first = await photo(entryId, 0, "pass");
  return { userId, runId, entryId, shell, tights, first, second };
}

/**
 * The run's copy of its conditions in core (D-175): a start of 5°, a span
 * of 2–9° and DAMP. The kit's verdict is copied too, so the judged
 * feels-like is the span's cold end for a −1.
 */
async function conditionsCopy(
  runId: string,
  userId: string,
  verdict: number,
): Promise<void> {
  await core().insert(runConditions).values({
    runId,
    userId,
    feelsLikeC: 5,
    minFeelsLikeC: 2,
    maxFeelsLikeC: 9,
    precipClass: "damp",
    source: "visualcrossing",
    verdict,
  });
}

async function placeRunner(
  userId: string,
  place: Readonly<{ cityLabel: string; timeZone: string }>,
): Promise<void> {
  await core()
    .update(userProfiles)
    .set(place)
    .where(eq(userProfiles.userId, userId));
}

beforeEach(async () => {
  await resetSafetyTables();
});

describe("deskKitFor", () => {
  it("opens a private kit hidden pending review, with every photo and garment", async () => {
    const kit = await hiddenPrivateKit();

    const found = await asAdmin(async () =>
      deskKitFor(core(), ADMIN, kit.entryId),
    );

    expect(found).toStrictEqual({
      id: kit.entryId,
      runnerId: kit.userId,
      handle: "k_lopes",
      audience: "private",
      moderationStatus: "hidden_pending_review",
      verdict: -1,
      caption: "Cold start",
      createdAt: NOW,
      run: {
        startedAt: NOW - 3600,
        timeZone: undefined,
        feelsLikeC: undefined,
        moisture: undefined,
      },
      city: undefined,
      tempUnit: "f",
      photos: [
        {
          id: kit.first,
          photoKey: `entries/x/${kit.entryId}/${kit.first}`,
          screenStatus: "pass",
        },
        {
          id: kit.second,
          photoKey: `entries/x/${kit.entryId}/${kit.second}`,
          screenStatus: "pending",
        },
      ],
      // In the order they were put on: tights, then the shell.
      garments: [
        {
          id: kit.tights,
          name: "Thermal tights",
          brand: undefined,
          category: "bottom",
        },
        {
          id: kit.shell,
          name: "Wind shell",
          brand: undefined,
          category: "top",
        },
      ],
    });
  });

  it("carries the run line: the observation's zone, the judged feels-like, the moisture, the city, in the operator's unit (Round 51 · 153)", async () => {
    const kit = await hiddenPrivateKit();
    await conditionsCopy(kit.runId, kit.userId, -1);
    await placeRunner(kit.userId, {
      cityLabel: "Boston",
      timeZone: "America/Chicago",
    });
    // makeRun's default place, so the observation is the run's own cell.
    await makeObservation({
      lat: 44.98,
      lng: -93.27,
      startedAt: NOW - 3600,
      tempC: 6,
      feelsLikeC: 4,
      timeZone: "America/New_York",
    });
    await core().insert(userProfiles).values({ userId: ADMIN, tempUnit: "c" });

    const found = await asAdmin(async () =>
      deskKitFor(core(), ADMIN, kit.entryId),
    );

    expect(found?.run).toStrictEqual({
      startedAt: NOW - 3600,
      timeZone: "America/New_York",
      feelsLikeC: 2,
      moisture: "damp",
    });
    expect(found?.city).toBe("Boston");
    expect(found?.tempUnit).toBe("c");
  });

  it("dates the run in the runner's zone when no observation names one", async () => {
    const kit = await hiddenPrivateKit();
    await placeRunner(kit.userId, {
      cityLabel: "Boston",
      timeZone: "America/Chicago",
    });

    const found = await asAdmin(async () =>
      deskKitFor(core(), ADMIN, kit.entryId),
    );

    expect(found?.run?.timeZone).toBe("America/Chicago");
  });

  it("dates the run in UTC when the only zone it has is not one", async () => {
    const kit = await hiddenPrivateKit();
    await placeRunner(kit.userId, {
      cityLabel: "Boston",
      timeZone: "Mars/Base",
    });

    const found = await asAdmin(async () =>
      deskKitFor(core(), ADMIN, kit.entryId),
    );

    expect(found?.run).toHaveProperty("timeZone", undefined);
  });

  it("reads Fahrenheit for an operator with no profile", async () => {
    const kit = await hiddenPrivateKit();
    // The runner's own unit is not the reader's.
    await core()
      .update(userProfiles)
      .set({ tempUnit: "c" })
      .where(eq(userProfiles.userId, kit.userId));

    const found = await asAdmin(async () =>
      deskKitFor(core(), ADMIN, kit.entryId),
    );

    expect(found?.tempUnit).toBe("f");
  });

  it("opens a removed kit, saying so", async () => {
    const kit = await hiddenPrivateKit();
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "removed" })
      .where(eq(outfitEntries.id, kit.entryId));

    const found = await asAdmin(async () =>
      deskKitFor(core(), ADMIN, kit.entryId),
    );

    expect(found?.moderationStatus).toBe("removed");
  });

  it("answers absent fields as undefined, not null", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await makeEntry({ userId, runId });

    const found = await asAdmin(async () => deskKitFor(core(), ADMIN, entryId));

    expect(found).toMatchObject({
      verdict: undefined,
      caption: undefined,
      photos: [],
      garments: [],
    });
    expect(found?.handle).toMatch(/^runner_/);
  });

  it("answers no run for a kit whose run is gone, and still the kit", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await makeEntry({ userId, runId });
    await core().delete(runs).where(eq(runs.id, runId));

    const found = await asAdmin(async () => deskKitFor(core(), ADMIN, entryId));

    expect(found?.id).toBe(entryId);
    expect(found).toHaveProperty("run", undefined);
  });

  it("answers nothing for a kit that does not exist", async () => {
    expect(
      await asAdmin(async () => deskKitFor(core(), ADMIN, newUlid())),
    ).toBeUndefined();
  });

  it("refuses anyone who is not an operator, the kit's own runner included", async () => {
    const kit = await hiddenPrivateKit();

    await asAdmin(async () => {
      await expect(deskKitFor(core(), kit.userId, kit.entryId)).rejects.toThrow(
        AdminRequiredError,
      );
    });
  });
});

describe("deskKitInput", () => {
  it("takes the kit's id from the URL as it is", () => {
    const entryId = newUlid();
    expect(deskKitInput.parse({ entryId })).toStrictEqual({ entryId });
  });

  it("reads an id that is not one as no kit, rather than failing", () => {
    expect(deskKitInput.parse({ entryId: "x".repeat(65) })).toStrictEqual({
      entryId: "",
    });
    expect(deskKitInput.parse({})).toStrictEqual({ entryId: "" });
  });
});
