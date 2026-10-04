import { describe, expect, it } from "vitest";

import {
  audienceOfShareToggle,
  audienceSchema,
  audiences,
  isSharedAudience,
  SHARED_AUDIENCE,
  writableAudienceSchema,
} from "../../src/lib/contracts";

/**
 * The audience contract (D-109, design 131), pinned against its own
 * schema so the helpers cannot drift from the list they describe.
 */

describe("audienceSchema", () => {
  it("is built from the tuple drizzle reads, in order", () => {
    expect(audienceSchema.options).toEqual(audiences);
    expect(audiences).toEqual(["private", "groups", "runners"]);
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
    expect(writableAudienceSchema.options).toEqual(["private", "runners"]);
    for (const audience of writableAudienceSchema.options) {
      expect(audiences).toContain(audience);
    }
  });

  it("refuses groups until groups ship", () => {
    expect(writableAudienceSchema.safeParse("groups").success).toBe(false);
    expect(writableAudienceSchema.parse("private")).toBe("private");
    expect(writableAudienceSchema.parse("runners")).toBe("runners");
  });
});

describe("the share toggle", () => {
  it("maps on to runners and off to private", () => {
    expect(audienceOfShareToggle(true)).toBe("runners");
    expect(audienceOfShareToggle(false)).toBe("private");
  });

  it("round-trips through isSharedAudience", () => {
    for (const isOn of [true, false]) {
      expect(isSharedAudience(audienceOfShareToggle(isOn))).toBe(isOn);
    }
  });

  it("is shared only for runners, of every stored audience", () => {
    const shared = audiences.filter((audience) => isSharedAudience(audience));
    expect(shared).toEqual(["runners"]);
  });

  it("is on for SHARED_AUDIENCE, the one audience strangers see", () => {
    expect(SHARED_AUDIENCE).toBe("runners");
    expect(audienceOfShareToggle(true)).toBe(SHARED_AUDIENCE);
  });

  it("only ever produces a writable audience", () => {
    for (const isOn of [true, false]) {
      expect(
        writableAudienceSchema.safeParse(audienceOfShareToggle(isOn)).success,
      ).toBe(true);
    }
  });
});
