import { asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeAll, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { inJsonList, jsonEach, jsonField } from "../../src/lib/sql/json-list";

/**
 * Design 188: a list bound as one parameter, read back with `json_each`,
 * however long it is.
 */

const listed = sqliteTable("json_list_probe", { id: text("id") });

const db = () => drizzle(env.DIALED_CORE);

beforeAll(async () => {
  await env.DIALED_CORE.exec(
    "CREATE TABLE IF NOT EXISTS json_list_probe (id TEXT)",
  );
  await env.DIALED_CORE.exec("DELETE FROM json_list_probe");
  await db()
    .insert(listed)
    .values(["a", "b", "c", "it's"].map((id) => ({ id })));
});

async function idsIn(values: readonly string[]) {
  const rows = await db()
    .select({ id: listed.id })
    .from(listed)
    .where(inJsonList(listed.id, values))
    .orderBy(asc(listed.id));
  return rows.map((row) => row.id);
}

describe("inJsonList", () => {
  it("matches the listed values, quotes and all", async () => {
    expect(await idsIn(["c", "it's", "z"])).toStrictEqual(["c", "it's"]);
  });

  it("matches nothing for an empty list", async () => {
    expect(await idsIn([])).toStrictEqual([]);
  });

  it("binds one parameter however long the list, past D1's 100", async () => {
    const many = [
      ...Array.from({ length: 500 }, (_, index) => `x${String(index)}`),
      "b",
    ];
    const query = db()
      .select({ id: listed.id })
      .from(listed)
      .where(inJsonList(listed.id, many));

    expect(query.toSQL().params).toHaveLength(1);
    const rows = await query;
    expect(rows.map((row) => row.id)).toStrictEqual(["b"]);
  });
});

describe("jsonEach and jsonField", () => {
  it("reads each item's fields, one row an item", async () => {
    const rows = await db()
      .select({
        name: jsonField<string>("name"),
        count: sql<number>`${jsonField<number>("count")}`.mapWith(Number),
      })
      .from(
        jsonEach([
          { name: "one", count: 1 },
          { name: "two", count: 2 },
        ]),
      );

    expect(rows).toStrictEqual([
      { name: "one", count: 1 },
      { name: "two", count: 2 },
    ]);
  });
});
