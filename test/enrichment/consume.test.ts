import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  domainDenylist,
  rateLimits,
  gaveUp,
  linkLandings,
  products,
  productSnapshots,
} from "../../src/db/schema-core";
import { GLOBAL_SUBJECT } from "../../src/lib/contracts/rate-limits";
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
import { DEAD_LETTER_REASON, MAX_RAW_ERROR_LENGTH } from "../../src/db/gave-up";
import {
  ABANDONED_PER_FIRING,
  listAbandonedEnrichments,
} from "../../src/modules/enrichment/abandon";
import { MAX_OPEN_TAGS } from "../../src/modules/enrichment/html";
import { pageFailureReason } from "../../src/modules/enrichment/bounds";
import {
  MODEL_CALLS_PER_HOUR,
  PAGE_FETCHES_PER_HOUR,
  PROXY_CALLS_PER_DAY,
} from "../../src/modules/enrichment/spend-limit";
import { isDeniedLink, isDeniedOnLanding } from "../../src/modules/safety";
import { denyDomain } from "../../src/modules/safety/rules/denylist";
import { nowSeconds } from "../../src/lib/now";
import { gaveUpRow } from "../gave-up-rows";
import { batchOf, fakeMessage, type SpiedMessage } from "../queue-fakes";

/**
 * The consumer against a real D1 and a real R2, with only the network
 * faked. Every case is a row state the job can meet, and every assertion is
 * on what the job left behind: the message (acked or retried), the row's
 * status and columns, the snapshot row, and the bytes in the bucket.
 */

/**
 * A shop image the page advertises. No shop image is ever fetched or
 * stored (D-176), so nothing in these tests serves one: a fetch of it is
 * the bug.
 */
const IMAGE_URL = "https://cdn.example.com/products/tee.jpg";

const PAGE_WITH_IMAGE = `<html><head>
<meta property="og:image" content="${IMAGE_URL}">
<meta property="og:title" content="Repeat Merino Tech Tee">
</head><body><p>Built for cold mornings.</p></body></html>`;

/**
 * An ordinary page: JSON-LD names it, and says nothing about fabric.
 *
 * It used to declare `material` and, before that, state the composition in
 * prose. Neither reaches the column any more — the ladder stopped
 * answering the field entirely on 2026-09-14 — so composition in these
 * tests comes from the stub model, exactly as it does in production.
 */
const PAGE = `<html><head>
<script type="application/ld+json">{"@type":"Product","name":"Repeat Merino Tech Tee","brand":{"@type":"Brand","name":"Janji"}}</script>
</head><body><p>Built for cold mornings.</p></body></html>`;

const URL_UNDER_TEST = "https://shop.example.com/products/tee";

/**
What the stub model reports, standing in for the one source of composition.
*/
const COMPOSITION = "47% merino wool, 53% nylon";

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

/**
Serves the page that advertises an image, at any URL.
*/
const servingPageWithImage: typeof fetch = () =>
  Promise.resolve(new Response(PAGE_WITH_IMAGE));

async function statusOf(productId: string): Promise<string> {
  const row = await rowOf(productId);
  return row.extractionStatus;
}

function modelAnswering(verbatim: string) {
  return {
    extract: vi.fn(() => Promise.resolve({ fabricComposition: { verbatim } })),
  };
}

/**
 * A configured worker: a page fetcher and a model.
 *
 * **The model is part of the default now**, because composition has no
 * other source (owner, 2026-09-14). A worker without one is a real state —
 * a dev machine with no key — but it is the exception, and the tests that
 * care about it pass no model explicitly.
 */
function depsWith(fetchImpl: typeof fetch) {
  return {
    db: db(),
    captureException: vi.fn(),
    fetchImpl,
    model: modelAnswering(COMPOSITION),
    isLandingDenied: isDeniedOnLanding,
  };
}

