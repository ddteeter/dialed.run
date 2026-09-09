import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { handleQueueBatch } from "../../src/modules/ops";

/**
 * The queue router: one switch over four queue names plus a default, and
 * nothing distinguished the arms. Every `case` label could be replaced with
 * `""` and every arm's body deleted with the suite green, because the only
 * assertion was that four empty batches did not throw — which they would
 * not, whichever arm they fell into.
 *
 * These give each batch a real message and watch what happens to it. The
 * imports arms ack or retry; the enrichment stub logs; the DLQ arm reports
 * every message; the default reports the queue it did not recognise. Those
 * are four different observable outcomes, which is what makes the routing
 * itself testable.
 */

/**
 * The exact sentences the two Sentry-side arms raise. Written out rather
 * than matched loosely: they are what someone greps for in the alert
 * stream, and an empty one is a mutant that silences the arm.
 */
const DEAD_LETTERED = "dead-lettered job on dialed-enrichment-dlq";
const UNKNOWN_QUEUE = "batch from unknown queue";

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

/**
 * A real `Message`, with `ack`/`retry` replaced by spies. The consumer's
 * only outward effect on a message is which of those two it calls, so
 * they are the assertion.
 */
type SpiedMessage = Omit<Message, "ack" | "retry"> & {
  ack: Mock<() => void>;
  retry: Mock<(options?: QueueRetryOptions) => void>;
};

function fakeMessage(id: string, body: unknown): SpiedMessage {
  return {
    id,
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: vi.fn<() => void>(),
    retry: vi.fn<(options?: QueueRetryOptions) => void>(),
  };
}

function batchOf(queue: string, messages: SpiedMessage[]): MessageBatch {
  return {
    queue,
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    messages,
    ackAll: nothing,
    retryAll: nothing,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleQueueBatch routes by queue name", () => {
  it("hands a dialed-imports batch to the imports consumer", async () => {
    // The consumer acks structurally-invalid garbage rather than retrying
    // it forever, so an ack is proof the message reached that arm.
    vi.spyOn(console, "error").mockImplementation(nothing);
    const message = fakeMessage("m1", { type: "nonsense" });

    await handleQueueBatch(batchOf("dialed-imports", [message]));

    expect(message.ack).toHaveBeenCalled();
  });

  it("hands a dialed-imports-dlq batch to the DLQ consumer", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const message = fakeMessage("m2", { type: "nonsense" });

    await handleQueueBatch(batchOf("dialed-imports-dlq", [message]));

    expect(message.ack).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      expect.objectContaining({ queue: "dialed-imports-dlq", messageId: "m2" }),
      expect.anything(),
    );
  });

  it("acks the enrichment stub and says how much it dropped", async () => {
    // Lane 107 replaces this. Until then the size is the only sign that
    // anything is accumulating there.
    const warn = vi.spyOn(console, "warn").mockImplementation(nothing);

    await handleQueueBatch(
      batchOf("dialed-enrichment", [
        fakeMessage("m3", {}),
        fakeMessage("m4", {}),
      ]),
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("dialed-enrichment not implemented"),
      { size: 2 },
    );
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

    await handleQueueBatch(batchOf("dialed-unheard-of", [fakeMessage("m7", {})]));

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      { queue: "dialed-unheard-of" },
      expect.objectContaining({ message: UNKNOWN_QUEUE }),
    );
  });
});
