import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";

import { products } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { requestEnrichment } from "../../src/modules/enrichment/request";
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
    await client.update(products).set(overrides).where(eq(products.id, product.id));
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
    expect(d.queue.send).toHaveBeenCalledWith({ type: "enrich", productId: id });
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

  it("lets a failed product be asked for again", async () => {
    const id = await productWith({ extractionStatus: "failed" });
    const d = deps();
    expect(await requestEnrichment(db(), id, d)).toBe("queued");
    expect(await statusOf(id)).toBe("pending");
    expect(d.queue.send).toHaveBeenCalledTimes(1);
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
