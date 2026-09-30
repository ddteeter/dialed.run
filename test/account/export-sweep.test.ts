import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { dataExports } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { EXPORT_LINK_TTL_S } from "../../src/lib/data-export";
import { newUlid } from "../../src/lib/ids";
import {
  exportKeyFor,
  newLinkToken,
} from "../../src/modules/account/data-exports";
import {
  EXPORT_LEASE_S,
  EXPORT_STALL_S,
  EXPORT_SWEEP_CAP,
  sweepExports,
  type SweepDeps,
} from "../../src/modules/account/export-sweep";
import { core } from "../email/helpers";

/**
 * The export's hourly sweep (task 126, ACC-10) on real D1 and R2: expired
 * ZIPs gone, old failures forgotten, lost sends re-sent — and nothing
 * touched that is not due.
 */

const db = core();
const NOW = 1_800_000_000;

type Status = (typeof dataExports.$inferInsert)["status"];

async function seedExport(
  status: Status,
  overrides: Partial<typeof dataExports.$inferInsert> = {},
) {
  const row = {
    id: newUlid(),
    userId: newUlid(),
    idempotencyKey: newUlid(),
    linkToken: newLinkToken(),
    status,
    requestedAt: NOW - 60,
    ...overrides,
  };
  await db.insert(dataExports).values(row);
  return row;
}

async function stagedFor(row: { userId: string; id: string }) {
  await env.IMPORTS.put(exportKeyFor(row.userId, row.id), "zip");
  return row;
}

/**
 * A row's status and its claim time ("unclaimed" before any) — or nothing
 * once the sweep has deleted it.
 */
async function statusOf(id: string) {
  const [row] = await db
    .select({ status: dataExports.status, claimedAt: dataExports.claimedAt })
    .from(dataExports)
    .where(eq(dataExports.id, id));
  return row === undefined
    ? undefined
    : { status: row.status, at: row.claimedAt ?? "unclaimed" };
}

function deps(overrides: Partial<SweepDeps> = {}) {
  const sent: unknown[] = [];
  const reports: { error: unknown; context: Record<string, string> }[] = [];
  const value: SweepDeps = {
    db,
    bucket: env.IMPORTS,
    queue: {
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    },
    report: (error, context) => {
      reports.push({ error, context });
    },
    now: NOW,
    ...overrides,
  };
  return { deps: value, sent, reports };
}

/**
 * Storage is shared by the tests in one file, and the sweep reads every
 * runner's rows — so each test starts from none.
 */
beforeEach(async () => {
  await db.delete(dataExports);
});

