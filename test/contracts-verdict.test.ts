import { describe, expect, it } from "vitest";

import {
  verdictLabel,
  verdictScale,
  verdictSchema,
} from "../src/lib/contracts";
import {
  allowedPhotoTypes,
  isAllowedPhotoType,
  maxPhotoBytes,
  maxPhotosPerEntry,
  photoAcceptAttribute,
} from "../src/lib/photo-constraints";

describe("the verdict scale", () => {
  /**
   * Verdicts are stored as an integer −2..+2 with 0 = dialed (CLAUDE.md,
   * docs/contracts.md). The scale is the only place that fact is written
   * down now, so it is the place to assert it.
   */
  it("covers exactly the range the schema accepts, in cold-to-warm order", () => {
    expect(verdictScale.map((entry) => entry.value)).toEqual([-2, -1, 0, 1, 2]);
    for (const entry of verdictScale) {
      expect(verdictSchema.safeParse(entry.value).success).toBe(true);
    }
    expect(verdictSchema.safeParse(3).success).toBe(false);
    expect(verdictSchema.safeParse(-3).success).toBe(false);
    expect(verdictSchema.safeParse(0.5).success).toBe(false);
  });

  it("keeps 0 as dialed — the product's fixed point", () => {
    expect(verdictLabel(0)).toBe("Dialed");
    expect(verdictScale.find((entry) => entry.value === 0)?.token).toBe(
      "dialed",
    );
  });

  it("has a distinct token and label for every step", () => {
    const tokens = new Set(verdictScale.map((entry) => entry.token));
    const labels = new Set(verdictScale.map((entry) => entry.label));
    expect(tokens.size).toBe(verdictScale.length);
    expect(labels.size).toBe(verdictScale.length);
  });

  it("returns undefined outside the range rather than a wrong label", () => {
    expect(verdictLabel(3)).toBeUndefined();
    expect(verdictLabel(-3)).toBeUndefined();
  });
});

describe("photo constraints", () => {
  it("accepts the three types the resizer can decode, and nothing else", () => {
    for (const type of allowedPhotoTypes) {
      expect(isAllowedPhotoType(type)).toBe(true);
    }
    expect(isAllowedPhotoType("image/heic")).toBe(false);
    expect(isAllowedPhotoType("image/gif")).toBe(false);
    expect(isAllowedPhotoType("application/pdf")).toBe(false);
    expect(isAllowedPhotoType("")).toBe(false);
  });

  it("offers the same list to an <input accept>", () => {
    expect(photoAcceptAttribute.split(",")).toEqual([...allowedPhotoTypes]);
  });

  it("states the limits the server enforces", () => {
    expect(maxPhotoBytes).toBe(10 * 1024 * 1024);
    expect(maxPhotosPerEntry).toBe(4);
  });
});
