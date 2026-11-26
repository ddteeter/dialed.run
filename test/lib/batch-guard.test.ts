import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { guarded, runGuarded } from "../../src/lib/sql/batch-guard";
import { runInD1Scope, scopedDb } from "../../src/lib/sql/d1-session";

/**
 * Design 277 §2: a guarded write aborts its whole batch when it changes
 * no rows. A table of the test's own, so nothing here depends on the
 * schema.
 */

const rows = sqliteTable("batch_guard_rows", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  n: integer("n").notNull(),
});

function db() {
  return drizzle(env.DIALED_CORE);
}

async function ids(): Promise<string[]> {
  const found = await db().select({ id: rows.id }).from(rows).orderBy(rows.id);
  return found.map((row) => row.id);
}

function claim(id: string) {
  return db()
    .update(rows)
    .set({ status: "claimed" })
    .where(sql`${rows.id} = ${id} AND ${rows.status} = 'pending'`);
}

function add(id: string) {
  return db().insert(rows).values({ id, status: "pending", n: 0 });
}

beforeEach(async () => {
  await db().run(
    sql`CREATE TABLE IF NOT EXISTS batch_guard_rows (id TEXT PRIMARY KEY, status TEXT NOT NULL, n INTEGER NOT NULL)`,
  );
  await db().delete(rows);
  await db().insert(rows).values({ id: "a", status: "pending", n: 0 });
});

describe("runGuarded with a guarded write", () => {
  it("commits the whole batch when the guarded write changed a row", async () => {
    const outcome = await runGuarded(db(), [
      ...guarded(db(), claim("a"), "claim"),
      add("b"),
    ]);
    expect(outcome.ok).toBe(true);
    expect(await ids()).toEqual(["a", "b"]);
    const [status] = await db()
      .select({ s: rows.status })
      .from(rows)
      .where(eq(rows.id, "a"));
    expect(status?.s).toBe("claimed");
  });

  it("hands back every statement's result, the guard's row in its place", async () => {
    const outcome = await runGuarded(db(), [
      ...guarded(db(), claim("a").returning({ id: rows.id }), "claim"),
      db().select({ n: rows.n }).from(rows),
    ]);
    if (!outcome.ok) throw new Error("expected the batch to commit");
    const [claimed, guard, read] = outcome.results;
    expect(claimed).toEqual([{ id: "a" }]);
    expect(guard).toHaveLength(1);
    expect(guard[0]?.missed).toBeNull();
    expect(read).toEqual([{ n: 0 }]);
  });

  it("writes nothing and names the guard when the guarded write missed", async () => {
    const outcome = await runGuarded(db(), [
      add("b"),
      ...guarded(db(), claim("missing"), "claim-missing"),
      add("c"),
    ]);
    expect(outcome).toEqual({ ok: false, missed: "claim-missing" });
    // The insert before the guard is rolled back, and the one after never ran.
    expect(await ids()).toEqual(["a"]);
  });

  it("reads its own write, not an earlier one that changed rows", async () => {
    const outcome = await runGuarded(db(), [
      add("b"),
      ...guarded(db(), claim("missing"), "own"),
    ]);
    expect(outcome).toEqual({ ok: false, missed: "own" });
    expect(await ids()).toEqual(["a"]);
  });

  it("passes on its own write's hit, after an earlier write that missed", async () => {
    const outcome = await runGuarded(db(), [
      claim("missing"),
      ...guarded(db(), claim("a"), "own"),
    ]);
    expect(outcome.ok).toBe(true);
  });

  it("names the second guard when the first held and the second missed", async () => {
    const outcome = await runGuarded(db(), [
      ...guarded(db(), claim("a"), "first"),
      ...guarded(db(), claim("a"), "second"),
    ]);
    expect(outcome).toEqual({ ok: false, missed: "second" });
    const [status] = await db()
      .select({ s: rows.status })
      .from(rows)
      .where(eq(rows.id, "a"));
    expect(status?.s).toBe("pending");
  });

  it("guards a delete and an insert as well as an update", async () => {
    const missing = eq(rows.id, "missing");
    const deleted = await runGuarded(db(), [
      ...guarded(db(), db().delete(rows).where(missing), "gone"),
    ]);
    expect(deleted).toEqual({ ok: false, missed: "gone" });
    const inserted = await runGuarded(db(), [
      ...guarded(
        db(),
        db()
          .insert(rows)
          .values({ id: "a", status: "pending", n: 1 })
          .onConflictDoNothing(),
        "new",
      ),
    ]);
    expect(inserted).toEqual({ ok: false, missed: "new" });
  });

  it("works the same through a request's D1 session", async () => {
    const outcome = await runInD1Scope(undefined, async () => {
      const scoped = scopedDb(env.DIALED_CORE, "core");
      const missing = eq(rows.id, "missing");
      const write = scoped.update(rows).set({ n: 1 }).where(missing);
      return runGuarded(scoped, [
        add("b"),
        ...guarded(scoped, write, "scoped"),
      ]);
    });
    expect(outcome).toEqual({ ok: false, missed: "scoped" });
    expect(await ids()).toEqual(["a"]);
  });
});

describe("runGuarded with other errors", () => {
  it("throws an error that is not a guard's, as it came", async () => {
    const failing = runGuarded(db(), [add("a")]);
    await expect(failing).rejects.toBeInstanceOf(Error);
    await expect(failing).rejects.toThrow(/UNIQUE constraint failed/u);
  });

  it("throws another bad JSON path rather than reading it as a guard", async () => {
    const failing = runGuarded(db(), [
      add("b"),
      db()
        .select({ x: sql`json_extract('{}', 'not a guard: x')` })
        .from(sql`(SELECT 1)`),
    ]);
    await expect(failing).rejects.toBeInstanceOf(Error);
    await expect(failing).rejects.toThrow(/bad JSON path: 'not a guard: x'/u);
  });
});

describe("the error SQLite raises (wording, not an API)", () => {
  it("is D1's bad JSON path, with the guard's label in it", async () => {
    const failing = db().batch([
      ...guarded(db(), claim("missing"), "pinned-text"),
    ]);
    await expect(failing).rejects.toThrow(
      "bad JSON path: 'batch guard missed: pinned-text'",
    );
  });
});

describe("guarded refuses", () => {
  it.each(["", "Claim", "a b", "'claim", "claim'", "claim_x"])(
    "the label %j",
    (label) => {
      expect(() => guarded(db(), claim("a"), label)).toThrow(
        `a guard label is lower-case words and digits: ${label}`,
      );
    },
  );

  it("accepts lower-case words, digits and dashes", () => {
    expect(guarded(db(), claim("a"), "claim-2")).toHaveLength(2);
  });

  it("a select, which changes no rows", () => {
    expect(() => guarded(db(), db().select().from(rows), "read")).toThrow(
      'guard "read" wraps a select, which changes no rows',
    );
  });
});
