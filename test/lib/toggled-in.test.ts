import { describe, expect, it } from "vitest";

import { toggledIn } from "../../src/lib/toggled-in";

/**
 * The set-membership toggle behind choosing a garment for a kit and
 * choosing a tag for a verdict.
 */
describe("toggledIn", () => {
  it("adds a member that was not there", () => {
    expect([...toggledIn(new Set(["a"]), "b")]).toStrictEqual(["a", "b"]);
  });

  it("removes a member that was", () => {
    expect([...toggledIn(new Set(["a", "b"]), "b")]).toStrictEqual(["a"]);
  });

  it("never mutates the set it was given", () => {
    // The whole reason this is a copy: React compares by identity, so a
    // version that mutated `prev` would leave the checkbox visually stuck
    // while the state underneath moved.
    const before = new Set(["a"]);
    const after = toggledIn(before, "b");

    expect(after).not.toBe(before);
    expect([...before]).toStrictEqual(["a"]);
  });

  it("round-trips: toggling the same member twice is the original", () => {
    const start = new Set(["a", "b"]);
    expect([...toggledIn(toggledIn(start, "b"), "b")]).toStrictEqual([
      "a",
      "b",
    ]);
  });
});
