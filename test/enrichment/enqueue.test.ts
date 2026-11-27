import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimits, products } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { enqueueEnrichment } from "../../src/modules/enrichment/enqueue";
import { ENRICHMENT_REQUESTS_PER_RUNNER_PER_DAY } from "../../src/modules/enrichment/spend-limit";
import { captureException } from "../../src/modules/ops/sentry";
import { createOrGetBrand } from "../../src/modules/products";
import { createOrGetProduct } from "../../src/modules/products/service";

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

async function productWithUrl() {
  const client = db();
  const brand = await createOrGetBrand(client, `Brand ${newUlid()}`);
  return createOrGetProduct(client, {
    brandId: brand.id,
    name: `Tee ${newUlid()}`,
    sourceUrl: "https://shop.example.com/products/tee",
    createdBy: newUlid(),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enqueueEnrichment", () => {
  it("sends the job on this Worker's enrichment queue", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    const product = await productWithUrl();
    const productId = product.id;

    expect(
      await enqueueEnrichment(db(), product, newUlid(), captureException),
    ).toBe("queued");

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "enrich",
        productId,
      }),
    );
    const [row] = await db()
      .select({ status: products.extractionStatus })
      .from(products)
      .where(eq(products.id, productId));
    expect(row?.status).toBe("pending");
  });

  it("skips a product that is already pending, and sends nothing", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    const product = await productWithUrl();
    const runner = newUlid();
    await enqueueEnrichment(db(), product, runner, captureException);
    send.mockClear();
    const [pending] = await db()
      .select()
      .from(products)
      .where(eq(products.id, product.id));
    if (pending === undefined) throw new Error("no product");

    expect(
      await enqueueEnrichment(db(), pending, runner, captureException),
    ).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    // Nothing that could not go was counted against the runner.
    expect(await countOf(runner)).toBe(1);
  });

  it("swallows a failed claim and reports it, rather than failing the save", async () => {
    // Law 5: enrichment must never take down the garment save that asked
    // for it. Driven with a real handle on the *weather* database, which
    // has no `products` table — so the claim throws where a D1 outage
    // would, through the real code rather than a stub.
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const product = await productWithUrl();
    const productId = product.id;

    expect(
      await enqueueEnrichment(
        drizzle(env.DIALED_WEATHER),
        product,
        newUlid(),
        captureException,
      ),
    ).toBe("skipped");

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      { surface: "enrichment-enqueue", productId },
      expect.anything(),
    );
  });

  it("asks for a runner's first 50 a day, then nothing more, and another runner still asks", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    const runner = newUlid();
    const answers: string[] = [];
    for (let n = 0; n < ENRICHMENT_REQUESTS_PER_RUNNER_PER_DAY; n += 1) {
      answers.push(
        await enqueueEnrichment(
          db(),
          await productWithUrl(),
          runner,
          captureException,
        ),
      );
    }
    expect(answers.every((answer) => answer === "queued")).toBe(true);
    send.mockClear();

    const over = await productWithUrl();
    expect(await enqueueEnrichment(db(), over, runner, captureException)).toBe(
      "skipped",
    );
    expect(send).not.toHaveBeenCalled();
    const [row] = await db()
      .select({ status: products.extractionStatus })
      .from(products)
      .where(eq(products.id, over.id));
    expect(row?.status).toBe("none");

    expect(
      await enqueueEnrichment(db(), over, newUlid(), captureException),
    ).toBe("queued");
  });

  it("does not ask for a product with no link, and counts nothing", async () => {
    const client = db();
    const brand = await createOrGetBrand(client, `Brand ${newUlid()}`);
    const product = await createOrGetProduct(client, {
      brandId: brand.id,
      name: `Tee ${newUlid()}`,
      sourceUrl: undefined,
      createdBy: newUlid(),
    });
    const runner = newUlid();
    expect(
      await enqueueEnrichment(client, product, runner, captureException),
    ).toBe("skipped");
    expect(await countOf(runner)).toBeUndefined();
  });
});

/**
The runner's count of enrichment requests in its window, if it has one.
*/
async function countOf(runner: string): Promise<number | undefined> {
  const [row] = await db()
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(
      and(eq(rateLimits.kind, "enrich-runner"), eq(rateLimits.subject, runner)),
    );
  return row?.count;
}
