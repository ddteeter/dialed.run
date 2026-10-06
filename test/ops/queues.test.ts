import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { outbox, products, stravaConnections } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { handleQueueBatch } from "../../src/modules/ops";
import {
  createOrGetBrand,
  createOrGetProduct,
} from "../../src/modules/products";
import { reminderSubject } from "../../src/modules/runs/queue-messages";
import { gaveUpRow } from "../gave-up-rows";
import { batchOf, fakeMessage } from "../queue-fakes";

/**
 * The queue router: one switch over four queue names plus a default, and
 * nothing distinguished the arms. Every `case` label could be replaced with
 * `""` and every arm's body deleted with the suite green, because the only
 * assertion was that four empty batches did not throw — which they would
 * not, whichever arm they fell into.
 *
 * These give each batch a real message and watch what happens to it. The
 * imports arms ack or retry; the enrichment arm marks a product; the DLQ
 * arm reports every message; the default reports the queue it did not
 * recognise. Those are four different observable outcomes, which is what
 * makes the routing itself testable.
 */

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

/**
 * The exact sentences the two Sentry-side arms raise. Written out rather
 * than matched loosely: they are what someone greps for in the alert
 * stream, and an empty one is a mutant that silences the arm.
 */
const DEAD_LETTERED = "dead-lettered job on dialed-enrichment-dlq";
const UNKNOWN_QUEUE = "batch from unknown queue";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleQueueBatch routes by queue name", () => {
  it("hands a dialed-imports batch to the imports consumer", async () => {
    // The consumer acks structurally-invalid garbage rather than retrying
    // it forever — but so does the enrichment consumer one `case` down,
    // and an emptied case falls through to it. What proves the message
    // reached *this* arm is the sentence only the imports consumer says.
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const message = fakeMessage("m1", { type: "nonsense" });

    await handleQueueBatch(batchOf("dialed-imports", [message]));

    expect(message.ack).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      expect.objectContaining({ queue: "dialed-imports", messageId: "m1" }),
      expect.objectContaining({ message: "invalid imports queue message" }),
    );
  });

  it("gives the imports consumer an outbox in dialed-core to owe its emails to", async () => {
    // A Strava deauthorization owes the runner an email (task 126), and
    // the consumer cannot reach `ops`' outbox itself — this module hands
    // it in. The row landing in dialed-core is what proves the hand-off.
    const db = drizzle(env.DIALED_CORE);
    const userId = newUlid();
    const athleteId = newUlid();
    await db.insert(stravaConnections).values({
      userId,
      athleteId,
      refreshToken: `refresh-${athleteId}`,
    });
    const message = fakeMessage("m8", {
      type: "strava_deauthorize",
      athleteId,
      eventTime: 1_516_126_040,
    });

    await handleQueueBatch(batchOf("dialed-imports", [message]));

    expect(message.ack).toHaveBeenCalled();
    const owed = await db
      .select({ kind: outbox.kind, dedupeKey: outbox.dedupeKey })
      .from(outbox)
      .where(eq(outbox.dedupeKey, `strava_disconnected:${userId}:1516126040`));
    expect(owed).toStrictEqual([
      {
        kind: "email",
        dedupeKey: `strava_disconnected:${userId}:1516126040`,
      },
    ]);
  });

  it("hands a dialed-imports-dlq batch to the DLQ consumer", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const message = fakeMessage("m2", { type: "nonsense" });

    await handleQueueBatch(batchOf("dialed-imports-dlq", [message]));

    expect(message.ack).toHaveBeenCalled();
    // The imports DLQ's own sentence, for the same reason as above: the
    // enrichment DLQ handler one case down also acks and reports.
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      expect.objectContaining({ queue: "dialed-imports-dlq", messageId: "m2" }),
      expect.objectContaining({
        message: "dead-lettered dialed-imports message",
      }),
    );
  });

  it("hands a dialed-enrichment batch to the enrichment consumer", async () => {
    // The consumer's first observable act on a pending product with no
    // page behind it is to give up on it: a URL nothing serves is a
    // `PageFetchError`, which is terminal, so the row goes to `failed`
    // and the message is acked. That is enough to prove the arm routes
    // here and not to the old stub.
    vi.spyOn(console, "error").mockImplementation(nothing);
    const db = drizzle(env.DIALED_CORE);
    const brand = await createOrGetBrand(db, `Routed ${newUlid()}`);
    const product = await createOrGetProduct(db, {
      brandId: brand.id,
      name: "Routed Tee",
      sourceUrl: "https://localhost/refused",
      createdBy: newUlid(),
    });
    await db
      .update(products)
      .set({ extractionStatus: "pending" })
      .where(eq(products.id, product.id));
    const message = fakeMessage("m3", {
      type: "enrich",
      productId: product.id,
    });

    await handleQueueBatch(batchOf("dialed-enrichment", [message]));

    expect(message.ack).toHaveBeenCalledTimes(1);
    const [row] = await db
      .select({ status: products.extractionStatus })
      .from(products)
      .where(eq(products.id, product.id));
    expect(row?.status).toBe("failed");
  });

  it("reports every dead-lettered enrichment job, one by one", async () => {
    // Law 6: a job that exhausted its retries has to land where a human
    // sees it, and "one by one" is the part that matters — a loop that
    // reports only the first hides the rest of the batch.
    const error = vi.spyOn(console, "error").mockImplementation(nothing);

    await handleQueueBatch(
      batchOf("dialed-enrichment-dlq", [
        fakeMessage("m5", {}),
        fakeMessage("m6", {}),
      ]),
    );

    expect(error).toHaveBeenCalledTimes(2);
    for (const messageId of ["m5", "m6"]) {
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("sentry-disabled"),
        { queue: "dialed-enrichment-dlq", messageId },
        expect.objectContaining({ message: DEAD_LETTERED }),
      );
    }
  });

  it("reports a batch from a queue it has never heard of", async () => {
    // A queue bound in wrangler.jsonc with no arm here drains into
    // nothing. test/bindings-conformance.test.ts is meant to catch that in
    // CI; this is what happens if it reaches production anyway.
    const error = vi.spyOn(console, "error").mockImplementation(nothing);

    await handleQueueBatch(
      batchOf("dialed-unheard-of", [fakeMessage("m7", {})]),
    );

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      { queue: "dialed-unheard-of" },
      expect.objectContaining({ message: UNKNOWN_QUEUE }),
    );
  });
});

