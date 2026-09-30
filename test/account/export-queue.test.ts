import { describe, expect, it, vi } from "vitest";

import { handleQueueBatch, handleScheduled } from "../../src/modules/ops";
import type { CronReporter } from "../../src/modules/ops/sentry";
import {
  handleImportsBatch,
  handleImportsDlqBatch,
  type ExportWork,
} from "../../src/modules/runs";
import { importsQueueMessageSchema } from "../../src/modules/runs/queue-messages";
import { coreDb } from "../../src/modules/runs/core-db";
import { env } from "../../src/env";
import { batchOf, fakeMessage, oweInCore } from "../queue-fakes";

/**
 * The data export's seams (task 126, ACC-10): its job on `dialed-imports`
 * (a variant added, law 9), the export work handed down to that queue's
 * consumer and DLQ, and the sweep handed to the hourly firing.
 */

function recordingWork() {
  const built: string[] = [];
  const failed: string[] = [];
  const work: ExportWork = {
    build: (exportId) => {
      built.push(exportId);
      return Promise.resolve();
    },
    fail: (exportId) => {
      failed.push(exportId);
      return Promise.resolve();
    },
  };
  return { work, built, failed };
}

function consumerDeps(exports?: ExportWork) {
  const reports: Record<string, string>[] = [];
  return {
    reports,
    deps: {
      db: coreDb(),
      importBucket: env.IMPORTS,
      captureException: (_error: unknown, context: Record<string, string>) => {
        reports.push(context);
      },
      owe: oweInCore,
      exports,
    },
  };
}

function nothing(): void {
  /*
   * Sentry is disabled in tests; its capture logs, and the log is not the
   * assertion here.
   */
}

describe("the account_export job", () => {
  it("is a variant of the imports queue's union, carrying only the export's id", () => {
    expect(
      importsQueueMessageSchema.parse({
        type: "account_export",
        exportId: "e1",
      }),
    ).toStrictEqual({ type: "account_export", exportId: "e1" });
    expect(
      importsQueueMessageSchema.safeParse({
        type: "account_export",
        exportId: "",
      }).success,
    ).toBe(false);
  });

  it("is built by the export work the consumer was handed, and acked", async () => {
    const { work, built, failed } = recordingWork();
    const message = fakeMessage("m1", {
      type: "account_export",
      exportId: "e1",
    });
    await handleImportsBatch(
      batchOf("dialed-imports", [message]),
      consumerDeps(work).deps,
    );
    expect(built).toStrictEqual(["e1"]);
    expect(failed).toStrictEqual([]);
    expect(message.ack).toHaveBeenCalled();
  });

  it("is retried, and reported, when no export work was wired", async () => {
    const message = fakeMessage("m2", {
      type: "account_export",
      exportId: "e2",
    });
    const { deps, reports } = consumerDeps();
    await handleImportsBatch(batchOf("dialed-imports", [message]), deps);
    expect(message.retry).toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
    expect(reports).toStrictEqual([
      { queue: "dialed-imports", messageId: "m2" },
    ]);
  });

  it("is marked failed from the DLQ once retries are spent", async () => {
    const { work, built, failed } = recordingWork();
    const message = fakeMessage("m3", {
      type: "account_export",
      exportId: "e3",
    });
    await handleImportsDlqBatch(
      batchOf("dialed-imports-dlq", [message]),
      consumerDeps(work).deps,
    );
    expect(failed).toStrictEqual(["e3"]);
    expect(built).toStrictEqual([]);
    expect(message.ack).toHaveBeenCalled();
  });

  it("reaches the imports consumer and its DLQ through the queue router", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const { work, built, failed } = recordingWork();
    await handleQueueBatch(
      batchOf("dialed-imports", [
        fakeMessage("m4", { type: "account_export", exportId: "e4" }),
      ]),
      work,
    );
    await handleQueueBatch(
      batchOf("dialed-imports-dlq", [
        fakeMessage("m5", { type: "account_export", exportId: "e5" }),
      ]),
      work,
    );
    expect(built).toStrictEqual(["e4"]);
    expect(failed).toStrictEqual(["e5"]);
    error.mockRestore();
  });
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
