import { describe, expect, it, vi } from "vitest";

import { PIXEL_BLOCKS, paintOnto } from "../../src/modules/safety/blur/paint";
import {
  DETECTION_PADDING,
  type BlurRegion,
} from "../../src/modules/safety/blur/regions";

/**
 * What the painter decides, against a fake context.
 *
 * jsdom's `getContext("2d")` is null and the workers pool has no canvas
 * at all, so a real one is out of reach in both projects. A context is an
 * interface though, and every decision worth testing — how many draws,
 * over what rectangles, in what order, with smoothing off — is visible in
 * the calls made against it.
 */

type Call = readonly unknown[];

function fakeContext() {
  const smoothingDuringDraws: boolean[] = [];
  const context = {
    drawImage: vi.fn<(...args: readonly unknown[]) => void>(() => {
      // Captured AT draw time. Reading it afterwards only shows the
      // restore, which is a different fact from whether the upscale was
      // interpolated.
      smoothingDuringDraws.push(context.imageSmoothingEnabled);
    }),
    canvas: {} as HTMLCanvasElement,
    imageSmoothingEnabled: true,
  };
  return { context, drawImage: context.drawImage, smoothingDuringDraws };
}

const IMAGE = {} as CanvasImageSource;

function detected(over: Partial<BlurRegion> = {}): BlurRegion {
  return {
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    source: "detected",
    ...over,
  };
}
function tapped(over: Partial<BlurRegion> = {}): BlurRegion {
  return { x: 100, y: 100, width: 100, height: 100, source: "tapped", ...over };
}

/**
The x/y/w/h a `drawImage` read its source from.
*/
function sourceRect(call: Call): number[] {
  return call.slice(1, 5) as number[];
}

describe("painting the photo", () => {
  it("draws the whole image first, at its own size", () => {
    const { context, drawImage } = fakeContext();

    paintOnto(context, IMAGE, 800, 600, []);

    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(IMAGE, 0, 0, 800, 600);
  });

  it("leaves a photo with nothing to blur untouched beyond that", () => {
    const { context, drawImage } = fakeContext();
    paintOnto(context, IMAGE, 800, 600, []);
    // One call: the photo. No region means no pixelation passes.
    expect(drawImage).toHaveBeenCalledTimes(1);
  });
});

describe("blurring a region", () => {
  it("takes two more draws per region — down, then up", () => {
    const { context, drawImage } = fakeContext();
    paintOnto(context, IMAGE, 1000, 1000, [tapped()]);
    expect(drawImage).toHaveBeenCalledTimes(3);
  });

  it("destroys the pixels rather than softening them", () => {
    const { context, drawImage } = fakeContext();

    paintOnto(context, IMAGE, 1000, 1000, [tapped()]);

    // The downscale target is PIXEL_BLOCKS wide. That is the whole
    // security argument: a gaussian blur is a small reversible-ish kernel
    // and deblurring is a known attack, while information thrown away by
    // downsampling cannot be recovered from the file a stranger
    // downloads.
    const down = drawImage.mock.calls[1] ?? [];
    expect(down[7]).toBe(PIXEL_BLOCKS);
  });

  it("turns smoothing off for the blur passes and puts it back", () => {
    const { context, smoothingDuringDraws } = fakeContext();
    context.imageSmoothingEnabled = true;

    paintOnto(context, IMAGE, 1000, 1000, [tapped()]);

    // With smoothing ON the upscale interpolates and reintroduces a
    // plausible face, so it must be off for BOTH blur passes — asserting
    // only the restored value would pass with the flag never set.
    expect(smoothingDuringDraws.slice(1)).toEqual([false, false]);
    // And restored, so the painter does not change state its caller did
    // not ask it to change.
    expect(context.imageSmoothingEnabled).toBe(true);
  });

  it("keeps a region's aspect ratio when it downsamples", () => {
    const { context, drawImage } = fakeContext();

    // Twice as tall as it is wide. A square downsample target would
    // squash the blur and, on the way back up, smear it outside the
    // region it was meant to cover.
    paintOnto(context, IMAGE, 1000, 1000, [
      tapped({ width: 100, height: 200 }),
    ]);

    const down = drawImage.mock.calls[1] ?? [];
    expect(down[7]).toBe(PIXEL_BLOCKS);
    expect(down[8]).toBe(PIXEL_BLOCKS * 2);
  });

  it("never downsamples to less than one pixel", () => {
    const { context, drawImage } = fakeContext();

    // A very wide, very short region: the height ratio rounds toward
    // zero, and a zero-height draw paints nothing at all.
    paintOnto(context, IMAGE, 1000, 1000, [
      tapped({ x: 0, y: 0, width: 900, height: 1 }),
    ]);

    const down = drawImage.mock.calls[1] ?? [];
    expect(down[8]).toBeGreaterThanOrEqual(1);
  });

  it("blurs each region, so two taps are two blurs", () => {
    const { context, drawImage } = fakeContext();
    paintOnto(context, IMAGE, 1000, 1000, [tapped(), tapped({ x: 500 })]);
    expect(drawImage).toHaveBeenCalledTimes(5);
  });
});

describe("what gets padded", () => {
  it("grows a detected box beyond the detector's crop", () => {
    const { context, drawImage } = fakeContext();

    paintOnto(context, IMAGE, 1000, 1000, [detected()]);

    // Detectors return a tight box around landmarks; blurring exactly
    // that leaves hairline, ears and jaw legible.
    const width = sourceRect(drawImage.mock.calls[1] ?? [])[3];
    expect(width).toBeCloseTo(100 * (1 + DETECTION_PADDING));
  });

  it("does not grow a tap", () => {
    const { context, drawImage } = fakeContext();

    paintOnto(context, IMAGE, 1000, 1000, [tapped()]);

    // A runner tapping has already chosen the spot; growing it would move
    // the blur away from where they pointed.
    const width = sourceRect(drawImage.mock.calls[1] ?? [])[3];
    expect(width).toBe(100);
  });
});

describe("regions at the edge of the photo", () => {
  it("trims one that hangs off", () => {
    const { context, drawImage } = fakeContext();

    paintOnto(context, IMAGE, 1000, 1000, [tapped({ x: -50, y: -50 })]);

    const [x, y, width] = sourceRect(drawImage.mock.calls[1] ?? []);
    // Clamped to the image, or the canvas is asked to read pixels that do
    // not exist.
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(width).toBe(50);
  });

  it("skips one entirely outside, rather than drawing a zero-width box", () => {
    const { context, drawImage } = fakeContext();

    paintOnto(context, IMAGE, 1000, 1000, [tapped({ x: 5000 })]);

    // Only the photo. A zero-width draw would blur nothing while the
    // caller believed a region had been covered.
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it("still blurs the others when one is out of bounds", () => {
    const { context, drawImage } = fakeContext();
    paintOnto(context, IMAGE, 1000, 1000, [tapped({ x: 5000 }), tapped()]);
    expect(drawImage).toHaveBeenCalledTimes(3);
  });
});