describe("a dead letter's tries are the queue's deliveries (R-119)", () => {
  // `max_retries` plus the first delivery, from the registry a test pins
  // to wrangler.jsonc: what the Desk's Gave up row says it tried.
  it("gives a dead-lettered enrichment job its queue's deliveries", async () => {
    vi.spyOn(console, "error").mockImplementation(nothing);
    const db = drizzle(env.DIALED_CORE);
    const brand = await createOrGetBrand(db, `Dead ${newUlid()}`);
    const product = await createOrGetProduct(db, {
      brandId: brand.id,
      name: "Dead Tee",
      sourceUrl: "https://example.com/dead",
      createdBy: newUlid(),
    });
    await db
      .update(products)
      .set({ extractionStatus: "pending" })
      .where(eq(products.id, product.id));

    await handleQueueBatch(
      batchOf("dialed-enrichment-dlq", [
        fakeMessage("m8", { type: "enrich", productId: product.id }),
      ]),
    );

    const row = await gaveUpRow("enrichment", product.id);
    expect(row?.tries).toBe(4);
  });

  it("gives a dead-lettered reminder its queue's deliveries", async () => {
    vi.spyOn(console, "error").mockImplementation(nothing);
    const job = {
      type: "strava_reminder",
      athleteId: "7",
      objectId: newUlid(),
      aspectType: "create",
      eventTime: 1,
    } as const;

    await handleQueueBatch(
      batchOf("dialed-imports-dlq", [fakeMessage("m9", job)]),
    );

    const row = await gaveUpRow("reminder", reminderSubject(job));
    expect(row?.tries).toBe(4);
  });
});
