import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";

import { products, productSnapshots } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  handleEnrichmentBatch,
  handleEnrichmentDlqBatch,
  reextract,
} from "../../src/modules/enrichment/consume";
import {
  createOrGetBrand,
  createOrGetProduct,
} from "../../src/modules/products";
import { batchOf, fakeMessage } from "../queue-fakes";

/**
 * The consumer against a real D1 and a real R2, with only the network
 * faked. Every case is a row state the job can meet, and every assertion is
 * on what the job left behind: the message (acked or retried), the row's
 * status and columns, the snapshot row, and the bytes in the bucket.
 */

const PAGE = `<html><head>
<script type="application/ld+json">{"@type":"Product","name":"Repeat Merino Tech Tee","brand":{"@type":"Brand","name":"Janji"}}</script>
</head><body><p>Fabric: 47% merino wool, 53% nylon</p></body></html>`;

const URL_UNDER_TEST = "https://shop.example.com/products/tee";

function db() {
  return drizzle(env.DIALED_CORE);
}

/**
A pending product with a URL — what `requestEnrichment` leaves behind.
*/
async function pendingProduct(
  overrides: Partial<typeof products.$inferInsert> = {},
): Promise<string> {
  const client = db();
  const brand = await createOrGetBrand(client, `Brand ${newUlid()}`);
  const product = await createOrGetProduct(client, {
    brandId: brand.id,
    name: `Tee ${newUlid()}`,
    sourceUrl: URL_UNDER_TEST,
    createdBy: newUlid(),
  });
  await client
    .update(products)
    .set({ extractionStatus: "pending", ...overrides })
    .where(eq(products.id, product.id));
  return product.id;
}

async function rowOf(productId: string) {
  const [row] = await db()
    .select()
    .from(products)
    .where(eq(products.id, productId));
  if (row === undefined) throw new Error("row vanished");
  return row;
}

async function snapshotsOf(productId: string) {
  return db()
    .select()
    .from(productSnapshots)
    .where(eq(productSnapshots.productId, productId));
}

function serving(html: string, status = 200) {
  const impl: typeof fetch = () =>
    Promise.resolve(new Response(html, { status }));
  return vi.fn(impl);
}

/**
A network that is down: the fetch itself rejects, no page refuses.
*/
const networkDown: typeof fetch = () =>
  Promise.reject(new TypeError("network down"));

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/**
A shop that refuses, and a proxy that answers for it with the tee page.
*/
const refusingWithProxy: typeof fetch = (input) =>
  Promise.resolve(
    urlOf(input).startsWith("https://api.firecrawl.dev/")
      ? Response.json({
          success: true,
          data: { rawHtml: PAGE, metadata: { statusCode: 200 } },
        })
      : new Response("blocked", { status: 403 }),
  );

/**
Serves the tee page and nothing else — every other URL is a network error.
*/
const servingOnlyTee: typeof fetch = (input) =>
  urlOf(input).includes("tee")
    ? Promise.resolve(new Response(PAGE))
    : Promise.reject(new TypeError("down"));

async function statusOf(productId: string): Promise<string> {
  const row = await rowOf(productId);
  return row.extractionStatus;
}

function depsWith(fetchImpl: typeof fetch) {
  return { db: db(), captureException: vi.fn(), fetchImpl };
}

function jobFor(productId: string, id = "m1") {
  return fakeMessage(id, { type: "enrich", productId });
}

describe("handleEnrichmentBatch: the happy path", () => {
  it("fetches, snapshots, extracts and writes back, then acks", async () => {
    const productId = await pendingProduct();
    const fetchImpl = serving(PAGE);
    const message = jobFor(productId);

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [message]),
      depsWith(fetchImpl),
    );

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const row = await rowOf(productId);
    expect(row.extractionStatus).toBe("done");
    expect(row.fabricComposition).toBe("Fabric: 47% merino wool, 53% nylon");

    const [snapshot] = await snapshotsOf(productId);
    expect(snapshot).toMatchObject({ url: URL_UNDER_TEST, rung: "text" });
    const stored = await env.MEDIA.get(snapshot?.r2Key ?? "");
    expect(await stored?.text()).toBe(PAGE);
  });

  it("answers a redelivery from the snapshot it already has, without fetching", async () => {
    // The write-back failed after the page was stored, say. The retry must
    // not buy the page again: one fetch, one snapshot, and still done.
    const productId = await pendingProduct();
    const fetchImpl = serving(PAGE);
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(fetchImpl),
    );
    await db()
      .update(products)
      .set({ extractionStatus: "pending" })
      .where(eq(products.id, productId));

    const again = jobFor(productId, "m2");
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [again]),
      depsWith(fetchImpl),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(again.ack).toHaveBeenCalledTimes(1);
    expect(await snapshotsOf(productId)).toHaveLength(1);
    expect(await statusOf(productId)).toBe("done");
  });

  it("refetches when the only snapshot is older than the reuse window", async () => {
    // A stale snapshot is history, not a cache: a product asked for again
    // a day later gets the page as it is now, and keeps both (D-31).
    const productId = await pendingProduct();
    const fetchImpl = serving(PAGE);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    await env.MEDIA.put(`products/${productId}/snapshot-${String(dayAgo)}.html`, PAGE);
    await db().insert(productSnapshots).values({
      id: newUlid(),
      productId,
      url: URL_UNDER_TEST,
      r2Key: `products/${productId}/snapshot-${String(dayAgo)}.html`,
      rung: "text",
      fetchedAt: dayAgo,
    });

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(fetchImpl),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await snapshotsOf(productId)).toHaveLength(2);
  });

  it("refetches when a recent snapshot row points at an object that is gone", async () => {
    const productId = await pendingProduct();
    const fetchImpl = serving(PAGE);
    const now = Date.now();
    await db().insert(productSnapshots).values({
      id: newUlid(),
      productId,
      url: URL_UNDER_TEST,
      r2Key: `products/${productId}/snapshot-${String(now)}.html`,
      rung: "text",
      fetchedAt: now,
    });

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(fetchImpl),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await statusOf(productId)).toBe("done");
  });
});

