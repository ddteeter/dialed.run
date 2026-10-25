import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { imports, runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { effortSources, runSources } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { coreDb } from "../../src/modules/runs/core-db";

const nameRows = z.array(z.object({ name: z.string() }));

async function columnsOf(table: string): Promise<string[]> {
  const { results } = await env.DIALED_CORE.prepare(
    `SELECT name FROM pragma_table_info(?)`,
  )
    .bind(table)
    .all();
  return nameRows.parse(results).map((row) => row.name);
}

function importValues(userId: string, garminActivityId?: string) {
  const id = newUlid();
  return {
    id,
    userId,
    r2Key: `imports/${userId}/${id}.fit`,
    status: "pending" as const,
    createdAt: nowSeconds(),
    garminActivityId,
  };
}

/**
 * Plan 152's columns (migration `add_garmin_import_columns`). The suite has
 * already applied every migration to this D1, so this is the schema a fresh
 * database ends with.
 */
describe("the Garmin import schema", () => {
  it("reads its enums from the contracts (R-77)", () => {
    // A drizzle text enum emits no CHECK, so these pins are what keeps the
    // column and the contract from drifting apart.
    expect(runs.source.enumValues).toEqual(runSources);
    expect(runs.effortSource.enumValues).toEqual(effortSources);
    expect(runSources).toContain("garmin");
    expect(effortSources).toEqual(["watch", "runner"]);
  });

  it("adds the run's effort, its source and the device", async () => {
    const columns = await columnsOf("runs");
    expect(columns).toEqual(
      expect.arrayContaining(["rpe", "effort_source", "device_name"]),
    );
    expect(await columnsOf("imports")).toContain("garmin_activity_id");
  });

  it("refuses a second import of the same activity for the same runner", async () => {
    const db = coreDb();
    const userId = newUlid();
    await db.insert(imports).values(importValues(userId, "g-1"));
    await expect(
      db.insert(imports).values(importValues(userId, "g-1")),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof Error &&
        String(error.cause).includes("UNIQUE constraint failed"),
    );
  });

  it("lets another runner, and any number of file uploads, through", async () => {
    const db = coreDb();
    const userId = newUlid();
    await db.insert(imports).values(importValues(userId, "g-2"));
    await db.insert(imports).values(importValues(newUlid(), "g-2"));
    await db.insert(imports).values(importValues(userId));
    await db.insert(imports).values(importValues(userId));
    const rows = await db
      .select({ id: imports.id })
      .from(imports)
      .where(eq(imports.userId, userId));
    expect(rows).toHaveLength(3);
  });
});
