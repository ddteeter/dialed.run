import { describe, expect, it } from "vitest";

import * as copy from "../../src/lib/copy";

/**
 * Not a test that each string equals itself — that would restate the
 * constant and catch nothing.
 *
 * What is worth pinning is the **copy rules** from `product.md` §Forms &
 * failure, which are binding and easy to break without noticing. They apply
 * to every user-facing sentence, so this iterates the module rather than
 * naming its exports: a constant added later is covered the day it lands.
 */

const BANNED = /\b(please|invalid|error|oops)\b/i;

describe("shared user-facing copy", () => {
  const entries: [string, string][] = Object.entries(copy).flatMap(
    ([name, value]) => (typeof value === "string" ? [[name, value]] : []),
  );

  it("has something to check", () => {
    // Guards the loops below: if the module ever exports nothing that is a
    // string, every `it.each` under it passes vacuously.
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s is one short sentence", (_name, text) => {
    expect(text.length).toBeGreaterThan(0);
    expect(text.split(" ").length).toBeLessThan(10);
  });

  it.each(entries)("%s is sentence case and ends in a period", (_name, text) => {
    expect(text).toMatch(/[.?]$/);
    expect(text).not.toMatch(/!/);
    expect(text[0]).toBe(text[0]?.toUpperCase());
  });

  it.each(entries)("%s avoids the banned words", (_name, text) => {
    // "please", "invalid", "error", "oops" — and never "like", which is
    // "useful" in this product's lexicon.
    expect(text).not.toMatch(BANNED);
    expect(text).not.toMatch(/\blike\b/i);
  });
});
