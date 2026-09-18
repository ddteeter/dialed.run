import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { consumeEach, deadLetterEach } from "../../src/lib/queue-batch";
import { batchOf, fakeMessage } from "../queue-fakes";

/**
 * The loop both consumers share. Each case is one of the four things a
 * message can do to the loop — parse and succeed, parse and throw, fail
 * to parse, or sit behind one that threw — and the assertion is what the
 * loop did to the message and what it told Sentry.
 */

const jobSchema = z.object({ type: z.literal("job"), id: z.string() });

function handlers(
  process: (job: { id: string }) => Promise<void> = () => Promise.resolve(),
) {
  return {
    process: vi.fn(process),
    invalidMessage: "invalid test queue message",
    captureException: vi.fn(),
  };
}

describe("consumeEach", () => {
  it("processes a message that parses, then acks it", async () => {
    const h = handlers();
    const message = fakeMessage("m1", { type: "job", id: "a" });

    await consumeEach(batchOf("q", [message]), jobSchema, h);

    expect(h.process).toHaveBeenCalledWith({ type: "job", id: "a" });
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(h.captureException).not.toHaveBeenCalled();
  });

  it("acks and reports a message that does not parse, without processing it", async () => {
    // No retry can make a malformed body well-formed.
    const h = handlers();
    const message = fakeMessage("m2", { type: "job" });

    await consumeEach(batchOf("q", [message]), jobSchema, h);

    expect(h.process).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(h.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "invalid test queue message" }),
      { queue: "q", messageId: "m2" },
    );
  });

  it("retries and reports a message whose job throws", async () => {
    const h = handlers(() => Promise.reject(new Error("boom")));
    const message = fakeMessage("m3", { type: "job", id: "a" });

    await consumeEach(batchOf("q", [message]), jobSchema, h);

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(h.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom" }),
      { queue: "q", messageId: "m3" },
    );
  });

  it("adds the consumer's own context to a report, when it gives some", async () => {
    const h = {
      ...handlers(() => Promise.reject(new Error("boom"))),
      context: (job: { id: string }) => ({ jobId: job.id }),
    };
    const message = fakeMessage("m4", { type: "job", id: "a" });

    await consumeEach(batchOf("q", [message]), jobSchema, h);

    expect(h.captureException).toHaveBeenCalledWith(expect.anything(), {
      queue: "q",
      messageId: "m4",
      jobId: "a",
    });
  });

  it("keeps going after a message that threw, so the rest of the batch is served", async () => {
    const h = handlers((job) =>
      job.id === "bad" ? Promise.reject(new Error("boom")) : Promise.resolve(),
    );
    const bad = fakeMessage("bad", { type: "job", id: "bad" });
    const good = fakeMessage("good", { type: "job", id: "good" });

    await consumeEach(batchOf("q", [bad, good]), jobSchema, h);

    expect(bad.retry).toHaveBeenCalledTimes(1);
    expect(good.ack).toHaveBeenCalledTimes(1);
    expect(h.process).toHaveBeenCalledTimes(2);
  });
});

function dlq() {
  return {
    onJob: vi.fn(() => Promise.resolve()),
    deadLettered: "dead-lettered test message",
    captureException: vi.fn(),
  };
}

describe("deadLetterEach", () => {
  it("hands a job that parses to the handler, reports it, and acks", async () => {
    const h = dlq();
    const message = fakeMessage("d1", { type: "job", id: "a" });

    await deadLetterEach(batchOf("q-dlq", [message]), jobSchema, h);

    expect(h.onJob).toHaveBeenCalledWith({ type: "job", id: "a" });
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(h.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "dead-lettered test message" }),
      { queue: "q-dlq", messageId: "d1" },
    );
  });

  it("still reports and acks a message that does not parse, touching no job", async () => {
    // The DLQ is the end of the line: a message left there is a silent
    // permanent failure, whether or not anyone can read it.
    const h = dlq();
    const message = fakeMessage("d2", "garbage");

    await deadLetterEach(batchOf("q-dlq", [message]), jobSchema, h);

    expect(h.onJob).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(h.captureException).toHaveBeenCalledTimes(1);
  });

  it("reports every message, one by one", async () => {
    const h = dlq();
    const messages = [
      fakeMessage("d3", { type: "job", id: "a" }),
      fakeMessage("d4", { type: "job", id: "b" }),
    ];

    await deadLetterEach(batchOf("q-dlq", messages), jobSchema, h);

    expect(h.captureException).toHaveBeenCalledTimes(2);
    for (const message of messages) {
      expect(message.ack).toHaveBeenCalledTimes(1);
    }
  });
});
