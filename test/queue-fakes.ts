import type { SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { expect, vi } from "vitest";
import type { Mock } from "vitest";

import type { OutboxMessage } from "../src/lib/sql/outbox";
import {
  outboxInsert,
  outboxInsertWhere,
  oweOutbox,
} from "../src/modules/ops/outbox/outbox";
import { coreDb } from "../src/modules/runs/core-db";

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

/**
 * A sent `import` message, as an assertion sees it: the import it is for,
 * and a claim id of that send's own (#841), whatever it is. That each send
 * mints a different one is `importJob`'s test.
 */
export function importMessageFor(importId: string): unknown {
  const claimId: unknown = expect.any(String);
  return { type: "import", importId, claimId };
}

/**
 * The imports consumer's `owe`, as the queue entry wires it: an outbox
 * row in the core database, for the caller's batch.
 */
export function oweInCore(message: OutboxMessage, notBefore?: number) {
  return outboxInsert(coreDb(), oweOutbox(message, notBefore));
}

/**
 * Safety's removal requests' `oweWhere`, as their server functions wire
 * it: the outbox row only where the request's own row matches.
 */
export function oweInCoreWhere(
  message: OutboxMessage,
  from: Readonly<{ table: SQLiteTable; where: SQL }>,
) {
  return outboxInsertWhere(coreDb(), oweOutbox(message), from);
}

/**
 * The imports consumer's weather attempt, for a test about something else:
 * it asks for nothing and leaves the run `pending`, as a provider that did
 * not answer would.
 */
export function weatherLater(): Promise<string> {
  return Promise.resolve("pending");
}
