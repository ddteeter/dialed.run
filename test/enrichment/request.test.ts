import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";

import { products } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { orSqlNull } from "../../src/lib/sql/sql-null";
import { abandonedBefore } from "../../src/modules/enrichment/abandon";
import {
  isClaimable,
  requestEnrichment,
} from "../../src/modules/enrichment/request";
import {
  createOrGetBrand,
  createOrGetProduct,
} from "../../src/modules/products";

/**
 * The producing half of the reconciliation pattern: the row flips first,
 * the send is a fast path, and the flip is also the dedupe.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

const NOW = 1_800_000_000;

async function productWith(
  overrides: Partial<typeof products.$inferInsert> = {},
): Promise<string> {
  const client = db();
  const brand = await createOrGetBrand(client, `Brand ${newUlid()}`);
  const product = await createOrGetProduct(client, {
    brandId: brand.id,
    name: `Tee ${newUlid()}`,
    sourceUrl: "https://shop.example.com/products/tee",
    createdBy: newUlid(),
  });
  if (Object.keys(overrides).length > 0) {
    await client
      .update(products)
      .set(overrides)
      .where(eq(products.id, product.id));
  }
  return product.id;
}

async function statusOf(productId: string): Promise<string | undefined> {
  const [row] = await db()
    .select({ status: products.extractionStatus })
    .from(products)
    .where(eq(products.id, productId));
  return row?.status;
}

function deps() {
  return {
    queue: { send: vi.fn(() => Promise.resolve()) },
    captureException: vi.fn(),
  };
}

describe("requestEnrichment", () => {
  it("flips a fresh product to pending and sends the job", async () => {
    const id = await productWith();
    const d = deps();
    expect(await requestEnrichment(db(), id, d)).toBe("queued");
    expect(await statusOf(id)).toBe("pending");
    expect(d.queue.send).toHaveBeenCalledWith({
      type: "enrich",
      productId: id,
    });
  });

  it("sends nothing for a product already pending — the flip is the dedupe", async () => {
    const id = await productWith({ extractionStatus: "pending" });
    const d = deps();
    expect(await requestEnrichment(db(), id, d)).toBe("skipped");
    expect(d.queue.send).not.toHaveBeenCalled();
  });

  it("sends nothing for a product already done — that is reextract's job", async () => {
    const id = await productWith({ extractionStatus: "done" });
    const d = deps();
    expect(await requestEnrichment(db(), id, d)).toBe("skipped");
    expect(await statusOf(id)).toBe("done");
    expect(d.queue.send).not.toHaveBeenCalled();
  });

  it("lets a failed product be asked for again once the sweep's day is over", async () => {
    const id = await productWith({
      extractionStatus: "failed",
      createdAt: abandonedBefore(NOW),
    });
    const d = deps();
    expect(await requestEnrichment(db(), id, d, NOW)).toBe("queued");
    expect(await statusOf(id)).toBe("pending");
    expect(d.queue.send).toHaveBeenCalledTimes(1);
  });

  it("leaves a failed product to the sweep inside its first day", async () => {
    const id = await productWith({
      extractionStatus: "failed",
      createdAt: abandonedBefore(NOW) + 1,
    });
    const d = deps();
    expect(await requestEnrichment(db(), id, d, NOW)).toBe("skipped");
    expect(await statusOf(id)).toBe("failed");
    expect(d.queue.send).not.toHaveBeenCalled();
  });

  it("asks for a never-tried product whatever its age", async () => {
    const id = await productWith({ createdAt: abandonedBefore(NOW) + 1 });
    expect(await requestEnrichment(db(), id, deps(), NOW)).toBe("queued");
  });

  it("sends nothing for a product with no URL to fetch", async () => {
    const client = db();
    const brand = await createOrGetBrand(client, `Brand ${newUlid()}`);
    const product = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "No link",
      createdBy: newUlid(),
    });
    const d = deps();
    expect(await requestEnrichment(client, product.id, d)).toBe("skipped");
    expect(await statusOf(product.id)).toBe("none");
    expect(d.queue.send).not.toHaveBeenCalled();
  });

  it("still reports queued when the send fails, and leaves the row pending for the sweep", async () => {
    // The row is the durable half. A failed send is reported, never thrown
    // — the garment save that asked for this must not fail — and the
    // hourly sweep sends what this could not.
    const id = await productWith();
    const d = {
      queue: { send: vi.fn(() => Promise.reject(new Error("queue down"))) },
      captureException: vi.fn(),
    };
    expect(await requestEnrichment(db(), id, d)).toBe("queued");
    expect(await statusOf(id)).toBe("pending");
    expect(d.captureException).toHaveBeenCalledWith(expect.any(Error), {
      surface: "enrichment-request",
      productId: id,
    });
  });
});

describe("isClaimable", () => {
  // The rule for a row in hand must be the claim's own: each case is put
  // to both, and the two must agree.
  const DAY_OVER = abandonedBefore(NOW);
  const cases = [
    { extractionStatus: "none", createdAt: DAY_OVER + 1, link: true },
    { extractionStatus: "none", createdAt: DAY_OVER, link: false },
    { extractionStatus: "failed", createdAt: DAY_OVER, link: true },
    { extractionStatus: "failed", createdAt: DAY_OVER + 1, link: true },
    { extractionStatus: "pending", createdAt: DAY_OVER, link: true },
    { extractionStatus: "done", createdAt: DAY_OVER, link: true },
  ] as const;

  it.each(cases)(
    "agrees with the claim for $extractionStatus, created $createdAt, link $link",
    async ({ extractionStatus, createdAt, link }) => {
      const id = await productWith({ extractionStatus, createdAt });
      if (!link) {
        await db()
          .update(products)
          .set({ sourceUrl: orSqlNull(undefined) })
          .where(eq(products.id, id));
      }
      const [row] = await db()
        .select()
        .from(products)
        .where(eq(products.id, id));
      if (row === undefined) throw new Error("no product");
      const isInHand = isClaimable(row, NOW);
      const claimed = await requestEnrichment(db(), id, deps(), NOW);
      expect(claimed === "queued").toBe(isInHand);
    },
  );

  it("says yes and no where the claim does", () => {
    const row = { sourceUrl: "https://a.example/p", createdAt: DAY_OVER };
    expect(isClaimable({ ...row, extractionStatus: "none" }, NOW)).toBe(true);
    expect(isClaimable({ ...row, extractionStatus: "failed" }, NOW)).toBe(true);
    expect(
      isClaimable(
        { ...row, extractionStatus: "failed", createdAt: DAY_OVER + 1 },
        NOW,
      ),
    ).toBe(false);
    expect(isClaimable({ ...row, extractionStatus: "pending" }, NOW)).toBe(
      false,
    );
  });
});
