import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { refusal } from "./refusal";
import { R2_DELETE_REFUSAL } from "./strict-r2";

/**
 * The setup file's R2 (`strict-r2.ts`): every binding refuses a delete
 * that production refuses, and deletes what production deletes.
 */
const buckets = [
  ["MEDIA", env.MEDIA],
  ["IMPORTS", env.IMPORTS],
  ["PUBLIC_PHOTOS", env.PUBLIC_PHOTOS],
  ["MEDIA_BACKUP", env.MEDIA_BACKUP],
] as const;

function keysOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `strict/${String(index)}`);
}

describe.each(buckets)("%s's delete", (_name, bucket) => {
  it("refuses no keys, in R2's words", async () => {
    expect(await refusal(() => bucket.delete([]))).toBe(R2_DELETE_REFUSAL);
  });

  it("refuses 1001 keys, in R2's words", async () => {
    expect(await refusal(() => bucket.delete(keysOf(1001)))).toBe(
      R2_DELETE_REFUSAL,
    );
  });

  it("deletes one key, and a thousand", async () => {
    await bucket.put("strict/0", "x");
    await bucket.put("strict/999", "x");
    expect(await refusal(() => bucket.delete("strict/0"))).toBe("");
    expect(await bucket.head("strict/0")).toBeNull();
    expect(await refusal(() => bucket.delete(keysOf(1000)))).toBe("");
    expect(await bucket.head("strict/999")).toBeNull();
  });
});
