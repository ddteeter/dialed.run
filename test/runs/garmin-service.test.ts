import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { imports, runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { coreDb } from "../../src/modules/runs/core-db";
import { handleImportsBatch } from "../../src/modules/runs";
import type { GarminConfig } from "../../src/modules/runs/garmin/config";
import {
  garminPicker,
  importGarminActivity,
} from "../../src/modules/runs/garmin/service";
import type { ImportJob } from "../../src/modules/runs/queue-messages";
import { oweInCore } from "../../src/modules/ops";
import { batchOf, fakeMessage } from "../queue-fakes";
import { urlOf } from "./request-url";
import { fitFile } from "./fit-file";
import { zipOf } from "./zip-file";

/**
 * "Import from Garmin" against a stubbed Personal API. Synthetic
 * activities and a synthetic FIT; nothing from a real account (plan 160).
 */

const ORIGIN = "https://garmin.test";

function configFor(userId: string): GarminConfig {
  return { apiKey: "key", ownerUserId: userId, origin: ORIGIN };
}

interface Stub {
  fetchImpl: typeof fetch;
  downloads: string[];
}

function garminStub(options: {
  activities?: unknown;
  listStatus?: number;
  fit?: ArrayBuffer;
}): Stub {
  const downloads: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = urlOf(input);
    if (url.pathname.startsWith("/personalapitoken-service")) {
      return new Response("aaa.bbb.ccc");
    }
    if (url.pathname.startsWith("/activitylist-service")) {
      return options.listStatus === undefined
        ? Response.json(options.activities ?? [])
        : new Response("", { status: options.listStatus });
    }
    downloads.push(url.pathname);
    return new Response(
      await zipOf(options.fit ?? fitFile({ workoutRpe: 20 })),
    );
  };
  return { fetchImpl, downloads };
}

const summary = (activityId: number, day: number) => ({
  activityId,
  startTimeGMT: `2026-10-${String(day).padStart(2, "0")} 12:00:00`,
  distance: 5000,
  duration: 1800,
});

function queue() {
  const sent: ImportJob[] = [];
  return {
    sent,
    send: (message: ImportJob) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

function reports() {
  const seen: { error: unknown; context: Record<string, string> }[] = [];
  return {
    seen,
    report: (error: unknown, context: Record<string, string>) => {
      seen.push({ error, context });
    },
  };
}

function importDeps(userId: string, stub: Stub, config = configFor(userId)) {
  const reported = reports();
  return {
    reported,
    sent: queue(),
    deps: (sent = queue()) => ({
      db: coreDb(),
      config,
      report: reported.report,
      fetchImpl: stub.fetchImpl,
      importBucket: env.IMPORTS,
      queue: sent,
    }),
  };
}

/**
A token whose body breaks while it is read: not one of the client's own
refusals.
*/
const brokenBody: typeof fetch = () =>
  Promise.resolve(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new RangeError("a broken body"));
        },
      }),
    ),
  );

/**
A token, and then a download Garmin refuses.
*/
const downloadFails: typeof fetch = (input) =>
  Promise.resolve(
    urlOf(input).pathname.includes("token")
      ? new Response("aaa.bbb.ccc")
      : new Response("", { status: 500 }),
  );

/**
The consumer's Sentry, for a run that is expected to go through.
*/
function ignoreException(): void {
  // Nothing is expected to fail here.
}

describe("garminPicker", () => {
  it("is not there for anyone the feature is not for", async () => {
    const stub = garminStub({});
    expect(
      await garminPicker(
        {
          db: coreDb(),
          config: undefined,
          report: reports().report,
          fetchImpl: stub.fetchImpl,
        },
        newUlid(),
      ),
    ).toBeUndefined();
  });

  it("lists the recent runs and marks the ones already here", async () => {
    const userId = newUlid();
    const runId = newUlid();
    await coreDb()
      .insert(imports)
      .values([
        {
          id: newUlid(),
          userId,
          r2Key: `imports/${userId}/a.fit`,
          status: "done",
          runId,
          garminActivityId: "101",
          createdAt: nowSeconds(),
        },
        // On its way, not here yet: still IMPORT ›, and a tap returns it.
        {
          id: newUlid(),
          userId,
          r2Key: `imports/${userId}/b.fit`,
          status: "pending",
          garminActivityId: "102",
          createdAt: nowSeconds(),
        },
        // Another runner's import of the same id is not this runner's.
        {
          id: newUlid(),
          userId: newUlid(),
          r2Key: "imports/other/c.fit",
          status: "done",
          runId: newUlid(),
          garminActivityId: "103",
          createdAt: nowSeconds(),
        },
      ]);
    const stub = garminStub({
      activities: [summary(101, 23), summary(102, 22), summary(103, 21)],
    });

    const picker = await garminPicker(
      {
        db: coreDb(),
        config: configFor(userId),
        report: reports().report,
        fetchImpl: stub.fetchImpl,
      },
      userId,
    );

    expect(picker).toMatchObject({ status: "ready" });
    expect(
      picker?.status === "ready"
        ? picker.rows.map((row) => [row.activityId, row.runId])
        : [],
    ).toEqual([
      ["101", runId],
      ["102", undefined],
      ["103", undefined],
    ]);
  });

  it("lists nothing when Garmin has no runs", async () => {
    const userId = newUlid();
    const picker = await garminPicker(
      {
        db: coreDb(),
        config: configFor(userId),
        report: reports().report,
        fetchImpl: garminStub({}).fetchImpl,
      },
      userId,
    );
    expect(picker).toEqual({ status: "ready", rows: [] });
  });

  it("says Garmin didn't answer, and reports why without a token", async () => {
    const userId = newUlid();
    const reported = reports();
    const picker = await garminPicker(
      {
        db: coreDb(),
        config: configFor(userId),
        report: reported.report,
        fetchImpl: garminStub({ listStatus: 503 }).fetchImpl,
      },
      userId,
    );

    expect(picker).toEqual({ status: "unreachable" });
    expect(reported.seen).toHaveLength(1);
    expect(reported.seen[0]?.context).toEqual({
      surface: "garmin-list",
      userId,
      reason: "list: HTTP 503",
    });
  });

  it("names a failure that is not one of the client's own as unexpected", async () => {
    const userId = newUlid();
    const reported = reports();
    await expect(
      garminPicker(
        {
          db: coreDb(),
          config: configFor(userId),
          report: reported.report,
          fetchImpl: brokenBody,
        },
        userId,
      ),
    ).resolves.toEqual({ status: "unreachable" });
    expect(reported.seen[0]?.context.reason).toBe("unexpected");
  });
});

