import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import type { AttachContext } from "../../src/modules/feed/attach-context";
import {
  kitChoice,
  orOnToVerdict,
  photoProblem,
} from "../../src/modules/feed/attach-rules";
import { attachKitInput } from "../../src/modules/feed/inputs";

/**
 * A2's two refusals: a kit with nothing in it, and a photo the upload
 * route would turn away.
 */

const ID = "01HQA00000000000000000000A";
const CAP = 10 * 1024 * 1024;

function photo(bytes: number, type: string): File {
  const body = new Uint8Array(bytes);
  return new File([body], "photo", { type });
}

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

describe("photoProblem", () => {
  it("passes a photo of an accepted type under the cap", () => {
    expect(photoProblem(photo(10, "image/jpeg"))).toBeUndefined();
  });

  it("names the accepted types for one it does not take", () => {
    expect(photoProblem(photo(1, "image/heic"))).toBe(
      "Photos must be JPG, PNG or WebP.",
    );
  });

  it("names the cap for one that is over it, and takes one exactly at it", () => {
    expect(photoProblem(photo(CAP + 1, "image/png"))).toBe(
      "That photo is over 10 MB. Pick a smaller one.",
    );
    expect(photoProblem(photo(CAP, "image/png"))).toBeUndefined();
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