/**
Deps with no model configured, which is the unconfigured-worker case.
*/
function depsWithoutModel(fetchImpl: typeof fetch) {
  return {
    db: db(),
    captureException: vi.fn(),
    fetchImpl,
    isLandingDenied: isDeniedOnLanding,
  };
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
    expect(row.fabricComposition).toBe("47% merino wool, 53% nylon");

    const [snapshot] = await snapshotsOf(productId);
    expect(snapshot).toMatchObject({ url: URL_UNDER_TEST, rung: "llm" });
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

  it("keeps the page of a delivery that ended inside the ladder, and reads it again (SA-M32)", async () => {
    const productId = await pendingProduct();
    const fetchImpl = serving(PAGE);
    const first = jobFor(productId);
    await handleEnrichmentBatch(batchOf("dialed-enrichment", [first]), {
      ...depsWith(fetchImpl),
      ladder: () => {
        throw new Error("ended part-way");
      },
    });

    // The row was written before the ladder ran, rung not yet known.
    expect(first.retry).toHaveBeenCalledTimes(1);
    const [kept] = await snapshotsOf(productId);
    expect(kept?.rung).toBe("none");
    expect(await statusOf(productId)).toBe("pending");

    const again = jobFor(productId, "m2");
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [again]),
      depsWith(fetchImpl),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await snapshotsOf(productId)).toHaveLength(1);
    expect(await statusOf(productId)).toBe("done");
  });

  it("refetches when the only snapshot is older than the reuse window", async () => {
    // A stale snapshot is history, not a cache: a product asked for again
    // a day later gets the page as it is now, and keeps both (D-31).
    const productId = await pendingProduct();
    const fetchImpl = serving(PAGE);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    await env.MEDIA.put(
      `products/${productId}/snapshot-${String(dayAgo)}.html`,
      PAGE,
    );
    await db()
      .insert(productSnapshots)
      .values({
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
    await db()
      .insert(productSnapshots)
      .values({
        id: newUlid(),
        productId,
        url: URL_UNDER_TEST,
        r2Key: `products/${productId}/snapshot-${String(now)}.html`,
        rung: "text",
        fetchedAt: now,
      });

    const message = jobFor(productId);
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [message]),
      depsWith(fetchImpl),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await statusOf(productId)).toBe("done");
  });
});

/**
 * A link that 302s to `landing`, which serves the page with an image.
 */
function redirectingTo(landing: string) {
  const impl: typeof fetch = (input) => {
    const url = urlOf(input);
    if (url === URL_UNDER_TEST) {
      return Promise.resolve(
        new Response(undefined, {
          status: 302,
          headers: { location: landing },
        }),
      );
    }
    return Promise.resolve(new Response(PAGE_WITH_IMAGE));
  };
  return vi.fn(impl);
}

describe("handleEnrichmentBatch: where the link landed (R-176)", () => {
  afterEach(async () => {
    await db().delete(linkLandings);
    await db()
      .delete(domainDenylist)
      .where(eq(domainDenylist.domain, "spam.example"));
  });

  it("throws away a read that landed on a denied site, and lets the link go", async () => {
    await denyDomain("spam.example", newUlid());
    const productId = await pendingProduct({
      extractionError: "earlier",
      extractionTries: 2,
    });
    const fetchImpl = redirectingTo("https://spam.example/tee");
    const deps = depsWith(fetchImpl);
    const message = jobFor(productId);

    await handleEnrichmentBatch(batchOf("dialed-enrichment", [message]), deps);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(deps.captureException).not.toHaveBeenCalled();
    // The redirect and the landing page: no image was fetched.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(deps.model.extract).not.toHaveBeenCalled();
    expect(await snapshotsOf(productId)).toEqual([]);
    const listed = await env.MEDIA.list({ prefix: `products/${productId}/` });
    expect(listed.objects).toEqual([]);
    const row = await rowOf(productId);
    expect(row.extractionStatus).toBe("none");
    expect(row.sourceUrl).toBeNull();
    expect(row.fabricComposition).toBeNull();
    expect(row.extractionError).toBeNull();
    expect(row.extractionTries).toBeNull();
    // Denied wherever it would show, as a link typed there is.
    expect(await isDeniedLink(URL_UNDER_TEST)).toBe(true);
  });

  it("asks with the link as typed and the page it ended on", async () => {
    const productId = await pendingProduct();
    const isLandingDenied = vi.fn(() => Promise.resolve(false));
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      {
        ...depsWith(redirectingTo("https://other.example/tee")),
        isLandingDenied,
      },
    );
    expect(isLandingDenied).toHaveBeenCalledWith(
      URL_UNDER_TEST,
      "https://other.example/tee",
    );
  });

  it("reads an allowed landing as before, and remembers where it was", async () => {
    const productId = await pendingProduct();
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(redirectingTo("https://spam.example/tee")),
    );

    const row = await rowOf(productId);
    expect(row).toMatchObject({
      extractionStatus: "done",
      sourceUrl: URL_UNDER_TEST,
    });
    const [snapshot] = await snapshotsOf(productId);
    expect(snapshot?.url).toBe("https://spam.example/tee");

    // Denied later: the link goes too, though its read has been kept.
    expect(await isDeniedLink(URL_UNDER_TEST)).toBe(false);
    await denyDomain("spam.example", newUlid());
    expect(await isDeniedLink(URL_UNDER_TEST)).toBe(true);
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
    expect(snapshot?.rung).toBe("llm");
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
      4,
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
      4,
    );
    expect(await statusOf(productId)).toBe("done");
  });

  it("reports and acks a message it cannot parse, touching no row", async () => {
    const deps = depsWith(serving(PAGE));
    const message = fakeMessage("m7", "garbage");
    await handleEnrichmentDlqBatch(
      batchOf("dialed-enrichment-dlq", [message]),
      deps,
      4,
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

    const report = await reextract(depsWith(fetchImpl), productId);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(report?.kept).toStrictEqual(["fabricComposition"]);
    const edited = await rowOf(productId);
    expect(edited.fabricComposition).toBe("hand-edited");
    const [after] = await snapshotsOf(productId);
    expect(after?.rung).toBe("llm");
  });

  it("does nothing for a product that has never been snapshotted", async () => {
    const productId = await pendingProduct();
    const deps = depsWith(serving(PAGE));
    expect(await reextract(deps, productId)).toBeUndefined();
    expect(await statusOf(productId)).toBe("pending");
  });

  it("does nothing when the snapshot's object is gone", async () => {
    const productId = await pendingProduct();
    await db()
      .insert(productSnapshots)
      .values({
        id: newUlid(),
        productId,
        url: URL_UNDER_TEST,
        r2Key: `products/${productId}/snapshot-0.html`,
        rung: "text",
        fetchedAt: 1,
      });
    const deps = depsWith(serving(PAGE));
    expect(await reextract(deps, productId)).toBeUndefined();
  });
});

