import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { outfitEntries, userProfiles } from "../src/db/schema-core";
import { env } from "../src/env";
import { audienceOfShareToggle } from "../src/lib/contracts";
import { newUlid } from "../src/lib/ids";

/**
 * The backfill in the migration that adds the audience columns
 * (design 131, PR A), run from the migration's own SQL rather than a copy
 * of it, so the statements under test are the ones production applies.
 *
 * The suite has already applied every migration to this D1, so the rows
 * seeded here start with the column defaults (or a deliberately wrong
 * audience); running the backfill again must make each one agree with its
 * boolean. Found by name suffix, so a law-11 renumber does not break it.
 */
function backfillStatements(): string[] {
  const migration = env.TEST_MIGRATIONS_CORE.find((candidate) =>
    candidate.name.endsWith("_add_audience_columns.sql"),
  );
  if (migration === undefined) {
    throw new Error("no *_add_audience_columns migration found");
  }
  return migration.queries.filter((query) =>
    query.trimStart().startsWith("UPDATE"),
  );
}

async function runBackfill(): Promise<void> {
  for (const statement of backfillStatements()) {
    await env.DIALED_CORE.prepare(statement).run();
  }
}

describe("the audience backfill", () => {
  it("is exactly two UPDATEs, one per table", () => {
    const statements = backfillStatements();
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("UPDATE `outfit_entries`");
    expect(statements[1]).toContain("UPDATE `user_profiles`");
  });

  it("gives every entry the audience its boolean stands for", async () => {
    const db = drizzle(env.DIALED_CORE);
    const shared = newUlid();
    const hidden = newUlid();
    await db.insert(outfitEntries).values([
      // Wrong on purpose in both directions, so a no-op backfill fails.
      {
        id: shared,
        runId: newUlid(),
        userId: newUlid(),
        isPublic: true,
        audience: "private",
        createdAt: 1,
      },
      {
        id: hidden,
        runId: newUlid(),
        userId: newUlid(),
        isPublic: false,
        audience: "groups",
        createdAt: 1,
      },
    ]);

    await runBackfill();

    const rows = await db
      .select({
        id: outfitEntries.id,
        isPublic: outfitEntries.isPublic,
        audience: outfitEntries.audience,
      })
      .from(outfitEntries)
      .where(inArray(outfitEntries.id, [shared, hidden]));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.audience).toBe(audienceOfShareToggle(row.isPublic));
    }
    const byId = new Map(rows.map((row) => [row.id, row.audience]));
    expect(byId.get(shared)).toBe("runners");
    expect(byId.get(hidden)).toBe("private");
  });

  it("gives every profile the default audience its boolean stands for", async () => {
    const db = drizzle(env.DIALED_CORE);
    const sharing = newUlid();
    const keeping = newUlid();
    await db.insert(userProfiles).values([
      { userId: sharing, shareDefault: true, defaultAudience: "private" },
      { userId: keeping, shareDefault: false, defaultAudience: "runners" },
    ]);

    await runBackfill();

    const [shared] = await db
      .select({ defaultAudience: userProfiles.defaultAudience })
      .from(userProfiles)
      .where(eq(userProfiles.userId, sharing));
    const [kept] = await db
      .select({ defaultAudience: userProfiles.defaultAudience })
      .from(userProfiles)
      .where(eq(userProfiles.userId, keeping));
    expect(shared?.defaultAudience).toBe(audienceOfShareToggle(true));
    expect(kept?.defaultAudience).toBe(audienceOfShareToggle(false));
  });

  it("fails closed for an entry that never set its audience", async () => {
    // The column default is what pre-A code, a test seed or a forgetful
    // future insert gets: it must hide the entry, never publish it.
    const db = drizzle(env.DIALED_CORE);
    const id = newUlid();
    await db.insert(outfitEntries).values({
      id,
      runId: newUlid(),
      userId: newUlid(),
      createdAt: 1,
    });
    const [row] = await db
      .select({ audience: outfitEntries.audience })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, id));
    expect(row?.audience).toBe("private");
  });

  it("defaults a new profile to shared, as share_default did", async () => {
    const db = drizzle(env.DIALED_CORE);
    const userId = newUlid();
    await db.insert(userProfiles).values({ userId });
    const [row] = await db
      .select({ defaultAudience: userProfiles.defaultAudience })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(row?.defaultAudience).toBe("runners");
  });
});