describe("handleEnrichmentBatch: rows that are not work", () => {
  it("acks a job for a product that does not exist, and fetches nothing", async () => {
    const fetchImpl = serving(PAGE);
    const message = jobFor(newUlid());
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [message]),
      depsWith(fetchImpl),
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("acks a job for a product that is not pending — done or never asked", async () => {
    // `done` is a redelivery after success; `none` is a message sent
    // without the row having flipped. Neither is work.
    const fetchImpl = serving(PAGE);
    for (const extractionStatus of ["done", "none"] as const) {
      const productId = await pendingProduct({ extractionStatus });
      const message = jobFor(productId);
      await handleEnrichmentBatch(
        batchOf("dialed-enrichment", [message]),
        depsWith(fetchImpl),
      );
      expect(message.ack, extractionStatus).toHaveBeenCalledTimes(1);
      expect(await statusOf(productId)).toBe(extractionStatus);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reuses a snapshot from inside the window — half an hour is recent", async () => {
    // The window is an hour. A snapshot from thirty minutes ago is on the
    // reuse side of it, which is what separates an hour from a second.
    const productId = await pendingProduct();
    const fetchImpl = serving(PAGE);
    const halfHourAgo = Date.now() - 30 * 60 * 1000;
    const r2Key = `products/${productId}/snapshot-${String(halfHourAgo)}.html`;
    await env.MEDIA.put(r2Key, PAGE);
    await db().insert(productSnapshots).values({
      id: newUlid(),
      productId,
      url: URL_UNDER_TEST,
      r2Key,
      rung: "none",
      fetchedAt: halfHourAgo,
    });

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(fetchImpl),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await statusOf(productId)).toBe("done");
  });

  it("goes through the proxy when the shop refuses and a key is configured", async () => {
    // The consumer is where `FIRECRAWL_API_KEY` meets the fetch. With it
    // passed, a 403 is not the end: the same URL goes through the proxy
    // and the page comes back from there.
    const productId = await pendingProduct();
    const message = jobFor(productId);

    await handleEnrichmentBatch(batchOf("dialed-enrichment", [message]), {
      ...depsWith(vi.fn(refusingWithProxy)),
      proxyApiKey: "fc-test",
    });

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(await statusOf(productId)).toBe("done");
    const [snapshot] = await snapshotsOf(productId);
    expect(snapshot?.rung).toBe("text");
  });

  it("fails a pending product that has no URL, rather than retrying forever", async () => {
    const client = db();
    const brand = await createOrGetBrand(client, `Brand ${newUlid()}`);
    const product = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "No link",
      createdBy: newUlid(),
    });
    await client
      .update(products)
      .set({ extractionStatus: "pending" })
      .where(eq(products.id, product.id));
    const message = jobFor(product.id);

    const deps = depsWith(serving(PAGE));
    await handleEnrichmentBatch(batchOf("dialed-enrichment", [message]), deps);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(await statusOf(product.id)).toBe("failed");
    // Through the same door as any bad URL: reported, not silently failed.
    expect(deps.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "PageFetchError" }),
      { surface: "enrichment-fetch", productId: product.id },
    );
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("acks and reports a message it cannot parse", async () => {
    const deps = depsWith(serving(PAGE));
    const message = fakeMessage("m9", { type: "enrich" });
    await handleEnrichmentBatch(batchOf("dialed-enrichment", [message]), deps);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(deps.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "invalid enrichment queue message" }),
      { queue: "dialed-enrichment", messageId: "m9" },
    );
  });
});