describe("handleEnrichmentBatch: no shop images (D-176)", () => {
  it("reads a page that advertises an image without fetching or storing it", async () => {
    const productId = await pendingProduct();
    const fetchImpl = vi.fn(servingPageWithImage);
    const deps = depsWith(fetchImpl);

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      deps,
    );

    // The page, and only the page: the advertised image is never asked for.
    const fetched = fetchImpl.mock.calls.map((call) => urlOf(call[0]));
    expect(fetched).toStrictEqual([URL_UNDER_TEST]);
    const row = await rowOf(productId);
    expect(row.extractionStatus).toBe("done");
    // The snapshot is the product's only object in the bucket.
    const listed = await env.MEDIA.list({ prefix: `products/${productId}/` });
    expect(listed.objects.map((object) => object.key)).toStrictEqual([
      expect.stringMatching(/\/snapshot-\d+\.html$/u),
    ]);
    expect(deps.captureException).not.toHaveBeenCalled();
  });
});

/**
 * A page a deterministic rung can read the *name* off — Open Graph, which
 * essentially every shop ships — while stating no composition anywhere.
 * That is the shape the model rung exists for, and it is why the rung below
 * stays `og` rather than falling to `none`.
 */
const OPAQUE = `<html><head>
<meta property="og:title" content="Graves Shell">
</head><body><p>Built for cold mornings.</p></body></html>`;

describe("handleEnrichmentBatch: the model rung", () => {
  it("asks the model when the page states no composition, and records `llm`", async () => {
    const productId = await pendingProduct();
    const model = modelAnswering("100% Primeflex");

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      {
        ...depsWith(serving(OPAQUE)),
        model,
      },
    );

    expect(model.extract).toHaveBeenCalledTimes(1);
    const row = await rowOf(productId);
    expect(row.fabricComposition).toBe("100% Primeflex");
    const [snapshot] = await snapshotsOf(productId);
    expect(snapshot?.rung).toBe("llm");
  });

  it("leaves the rung alone when the model answers nothing new", async () => {
    // The column says whether re-running would help. A model that filled
    // no blank did not deepen anything, so `llm` would be a lie.
    const productId = await pendingProduct();
    const model = { extract: vi.fn(() => Promise.resolve({})) };

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      {
        ...depsWith(serving(OPAQUE)),
        model,
      },
    );

    expect(model.extract).toHaveBeenCalledTimes(1);
    const [snapshot] = await snapshotsOf(productId);
    expect(snapshot?.rung).toBe("og");
  });

  it("runs no model at all when none is configured, and says nothing about it", async () => {
    // Unconfigured means unwired, the same way the proxy fetch is — and
    // *quietly*. Reaching for a model that is not there would be caught and
    // reported, which leaves the same row behind and a Sentry event for
    // every product, so the silence is the assertion.
    const productId = await pendingProduct();
    const deps = depsWithoutModel(serving(OPAQUE));
    const message = jobFor(productId);

    await handleEnrichmentBatch(batchOf("dialed-enrichment", [message]), deps);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(await statusOf(productId)).toBe("done");
    const [snapshot] = await snapshotsOf(productId);
    expect(snapshot?.rung).toBe("og");
    expect(deps.captureException).not.toHaveBeenCalled();
  });

  it("retries, and keeps the row pending, when the model fails", async () => {
    // The model is the only source of composition now, so swallowing this
    // would write a product without one and mark it `done` — and
    // `requestEnrichment` never claims a `done` row again, so a transient
    // outage would cost that product its composition permanently. The
    // queue's retry is the mechanism (law 3), and `pending` is what the
    // hourly sweep re-drives.
    const productId = await pendingProduct();
    const model = {
      extract: vi.fn(() => Promise.reject(new Error("upstream"))),
    };
    const deps = { ...depsWith(serving(OPAQUE)), model };
    const message = jobFor(productId);

    await handleEnrichmentBatch(batchOf("dialed-enrichment", [message]), deps);

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(await statusOf(productId)).toBe("pending");
    expect(deps.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "upstream" }),
      expect.objectContaining({ productId }),
    );
  });

  it("finishes quietly when no model is configured, rather than retrying forever", async () => {
    // "We do not do model extraction here" is a different state from "the
    // model could not be reached". A dev machine with no key must not churn
    // every product through the retry machinery; the declared rungs'
    // answer stands and the row is done.
    const productId = await pendingProduct();
    const deps = depsWith(serving(OPAQUE));
    const message = jobFor(productId);

    await handleEnrichmentBatch(batchOf("dialed-enrichment", [message]), deps);

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(await statusOf(productId)).toBe("done");
    expect(deps.captureException).not.toHaveBeenCalled();
  });

  it("extracts no composition from prose, now that only the model reads it", async () => {
    // The page states `Fabric: 88% polyester` in a div and declares
    // nothing. The prose search used to answer here and was retired; with
    // no model configured the column stays empty, which is the state the
    // app renders and a person can correct.
    const productId = await pendingProduct();
    const prose = `<html><head><meta property="og:title" content="Rover Tee">
      </head><body><div class="specs"><p>Fabric: 88% polyester, 12% elastane</p></div></body></html>`;

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWithoutModel(serving(prose)),
    );

    const row = await rowOf(productId);
    expect(row.extractionStatus).toBe("done");
    expect(row.fabricComposition).toBeNull();
    const [snapshot] = await snapshotsOf(productId);
    expect(snapshot?.rung).toBe("og");
  });
});

