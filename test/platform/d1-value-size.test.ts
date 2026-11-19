import { beforeAll, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { refusal } from "./refusal";

/**
 * D1's limit on the size of one stored value, asked of the local D1 the
 * suite runs on (design 239). Cloudflare documents two megabytes for a
 * string, a BLOB or a row. What the code relies on is how the limit is
 * met: the write is refused with an error, so the caller's own failure
 * path runs, and nothing shorter is stored in its place. If a workerd
 * update changed that, these fail first.
 */
const db = env.DIALED_CORE;

const TWO_MEGABYTES = 2_000_000;

function store(id: number, first: string, second = ""): Promise<unknown> {
  return db
    .prepare("INSERT INTO platform_value_size (id, a, b) VALUES (?, ?, ?)")
    .bind(id, first, second)
    .run();
}

function storedLengthOf(id: number): Promise<{ bytes: number } | null> {
  return db
    .prepare("SELECT length(a) AS bytes FROM platform_value_size WHERE id = ?")
    .bind(id)
    .first<{ bytes: number }>();
}

beforeAll(async () => {
  await db.exec(
    "CREATE TABLE platform_value_size (id INTEGER PRIMARY KEY, a TEXT, b TEXT)",
  );
});

describe("local D1's limit on one stored value", () => {
  it("stores a two-megabyte text value and reads all of it back", async () => {
    await store(1, "v".repeat(TWO_MEGABYTES));
    expect(await storedLengthOf(1)).toStrictEqual({ bytes: TWO_MEGABYTES });
  });

  it("refuses a three-megabyte value, and stores nothing in its place", async () => {
    expect(await refusal(() => store(2, "v".repeat(3_000_000)))).toContain(
      "string or blob too big",
    );
    expect(await storedLengthOf(2)).toBeNull();
  });

  it("counts the bytes, not the characters", async () => {
    // A million three-byte characters: one megabyte by length, three stored.
    expect(await refusal(() => store(3, "€".repeat(1_000_000)))).toContain(
      "string or blob too big",
    );
  });

  it("holds a row to the limit as well as each value in it", async () => {
    const half = "v".repeat(1_500_000);
    expect(await refusal(() => store(4, half, half))).toContain(
      "string or blob too big",
    );
    expect(await storedLengthOf(4)).toBeNull();
  });
});
