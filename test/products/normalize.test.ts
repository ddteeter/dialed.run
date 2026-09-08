import { describe, expect, it } from "vitest";

import { normalizeIdentity } from "../../src/lib/normalize";

describe("normalizeIdentity", () => {
  it("casefolds and strips punctuation/whitespace runs", () => {
    expect(normalizeIdentity("Ciele Athletics™")).toBe("ciele athletics");
    expect(normalizeIdentity("ciele  athletics")).toBe("ciele athletics");
  });

  it("strips diacritics", () => {
    expect(normalizeIdentity("Björn Borg")).toBe("bjorn borg");
  });

  it("collapses mixed punctuation to single spaces and trims", () => {
    expect(normalizeIdentity("  On-Running!!  ")).toBe("on running");
  });

  it("dedup collisions land on the same normalized key", () => {
    const variants = ["Janji", " janji ", "JANJI", "Janji™"];
    const normalized = new Set(variants.map((value) => normalizeIdentity(value)));
    expect(normalized.size).toBe(1);
  });

  it("returns empty string for input with no letters or digits", () => {
    expect(normalizeIdentity("!!!")).toBe("");
  });
});