/**
 * A product the sweep has stopped re-driving: created more than a day ago,
 * so nothing but an operator's Retry or a fresh paste will try it again.
 */
const PAST_THE_DAY = { createdAt: nowSeconds() - 25 * 60 * 60 };

const DAY = 24 * 60 * 60;

/**
A shop that refuses, and a proxy whose fetch the shop refused too.
*/
const refusedThroughProxy: typeof fetch = (input) =>
  Promise.resolve(
    urlOf(input).startsWith("https://api.firecrawl.dev/")
      ? Response.json({
          success: true,
          data: { rawHtml: "blocked", metadata: { statusCode: 403 } },
        })
      : new Response("blocked", { status: 403 }),
  );

describe("the Desk's Gave up (R-119): only what the system stopped retrying", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists a product created exactly a day ago at once: the sweep owes it nothing", async () => {
    // The sweep re-drives a failed product only while it is strictly
    // younger than a day, so at exactly a day nothing will try it again.
    const now = nowSeconds();
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    const refused = await pendingProduct({ createdAt: now - DAY });
    const deadLettered = await pendingProduct({ createdAt: now - DAY });

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(refused)]),
      depsWith(serving("blocked", 403)),
    );
    await handleEnrichmentDlqBatch(
      batchOf("dialed-enrichment-dlq", [jobFor(deadLettered)]),
      depsWith(serving(PAGE)),
      4,
    );

    expect(await gaveUpRow("enrichment", refused)).toBeDefined();
    expect(await gaveUpRow("enrichment", deadLettered)).toBeDefined();
  });

  it("parks a product one second younger than a day", async () => {
    const now = nowSeconds();
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    const refused = await pendingProduct({ createdAt: now - DAY + 1 });
    const deadLettered = await pendingProduct({ createdAt: now - DAY + 1 });

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(refused)]),
      depsWith(serving("blocked", 403)),
    );
    await handleEnrichmentDlqBatch(
      batchOf("dialed-enrichment-dlq", [jobFor(deadLettered)]),
      depsWith(serving(PAGE)),
      4,
    );

    expect(await gaveUpRow("enrichment", refused)).toBeUndefined();
    expect(await gaveUpRow("enrichment", deadLettered)).toBeUndefined();
  });

  it("does not list a refusal inside the product's first day, and keeps it for later", async () => {
    const productId = await pendingProduct();

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(serving("blocked", 403)),
    );

    expect(await statusOf(productId)).toBe("failed");
    expect(await gaveUpRow("enrichment", productId)).toBeUndefined();
    expect(await rowOf(productId)).toMatchObject({
      extractionError: "Page returned 403",
      extractionTries: 1,
    });
  });

  it("counts each re-driven refusal inside the day, still unlisted", async () => {
    const productId = await pendingProduct();
    const deps = depsWith(serving("blocked", 403));
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      deps,
    );
    await repend(productId);

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      deps,
    );

    const row = await rowOf(productId);
    expect(row.extractionTries).toBe(2);
    expect(await gaveUpRow("enrichment", productId)).toBeUndefined();
  });

  it("lists a refusal past the day at once, with the status in words and the error as detail", async () => {
    const productId = await pendingProduct(PAST_THE_DAY);

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(serving("blocked", 403)),
    );

    expect(await statusOf(productId)).toBe("failed");
    expect(await gaveUpRow("enrichment", productId)).toMatchObject({
      reason: "The shop returned 403. It may be blocking us.",
      rawError: "Page returned 403",
      tries: 1,
    });
    await expectNothingParked(productId);
  });

  it("names the 403 when the shop refused the proxy too", async () => {
    const productId = await pendingProduct(PAST_THE_DAY);

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      { ...depsWith(refusedThroughProxy), proxyApiKey: "fc-test" },
    );

    expect(await gaveUpRow("enrichment", productId)).toMatchObject({
      reason: "The shop returned 403. It may be blocking us.",
      rawError: "Page returned 403 through the proxy",
    });
  });

  it("adds a try each time a listed product is refused again", async () => {
    const productId = await pendingProduct(PAST_THE_DAY);
    const deps = depsWith(serving("blocked", 403));
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      deps,
    );
    await repend(productId);

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      deps,
    );

    const row = await gaveUpRow("enrichment", productId);
    expect(row?.tries).toBe(2);
  });

  it("takes a product off the list once a later try succeeds", async () => {
    const productId = await pendingProduct(PAST_THE_DAY);
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(serving("blocked", 403)),
    );
    await repend(productId);

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(serving(PAGE)),
    );

    expect(await statusOf(productId)).toBe("done");
    expect(await gaveUpRow("enrichment", productId)).toBeUndefined();
  });

  it("forgets a parked failure once a later try inside the day succeeds", async () => {
    const productId = await pendingProduct();
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(serving("blocked", 403)),
    );
    await repend(productId);

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(serving(PAGE)),
    );

    expect(await statusOf(productId)).toBe("done");
    await expectNothingParked(productId);
  });

  it("parks a dead letter inside the day: failed, its tries counted, no error, not listed", async () => {
    const productId = await pendingProduct({
      extractionError: "Page returned 404",
      extractionTries: 2,
    });

    await handleEnrichmentDlqBatch(
      batchOf("dialed-enrichment-dlq", [jobFor(productId)]),
      depsWith(serving(PAGE)),
      4,
    );

    const row = await rowOf(productId);
    expect(row).toMatchObject({
      extractionStatus: "failed",
      extractionTries: 6,
    });
    expect(row.extractionError).toBeNull();
    expect(await gaveUpRow("enrichment", productId)).toBeUndefined();
  });

  it("lists a dead letter past the day with the queue's tries, in the batch that fails it", async () => {
    const productId = await pendingProduct(PAST_THE_DAY);

    await handleEnrichmentDlqBatch(
      batchOf("dialed-enrichment-dlq", [jobFor(productId)]),
      depsWith(serving(PAGE)),
      4,
    );

    expect(await statusOf(productId)).toBe("failed");
    expect(await gaveUpRow("enrichment", productId)).toMatchObject({
      reason: DEAD_LETTER_REASON,
      tries: 4,
    });
  });

  it("acks a dead letter for a product that is gone, writing nothing", async () => {
    const productId = newUlid();
    const message = jobFor(productId);

    await handleEnrichmentDlqBatch(
      batchOf("dialed-enrichment-dlq", [message]),
      depsWith(serving(PAGE)),
      4,
    );

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(await gaveUpRow("enrichment", productId)).toBeUndefined();
  });

  it("does not list a product a late retry finished", async () => {
    const productId = await pendingProduct({
      ...PAST_THE_DAY,
      extractionStatus: "done",
    });

    await handleEnrichmentDlqBatch(
      batchOf("dialed-enrichment-dlq", [jobFor(productId)]),
      depsWith(serving(PAGE)),
      4,
    );

    expect(await gaveUpRow("enrichment", productId)).toBeUndefined();
    const row = await rowOf(productId);
    expect(row.extractionTries).toBeNull();
  });
});

