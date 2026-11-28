import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { deleteKeys, R2_DELETE_CAP } from "../../src/lib/sql/r2-delete";

/**
 * Deleting a list of keys the way R2 takes them: never none, never more
 * than a thousand a call. `env.MEDIA` refuses both, as R2 does
 * (`test/platform/strict-r2.ts`).
 */
function keysUnder(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index).padStart(4, "0")}`,
  );
}

function recording() {
  const calls: string[][] = [];
  const bucket = {
    delete: (keys: string | string[]) => {
      calls.push([keys].flat());
      return Promise.resolve();
    },
  };
  return { bucket, calls };
}

describe("deleteKeys", () => {
  it("takes a thousand keys a call, R2's cap", () => {
    expect(R2_DELETE_CAP).toBe(1000);
  });

  it("makes no call for no keys", async () => {
    const { bucket, calls } = recording();
    await deleteKeys(bucket, []);
    expect(calls).toStrictEqual([]);
  });

  it("deletes a short list in one call, in order", async () => {
    const { bucket, calls } = recording();
    await deleteKeys(bucket, ["b", "a", "c"]);
    expect(calls).toStrictEqual([["b", "a", "c"]]);
  });

  it("splits a long list into calls of a thousand and the rest", async () => {
    const { bucket, calls } = recording();
    const keys = keysUnder("k", 2001);
    await deleteKeys(bucket, keys);
    expect(calls).toStrictEqual([
      keys.slice(0, 1000),
      keys.slice(1000, 2000),
      keys.slice(2000),
    ]);
  });

  it("deletes past a thousand from a bucket that refuses more", async () => {
    const prefix = `r2-delete/${newUlid()}/`;
    const keys = keysUnder(prefix, 1001);
    await env.MEDIA.put(keys[0] ?? "", "x");
    await env.MEDIA.put(keys[1000] ?? "", "x");

    await deleteKeys(env.MEDIA, keys);

    const left = await env.MEDIA.list({ prefix });
    expect(left.objects).toStrictEqual([]);
  });

  it("asks nothing of a bucket that refuses none", async () => {
    await expect(deleteKeys(env.MEDIA, [])).resolves.toBeUndefined();
  });
});