describe("importGarminActivity", () => {
  it("is not there for anyone the feature is not for", async () => {
    const userId = newUlid();
    const stub = garminStub({});
    const { deps } = importDeps(userId, stub);
    expect(
      await importGarminActivity({ ...deps(), config: undefined }, userId, {
        activityId: "1",
        idempotencyKey: newUlid(),
      }),
    ).toBeUndefined();
    expect(stub.downloads).toEqual([]);
  });

  it("fetches the run, starts an ordinary import, and lands a Garmin run", async () => {
    const userId = newUlid();
    const stub = garminStub({});
    const sent = queue();
    const { deps } = importDeps(userId, stub);

    const started = await importGarminActivity(deps(sent), userId, {
      activityId: "20123",
      idempotencyKey: newUlid(),
    });

    expect(started).toMatchObject({ status: "started" });
    const importId = started?.status === "started" ? started.importId : "";
    expect(stub.downloads).toEqual(["/download-service/files/activity/20123"]);
    expect(sent.sent).toEqual([{ type: "import", importId }]);
    const [row] = await coreDb()
      .select()
      .from(imports)
      .where(eq(imports.id, importId));
    expect(row).toMatchObject({ garminActivityId: "20123", status: "pending" });
    expect(row?.r2Key.endsWith(".fit")).toBe(true);

    await handleImportsBatch(
      batchOf("dialed-imports", [
        fakeMessage("m", { type: "import", importId }),
      ]),
      {
        db: coreDb(),
        importBucket: env.IMPORTS,
        captureException: ignoreException,
        owe: oweInCore,
      },
    );
    const [run] = await coreDb()
      .select()
      .from(runs)
      .innerJoin(imports, eq(imports.runId, runs.id))
      .where(eq(imports.id, importId));
    expect(run?.runs).toMatchObject({
      source: "garmin",
      deviceName: "Garmin",
      rpe: 2,
      effort: "easy",
      effortSource: "watch",
    });
  });

  it("returns the import already made for the activity and fetches nothing", async () => {
    const userId = newUlid();
    const stub = garminStub({});
    const { deps } = importDeps(userId, stub);
    const first = await importGarminActivity(deps(), userId, {
      activityId: "7",
      idempotencyKey: newUlid(),
    });

    const again = await importGarminActivity(deps(), userId, {
      activityId: "7",
      idempotencyKey: newUlid(),
    });

    expect(again).toEqual(first);
    expect(stub.downloads).toHaveLength(1);
  });

  it("answers a race with the import that won it", async () => {
    const userId = newUlid();
    const stub = garminStub({});
    const { deps } = importDeps(userId, stub);

    const [one, two] = await Promise.all([
      importGarminActivity(deps(), userId, {
        activityId: "8",
        idempotencyKey: newUlid(),
      }),
      importGarminActivity(deps(), userId, {
        activityId: "8",
        idempotencyKey: newUlid(),
      }),
    ]);

    expect(one).toEqual(two);
    const rows = await coreDb()
      .select({ id: imports.id })
      .from(imports)
      .where(eq(imports.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it("says Garmin didn't answer, writes nothing, and reports the step", async () => {
    const userId = newUlid();
    const reported = reports();

    const result = await importGarminActivity(
      {
        db: coreDb(),
        config: configFor(userId),
        report: reported.report,
        fetchImpl: downloadFails,
        importBucket: env.IMPORTS,
        queue: queue(),
      },
      userId,
      { activityId: "9", idempotencyKey: newUlid() },
    );

    expect(result).toEqual({ status: "unreachable" });
    expect(reported.seen[0]?.context).toEqual({
      surface: "garmin-download",
      userId,
      reason: "download: HTTP 500",
    });
    const rows = await coreDb()
      .select()
      .from(imports)
      .where(eq(imports.userId, userId));
    expect(rows).toEqual([]);
  });

  it("lets a failure that is not a race or Garmin's through", async () => {
    const userId = newUlid();
    const stub = garminStub({ fit: new ArrayBuffer(0) });
    const { deps } = importDeps(userId, stub);
    // An empty file is refused by the upload rule itself, not a race.
    await expect(
      importGarminActivity(deps(), userId, {
        activityId: "10",
        idempotencyKey: newUlid(),
      }),
    ).rejects.toThrow();
  });
});
