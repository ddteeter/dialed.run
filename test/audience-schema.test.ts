import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { outfitEntries, userProfiles } from "../src/db/schema-core";
import { env } from "../src/env";
import { newUlid } from "../src/lib/ids";

const nameRows = z.array(z.object({ name: z.string() }));

/**
The columns of a table, as the migrated D1 has them.
*/
async function columnsOf(table: string): Promise<string[]> {
  const { results } = await env.DIALED_CORE.prepare(
    `SELECT name FROM pragma_table_info(?)`,
  )
    .bind(table)
    .all();
  return nameRows.parse(results).map((row) => row.name);
}

/**
The indexes on a table, as the migrated D1 has them.
*/
async function indexesOf(table: string): Promise<string[]> {
  const { results } = await env.DIALED_CORE.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`,
  )
    .bind(table)
    .all();
  return nameRows.parse(results).map((row) => row.name);
}

/**
 * The audience columns after design 131's C2 (D-109). The suite has
 * already applied every migration to this D1, so this is the schema a
 * fresh database ends with.
 */
describe("the audience schema", () => {
  it("has dropped the sharing booleans and kept the audiences", async () => {
    const entries = await columnsOf("outfit_entries");
    expect(entries).toContain("audience");
    expect(entries).not.toContain("is_public");

    const profiles = await columnsOf("user_profiles");
    expect(profiles).toContain("default_audience");
    expect(profiles).not.toContain("share_default");
  });

  it("has dropped the boolean indexes and kept the audience ones", async () => {
    const indexes = await indexesOf("outfit_entries");
    expect(indexes).toEqual(
      expect.arrayContaining([
        "entries_audience_created",
        "entries_user_audience_created",
      ]),
    );
    expect(indexes).not.toContain("entries_public_created");
    expect(indexes).not.toContain("entries_user_public_created");
  });

  it("left the username expression index on user_profiles alone", async () => {
    // Law 8b: a table rebuild re-emits this index with its expression
    // quoted as one identifier. The drop is `DROP COLUMN`, so it must
    // still be here, still an expression over `username`.
    const { results } = await env.DIALED_CORE.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'user_profiles_username_nocase'`,
    ).all();
    const [index] = z.array(z.object({ sql: z.string() })).parse(results);
    expect(index?.sql).toMatch(/COLLATE NOCASE/iu);
  });

  it("fails closed for an entry that never set its audience", async () => {
    // The column default is what a test seed or a forgetful future insert
    // gets: it must hide the entry, never publish it.
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

  it("defaults a new profile to shared", async () => {
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