describe("sweepExports", () => {
  it("deletes an expired ZIP and its row, and leaves one still live", async () => {
    const expired = await stagedFor(
      await seedExport("ready", { expiresAt: NOW }),
    );
    const live = await stagedFor(
      await seedExport("ready", { expiresAt: NOW + 1 }),
    );
    const anomalies: string[] = [];
    const { deps: sweep, reports } = deps();

    await sweepExports(anomalies, sweep);

    expect(await statusOf(expired.id)).toBeUndefined();
    expect(
      await env.IMPORTS.head(exportKeyFor(expired.userId, expired.id)),
    ).toBeNull();
    expect(await statusOf(live.id)).toMatchObject({ status: "ready" });
    expect(
      await env.IMPORTS.head(exportKeyFor(live.userId, live.id)),
    ).not.toBeNull();
    expect(anomalies).toStrictEqual([]);
    expect(reports).toStrictEqual([]);
  });

  it("re-claims an expiry whose claim went stale, and leaves one still held", async () => {
    const stale = await stagedFor(
      await seedExport("expiring", { claimedAt: NOW - EXPORT_LEASE_S - 1 }),
    );
    const held = await stagedFor(
      await seedExport("expiring", { claimedAt: NOW - EXPORT_LEASE_S }),
    );

    await sweepExports([], deps().deps);

    expect(await statusOf(stale.id)).toBeUndefined();
    expect(await statusOf(held.id)).toStrictEqual({
      status: "expiring",
      at: NOW - EXPORT_LEASE_S,
    });
  });

  it("keeps the row expiring, reports it, and says so when a ZIP will not delete", async () => {
    const expired = await seedExport("ready", { expiresAt: NOW - 5 });
    const failure = new Error("R2 down");
    const anomalies: string[] = [];
    const { deps: failing, reports } = deps({
      bucket: { delete: () => Promise.reject(failure) },
    });

    await sweepExports(anomalies, failing);

    expect(await statusOf(expired.id)).toStrictEqual({
      status: "expiring",
      at: NOW,
    });
    expect(reports).toStrictEqual([
      {
        error: failure,
        context: {
          surface: "account-export-expire",
          exportId: expired.id,
          userId: expired.userId,
        },
      },
    ]);
    expect(anomalies).toStrictEqual([
      "1 expired data export(s) could not be deleted and are retried next hour",
    ]);
    // The next firing past the lease finishes it.
    await sweepExports([], deps({ now: NOW + EXPORT_LEASE_S + 1 }).deps);
    expect(await statusOf(expired.id)).toBeUndefined();
  });

  it("expires at most a firing's cap, oldest first", async () => {
    const rows = [];
    for (let index = 0; index <= EXPORT_SWEEP_CAP; index += 1) {
      rows.push(
        await seedExport("ready", {
          expiresAt: NOW - 10,
          requestedAt: NOW - 10_000 + index,
        }),
      );
    }
    await sweepExports([], deps().deps);
    const left = await Promise.all(rows.map((row) => statusOf(row.id)));
    // The newest is left, unclaimed, for the next firing.
    expect(left.filter((row) => row !== undefined)).toStrictEqual([
      { status: "ready", at: "unclaimed" },
    ]);
    expect(left.at(-1)).toStrictEqual({ status: "ready", at: "unclaimed" });
  });

  it("forgets a failure after a week, and keeps a recent one for the row to show", async () => {
    const old = await seedExport("failed", {
      requestedAt: NOW - EXPORT_LINK_TTL_S - 1,
    });
    const recent = await seedExport("failed", {
      requestedAt: NOW - EXPORT_LINK_TTL_S,
    });
    await sweepExports([], deps().deps);
    expect(await statusOf(old.id)).toBeUndefined();
    expect(await statusOf(recent.id)).toMatchObject({ status: "failed" });
  });

  it("re-sends a pending export past the stall window and a build past its lease, and says so", async () => {
    const stalled = await seedExport("pending", {
      requestedAt: NOW - EXPORT_STALL_S - 1,
    });
    await seedExport("pending", {
      requestedAt: NOW - EXPORT_STALL_S,
    });
    const dead = await seedExport("building", {
      requestedAt: NOW - 2 * EXPORT_LEASE_S,
      claimedAt: NOW - EXPORT_LEASE_S - 1,
    });
    await seedExport("building", {
      requestedAt: NOW - 2 * EXPORT_LEASE_S,
      claimedAt: NOW - EXPORT_LEASE_S,
    });
    const anomalies: string[] = [];
    const { deps: live, sent } = deps();

    await sweepExports(anomalies, live);

    expect(sent).toStrictEqual([
      { type: "account_export", exportId: dead.id },
      { type: "account_export", exportId: stalled.id },
    ]);
    expect(anomalies).toStrictEqual([
      "2 data export(s) stalled and were re-sent",
    ]);
    // Untouched: the consumer claims them when the message lands.
    expect(await statusOf(stalled.id)).toMatchObject({ status: "pending" });
  });

  it("reports a re-send that fails and goes on to the next", async () => {
    const first = await seedExport("pending", {
      requestedAt: NOW - EXPORT_STALL_S - 20,
    });
    const second = await seedExport("pending", {
      requestedAt: NOW - EXPORT_STALL_S - 10,
    });
    const failure = new Error("queue down");
    const attempted: unknown[] = [];
    const anomalies: string[] = [];
    const { deps: failing, reports } = deps({
      queue: {
        send: (message) => {
          attempted.push(message);
          return Promise.reject(failure);
        },
      },
    });

    await sweepExports(anomalies, failing);

    expect(attempted).toHaveLength(2);
    expect(reports.map((report) => report.context)).toStrictEqual([
      {
        surface: "account-export-resend",
        exportId: first.id,
        userId: first.userId,
      },
      {
        surface: "account-export-resend",
        exportId: second.id,
        userId: second.userId,
      },
    ]);
    expect(anomalies).toStrictEqual([
      "2 data export(s) stalled and were re-sent",
    ]);
  });
});
