import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { cronCheckpoints } from "../src/db/schema-core";
import { checkHealth, handleQueueBatch, handleScheduled } from "../src/modules/ops";

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
    const report = await checkHealth();
    expect(report.checks.coreDb).toBe("ok");
    expect(report.checks.weatherDb).toBe("ok");
    expect(report.checks.photos).toBe("ok");
    expect(report.ok).toBe(true);
  });

  it("digest cron writes its heartbeat and is re-runnable", async () => {
    const controller = { cron: "0 12 * * *" } as ScheduledController;
    await handleScheduled(controller);
    await handleScheduled(controller); // law 1: safely re-runnable
    const { env } = await import("../src/env");
    const rows = await drizzle(env.DIALED_CORE)
      .select()
      .from(cronCheckpoints);
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
