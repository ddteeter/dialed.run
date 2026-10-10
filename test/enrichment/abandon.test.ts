import { and, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { products } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { nowSeconds } from "../../src/lib/now";
import {
  extractionDone,
  extractionFailed,
  extractionPending,
  listAbandonedEnrichments,
} from "../../src/modules/enrichment/abandon";

/**
 * The hourly sweeps over failed enrichments run against every product, and
 * D1 bills rows scanned. `products_extraction_failed` is partial, so a
 * query reaches it only when its WHERE implies the index's predicate; a
 * sweep that missed it would scan the table with results identical either
 * way. The plan is the assertion.
 */
describe("the failed-enrichment sweeps are served by the partial index", () => {
  it("lists abandoned products through products_extraction_failed", async () => {
    const seen: { sql: string; params: unknown[] }[] = [];
    const client = drizzle(env.DIALED_CORE, {
      logger: {
        logQuery(sql, params) {
          seen.push({ sql, params });
        },
      },
    });

    await listAbandonedEnrichments(client, nowSeconds());

    const [read] = seen;
    if (read === undefined) throw new Error("no query was issued");
    const plan = await planOf(read.sql, read.params);
    expect(plan).toContain(
      "SEARCH products USING INDEX products_extraction_failed (created_at<?)",
    );
    expect(plan.filter((line) => line.startsWith("SCAN"))).toStrictEqual([]);
  });

  it("reaches the index from the predicate alone, for any age bound", async () => {
    const failedBefore = and(
      extractionFailed(),
      lt(products.createdAt, nowSeconds()),
    );
    const { sql, params } = drizzle(env.DIALED_CORE)
      .select({ id: products.id })
      .from(products)
      .where(failedBefore)
      .toSQL();

    expect(sql).toContain(`"products"."extraction_status" = 'failed'`);
    expect(await planOf(sql, params)).toContain(
      "SEARCH products USING INDEX products_extraction_failed (created_at<?)",
    );
  });
});

describe("the other status predicates state their index's own literal", () => {
  // The sweeps that use these are pinned end to end in
  // `test/ops/scheduled.test.ts`; this holds the literal itself, which is
  // what lets the planner match each partial index.
  it.each([
    ["pending", extractionPending, "products_extraction_pending"],
    ["done", extractionDone, "products_extraction_done"],
  ] as const)(
    "'%s' reaches its own partial index",
    async (status, predicate, index) => {
      const now = nowSeconds();
      const { sql, params } = drizzle(env.DIALED_CORE)
        .select({ id: products.id })
        .from(products)
        .where(and(predicate(), lt(products.createdAt, now)))
        .toSQL();

      expect(sql).toContain(`"products"."extraction_status" = '${status}'`);
      expect(await planOf(sql, params)).toStrictEqual([
        `SEARCH products USING INDEX ${index} (created_at<?)`,
      ]);
    },
  );
});

async function planOf(sql: string, params: unknown[]): Promise<string[]> {
  const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>();
  return plan.results.map((row) => row.detail);
}
