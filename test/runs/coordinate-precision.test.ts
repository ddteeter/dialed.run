import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import { handleImportsBatch } from "../../src/modules/runs/consumer";
import {
  createManualRun,
  getRun,
  storedStart,
} from "../../src/modules/runs/service";
import { attachObservation } from "../../src/modules/weather";
import { ulidSchema } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { imports } from "../../src/db/schema-core";
import { visualCrossingObservationFixture } from "../weather/fixtures/visual-crossing-observation";
import validGpx from "./fixtures/valid.gpx?raw";
import { batchOf, fakeMessage } from "../queue-fakes";

/**
 * STR-14 (register D-110): a run's start point is kept, and sent to the
 * weather provider, at two decimal places — never at the precision the
 * device wrote it.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const PRECISE = { lat: 45.523456, lng: -122.676543 };

describe("storedStart", () => {
  it("rounds an outdoor run's point", () => {
    expect(storedStart({ indoor: false, ...PRECISE })).toStrictEqual({
      lat: 45.52,
      lng: -122.68,
    });
  });

  it("keeps no point for an indoor run, even one the file located", () => {
    expect(storedStart({ indoor: true, ...PRECISE })).toStrictEqual({
      lat: undefined,
      lng: undefined,
    });
  });

  it("leaves a missing coordinate missing", () => {
    expect(storedStart({ indoor: false, lat: 45.523456 })).toStrictEqual({
      lat: 45.52,
      lng: undefined,
    });
    expect(storedStart({ indoor: false, lng: -122.676543 })).toStrictEqual({
      lat: undefined,
      lng: -122.68,
    });
  });
});

describe("a stored run carries the rounded point", () => {
  it("rounds a manual run's own point", async () => {
    const db = coreDb();
    const userId = newUlid();

    const created = await createManualRun(db, userId, {
      startedAt: 1_768_485_600,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Morning",
      ...PRECISE,
    });

    const run = await getRun(db, userId, created.id);
    expect(String(run?.lat)).toBe("45.52");
    expect(String(run?.lng)).toBe("-122.68");
  });

  it("rounds the profile's fallback point where the run keeps it", async () => {
    const db = coreDb();
    const userId = newUlid();
    await db.insert(userProfiles).values({ userId, ...PRECISE });

    const created = await createManualRun(db, userId, {
      startedAt: 1_768_489_200,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Lunch",
    });

    const run = await getRun(db, userId, created.id);
    expect(String(run?.lat)).toBe("45.52");
    expect(String(run?.lng)).toBe("-122.68");
  });

  it("rounds an imported file's start point", async () => {
    // The GPX starts at 44.977800, -93.265000.
    const db = coreDb();
    const userId = newUlid();
    const importId = newUlid();
    const r2Key = `imports/${userId}/${importId}.gpx`;
    await env.IMPORTS.put(r2Key, new TextEncoder().encode(validGpx));
    await db.insert(imports).values({
      id: importId,
      userId,
      r2Key,
      status: "pending",
      createdAt: nowSeconds(),
    });
    const errors: unknown[] = [];
    const job = fakeMessage(newUlid(), { type: "import", importId });

    await handleImportsBatch(batchOf("dialed-imports", [job]), {
      db,
      importBucket: env.IMPORTS,
      captureException: (error) => {
        errors.push(error);
      },
    });

    expect(errors).toStrictEqual([]);

    const [importRow] = await db
      .select()
      .from(imports)
      .where(eq(imports.id, importId));
    expect(importRow?.status).toBe("done");
    const run = await getRun(db, userId, importRow?.runId ?? "");
    expect(String(run?.lat)).toBe("44.98");
    expect(String(run?.lng)).toBe("-93.26");
  });
});

describe("the weather provider is asked about the rounded point", () => {
  it("sends Visual Crossing two decimal places", async () => {
    const db = coreDb();
    const userId = newUlid();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(Response.json(visualCrossingObservationFixture)),
      );
    const created = await createManualRun(db, userId, {
      startedAt: 1_768_485_600,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Rounded",
      lat: 12.345678,
      lng: 98.765432,
    });

    await attachObservation(ulidSchema.parse(created.id));

    const [input] = fetchSpy.mock.calls[0] ?? [];
    const url = decodeURIComponent(
      input instanceof Request ? input.url : String(input),
    );
    expect(url).toContain("/12.35,98.77/");
    expect(url).not.toContain("12.345");
  });
});
