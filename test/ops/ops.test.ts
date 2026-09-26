import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { cronCheckpoints } from "../../src/db/schema-core";
import {
  checkHealth,
  handleQueueBatch,
  handleScheduled,
} from "../../src/modules/ops";

function fakeBatch(queue: string): MessageBatch {
  return {
    queue,
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    messages: [],
    ackAll: () => {
      /*
      noop
      */
    },
    retryAll: () => {
      /*
      noop
      */
    },
  };
}

describe("ops (000 §10)", () => {
  it("health reports ok against live local bindings", async () => {
    // The test bindings carry no vars, and a deployment without its
    // origin is not healthy (OPS-4), so this one is supplied.
    const { env } = await import("../../src/env");
    const original: unknown = env.BETTER_AUTH_URL;
    Reflect.set(env, "BETTER_AUTH_URL", "https://dialed.test");
    try {
      const report = await checkHealth();
      expect(report.checks.coreDb).toBe("ok");
      expect(report.checks.weatherDb).toBe("ok");
      expect(report.checks.media).toBe("ok");
      expect(report.ok).toBe(true);
    } finally {
      Reflect.set(env, "BETTER_AUTH_URL", original);
    }
  });

  it("digest cron writes its heartbeat and is re-runnable", async () => {
    const controller = { cron: "0 12 * * *" } as ScheduledController;
    await handleScheduled(controller);
    await handleScheduled(controller); // law 1: safely re-runnable
    const { env } = await import("../../src/env");
    const rows = await drizzle(env.DIALED_CORE).select().from(cronCheckpoints);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cronName).toBe("daily-digest");
  });

  it("queue stubs ack every known queue without throwing", async () => {
    const queues = [
      "dialed-imports",
      "dialed-enrichment",
      "dialed-imports-dlq",
      "dialed-enrichment-dlq",
    ];
    const results = await Promise.allSettled(
      queues.map((queue) => handleQueueBatch(fakeBatch(queue))),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
});
