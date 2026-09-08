import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { recentPublicEntriesStatement, yourConditionsConsensus } from "../../src/modules/feed/consensus";
import {
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  NOW,
  resetTables,
} from "./helpers";

// The consensus scan is global (not scoped by user), and this pool shares
// one D1 instance across the `it()` blocks in a file, so every test starts
// from a clean slate.
const HOUR = 3600;

describe("your conditions consensus (E2-lite)", () => {
  beforeEach(resetTables);


  it("counts an entry within the 72h/±3°C/same-precip window", async () => {
    const lat = 10;
    const lng = 10;
    const author = await makeUser();
    const item = await makeItem({ userId: author, category: "top" });
    const runId = await makeRun({ userId: author, lat, lng, startedAt: NOW });
    await makeEntry({ userId: author, runId, isPublic: true, createdAt: NOW, itemIds: [item] });
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 8, feelsLikeC: 6, precipMm: 0 });

    const result = await yourConditionsConsensus(
      { tempC: 8, feelsLikeC: 7, precipMm: 0, condition: "clear", windKph: 5, source: "visualcrossing" },
      NOW,
    );
    expect(result.total).toBe(1);
    expect(result.widened).toBe(false);
    expect(result.groups.tops).toBe(1);
  });

  it("excludes an entry whose feels-like is outside the delta", async () => {
    const lat = 20;
    const lng = 20;
    const author = await makeUser();
    const runId = await makeRun({ userId: author, lat, lng, startedAt: NOW });
    await makeEntry({ userId: author, runId, isPublic: true, createdAt: NOW });
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 20, feelsLikeC: 20, precipMm: 0 });

    const result = await yourConditionsConsensus(
      { tempC: 8, feelsLikeC: 8, precipMm: 0, condition: "clear", windKph: 5, source: "visualcrossing" },
      NOW,
    );
    expect(result.total).toBe(0);
  });

  it("excludes an entry in a different precip class", async () => {
    const lat = 30;
    const lng = 30;
    const author = await makeUser();
    const runId = await makeRun({ userId: author, lat, lng, startedAt: NOW });
    await makeEntry({ userId: author, runId, isPublic: true, createdAt: NOW });
    // wet (>2.5mm) vs. the viewer's dry conditions.
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 8, feelsLikeC: 8, precipMm: 5 });

    const result = await yourConditionsConsensus(
      { tempC: 8, feelsLikeC: 8, precipMm: 0, condition: "clear", windKph: 5, source: "visualcrossing" },
      NOW,
    );
    expect(result.total).toBe(0);
  });

  it("excludes a manual-source observation from the aggregate", async () => {
    const lat = 40;
    const lng = 40;
    const author = await makeUser();
    const runId = await makeRun({ userId: author, lat, lng, startedAt: NOW });
    await makeEntry({ userId: author, runId, isPublic: true, createdAt: NOW });
    await makeObservation({
      lat,
      lng,
      startedAt: NOW,
      tempC: 8,
      feelsLikeC: 8,
      precipMm: 0,
      source: "manual",
    });

    const result = await yourConditionsConsensus(
      { tempC: 8, feelsLikeC: 8, precipMm: 0, condition: "clear", windKph: 5, source: "visualcrossing" },
      NOW,
    );
    expect(result.total).toBe(0);
  });

  it("excludes an entry older than the (widened) window", async () => {
    const lat = 50;
    const lng = 50;
    const author = await makeUser();
    const eightDaysAgo = NOW - 8 * 24 * HOUR;
    const runId = await makeRun({ userId: author, lat, lng, startedAt: eightDaysAgo });
    await makeEntry({ userId: author, runId, isPublic: true, createdAt: eightDaysAgo });
    await makeObservation({ lat, lng, startedAt: eightDaysAgo, tempC: 8, feelsLikeC: 8, precipMm: 0 });

    const result = await yourConditionsConsensus(
      { tempC: 8, feelsLikeC: 8, precipMm: 0, condition: "clear", windKph: 5, source: "visualcrossing" },
      NOW,
    );
    expect(result.total).toBe(0);
    expect(result.widened).toBe(true);
  });

  it("widens from 72h/±3°C to 7d/±5°C before declaring empty", async () => {
    const lat = 60;
    const lng = 60;
    const author = await makeUser();
    const fourDaysAgo = NOW - 4 * 24 * HOUR;
    const runId = await makeRun({ userId: author, lat, lng, startedAt: fourDaysAgo });
    await makeEntry({ userId: author, runId, isPublic: true, createdAt: fourDaysAgo });
    // 4°C outside the first pass's ±3, inside the widened pass's ±5.
    await makeObservation({ lat, lng, startedAt: fourDaysAgo, tempC: 12, feelsLikeC: 12, precipMm: 0 });

    const result = await yourConditionsConsensus(
      { tempC: 8, feelsLikeC: 8, precipMm: 0, condition: "clear", windKph: 5, source: "visualcrossing" },
      NOW,
    );
    expect(result.total).toBe(1);
    expect(result.widened).toBe(true);
  });

  it("aggregates per UI group, counting an entry once per group even with multiple items in it", async () => {
    const lat = 70;
    const lng = 70;
    const authorA = await makeUser();
    const authorB = await makeUser();
    const topA = await makeItem({ userId: authorA, category: "top" });
    const bottomA = await makeItem({ userId: authorA, category: "bottom" });
    const topB = await makeItem({ userId: authorB, category: "top" });

    const runA = await makeRun({ userId: authorA, lat, lng, startedAt: NOW });
    const runB = await makeRun({ userId: authorB, lat, lng, startedAt: NOW });
    await makeEntry({
      userId: authorA,
      runId: runA,
      isPublic: true,
      createdAt: NOW,
      itemIds: [topA, bottomA],
    });
    await makeEntry({ userId: authorB, runId: runB, isPublic: true, createdAt: NOW, itemIds: [topB] });
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 8, feelsLikeC: 8, precipMm: 0 });

    const result = await yourConditionsConsensus(
      { tempC: 8, feelsLikeC: 8, precipMm: 0, condition: "clear", windKph: 5, source: "visualcrossing" },
      NOW,
    );
    expect(result.total).toBe(2);
    expect(result.groups.tops).toBe(2);
    expect(result.groups.bottoms).toBe(1);
  });

  it("resolves the recent-public-entries scan window with an index seek, no table scan", async () => {
    const database = drizzle(env.DIALED_CORE);
    const { sql, params } = recentPublicEntriesStatement(database, NOW - 72 * HOUR).toSQL();
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).not.toMatch(/SCAN\s+outfit_entries/i);
  });
});
