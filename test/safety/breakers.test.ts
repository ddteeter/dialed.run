import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { photoScreenings, reviewQueue } from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  ceilingReading,
  classifierCeiling,
  dayHeadroom,
  quietScreenerWeek,
  FINGERPRINT_HOLDS_PER_HOUR,
  REPORT_BASELINE_S,
  REPORT_HIDES_FLOOR,
  reportCeiling,
  type HoldCause,
} from "../../src/modules/safety/breakers";

import { opened, screened } from "./helpers";

/**
 * The hold breakers (design 164): each cause's last hour against its
 * ceiling, counted from the rows the holds write.
 */

const core = () => drizzle(env.DIALED_CORE);

const HOUR = 3600;

/**
On an hour's edge, so an hour's rows land in one bucket of the baseline.
*/
const NOW = 500_000 * HOUR;

beforeEach(async () => {
  await core().delete(reviewQueue);
  await core().delete(photoScreenings);
});

describe("classifierCeiling", () => {
  it("is out of reach under the fewest screenings", () => {
    expect(classifierCeiling(19)).toBe(Infinity);
  });

  it("is the share of the hour's screenings, rounded up", () => {
    expect(classifierCeiling(20)).toBe(3);
    expect(classifierCeiling(21)).toBe(4);
  });
});

describe("reportCeiling", () => {
  it("is never under the floor", () => {
    expect(reportCeiling(0)).toBe(REPORT_HIDES_FLOOR);
    expect(reportCeiling(2)).toBe(REPORT_HIDES_FLOOR);
  });

  it("is four times the busiest hour once that is past the floor", () => {
    expect(reportCeiling(3)).toBe(12);
  });
});

describe("the fingerprint breaker", () => {
  it("holds under its ceiling and stops at it", async () => {
    await opened("fingerprint", FINGERPRINT_HOLDS_PER_HOUR - 1, NOW - 60);
    expect(await ceilingReading(core(), "fingerprint", NOW)).toStrictEqual({
      cause: "fingerprint",
      isOver: false,
      count: 4,
      ceiling: FINGERPRINT_HOLDS_PER_HOUR,
    });

    await opened("fingerprint", 1, NOW - 60);
    const reading = await ceilingReading(core(), "fingerprint", NOW);
    expect(reading.isOver).toBe(true);
  });

  it("counts a garment photo's hold, which no report could make", async () => {
    await opened(
      "fingerprint",
      FINGERPRINT_HOLDS_PER_HOUR,
      NOW - 60,
      "garment",
    );

    const reading = await ceilingReading(core(), "fingerprint", NOW);

    expect(reading.isOver).toBe(true);
  });

  it("counts the hour to the second, and only its own cause", async () => {
    await opened("fingerprint", 4, NOW - HOUR);
    await opened("fingerprint", 3, NOW - HOUR - 1);
    await opened("classifier", 3, NOW - 60);

    const reading = await ceilingReading(core(), "fingerprint", NOW);

    expect(reading.count).toBe(4);
  });
});

describe("the classifier breaker", () => {
  it("never trips on an hour under the fewest screenings", async () => {
    await screened("flag", 19, NOW - 60);

    const reading = await ceilingReading(core(), "classifier", NOW);

    expect(reading).toMatchObject({ isOver: false, count: 19 });
  });

  it("trips at the share of an hour's screenings", async () => {
    await screened("pass", 16, NOW - 60);
    await screened("review", 2, NOW - 60);
    await screened("flag", 2, NOW - 60);
    expect(await ceilingReading(core(), "classifier", NOW)).toStrictEqual({
      cause: "classifier",
      isOver: false,
      count: 2,
      ceiling: 3,
    });

    await screened("flag", 1, NOW - 60);
    // 21 screened now, so the ceiling moves to 4 and 3 flags are under it.
    expect(await ceilingReading(core(), "classifier", NOW)).toMatchObject({
      isOver: false,
      count: 3,
      ceiling: 4,
    });

    await screened("flag", 1, NOW - 60);
    const reading = await ceilingReading(core(), "classifier", NOW);
    expect(reading.isOver).toBe(true);
  });

  it("reads only the hour, and nothing at all as no flags", async () => {
    await screened("flag", 25, NOW - HOUR - 1);
    expect(await ceilingReading(core(), "classifier", NOW)).toMatchObject({
      isOver: false,
      count: 0,
    });

    await screened("flag", 20, NOW - HOUR);
    const reading = await ceilingReading(core(), "classifier", NOW);
    expect(reading).toMatchObject({ isOver: true, count: 20 });
  });
});

