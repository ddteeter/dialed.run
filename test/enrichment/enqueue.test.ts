import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { products } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { enqueueEnrichment } from "../../src/modules/enrichment/enqueue";
import { captureException } from "../../src/modules/ops";
import {
  createOrGetBrand,
  createOrGetProduct,
} from "../../src/modules/products";

/**
 * The bindings-facing wrapper: `requestEnrichment` with this Worker's queue,
 * and the promise that it cannot fail the save that called it.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

async function productWithUrl(): Promise<string> {
  const client = db();
  const brand = await createOrGetBrand(client, `Brand ${newUlid()}`);
  const product = await createOrGetProduct(client, {
    brandId: brand.id,
    name: `Tee ${newUlid()}`,
    sourceUrl: "https://shop.example.com/products/tee",
    createdBy: newUlid(),
  });
  return product.id;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enqueueEnrichment", () => {
  it("sends the job on this Worker's enrichment queue", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    const productId = await productWithUrl();

    expect(await enqueueEnrichment(db(), productId, captureException)).toBe("queued");

    expect(send).toHaveBeenCalledWith({ type: "enrich", productId });
    const [row] = await db()
      .select({ status: products.extractionStatus })
      .from(products)
      .where(eq(products.id, productId));
    expect(row?.status).toBe("pending");
  });

  it("skips a product that is already pending, and sends nothing", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    const productId = await productWithUrl();
    await enqueueEnrichment(db(), productId, captureException);
    send.mockClear();

    expect(await enqueueEnrichment(db(), productId, captureException)).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a failed claim and reports it, rather than failing the save", async () => {
    // Law 5: enrichment must never take down the garment save that asked
    // for it. Driven with a real handle on the *weather* database, which
    // has no `products` table — so the claim throws where a D1 outage
    // would, through the real code rather than a stub.
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const productId = await productWithUrl();

    expect(await enqueueEnrichment(drizzle(env.DIALED_WEATHER), productId, captureException)).toBe(
      "skipped",
    );

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      { surface: "enrichment-enqueue", productId },
      expect.anything(),
    );
  });
});
