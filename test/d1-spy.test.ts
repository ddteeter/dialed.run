import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../src/env";
import { runInD1Scope, scopedDb } from "../src/lib/sql/d1-session";
import { queriesDuring, queryCounts } from "./d1-spy";

/**
 * The counter the scaling tests stand on (design 182). Its numbers have to
 * be exact, or a 1-vs-25 test compares two wrong counts and passes.
 */
const db = () => drizzle(env.DIALED_CORE);

beforeEach(async () => {
  await env.DIALED_CORE.exec(
    "CREATE TABLE IF NOT EXISTS spy_rows (id INTEGER PRIMARY KEY, n INTEGER)",
  );
  await env.DIALED_CORE.exec("DELETE FROM spy_rows");
  await env.DIALED_CORE.exec(
    "INSERT INTO spy_rows (id, n) VALUES (1, 1), (2, 2), (3, 3)",
  );
});

const rowCount = async () => {
  const row = await env.DIALED_CORE.prepare(
    "SELECT count(*) AS c FROM spy_rows",
  ).first<{ c: number }>();
  return row?.c;
};

describe("queriesDuring", () => {
  it("counts one statement per read and the rows D1 says it read", async () => {
    const tally = await queriesDuring(async () => {
      await db().all(sql`SELECT * FROM spy_rows`);
    });
    expect(tally.statements).toEqual(["SELECT * FROM spy_rows"]);
    expect(tally.rowsRead).toBe(3);
  });

  it("keeps the length of the longest statement prepared, batched ones included (design 188)", async () => {
    const long = sql`SELECT * FROM spy_rows WHERE n > 0 AND n < 100`;
    const short = sql`SELECT n FROM spy_rows`;
    const tally = await queriesDuring(async () => {
      await db().batch([db().all(long), db().all(short)]);
      await db().all(short);
    });
    expect(tally.longestSql).toBe(
      "SELECT * FROM spy_rows WHERE n > 0 AND n < 100".length,
    );
  });

  it("meters a read through raw(), which carries no meta", async () => {
    let values: unknown;
    const tally = await queriesDuring(async () => {
      values = await env.DIALED_CORE.prepare(
        "SELECT n FROM spy_rows WHERE n > ?",
      )
        .bind(1)
        .raw();
    });
    expect(values).toEqual([[2], [3]]);
    expect(tally.statements).toHaveLength(1);
    expect(tally.rowsRead).toBe(3);
  });

  it("meters first(), and passes its column through", async () => {
    let value: unknown;
    const tally = await queriesDuring(async () => {
      value = await env.DIALED_CORE.prepare(
        "SELECT n FROM spy_rows WHERE id = 2",
      ).first("n");
    });
    expect(value).toBe(2);
    expect(tally.statements).toHaveLength(1);
    expect(tally.rowsRead).toBe(1);
  });

  it("runs a write through raw() once, and reads no rows for it", async () => {
    const tally = await queriesDuring(async () => {
      await env.DIALED_CORE.prepare(
        "INSERT INTO spy_rows (id, n) VALUES (4, 4) RETURNING id",
      ).raw();
    });
    expect(await rowCount()).toBe(4);
    expect(tally.statements).toHaveLength(1);
    expect(tally.rowsRead).toBe(0);
  });

  it("counts run() with its meta", async () => {
    const tally = await queriesDuring(async () => {
      await env.DIALED_CORE.prepare("UPDATE spy_rows SET n = n + 1").run();
    });
    expect(tally.statements).toEqual(["UPDATE spy_rows SET n = n + 1"]);
    expect(tally.rowsRead).toBe(3);
  });

  it("counts each statement inside a batch, and sums their rows", async () => {
    const tally = await queriesDuring(async () => {
      await db().batch([
        db().run(sql`SELECT * FROM spy_rows`),
        db().run(sql`SELECT * FROM spy_rows WHERE id = 1`),
      ]);
    });
    expect(tally.statements).toEqual(["batch", "batch"]);
    expect(tally.rowsRead).toBe(4);
  });

  it("counts a session's statements like bare ones", async () => {
    const tally = await queriesDuring(() =>
      runInD1Scope(undefined, async () => {
        const scoped = scopedDb(env.DIALED_CORE, "core");
        await scoped.all(sql`SELECT * FROM spy_rows`);
        await scoped.batch([
          scoped.run(sql`SELECT * FROM spy_rows WHERE id = 1`),
        ]);
      }),
    );
    expect(tally.statements).toEqual(["SELECT * FROM spy_rows", "batch"]);
    expect(tally.rowsRead).toBe(4);
  });

  it("stops counting when the work is done, even if it threw", async () => {
    await expect(
      queriesDuring(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    const after = await queriesDuring(() => Promise.resolve());
    await db().all(sql`SELECT * FROM spy_rows`);
    expect(after.statements).toEqual([]);
  });
});

describe("queryCounts", () => {
  it("counts core and weather apart", async () => {
    await env.DIALED_WEATHER.exec(
      "CREATE TABLE IF NOT EXISTS spy_weather (id INTEGER PRIMARY KEY)",
    );
    await env.DIALED_WEATHER.exec("DELETE FROM spy_weather");
    await env.DIALED_WEATHER.exec("INSERT INTO spy_weather (id) VALUES (1)");
    const counts = await queryCounts(async () => {
      await db().all(sql`SELECT * FROM spy_rows`);
      await db().all(sql`SELECT * FROM spy_rows WHERE id = 1`);
      await drizzle(env.DIALED_WEATHER).all(sql`SELECT * FROM spy_weather`);
    });
    expect(counts).toEqual({
      core: 2,
      weather: 1,
      coreRowsRead: 4,
      weatherRowsRead: 1,
      coreLongestSql: "SELECT * FROM spy_rows WHERE id = 1".length,
    });
  });
});
