import { describe, expect, it } from "vitest";

import {
  afterCell,
  afterTap,
  BLUR_CELLS,
  BLUR_OFF_LINE,
  cellRegion,
  isCellBlurred,
  blurSummary,
  type BlurRegion,
  clamped,
  detectedRegions,
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
    expect(
      clamped({ x: 200, y: 0, width: 10, height: 10 }, 100, 100),
    ).toBeUndefined();
    expect(
      clamped({ x: -50, y: 0, width: 10, height: 10 }, 100, 100),
    ).toBeUndefined();
  });

  it("gives back nothing for a region with no height left", () => {
    // Overlaps horizontally but sits entirely above the image. The two
    // halves of the guard are separate facts, and a single-axis test
    // passes with either one missing.
    expect(
      clamped({ x: 10, y: -80, width: 40, height: 60 }, 100, 100),
    ).toBeUndefined();
  });

  it("gives back nothing for a region with no width left", () => {
    expect(
      clamped({ x: -80, y: 10, width: 60, height: 40 }, 100, 100),
    ).toBeUndefined();
  });

  it("gives back nothing for a region below or right of the image", () => {
    expect(
      clamped({ x: 10, y: 200, width: 10, height: 10 }, 100, 100),
    ).toBeUndefined();
  });

  it.each([
    ["zero width", { x: 50, y: 10, width: 0, height: 20 }],
    ["zero height", { x: 10, y: 50, width: 20, height: 0 }],
    [
      "a right edge exactly on the left one",
      { x: 100, y: 10, width: 10, height: 10 },
    ],
    [
      "a bottom edge exactly on the top one",
      { x: 10, y: 100, width: 10, height: 10 },
    ],
  ])("gives back nothing for a region with %s", (_label, region) => {
    // The comparison is `<=`, not `<`. A region whose edges coincide has
    // no area, and returning it would ask the canvas to blur a rectangle
    // of zero pixels while the caller believed a face was covered.
    expect(clamped(region, 100, 100)).toBeUndefined();
  });

  it("keeps a region one pixel wide, which does have area", () => {
    expect(clamped({ x: 99, y: 10, width: 1, height: 20 }, 100, 100)).toEqual({
      x: 99,
      y: 10,
      width: 1,
      height: 20,
    });
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
    // Round 28 #5: "found nothing", never "no faces". The app does not
    // claim certainty it has not got.
    expect(blurSummary({ detector: "ran", detected: 0, tapped: 0 })).toBe(
      "Auto-blur found nothing to cover. Tap the photo or a cell to blur an area.",
    );
  });

  it("reports what it blurred and invites a correction", () => {
    expect(blurSummary({ detector: "ran", detected: 1, tapped: 0 })).toBe(
      "Auto-blur covered 1 area. Tap the photo or a cell to change it.",
    );
  });

  it.each([
    [1, "1 area."],
    [2, "2 areas."],
    [5, "5 areas."],
    [6, "6 areas."],
  ])("writes %i in digits, always (round 26 #18)", (detected, expected) => {
    expect(blurSummary({ detector: "ran", detected, tapped: 0 })).toContain(
      `Auto-blur covered ${expected}`,
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
    expect(unavailable).not.toContain("found nothing");
    expect(unavailable).toContain("couldn't check");
  });

  it("gives the line to the runner once they have tapped (round 22, item 22)", () => {
    // Whether the detector found nothing or never ran, in Auto-blur's
    // grammar (round 35 #51c): with no claim before it, the count names
    // its noun.
    expect(blurSummary({ detector: "ran", detected: 0, tapped: 1 })).toBe(
      "You covered 1 area. Tap one to undo.",
    );
    expect(
      blurSummary({ detector: "unavailable", detected: 0, tapped: 2 }),
    ).toBe("You covered 2 areas. Tap one to undo.");
  });

  it("keeps a tap distinct from a detection", () => {
    // "Auto-blur covered" is a claim about detection; a runner's own tap
    // is not, and crediting the model for it would overstate what it
    // found. Round 35 #51c's words.
    expect(blurSummary({ detector: "ran", detected: 2, tapped: 1 })).toBe(
      "Auto-blur covered 2 areas. You covered 1 more. Tap one to undo.",
    );
    expect(blurSummary({ detector: "ran", detected: 1, tapped: 3 })).toBe(
      "Auto-blur covered 1 area. You covered 3 more. Tap one to undo.",
    );
  });

  it("says each resting outcome in its own words", () => {
    expect(blurSummary({ detector: "ran", detected: 1, tapped: 0 })).toBe(
      "Auto-blur covered 1 area. Tap the photo or a cell to change it.",
    );
    expect(blurSummary({ detector: "ran", detected: 0, tapped: 0 })).toBe(
      "Auto-blur found nothing to cover. Tap the photo or a cell to blur an area.",
    );
    expect(
      blurSummary({ detector: "unavailable", detected: 0, tapped: 0 }),
    ).toBe(
      "Auto-blur couldn't check this photo. Tap anything you want covered.",
    );
  });

  it("says what blur off means, without a warning", () => {
    expect(BLUR_OFF_LINE).toBe(
      "Faces won't be blurred. Anyone in this photo can be recognised.",
    );
  });
});