describe("handleEnrichmentBatch: failures", () => {
  it("fails the row and acks when the page itself refuses", async () => {
    // A 403 with no proxy key is a PageFetchError: terminal, so the row
    // says so and the message is not retried. No snapshot, because there
    // was no page.
    const productId = await pendingProduct();
    const deps = depsWith(serving("blocked", 403));
    const message = jobFor(productId);

    await handleEnrichmentBatch(batchOf("dialed-enrichment", [message]), deps);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(await statusOf(productId)).toBe("failed");
    expect(await snapshotsOf(productId)).toHaveLength(0);
    expect(deps.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "PageFetchError" }),
      { surface: "enrichment-fetch", productId },
    );
  });

  it("retries and leaves the row pending when the network throws", async () => {
    // Not the page refusing — the fetch itself failing. The queue owns
    // the retry (law 3), so the message is retried and the row untouched.
    const productId = await pendingProduct();
    const deps = depsWith(vi.fn(networkDown));
    const message = jobFor(productId);

    await handleEnrichmentBatch(batchOf("dialed-enrichment", [message]), deps);

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(await statusOf(productId)).toBe("pending");
    expect(deps.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "network down" }),
      { queue: "dialed-enrichment", messageId: "m1", productId },
    );
  });

  it("keeps going after one bad message so the rest of the batch is served", async () => {
    const good = await pendingProduct();
    const bad = await pendingProduct();
    await db()
      .update(products)
      .set({ sourceUrl: "https://shop.example.com/products/broken" })
      .where(eq(products.id, bad));
    const messages = [jobFor(bad, "bad"), jobFor(good, "good")];

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", messages),
      depsWith(vi.fn(servingOnlyTee)),
    );

    expect(messages[0]?.retry).toHaveBeenCalledTimes(1);
    expect(messages[1]?.ack).toHaveBeenCalledTimes(1);
    expect(await statusOf(good)).toBe("done");
  });
});

describe("handleEnrichmentDlqBatch", () => {
  it("fails a product still pending, reports it, and acks", async () => {
    const productId = await pendingProduct();
    const deps = depsWith(serving(PAGE));
    const message = jobFor(productId);

    await handleEnrichmentDlqBatch(
      batchOf("dialed-enrichment-dlq", [message]),
      deps,
    );

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(await statusOf(productId)).toBe("failed");
    expect(deps.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "dead-lettered job on dialed-enrichment-dlq",
      }),
      { queue: "dialed-enrichment-dlq", messageId: "m1" },
    );
  });

  it("does not un-succeed a product a late retry finished", async () => {
    const productId = await pendingProduct({ extractionStatus: "done" });
    await handleEnrichmentDlqBatch(
      batchOf("dialed-enrichment-dlq", [jobFor(productId)]),
      depsWith(serving(PAGE)),
    );
    expect(await statusOf(productId)).toBe("done");
  });

  it("reports and acks a message it cannot parse, touching no row", async () => {
    const deps = depsWith(serving(PAGE));
    const message = fakeMessage("m7", "garbage");
    await handleEnrichmentDlqBatch(
      batchOf("dialed-enrichment-dlq", [message]),
      deps,
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(deps.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("reextract", () => {
  it("re-runs the ladder over the stored page without fetching, and re-records the rung", async () => {
    const productId = await pendingProduct();
    const fetchImpl = serving(PAGE);
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(fetchImpl),
    );
    // A human corrects a column; the re-run must respect it (that is
    // applyExtraction's contract) while still re-reading the page.
    await db()
      .update(products)
      .set({ fabricComposition: "hand-edited" })
      .where(eq(products.id, productId));
    const [before] = await snapshotsOf(productId);
    await db()
      .update(productSnapshots)
      .set({ rung: "none" })
      .where(eq(productSnapshots.id, before?.id ?? ""));

    const report = await reextract(db(), productId);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(report?.kept).toStrictEqual(["fabricComposition"]);
    const edited = await rowOf(productId);
    expect(edited.fabricComposition).toBe("hand-edited");
    const [after] = await snapshotsOf(productId);
    expect(after?.rung).toBe("text");
  });

  it("does nothing for a product that has never been snapshotted", async () => {
    const productId = await pendingProduct();
    expect(await reextract(db(), productId)).toBeUndefined();
    expect(await statusOf(productId)).toBe("pending");
  });

  it("does nothing when the snapshot's object is gone", async () => {
    const productId = await pendingProduct();
    await db().insert(productSnapshots).values({
      id: newUlid(),
      productId,
      url: URL_UNDER_TEST,
      r2Key: `products/${productId}/snapshot-0.html`,
      rung: "text",
      fetchedAt: 1,
    });
    expect(await reextract(db(), productId)).toBeUndefined();
  });
});
