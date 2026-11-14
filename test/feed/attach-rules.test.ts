import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import type { AttachContext } from "../../src/modules/feed/attach-context";
import {
  kitChoice,
  orOnToVerdict,
  photosNotSent,
} from "../../src/modules/feed/attach-rules";
import { attachKitInput } from "../../src/modules/feed/inputs";

/**
 * A2's kit refusal, and where a kitted run goes instead. The photo
 * refusal is `lib/photo-constraints`' now: `test/lib/photo-problem.test.ts`.
 */

const ID = "01HQA00000000000000000000A";

describe("kitChoice", () => {
  it("refuses an empty kit, in round 20's words", () => {
    const result = kitChoice.safeParse([]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Pick at least one piece.");
  });

  it("takes one piece, and keeps the server's own rules for the rest", () => {
    expect(kitChoice.safeParse([ID]).success).toBe(true);
    // The id shape and the cap are `attachKitInput`'s, not restated.
    expect(kitChoice.safeParse(["not-an-id"]).success).toBe(false);
    // Forty is the server's cap; one over it fails both schemas alike.
    const overCap = Array.from({ length: 41 }, () => ID);
    expect(attachKitInput.shape.itemIds.safeParse(overCap).success).toBe(false);
    expect(kitChoice.safeParse(overCap).success).toBe(false);
  });
});

describe("photosNotSent", () => {
  it("says one photo in the singular", () => {
    expect(photosNotSent(1)).toBe(
      "The photo didn't upload. Your kit is attached — press Next to try again, or remove the photo to go on.",
    );
  });

  it("counts two or more, the owner's words", () => {
    expect(photosNotSent(2)).toBe(
      "2 photos didn't upload. Your kit is attached — press Next to try again, or remove them to go on.",
    );
    expect(photosNotSent(4)).toMatch(/^4 photos didn't upload\./u);
  });
});

function attachContext(entryId: string | undefined): AttachContext {
  return { distanceM: 5000, conditions: undefined, groups: [], entryId };
}

describe("orOnToVerdict", () => {
  it("hands back the context of a run with no kit yet", () => {
    const context = attachContext(undefined);
    expect(orOnToVerdict(context)).toBe(context);
  });

  it("sends a run that already has a kit on to A3 for its entry", () => {
    // A pick here would be dropped: `attachKit` never replaces a kit.
    let thrown: unknown;
    try {
      orOnToVerdict(attachContext("01ENTRY"));
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      options: { to: "/feed/verdict/$entryId", params: { entryId: "01ENTRY" } },
    });
  });
});