/**
A product failed inside its day with a failure parked, now `age` old.
*/
async function parked(
  age: number,
  facts: { extractionError?: string; extractionTries: number },
): Promise<string> {
  return pendingProduct({
    extractionStatus: "failed",
    createdAt: nowSeconds() - age,
    ...facts,
  });
}

/**
That a product holds no failure waiting to be listed.
*/
async function expectNothingParked(productId: string): Promise<void> {
  const row = await rowOf(productId);
  expect(row.extractionError).toBeNull();
  expect(row.extractionTries).toBeNull();
}

describe("listAbandonedEnrichments: the hour the day runs out", () => {
  it("lists a parked refusal once the day is past, in words, and clears what it kept", async () => {
    const productId = await parked(DAY + 60, {
      extractionError: "Page returned 403 through the proxy",
      extractionTries: 7,
    });

    await listAbandonedEnrichments(db());

    expect(await gaveUpRow("enrichment", productId)).toMatchObject({
      reason: "The shop returned 403. It may be blocking us.",
      rawError: "Page returned 403 through the proxy",
      tries: 7,
    });
    expect(await statusOf(productId)).toBe("failed");
    await expectNothingParked(productId);
  });

  it("lists a parked dead letter with the dead letter's reason and no detail", async () => {
    const productId = await parked(DAY + 60, { extractionTries: 4 });

    await listAbandonedEnrichments(db());

    const row = await gaveUpRow("enrichment", productId);
    expect(row).toMatchObject({ reason: DEAD_LETTER_REASON, tries: 4 });
    expect(row?.rawError).toBeNull();
  });

  it("lists nothing while the sweep still owns the product", async () => {
    const productId = await parked(DAY - 60, {
      extractionError: "Page returned 404",
      extractionTries: 3,
    });

    await listAbandonedEnrichments(db());

    expect(await gaveUpRow("enrichment", productId)).toBeUndefined();
    const row = await rowOf(productId);
    expect(row.extractionTries).toBe(3);
  });

  it("lists a product once: a dropped row does not come back the next hour", async () => {
    const productId = await parked(DAY + 60, {
      extractionError: "Page returned 404",
      extractionTries: 3,
    });
    await listAbandonedEnrichments(db());
    await db().delete(gaveUp).where(eq(gaveUp.subjectId, productId));

    await listAbandonedEnrichments(db());

    expect(await gaveUpRow("enrichment", productId)).toBeUndefined();
  });

  it("lists only a product still failed", async () => {
    const productId = await pendingProduct({
      createdAt: nowSeconds() - DAY - 60,
      extractionTries: 3,
    });

    await listAbandonedEnrichments(db());

    expect(await gaveUpRow("enrichment", productId)).toBeUndefined();
  });

  it("dates the row when it was listed", async () => {
    const productId = await parked(DAY + 60, {
      extractionError: "Page returned 404",
      extractionTries: 1,
    });
    const at = nowSeconds() + 5;

    await listAbandonedEnrichments(db(), at);

    expect(await gaveUpRow("enrichment", productId)).toMatchObject({
      firstFailedAt: at,
      lastFailedAt: at,
    });
  });
});

