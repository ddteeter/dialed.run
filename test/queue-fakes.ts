import { vi } from "vitest";
import type { Mock } from "vitest";

/**
 * A real `Message`, with `ack`/`retry` replaced by spies. A consumer's only
 * outward effect on a message is which of those two it calls, so they are
 * the assertion. Shared by every queue-consumer test.
 */
export type SpiedMessage = Omit<Message, "ack" | "retry"> & {
  ack: Mock<() => void>;
  retry: Mock<(options?: QueueRetryOptions) => void>;
};

export function fakeMessage(id: string, body: unknown): SpiedMessage {
  return {
    id,
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: vi.fn<() => void>(),
    retry: vi.fn<(options?: QueueRetryOptions) => void>(),
  };
}

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

export function batchOf(queue: string, messages: SpiedMessage[]): MessageBatch {
  return {
    queue,
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    messages,
    ackAll: nothing,
    retryAll: nothing,
  };
}
