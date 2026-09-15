import { createCanvas } from "canvas";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  blurredFile,
  paintBlurred,
} from "../../src/modules/safety/blur/paint";
import type { BlurRegion } from "../../src/modules/safety/blur/regions";

/**
 * The half of the painter that needs a real canvas.
 *
 * `paintOnto` is covered against a fake context in the workers pool; this
 * covers the three lines `paintBlurred` adds on top — sizing the element
 * and getting a context — plus `blurredFile`, which turns the result into
 * the bytes that actually get uploaded. `test/dom-setup.ts` gives
 * happy-dom a node-canvas context so these can look at pixels rather than
 * at calls.
 */

/**
 * A source image with a hard-edged black square in a known place.
 *
 * Returned as a real `ImageBitmap` — which IS a `CanvasImageSource` — via
 * the `createImageBitmap` that `test/dom-setup.ts` provides. An earlier
 * version handed back a node-canvas Canvas and cast it, which is the
 * structural cast at a boundary CLAUDE.md forbids; going through the same
 * decode the production path uses is both honest and closer to what a
 * picked photo actually is.
 */
async function sourceImage(width: number, height: number): Promise<ImageBitmap> {
  const source = createCanvas(width, height);
  const context = source.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#000000";
  context.fillRect(20, 20, 40, 40);
  const bytes = Uint8Array.from(source.toBuffer("image/png"));
  return createImageBitmap(new Blob([bytes], { type: "image/png" }));
}

/**
The pixel at a point, as `r,g,b`.
*/
function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): string {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no context");
  const [r, g, b] = context.getImageData(x, y, 1, 1).data;
  return `${String(r)},${String(g)},${String(b)}`;
}

function tapped(over: Partial<BlurRegion> = {}): BlurRegion {
  return { x: 20, y: 20, width: 40, height: 40, source: "tapped", ...over };
}

describe("painting onto a real canvas", () => {
  it("sizes the canvas to the image", async () => {
    const canvas = document.createElement("canvas");

    paintBlurred(canvas, await sourceImage(120, 80), 120, 80, []);

    // Not the element's default 300x150: a canvas left at its default
    // would letterbox or crop every photo in the app.
    expect(canvas.width).toBe(120);
    expect(canvas.height).toBe(80);
  });

  it("draws the photo through when there is nothing to blur", async () => {
    const canvas = document.createElement("canvas");

    paintBlurred(canvas, await sourceImage(100, 100), 100, 100, []);

    // The black square is still black and the background still white.
    expect(pixelAt(canvas, 40, 40)).toBe("0,0,0");
    expect(pixelAt(canvas, 5, 5)).toBe("255,255,255");
  });

  it("destroys detail inside a blurred region", async () => {
    const canvas = document.createElement("canvas");

    // Two points either side of the square's hard edge. In the source
    // they are white and black; blurring must make them the same, because
    // "detail destroyed" IS neighbouring pixels becoming indistinguishable.
    const outside = { x: 18, y: 18 };
    const inside = { x: 24, y: 24 };

    paintBlurred(
      canvas,
      await sourceImage(100, 100),
      100,
      100,
      [tapped({ x: 0, y: 0, width: 100, height: 100 })],
    );

    // Downscaling with smoothing off is nearest-neighbour SAMPLING rather
    // than averaging, so a block takes one source pixel's colour — which
    // is what makes the information unrecoverable rather than merely
    // softened.
    expect(pixelAt(canvas, outside.x, outside.y)).toBe(
      pixelAt(canvas, inside.x, inside.y),
    );
  });

  it("left those two pixels different before the blur", async () => {
    const canvas = document.createElement("canvas");

    paintBlurred(canvas, await sourceImage(100, 100), 100, 100, []);

    // The other half of the assertion above: without it, a painter that
    // drew nothing at all would pass.
    expect(pixelAt(canvas, 18, 18)).not.toBe(pixelAt(canvas, 24, 24));
  });

  it("leaves pixels outside the region alone", async () => {
    const canvas = document.createElement("canvas");

    paintBlurred(
      canvas,
      await sourceImage(100, 100),
      100,
      100,
      [tapped()],
    );

    // A blur that bled across the whole photo would pass a "something
    // changed" test while ruining every image.
    expect(pixelAt(canvas, 90, 90)).toBe("255,255,255");
  });
});

describe("turning the canvas into bytes", () => {
  it("produces a jpeg file under the original name", async () => {
    const canvas = document.createElement("canvas");
    paintBlurred(canvas, await sourceImage(60, 60), 60, 60, []);

    const file = await blurredFile(canvas, "run.jpg");

    expect(file?.name).toBe("run.jpg");
    expect(file?.type).toBe("image/jpeg");
    expect(file?.size).toBeGreaterThan(0);
  });

  it("gives back nothing rather than the original when the canvas cannot", async () => {
    // A canvas whose toBlob hands back nothing. The caller must not fall
    // back to the source bytes — that would upload exactly the frame this
    // screen promises never leaves the device.
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "toBlob", {
      configurable: true,
      value: (callback: (blob: Blob | null) => void) => {
        callback(z.null().parse(JSON.parse("null")));
      },
    });

    expect(await blurredFile(canvas, "run.jpg")).toBeUndefined();
  });
});