describe("a tap on the photo", () => {
  const face: BlurRegion = {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    source: "detected",
  };

  it("adds a spot centred on the tap", () => {
    // 1000x500: a tenth of the short edge is a 50px square.
    expect(afterTap([], 300, 200, 1000, 500)).toEqual([
      { x: 275, y: 175, width: 50, height: 50, source: "tapped" },
    ]);
  });

  it("undoes a spot the runner put there, by tapping inside it", () => {
    const once = afterTap([face], 300, 200, 1000, 500);
    // Each edge of the spot counts as inside it.
    for (const [x, y] of [
      [300, 200],
      [275, 175],
      [325, 225],
    ] as const) {
      expect([x, y, afterTap(once, x, y, 1000, 500)]).toEqual([x, y, [face]]);
    }
  });

  it("adds a spot rather than undoing when the tap misses every spot", () => {
    const once = afterTap([], 300, 200, 1000, 500);
    for (const [x, y] of [
      [274, 200],
      [326, 200],
      [300, 174],
      [300, 226],
    ] as const) {
      expect([x, y, afterTap(once, x, y, 1000, 500)]).toHaveProperty(
        [2, "length"],
        2,
      );
    }
  });

  it("never undoes a detected face — that is the toggle's job", () => {
    const tapped = afterTap([face], 50, 50, 1000, 500);
    expect(tapped).toHaveLength(2);
    expect(tapped[0]).toBe(face);
    expect(tapped[1]).toMatchObject({ source: "tapped", x: 25, y: 25 });
  });

  it("undoes the latest of two overlapping spots, and only that one", () => {
    const first = afterTap([], 300, 200, 1000, 500);
    const both = afterTap(first, 330, 200, 1000, 500);
    // (310, 200) is inside both; the undo takes the newer.
    expect(afterTap(both, 310, 200, 1000, 500)).toEqual(first);
  });
});

describe("the detector's answer as regions", () => {
  it("marks what the model found as detected", () => {
    expect(
      detectedRegions({
        status: "ran",
        faces: [{ x: 1, y: 2, width: 3, height: 4 }],
      }),
    ).toEqual([{ x: 1, y: 2, width: 3, height: 4, source: "detected" }]);
  });

  it("gives back nothing when there was no detector", () => {
    // The branch that used to live inside a React effect, where reading
    // `faces` off an unavailable outcome threw and the runner lost the
    // screen. Here it is simply the empty list, and the wrong answer is
    // a failing assertion rather than a crash.
    expect(detectedRegions({ status: "unavailable" })).toEqual([]);
  });

  it("gives back nothing when the detector ran and found none", () => {
    expect(detectedRegions({ status: "ran", faces: [] })).toEqual([]);
  });
});

describe("the keyboard's cells (R-84(b))", () => {
  it("names nine cells by position, in reading order", () => {
    expect(BLUR_CELLS).toStrictEqual([
      "top-left",
      "top",
      "top-right",
      "left",
      "middle",
      "right",
      "bottom-left",
      "bottom",
      "bottom-right",
    ]);
  });

  it("gives each cell a third of the photo each way", () => {
    expect(cellRegion(0, 300, 600)).toStrictEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 200,
    });
    expect(cellRegion(5, 300, 600)).toStrictEqual({
      x: 200,
      y: 200,
      width: 100,
      height: 200,
    });
    expect(cellRegion(7, 300, 600)).toStrictEqual({
      x: 100,
      y: 400,
      width: 100,
      height: 200,
    });
  });

  it("blurs a whole cell as the runner's own, and undoes it pressed again", () => {
    const once = afterCell([], 4, 300, 300);
    expect(once).toStrictEqual([
      { x: 100, y: 100, width: 100, height: 100, source: "tapped" },
    ]);
    expect(isCellBlurred(once, 4, 300, 300)).toBe(true);
    expect(isCellBlurred(once, 3, 300, 300)).toBe(false);
    expect(afterCell(once, 4, 300, 300)).toStrictEqual([]);
  });

  it("leaves detected faces and taps alone when a cell is undone", () => {
    const face: BlurRegion = {
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      source: "detected",
    };
    const tap: BlurRegion = {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      source: "tapped",
    };
    // A detected box the size of the cell is not the runner's cell.
    expect(isCellBlurred([face], 4, 300, 300)).toBe(false);
    const pressed = afterCell([face, tap], 4, 300, 300);
    expect(pressed).toHaveLength(3);
    expect(afterCell(pressed, 4, 300, 300)).toStrictEqual([face, tap]);
  });

  it("matches a cell only on all four edges", () => {
    const cell = cellRegion(0, 300, 300);
    for (const off of [
      { ...cell, x: 1 },
      { ...cell, y: 1 },
      { ...cell, width: 99 },
      { ...cell, height: 99 },
    ]) {
      expect(isCellBlurred([{ ...off, source: "tapped" }], 0, 300, 300)).toBe(
        false,
      );
    }
  });
});
