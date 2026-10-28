import { describe, expect, it } from "vitest";

import {
  audienceSchema,
  audienceWord,
  audiences,
  isStrangerAudience,
  SHARED_AUDIENCE,
  strangerAudiences,
  WORLD_AUDIENCE,
  writableAudienceOf,
  writableAudienceSchema,
} from "../../src/lib/contracts";

/**
 * The audience contract (D-109, design 131), pinned against its own
 * schema so the helpers cannot drift from the list they describe.
 */

describe("audienceSchema", () => {
  it("is built from the tuple drizzle reads, in order", () => {
    expect(audienceSchema.options).toEqual(audiences);
    expect(audiences).toEqual(["private", "groups", "runners", "world"]);
  });

  it("parses every stored audience and nothing else", () => {
    for (const audience of audiences) {
      expect(audienceSchema.parse(audience)).toBe(audience);
    }
    expect(audienceSchema.safeParse("public").success).toBe(false);
    expect(audienceSchema.safeParse(true).success).toBe(false);
  });
});

describe("writableAudienceSchema", () => {
  it("is the launch subset of the stored audiences", () => {
    expect(writableAudienceSchema.options).toEqual([
      "private",
      "runners",
      "world",
    ]);
    for (const audience of writableAudienceSchema.options) {
      expect(audiences).toContain(audience);
    }
  });

  it("refuses groups until groups ship", () => {
    expect(writableAudienceSchema.safeParse("groups").success).toBe(false);
    expect(writableAudienceSchema.parse("private")).toBe("private");
    expect(writableAudienceSchema.parse("runners")).toBe("runners");
    expect(writableAudienceSchema.parse("world")).toBe("world");
  });
});

describe("the stranger audiences (D-149)", () => {
  it("are SHARED and PUBLIC, both writable", () => {
    expect(strangerAudiences).toEqual(["runners", "world"]);
    expect(WORLD_AUDIENCE).toBe("world");
    for (const audience of strangerAudiences) {
      expect(writableAudienceSchema.safeParse(audience).success).toBe(true);
    }
  });

  it("are exactly what isStrangerAudience admits, of every stored audience", () => {
    expect(
      audiences.filter((audience) => isStrangerAudience(audience)),
    ).toEqual(["runners", "world"]);
  });
});

describe("writableAudienceOf", () => {
  it("keeps every writable audience and stores groups as private", () => {
    expect(writableAudienceOf("private")).toBe("private");
    expect(writableAudienceOf("runners")).toBe("runners");
    expect(writableAudienceOf("world")).toBe("world");
    expect(writableAudienceOf("groups")).toBe("private");
  });
});

describe("SHARED_AUDIENCE", () => {
  it("is runners, SHARED on screen", () => {
    expect(SHARED_AUDIENCE).toBe("runners");
  });
});

describe("audienceWord", () => {
  it("gives every stored audience exactly one word, and no two the same", () => {
    expect(
      Object.keys(audienceWord).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual([...audiences].toSorted((a, b) => a.localeCompare(b)));
    const words = audiences.map((audience) => audienceWord[audience]);
    expect(new Set(words).size).toBe(audiences.length);
  });

  it("writes the UI's words, so runners never leaves the server", () => {
    expect(audienceWord).toEqual({
      private: "private",
      groups: "groups",
      runners: "shared",
      world: "public",
    });
    expect(audienceWord[SHARED_AUDIENCE]).toBe("shared");
    expect(Object.values(audienceWord)).not.toContain("runners");
  });
});
