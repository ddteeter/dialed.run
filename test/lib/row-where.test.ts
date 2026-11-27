import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { rowWhere } from "../../src/lib/sql/row-where";

/**
 * A table of this test's own, with one column of each kind `rowWhere`
 * fills differently: given, a plain default, an SQL default, a computed
 * default, no default, and a generated column that takes no value.
 */
const probe = sqliteTable("row_where_probe", {
  id: text("id").primaryKey(),
  plain: integer("plain").notNull().default(7),
  expression: integer("expression").default(sql`(6 * 7)`),
  computed: text("computed").$defaultFn(() => "computed"),
  note: text("note"),
  doubled: integer("doubled").generatedAlwaysAs(sql`plain * 2`),
});

function db() {
  return drizzle(env.DIALED_CORE);
}

beforeAll(async () => {
  await env.DIALED_CORE.exec(
    "create table if not exists row_where_probe (id text primary key, plain integer not null default 7, expression integer, computed text, note text, doubled integer generated always as (plain * 2) virtual)",
  );
});

beforeEach(async () => {
  await db().delete(probe);
});

describe("rowWhere", () => {
  it("lands the row when its condition holds, each column from what was given or its default", async () => {
    await db()
      .insert(probe)
      .select(rowWhere(probe, { id: "a", note: "given" }, sql`1 = 1`));

    expect(await db().select().from(probe)).toStrictEqual([
      {
        id: "a",
        plain: 7,
        expression: 42,
        computed: "computed",
        note: "given",
        doubled: 14,
      },
    ]);
  });

  it("writes nothing when its condition does not hold", async () => {
    await db()
      .insert(probe)
      .select(rowWhere(probe, { id: "a" }, sql`1 = 0`));

    expect(await db().select().from(probe)).toStrictEqual([]);
  });

  it("prefers a given value to every default, an expression included", async () => {
    await db()
      .insert(probe)
      .select(
        rowWhere(
          probe,
          { id: "b", plain: 3, expression: sql`(2 + 3)`, computed: "mine" },
          sql`1 = 1`,
        ),
      );

    const rows = await db().select().from(probe);
    expect(rows).toMatchObject([
      { id: "b", plain: 3, expression: 5, computed: "mine", doubled: 6 },
    ]);
    expect(rows[0]?.note).toBeNull();
  });
});