describe("pageFailureReason", () => {
  it.each([
    ["Page returned 403", "The shop returned 403. It may be blocking us."],
    ["Page returned 401", "The shop returned 401. It may be blocking us."],
    ["Page returned 404", "The shop returned 404."],
    [
      "Page returned 403 through the proxy",
      "The shop returned 403. It may be blocking us.",
    ],
    ["Page returned 404 through the proxy", "The shop returned 404."],
    ["Page returned 403 through", "The shop's page couldn't be read."],
    [
      "Page returned 403 through the proxy!",
      "The shop's page couldn't be read.",
    ],
    ["Page returned 4035", "The shop's page couldn't be read."],
    ["A Page returned 403", "The shop's page couldn't be read."],
    ["Proxy returned 502", "The shop's page couldn't be read."],
    ["Page had no body", "The shop's page couldn't be read."],
  ])("says %j as %j", (message, reason) => {
    expect(pageFailureReason(message)).toBe(reason);
  });
});

/**
What the hourly sweep does to a failed product before it re-sends it.
*/
async function repend(productId: string): Promise<void> {
  await drizzle(env.DIALED_CORE)
    .update(products)
    .set({ extractionStatus: "pending" })
    .where(eq(products.id, productId));
}

type GlobalSpend = "page-fetch" | "proxy-call" | "model-call";

async function spentAlready(kind: GlobalSpend, count: number) {
  await db()
    .insert(rateLimits)
    .values({
      kind,
      subject: GLOBAL_SUBJECT,
      windowStartedAt: nowSeconds(),
      count,
    })
    .onConflictDoUpdate({
      target: [rateLimits.kind, rateLimits.subject],
      set: { windowStartedAt: nowSeconds(), count },
    });
}

async function limitCountOf(kind: GlobalSpend): Promise<number | undefined> {
  const [row] = await db()
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(
      and(eq(rateLimits.kind, kind), eq(rateLimits.subject, GLOBAL_SUBJECT)),
    );
  return row?.count;
}

