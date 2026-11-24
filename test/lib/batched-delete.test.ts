import { describe, expect, it } from "vitest";

import { deleteInBatches } from "../../src/lib/sql/batched-delete";

const BATCH = 2;

/**
A pass over `rows` rows, `BATCH` at a time, recording what each deleted.
*/
function passesOver(rows: number) {
  let left = rows;
  const deleted: number[] = [];
  const pass = () => {
    const now = Math.min(left, BATCH);
    left -= now;
    deleted.push(now);
    return Promise.resolve(now);
  };
  return { pass, deleted, left: () => left };
}

describe("deleteInBatches", () => {
  it("passes until one deletes fewer than a batch", async () => {
    const work = passesOver(5);
    expect(await deleteInBatches(work.pass, BATCH, 20)).toBe(3);
    expect(work.deleted).toStrictEqual([2, 2, 1]);
  });

  it("passes once more when the last full batch emptied the set", async () => {
    const work = passesOver(4);
    expect(await deleteInBatches(work.pass, BATCH, 20)).toBe(3);
    expect(work.deleted).toStrictEqual([2, 2, 0]);
  });

  it("stops at its bound, leaving the rest", async () => {
    const work = passesOver(5);
    expect(await deleteInBatches(work.pass, BATCH, 2)).toBe(2);
    expect(work.left()).toBe(1);
  });

  it("sends nothing with no passes to spend", async () => {
    const work = passesOver(5);
    expect(await deleteInBatches(work.pass, BATCH, 0)).toBe(0);
    expect(work.deleted).toStrictEqual([]);
  });
});