describe("the report breaker", () => {
  it("holds under the floor whatever the baseline, and stops at it with none", async () => {
    await opened("reports", 3, NOW - 2 * HOUR);
    await opened("reports", REPORT_HIDES_FLOOR - 1, NOW - 60);
    // Under the floor the baseline is not read: 3 would make it 12.
    expect(await ceilingReading(core(), "reports", NOW)).toStrictEqual({
      cause: "reports",
      isOver: false,
      count: 9,
      ceiling: REPORT_HIDES_FLOOR,
    });
  });

  it("stops at the floor with no busier baseline", async () => {
    await opened("reports", 2, NOW - 2 * HOUR);
    await opened("reports", REPORT_HIDES_FLOOR, NOW - 60);

    const reading = await ceilingReading(core(), "reports", NOW);

    expect(reading).toMatchObject({ isOver: true, ceiling: 10 });
  });

  it("rises to four times the busiest earlier hour, by the hour", async () => {
    // Three in one earlier hour, one in another: the busiest hour is 3.
    await opened("reports", 3, NOW - 2 * HOUR);
    await opened("reports", 1, NOW - 3 * HOUR);
    await opened("reports", REPORT_HIDES_FLOOR, NOW - 60);

    const reading = await ceilingReading(core(), "reports", NOW);

    expect(reading).toMatchObject({ isOver: false, count: 10, ceiling: 12 });
  });

  it("counts only the subjects a report can hide (owner, 2026-10-31)", async () => {
    await opened("reports", 6, NOW - 60, "profile");
    await opened("reports", 6, NOW - 60, "product");
    await opened("reports", REPORT_HIDES_FLOOR - 1, NOW - 60, "entry");
    expect(await ceilingReading(core(), "reports", NOW)).toMatchObject({
      isOver: false,
      count: 9,
    });

    await opened("reports", 1, NOW - 60, "photo");
    const reading = await ceilingReading(core(), "reports", NOW);
    expect(reading).toMatchObject({ isOver: true, count: 10 });
  });

  it("leaves profile and product reports out of the baseline too", async () => {
    await opened("reports", 3, NOW - 2 * HOUR, "profile");
    await opened("reports", REPORT_HIDES_FLOOR, NOW - 60);

    const reading = await ceilingReading(core(), "reports", NOW);

    expect(reading).toMatchObject({ ceiling: REPORT_HIDES_FLOOR });
  });

  it("remembers a busy hour four weeks back", async () => {
    // A literal date, not the constant: the window is the owner's 28 days.
    await opened("reports", 3, NOW - 27 * 24 * HOUR);
    await opened("reports", REPORT_HIDES_FLOOR, NOW - 60);

    const reading = await ceilingReading(core(), "reports", NOW);

    expect(reading).toMatchObject({ ceiling: 12 });
  });

  it("reads the baseline from the four weeks before this hour, and only reports", async () => {
    // Not the baseline: this hour itself, before the four weeks, or
    // another cause.
    await opened("reports", REPORT_HIDES_FLOOR, NOW - HOUR);
    await opened("reports", 3, NOW - HOUR - REPORT_BASELINE_S - 1);
    await opened("fingerprint", 3, NOW - 2 * HOUR);
    expect(await ceilingReading(core(), "reports", NOW)).toMatchObject({
      ceiling: 10,
    });

    // The baseline's first second counts.
    await opened("reports", 3, NOW - HOUR - REPORT_BASELINE_S);
    const reading = await ceilingReading(core(), "reports", NOW);
    expect(reading).toMatchObject({ ceiling: 12 });
  });
});

const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
One cause's share of its ceiling from `dayHeadroom`.
*/
async function usedBy(cause: HoldCause): Promise<number | undefined> {
  const headroom = await dayHeadroom(core(), NOW);
  return headroom.find((each) => each.cause === cause)?.used;
}

describe("dayHeadroom", () => {
  it("reads every cause, at nothing used on a quiet day", async () => {
    expect(await dayHeadroom(core(), NOW)).toStrictEqual([
      { cause: "fingerprint", used: 0 },
      { cause: "classifier", used: 0 },
      { cause: "reports", used: 0 },
    ]);
  });

  it("reads the busiest hour of the last day, to the second", async () => {
    await opened("fingerprint", 3, NOW - DAY);
    await opened("fingerprint", 1, NOW - 2 * HOUR);
    await opened("fingerprint", 5, NOW - DAY - 1);

    expect(await usedBy("fingerprint")).toBeCloseTo(0.6);
  });

  it("measures the reports against the ceiling their baseline set going into the day", async () => {
    await opened("reports", 4, NOW - 2 * HOUR);
    expect(await usedBy("reports")).toBeCloseTo(0.4);

    await opened("reports", 3, NOW - DAY - HOUR);
    expect(await usedBy("reports")).toBeCloseTo(4 / 12);
  });

  it("reads the classifier's busiest share among hours with enough screenings", async () => {
    // An hour of 19, every one flagged: too few to read a share from.
    await screened("flag", 19, NOW - 5 * HOUR);
    await screened("pass", 17, NOW - 2 * HOUR);
    await screened("flag", 3, NOW - 2 * HOUR);
    await screened("pass", 19, NOW - 3 * HOUR);
    await screened("flag", 1, NOW - 3 * HOUR);

    expect(await usedBy("classifier")).toBeCloseTo(1);
  });

  it("leaves a classifier hour older than the day out", async () => {
    await screened("flag", 20, NOW - DAY - HOUR);

    expect(await usedBy("classifier")).toBe(0);
  });
});

describe("quietScreenerWeek", () => {
  it("says how many a week screened when none was flagged or queued", async () => {
    await screened("pass", 50, NOW - WEEK);

    expect(await quietScreenerWeek(core(), NOW)).toBe(50);
  });

  it("says nothing under the fewest, or past a week", async () => {
    await screened("pass", 49, NOW - 60);
    await screened("pass", 5, NOW - WEEK - 1);

    expect(await quietScreenerWeek(core(), NOW)).toBeUndefined();
  });

  it("says nothing once one photo was flagged or sent to review", async () => {
    await screened("pass", 60, NOW - 60);
    await screened("review", 1, NOW - 60);
    expect(await quietScreenerWeek(core(), NOW)).toBeUndefined();

    await core().delete(photoScreenings);
    await screened("pass", 60, NOW - 60);
    await screened("flag", 1, NOW - 60);
    expect(await quietScreenerWeek(core(), NOW)).toBeUndefined();
  });
});