describe("handleEnrichmentBatch: the spend ceilings", () => {
  // The other cases here count their fetches too, and D1 keeps them.
  beforeEach(async () => {
    await db().delete(rateLimits);
  });
  afterEach(async () => {
    await db().delete(rateLimits);
  });

  it("counts each page fetch against the hour", async () => {
    const productId = await pendingProduct();
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(serving(PAGE)),
    );
    expect(await statusOf(productId)).toBe("done");
    expect(await limitCountOf("page-fetch")).toBe(1);
  });

  it("fetches nothing once the hour's fetches are spent, and leaves the row pending for the sweep", async () => {
    await spentAlready("page-fetch", PAGE_FETCHES_PER_HOUR);
    const productId = await pendingProduct();
    const fetchImpl = serving(PAGE);
    const message = jobFor(productId);

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [message]),
      depsWith(fetchImpl),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    const row = await rowOf(productId);
    expect(row.extractionStatus).toBe("pending");
    expect(row.extractionTries).toBeNull();
    expect(await snapshotsOf(productId)).toEqual([]);
  });

  it("leaves a deferred row's earlier failure as it was, for the sweep's next try", async () => {
    await spentAlready("page-fetch", PAGE_FETCHES_PER_HOUR);
    const productId = await pendingProduct({
      extractionError: "Page returned 403",
      extractionTries: 2,
    });

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(serving(PAGE)),
    );

    const row = await rowOf(productId);
    expect(row.extractionStatus).toBe("pending");
    expect(row.extractionError).toBe("Page returned 403");
    expect(row.extractionTries).toBe(2);
  });

  it("fetches the last one the hour allows", async () => {
    await spentAlready("page-fetch", PAGE_FETCHES_PER_HOUR - 1);
    const productId = await pendingProduct();
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      depsWith(serving(PAGE)),
    );
    expect(await statusOf(productId)).toBe("done");
  });

  it("counts a proxy call against the day", async () => {
    const productId = await pendingProduct();
    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      { ...depsWith(vi.fn(refusingWithProxy)), proxyApiKey: "fc-test" },
    );
    expect(await statusOf(productId)).toBe("done");
    expect(await limitCountOf("proxy-call")).toBe(1);
  });

  it("calls no proxy once the day's calls are spent: the refusal is a failed fetch", async () => {
    await spentAlready("proxy-call", PROXY_CALLS_PER_DAY);
    const productId = await pendingProduct();
    const fetchImpl = vi.fn(refusingWithProxy);

    await handleEnrichmentBatch(
      batchOf("dialed-enrichment", [jobFor(productId)]),
      { ...depsWith(fetchImpl), proxyApiKey: "fc-test" },
    );

    expect(
      fetchImpl.mock.calls.some(([input]) =>
        urlOf(input).startsWith("https://api.firecrawl.dev/"),
      ),
    ).toBe(false);
    const row = await rowOf(productId);
    expect(row.extractionStatus).toBe("failed");
    expect(row.extractionError).toBe("Page returned 403");
  });
});

/**
A page whose refresh names a host of 2,000 letters and no dot, which the
fetch refuses with the host in its message.
*/
const LONG_HOST = "a".repeat(2000);
const REFRESH_TO_LONG_HOST = `<meta http-equiv="refresh" content="0;url=https://${LONG_HOST}/">`;
const LONG_HOST_FAILURE = `Refusing a private or local host: ${LONG_HOST}`;

/**
One enrichment message for the product, through the consumer.
*/
async function consumeOne(
  productId: string,
  fetchImpl: typeof fetch,
): Promise<SpiedMessage> {
  const message = jobFor(productId);
  await handleEnrichmentBatch(
    batchOf("dialed-enrichment", [message]),
    depsWith(fetchImpl),
  );
  return message;
}

describe("a failure's message is kept short wherever it is stored", () => {
  it("parks no more than MAX_RAW_ERROR_LENGTH of it inside the product's day", async () => {
    const productId = await pendingProduct();

    await consumeOne(productId, serving(REFRESH_TO_LONG_HOST));

    const row = await rowOf(productId);
    expect(row.extractionStatus).toBe("failed");
    expect(row.extractionError).toBe(
      LONG_HOST_FAILURE.slice(0, MAX_RAW_ERROR_LENGTH),
    );
  });

  it("lists no more than MAX_RAW_ERROR_LENGTH of it past the day", async () => {
    const productId = await pendingProduct(PAST_THE_DAY);

    await consumeOne(productId, serving(REFRESH_TO_LONG_HOST));

    const row = await gaveUpRow("enrichment", productId);
    expect(row?.rawError).toBe(
      LONG_HOST_FAILURE.slice(0, MAX_RAW_ERROR_LENGTH),
    );
  });
});

describe("a page with more tags open than the cap", () => {
  it("fails the product and acks the message", async () => {
    const productId = await pendingProduct();

    const message = await consumeOne(
      productId,
      serving("<b>".repeat(MAX_OPEN_TAGS + 2)),
    );

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(await rowOf(productId)).toMatchObject({
      extractionStatus: "failed",
      extractionError: `Page nests more than ${String(MAX_OPEN_TAGS)} tags`,
    });
  });
});

describe("listAbandonedEnrichments: one firing's share", () => {
  it("lists the oldest ABANDONED_PER_FIRING and leaves the rest for the next firing", async () => {
    const oldest = await parked(DAY + 600, { extractionTries: 6 });
    for (let index = 1; index < ABANDONED_PER_FIRING; index += 1) {
      await parked(DAY + 60, { extractionTries: 6 });
    }
    const newest = await parked(DAY + 30, { extractionTries: 6 });

    await listAbandonedEnrichments(db());

    expect(await gaveUpRow("enrichment", oldest)).toBeDefined();
    expect(await gaveUpRow("enrichment", newest)).toBeUndefined();
    const waiting = await rowOf(newest);
    expect(waiting.extractionTries).toBe(6);

    await listAbandonedEnrichments(db());

    expect(await gaveUpRow("enrichment", newest)).toBeDefined();
  });
});

/**
Whether any of a fetch's calls went to the proxy.
*/
function hasCalledTheProxy(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchImpl.mock.calls.some(([input]) =>
    urlOf(input).startsWith("https://api.firecrawl.dev/"),
  );
}

