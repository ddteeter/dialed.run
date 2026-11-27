import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { products } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  abandonedBefore,
  ENRICHMENT_SWEEP_TRIES,
  isSweepOwed,
  sweepOwed,
} from "../../src/modules/enrichment/abandon";
import { createOrGetBrand } from "../../src/modules/products";
import { createOrGetProduct } from "../../src/modules/products/service";

/**
 * #881: the closet's link line says "retrying" by `isSweepOwed`, and the
 * hourly sweep claims by `sweepOwed`. One rule, written twice; this holds
 * the two to the same answer for every row, at both edges of the day and
 * of the try cap.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

const NOW = 1_800_000_000;
const DAY_EDGE = abandonedBefore(NOW);
const CAP = ENRICHMENT_SWEEP_TRIES;

function byId(a: string, b: string): number {
  return a.localeCompare(b);
}

const ROWS: readonly { createdAt: number; tries: number | undefined }[] = [
  { createdAt: DAY_EDGE + 1, tries: undefined },
  { createdAt: DAY_EDGE + 1, tries: 0 },
  { createdAt: DAY_EDGE + 1, tries: CAP - 1 },
  { createdAt: DAY_EDGE + 1, tries: CAP },
  { createdAt: DAY_EDGE + 1, tries: CAP + 3 },
  { createdAt: DAY_EDGE, tries: undefined },
  { createdAt: DAY_EDGE, tries: 1 },
  { createdAt: DAY_EDGE - 1, tries: 0 },
  { createdAt: NOW - 60, tries: 4 },
];

async function productWith(
  row: Readonly<{ createdAt: number; tries: number | undefined }>,
): Promise<string> {
  const client = db();
  const brand = await createOrGetBrand(client, `Brand ${newUlid()}`);
  const product = await createOrGetProduct(client, {
    brandId: brand.id,
    name: `Tee ${newUlid()}`,
    sourceUrl: "https://shop.example.com/products/tee",
    createdBy: newUlid(),
  });
  await client
    .update(products)
    .set({ createdAt: row.createdAt, extractionTries: row.tries })
    .where(eq(products.id, product.id));
  return product.id;
}

describe("isSweepOwed and sweepOwed: one rule for the line and the sweep (#881)", () => {
  it("owes a retry only inside the product's first day and under the try cap", () => {
    expect(ROWS.map((row) => isSweepOwed(row, NOW))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("reads the clock when no instant is given", () => {
    const fresh = { createdAt: nowSeconds(), tries: 0 };
    expect(isSweepOwed(fresh)).toBe(true);
    expect(isSweepOwed({ ...fresh, tries: CAP })).toBe(false);
  });

  it("selects exactly the rows the line calls owed", async () => {
    const ids = await Promise.all(ROWS.map((row) => productWith(row)));
    const selected = await db()
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.id, ids), sweepOwed(NOW)));

    const owed = ids.filter((_, index) => {
      const row = ROWS[index];
      return row !== undefined && isSweepOwed(row, NOW);
    });
    expect(owed).toHaveLength(4);
    expect(selected.map((row) => row.id).toSorted(byId)).toEqual(
      owed.toSorted(byId),
    );
  });

  it("reads the clock when no instant is given, in SQL too", async () => {
    const createdAt = nowSeconds() - 60;
    const owed = await productWith({ createdAt, tries: CAP - 1 });
    const capped = await productWith({ createdAt, tries: CAP });
    const selected = await db()
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.id, [owed, capped]), sweepOwed()));
    expect(selected.map((row) => row.id)).toEqual([owed]);
  });
});
