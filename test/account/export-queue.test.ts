import { describe, expect, it } from "vitest";

import {
  exportConsumers,
  exportsQueueMessageSchema,
  type ExportWork,
} from "../../src/modules/account/export-queue";
import { handleQueueBatch, handleScheduled } from "../../src/modules/ops";
import type { CronReporter } from "../../src/modules/ops/sentry";
import { importsQueueMessageSchema } from "../../src/modules/runs/queue-messages";
import { batchOf, fakeMessage } from "../queue-fakes";

/**
 * The data export's seams (task 126, ACC-10): its job on `dialed-exports`
 * (its own queue, decision D-86), the consumers handed to ops' queue
 * router, and the sweep handed to the hourly firing.
 */

function recordingWork(buildError?: Error) {
  const built: string[] = [];
  const failed: string[] = [];
  const work: ExportWork = {
    build: (exportId) => {
      built.push(exportId);
      return buildError === undefined
        ? Promise.resolve()
        : Promise.reject(buildError);
    },
    fail: (exportId) => {
      failed.push(exportId);
      return Promise.resolve();
    },
  };
  return { work, built, failed };
}

function recordingConsumers(buildError?: Error) {
  const recorded = recordingWork(buildError);
  const reports: { error: unknown; context: Record<string, string> }[] = [];
  const consumers = exportConsumers(recorded.work, (error, context) => {
    reports.push({ error, context });
  });
  return { ...recorded, reports, consumers };
}

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

describe("the account_export job", () => {
  it("is dialed-exports' one job, carrying only the export's id", () => {
    expect(
      exportsQueueMessageSchema.parse({
        type: "account_export",
        exportId: "e1",
      }),
    ).toStrictEqual({ type: "account_export", exportId: "e1" });
    expect(
      exportsQueueMessageSchema.safeParse({
        type: "account_export",
        exportId: "",
      }).success,
    ).toBe(false);
  });

  it("is no longer a job on dialed-imports (moved before any deploy, law 9)", () => {
    expect(
      importsQueueMessageSchema.safeParse({
        type: "account_export",
        exportId: "e1",
      }).success,
    ).toBe(false);
  });

  it("is built by the export work, and acked", async () => {
    const { consumers, built, failed, reports } = recordingConsumers();
    const message = fakeMessage("m1", {
      type: "account_export",
      exportId: "e1",
    });
    await consumers.batch(batchOf("dialed-exports", [message]));
    expect(built).toStrictEqual(["e1"]);
    expect(failed).toStrictEqual([]);
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
    expect(reports).toStrictEqual([]);
  });

  it("is retried, and reported with its export's id, when the build throws", async () => {
    const boom = new Error("R2 went away");
    const { consumers, reports } = recordingConsumers(boom);
    const message = fakeMessage("m2", {
      type: "account_export",
      exportId: "e2",
    });
    await consumers.batch(batchOf("dialed-exports", [message]));
    expect(message.retry).toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
    expect(reports).toStrictEqual([
      {
        error: boom,
        context: { queue: "dialed-exports", messageId: "m2", exportId: "e2" },
      },
    ]);
  });

  it("acks and reports a body that is not an export job, and builds nothing", async () => {
    const { consumers, built, reports } = recordingConsumers();
    const message = fakeMessage("m3", { type: "import", importId: "i1" });
    await consumers.batch(batchOf("dialed-exports", [message]));
    expect(built).toStrictEqual([]);
    expect(message.ack).toHaveBeenCalled();
    expect(reports.map((report) => report.context)).toStrictEqual([
      { queue: "dialed-exports", messageId: "m3" },
    ]);
    expect((reports[0]?.error as Error).message).toBe(
      "invalid exports queue message",
    );
  });

  it("is marked failed from the DLQ once retries are spent, and reported", async () => {
    const { consumers, built, failed, reports } = recordingConsumers();
    const message = fakeMessage("m4", {
      type: "account_export",
      exportId: "e4",
    });
    await consumers.deadLetters(batchOf("dialed-exports-dlq", [message]));
    expect(failed).toStrictEqual(["e4"]);
    expect(built).toStrictEqual([]);
    expect(message.ack).toHaveBeenCalled();
    expect(reports.map((report) => report.context)).toStrictEqual([
      { queue: "dialed-exports-dlq", messageId: "m4" },
    ]);
    expect((reports[0]?.error as Error).message).toBe(
      "dead-lettered dialed-exports message",
    );
  });

  it("reaches the export consumers through the queue router", async () => {
    const { consumers, built, failed } = recordingConsumers();
    await handleQueueBatch(
      batchOf("dialed-exports", [
        fakeMessage("m5", { type: "account_export", exportId: "e5" }),
      ]),
      consumers,
    );
    await handleQueueBatch(
      batchOf("dialed-exports-dlq", [
        fakeMessage("m6", { type: "account_export", exportId: "e6" }),
      ]),
      consumers,
    );
    expect(built).toStrictEqual(["e5"]);
    expect(failed).toStrictEqual(["e6"]);
  });

  it.each(["dialed-exports", "dialed-exports-dlq"])(
    "throws a %s batch back for the queue to redeliver when no consumers were wired",
    async (queue) => {
      const message = fakeMessage("m7", {
        type: "account_export",
        exportId: "e7",
      });
      await expect(handleQueueBatch(batchOf(queue, [message]))).rejects.toThrow(
        "dialed-exports batch with no export consumers wired",
      );
      expect(message.ack).not.toHaveBeenCalled();
    },
  );
});

describe("the export sweep's firing", () => {
  const reporter: CronReporter = {
    checkIn: () => ({ finish: nothing }),
    report: nothing,
  };

  function firing(cron: string): ScheduledController {
    return { cron, scheduledTime: 0, noRetry: nothing };
  }

  it("runs on the hourly :00 firing, and its anomalies are the firing's", async () => {
    const swept: string[] = [];
    const outcome = await handleScheduled(firing("0 * * * *"), reporter, {
      sweepExports: (anomalies) => {
        swept.push("swept");
        anomalies.push("1 data export(s) stalled and were re-sent");
        return Promise.resolve();
      },
    });
    expect(swept).toStrictEqual(["swept"]);
    expect(outcome.anomalies).toContain(
      "1 data export(s) stalled and were re-sent",
    );
  });

  it("does not run on the other firings", async () => {
    const swept: string[] = [];
    const sweepExports = () => {
      swept.push("swept");
      return Promise.resolve();
    };
    for (const cron of ["30 * * * *", "15 * * * *"]) {
      await handleScheduled(firing(cron), reporter, { sweepExports });
    }
    expect(swept).toStrictEqual([]);
  });
});