describe("handleEnrichmentBatch: one proxy call a product a day", () => {
  beforeEach(async () => {
    await db().delete(rateLimits);
  });

  it("goes direct only on a product's second try that day, and spends nothing shared", async () => {
    const productId = await pendingProduct();
    const deps = { ...depsWith(vi.fn(refusedThroughProxy)), proxyApiKey: "k" };
    await consumeWith(productId, deps);
    await repend(productId);
    const again = vi.fn(refusedThroughProxy);

    await consumeWith(productId, { ...deps, fetchImpl: again });

    expect(hasCalledTheProxy(again)).toBe(false);
    expect(await limitCountOf("proxy-call")).toBe(1);
    const row = await rowOf(productId);
    expect(row.extractionError).toBe("Page returned 403");
  });

  it("leaves another product its proxy call after one product's six tries", async () => {
    const refused = await pendingProduct();
    const deps = { ...depsWith(vi.fn(refusedThroughProxy)), proxyApiKey: "k" };
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await consumeWith(refused, deps);
      await repend(refused);
    }
    const honest = await pendingProduct();
    const fetchImpl = vi.fn(refusingWithProxy);

    await consumeWith(honest, { ...deps, fetchImpl });

    expect(hasCalledTheProxy(fetchImpl)).toBe(true);
    expect(await statusOf(honest)).toBe("done");
    expect(await limitCountOf("proxy-call")).toBe(2);
  });
});

/**
One enrichment message for the product, through the consumer with `deps`.
*/
async function consumeWith(
  productId: string,
  deps: Parameters<typeof handleEnrichmentBatch>[1],
): Promise<void> {
  await handleEnrichmentBatch(
    batchOf("dialed-enrichment", [jobFor(productId)]),
    deps,
  );
}

describe("handleEnrichmentBatch: the hour's model calls", () => {
  beforeEach(async () => {
    await db().delete(rateLimits);
  });

  it("counts the model call of a fresh fetch", async () => {
    const productId = await pendingProduct();

    await consumeWith(productId, depsWith(serving(PAGE)));

    expect(await statusOf(productId)).toBe("done");
    expect(await limitCountOf("model-call")).toBe(1);
  });

  it("stores the page but asks no model once the hour's calls are spent, and leaves the row pending", async () => {
    await spentAlready("model-call", MODEL_CALLS_PER_HOUR);
    const productId = await pendingProduct();
    const deps = depsWith(serving(PAGE));

    await consumeWith(productId, deps);

    expect(deps.model.extract).not.toHaveBeenCalled();
    expect(await statusOf(productId)).toBe("pending");
    expect(await snapshotsOf(productId)).toHaveLength(1);
  });

  it("reads the stored page again on the next try, counting a model call and no fetch", async () => {
    await spentAlready("model-call", MODEL_CALLS_PER_HOUR);
    const productId = await pendingProduct();
    await consumeWith(productId, depsWith(serving(PAGE)));
    await db().delete(rateLimits);
    const fetchImpl = serving(PAGE);

    await consumeWith(productId, depsWith(fetchImpl));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await statusOf(productId)).toBe("done");
    expect(await limitCountOf("model-call")).toBe(1);
  });

  it("defers a stored page's re-read too once the hour's calls are spent", async () => {
    const productId = await pendingProduct();
    await consumeWith(productId, depsWith(serving(PAGE)));
    await repend(productId);
    await spentAlready("model-call", MODEL_CALLS_PER_HOUR);
    const deps = depsWith(serving(PAGE));

    await consumeWith(productId, deps);

    expect(deps.model.extract).not.toHaveBeenCalled();
    expect(await statusOf(productId)).toBe("pending");
  });

  it("asks the model for the last call the hour allows", async () => {
    await spentAlready("model-call", MODEL_CALLS_PER_HOUR - 1);
    const productId = await pendingProduct();

    await consumeWith(productId, depsWith(serving(PAGE)));

    expect(await statusOf(productId)).toBe("done");
  });

  it("counts nothing with no model configured", async () => {
    await spentAlready("model-call", MODEL_CALLS_PER_HOUR);
    const productId = await pendingProduct();

    await consumeWith(productId, depsWithoutModel(serving(PAGE)));

    expect(await statusOf(productId)).toBe("done");
    expect(await limitCountOf("model-call")).toBe(MODEL_CALLS_PER_HOUR);
  });

  it("lets the Desk's re-run ask the model whatever the hour's count", async () => {
    const productId = await pendingProduct();
    await consumeWith(productId, depsWith(serving(PAGE)));
    await spentAlready("model-call", MODEL_CALLS_PER_HOUR);
    const deps = depsWith(serving(PAGE));

    await reextract(deps, productId);

    expect(deps.model.extract).toHaveBeenCalledTimes(1);
    expect(await limitCountOf("model-call")).toBe(MODEL_CALLS_PER_HOUR);
  });
});
