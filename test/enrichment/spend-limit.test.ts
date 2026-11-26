import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { rateLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  GLOBAL_SUBJECT,
  type RateLimitKind,
} from "../../src/lib/contracts/rate-limits";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { sweepRateLimits } from "../../src/modules/email";
import {
  canSpendModelCall,
  canSpendPageFetch,
  canSpendProductProxyCall,
  canSpendProxyCall,
  canSpendRunnerRequest,
  ENRICHMENT_REQUESTS_PER_RUNNER_PER_DAY,
  MODEL_CALLS_PER_HOUR,
  PAGE_FETCHES_PER_HOUR,
  PROXY_CALLS_PER_DAY,
  PROXY_CALLS_PER_PRODUCT_PER_DAY,
} from "../../src/modules/enrichment/spend-limit";

/**
 * Enrichment's spend counts on real D1: each allows its number in
 * its window, refuses the next, and starts over once the window ends.
 */

const db = drizzle(env.DIALED_CORE);
const NOW = 1_800_000_000;
const HOUR = 60 * 60;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await db.delete(rateLimits);
});

async function countOf(
  kind: RateLimitKind,
  subject = GLOBAL_SUBJECT,
): Promise<number | undefined> {
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.kind, kind), eq(rateLimits.subject, subject)));
  return row?.count;
}

type CanSpend = (now: number) => Promise<boolean>;

/**
`ask` `times` times at `at`, and every answer.
*/
async function answers(
  canSpend: CanSpend,
  times: number,
  at = NOW,
): Promise<boolean[]> {
  const out: boolean[] = [];
  for (let n = 0; n < times; n += 1) out.push(await canSpend(at));
  return out;
}

function canSpendAsRunner(now: number): Promise<boolean> {
  return canSpendRunnerRequest(db, RUNNER, now);
}

function canSpendFetch(now: number): Promise<boolean> {
  return canSpendPageFetch(db, now);
}

function canSpendProxy(now: number): Promise<boolean> {
  return canSpendProxyCall(db, now);
}

function canSpendProductProxy(now: number): Promise<boolean> {
  return canSpendProductProxyCall(db, PRODUCT, now);
}

function canSpendModel(now: number): Promise<boolean> {
  return canSpendModelCall(db, now);
}

const RUNNER = newUlid();
const PRODUCT = newUlid();

describe("the spend counts", () => {
  it.each([
    {
      name: "a runner's requests",
      canSpend: canSpendAsRunner,
      limit: ENRICHMENT_REQUESTS_PER_RUNNER_PER_DAY,
      windowS: DAY,
    },
    {
      name: "page fetches",
      canSpend: canSpendFetch,
      limit: PAGE_FETCHES_PER_HOUR,
      windowS: HOUR,
    },
    {
      name: "proxy calls",
      canSpend: canSpendProxy,
      limit: PROXY_CALLS_PER_DAY,
      windowS: DAY,
    },
    {
      name: "a product's proxy calls",
      canSpend: canSpendProductProxy,
      limit: PROXY_CALLS_PER_PRODUCT_PER_DAY,
      windowS: DAY,
    },
    {
      name: "model calls",
      canSpend: canSpendModel,
      limit: MODEL_CALLS_PER_HOUR,
      windowS: HOUR,
    },
  ])(
    "$name: allows the window's number, refuses the next, and starts over when it ends",
    async ({ canSpend, limit, windowS }) => {
      const first = await answers(canSpend, limit);
      expect(first.every(Boolean)).toBe(true);
      expect(await canSpend(NOW + windowS - 1)).toBe(false);
      expect(await canSpend(NOW + windowS)).toBe(true);
    },
  );

  it("are the owner's numbers", () => {
    expect(ENRICHMENT_REQUESTS_PER_RUNNER_PER_DAY).toBe(50);
    expect(PAGE_FETCHES_PER_HOUR).toBe(200);
    expect(PROXY_CALLS_PER_DAY).toBe(150);
    expect(PROXY_CALLS_PER_PRODUCT_PER_DAY).toBe(1);
    expect(MODEL_CALLS_PER_HOUR).toBe(200);
  });

  it("counts each runner, and each global count, on its own", async () => {
    const runner = newUlid();
    await canSpendRunnerRequest(db, runner, NOW);
    await canSpendPageFetch(db, NOW);
    await canSpendProxyCall(db, NOW);
    await canSpendProductProxyCall(db, PRODUCT, NOW);
    await canSpendModelCall(db, NOW);
    expect(await countOf("enrich-runner", runner)).toBe(1);
    expect(await countOf("proxy-product", PRODUCT)).toBe(1);
    expect(await countOf("model-call")).toBe(1);
    expect(await canSpendProductProxyCall(db, newUlid(), NOW)).toBe(true);
    expect(await countOf("page-fetch")).toBe(1);
    expect(await countOf("proxy-call")).toBe(1);
    expect(await canSpendRunnerRequest(db, newUlid(), NOW)).toBe(true);
  });

  it("counts from the present when no time is given (the production call)", async () => {
    const runner = newUlid();
    await canSpendRunnerRequest(db, runner);
    await canSpendPageFetch(db);
    await canSpendProxyCall(db);
    await canSpendProductProxyCall(db, PRODUCT);
    await canSpendModelCall(db);
    const rows = await db.select().from(rateLimits);
    for (const row of rows) {
      expect(Math.abs(row.windowStartedAt - nowSeconds())).toBeLessThan(60);
    }
    expect(rows).toHaveLength(5);
  });
});

describe("the rate limits' daily sweep, over spend counts", () => {
  it("keeps a day's count while it can still refuse, and takes it once long over", async () => {
    const runner = newUlid();
    for (let n = 0; n <= ENRICHMENT_REQUESTS_PER_RUNNER_PER_DAY; n += 1) {
      await canSpendRunnerRequest(db, runner, NOW);
    }
    // Late in its day, the sweep leaves it, and it still refuses.
    await sweepRateLimits(db, NOW + DAY - 60);
    expect(await canSpendRunnerRequest(db, runner, NOW + DAY - 60)).toBe(false);
    // Long after, it goes.
    await sweepRateLimits(db, NOW + 3 * DAY);
    expect(await countOf("enrich-runner", runner)).toBeUndefined();
  });
});
