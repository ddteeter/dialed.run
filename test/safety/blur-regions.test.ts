import { describe, expect, it } from "vitest";

import {
  blurSummary,
  clamped,
  DETECTION_PADDING,
  padded,
  TAP_SIZE_RATIO,
  tapRegion,
  toImageCoordinates,
} from "../../src/modules/safety/blur/regions";

describe("padding a detected box", () => {
  it("grows the box around its own centre", () => {
    const grown = padded({ x: 100, y: 100, width: 100, height: 100 }, 0.4);

    // Centred: a box that grew only right and down would slide off the
    // face it was meant to cover.
    expect(grown).toEqual({ x: 80, y: 80, width: 140, height: 140 });
  });

  it("covers more than the detector's crop", () => {
    // Detectors return a tight box around landmarks. Blurring exactly that
    // leaves hairline, ears and jaw legible — a recognisable person with a
    // smudged nose.
    expect(DETECTION_PADDING).toBeGreaterThan(0);
    const tight = { x: 0, y: 0, width: 100, height: 100 };
    expect(padded(tight).width).toBeGreaterThan(tight.width);
  });
});

describe("clamping to the image", () => {
  it("trims a region that hangs off the edge", () => {
    const shape = clamped({ x: -20, y: -10, width: 60, height: 60 }, 100, 100);
    expect(shape).toEqual({ x: 0, y: 0, width: 40, height: 50 });
  });

  it("gives back nothing for a region entirely outside", () => {
    // Not a zero-width box: a caller that drew one would blur nothing
    // while believing it had.
    expect(clamped({ x: 200, y: 0, width: 10, height: 10 }, 100, 100)).toBeUndefined();
    expect(clamped({ x: -50, y: 0, width: 10, height: 10 }, 100, 100)).toBeUndefined();
  });

  it("gives back nothing for a region with no height left", () => {
    // Overlaps horizontally but sits entirely above the image. The two
    // halves of the guard are separate facts, and a single-axis test
    // passes with either one missing.
    expect(clamped({ x: 10, y: -80, width: 40, height: 60 }, 100, 100)).toBeUndefined();
  });

  it("gives back nothing for a region with no width left", () => {
    expect(clamped({ x: -80, y: 10, width: 60, height: 40 }, 100, 100)).toBeUndefined();
  });

  it("gives back nothing for a region below or right of the image", () => {
    expect(clamped({ x: 10, y: 200, width: 10, height: 10 }, 100, 100)).toBeUndefined();
  });

  it("leaves a region already inside alone", () => {
    const inside = { x: 10, y: 10, width: 20, height: 20 };
    expect(clamped(inside, 100, 100)).toEqual(inside);
  });
});

describe("a tap", () => {
  it("makes a square centred on the point", () => {
    const region = tapRegion(50, 50, 200, 200);
    expect(region.width).toBe(region.height);
    expect(region.x + region.width / 2).toBeCloseTo(50);
    expect(region.y + region.height / 2).toBeCloseTo(50);
  });

  it("scales with the photo rather than being fixed in pixels", () => {
    // One tap should cover roughly a head whether the photo is 600px or
    // 4000px wide.
    const small = tapRegion(0, 0, 600, 600);
    const large = tapRegion(0, 0, 4000, 4000);
    expect(large.width).toBeGreaterThan(small.width);
    expect(small.width).toBeCloseTo(600 * TAP_SIZE_RATIO);
  });

  it("sizes from the short edge, so a panorama does not get a huge box", () => {
    const region = tapRegion(0, 0, 4000, 500);
    expect(region.width).toBeCloseTo(500 * TAP_SIZE_RATIO);
  });
});

describe("mapping a click back to the photo", () => {
  it("undoes the CSS scale", () => {
    // The canvas is displayed at 400px wide but the photo is 2000px, so a
    // tap 100px in is 500px into the image. Getting this wrong blurs the
    // wrong part and looks like a broken feature rather than a bug.
    const point = toImageCoordinates(
      140,
      60,
      { left: 40, top: 20, width: 400, height: 200 },
      2000,
      1000,
    );
    expect(point).toEqual({ x: 500, y: 200 });
  });

  it("survives an element that has not been laid out", () => {
    const point = toImageCoordinates(
      10,
      10,
      { left: 0, top: 0, width: 0, height: 0 },
      100,
      100,
    );
    // Finite and wrong beats Infinity and painting nothing anywhere.
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});

describe("the sentence above the photo", () => {
  it("uses the artboard's wording when nothing was found", () => {
    // "No face found", never "no face". The app does not claim certainty
    // it has not got.
    expect(blurSummary({ detector: "ran", detected: 0, tapped: 0 })).toBe(
      "No face found. Posting as-is.",
    );
  });

  it("reports what it blurred and invites a correction", () => {
    expect(blurSummary({ detector: "ran", detected: 1, tapped: 0 })).toBe(
      "We blurred one face. Missed something? Tap it to blur it too.",
    );
  });

  it("counts more than one", () => {
    expect(blurSummary({ detector: "ran", detected: 2, tapped: 0 })).toContain(
      "two faces",
    );
  });

  it("never claims a clean sweep it did not make", () => {
    const unavailable = blurSummary({
      detector: "unavailable",
      detected: 0,
      tapped: 0,
    });
    const looked = blurSummary({ detector: "ran", detected: 0, tapped: 0 });

    // The distinction the whole design rests on: "no face found" after
    // looking and after NOT looking are the same words describing very
    // different states, and only one of them is honest. A detector that
    // is absent must not borrow the sentence of one that ran.
    expect(unavailable).not.toBe(looked);
    expect(unavailable).not.toContain("No face found");
    expect(unavailable).toContain("couldn't check");
  });

  it("acknowledges the runner's own taps", () => {
    expect(
      blurSummary({ detector: "ran", detected: 0, tapped: 1 }),
    ).toContain("You blurred one spot");
    expect(
      blurSummary({ detector: "unavailable", detected: 0, tapped: 2 }),
    ).toContain("two spots");
  });

  it("keeps a tap distinct from a detection", () => {
    // "We blurred" is a claim about detection; a runner's own tap is not,
    // and crediting the model for it would overstate what it found.
    const both = blurSummary({ detector: "ran", detected: 1, tapped: 1 });
    expect(both).toContain("We blurred one face");
    expect(both).toContain("You blurred one more spot");
  });
});
