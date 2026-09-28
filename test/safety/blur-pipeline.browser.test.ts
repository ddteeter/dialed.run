import { describe, expect, it, vi } from "vitest";

import { browserPipeline } from "../../src/modules/safety/blur/pipeline";

/**
 * The production pipeline, exercised rather than asserted about.
 *
 * It is four lines of wiring — decode, detect, paint, encode — but the
 * wiring is the part that decides which implementation each caller gets,
 * and a mis-wired `detect` would silently mean no photo is ever checked.
 *
 * **In the browser project rather than happy-dom, and that was a real
 * failure rather than a preference.** Run under happy-dom, `detect`
 * reached the actual MediaPipe loader, happy-dom refused the fetch
 * ("JavaScript file loading is disabled"), and the DOMException escaped
 * as an uncaught error — every test passed and vitest still exited 1.
 * Here the model loads, so the honest answer is `ran` rather than
 * `unavailable`, and the canvas work runs on a real canvas instead of a
 * node-canvas stand-in.
 */

/**
A small picked photo, drawn rather than read off disk.
*/
async function pickedFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 40;
  canvas.height = 30;
  const ink = canvas.getContext("2d");
  if (!ink) throw new Error("no 2d context");
  ink.fillStyle = "#123456";
  ink.fillRect(0, 0, 40, 30);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("the canvas produced no bytes");
  return new File([blob], "run.png", { type: "image/png" });
}

describe("loading a picked file", () => {
  it("reports the image's own dimensions", async () => {
    const loaded = await browserPipeline.load(await pickedFile());

    // The canvas is sized from these, so a wrong answer letterboxes or
    // crops every photo in the app.
    expect(loaded.width).toBe(40);
    expect(loaded.height).toBe(30);
  });
});

describe("what the pipeline is wired to", () => {
  it("uses the real detector, paint and encoder", async () => {
    // Not identity checks against the imports — those would pass with the
    // wiring crossed. Each is exercised for the behaviour it owns.
    const canvas = document.createElement("canvas");
    const loaded = await browserPipeline.load(await pickedFile());

    const outcome = await browserPipeline.detect(loaded.image);
    // `ran`, because the model is really here. A flat blue rectangle has
    // no face in it, so the list is empty — which is the answer that
    // proves the detector looked, rather than that nothing looked.
    expect(outcome).toEqual({ status: "ran", faces: [] });

    browserPipeline.paint(
      canvas,
      loaded.image,
      loaded.width,
      loaded.height,
      [],
    );
    expect(canvas.width).toBe(40);

    const file = await browserPipeline.toFile(canvas, "out.jpg");
    expect(file?.name).toBe("out.jpg");
    expect(file?.size).toBeGreaterThan(0);
  });
});

/**
A picked photo of this size, drawn rather than read off disk.
*/
async function sizedFile(width: number, height: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ink = canvas.getContext("2d");
  if (!ink) throw new Error("no 2d context");
  ink.fillStyle = "#654321";
  ink.fillRect(0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("the canvas produced no bytes");
  return new File([blob], "big.png", { type: "image/png" });
}

describe("closing the intermediate decode", () => {
  it("closes the full-size bitmap once the resized one is made, and only that one", async () => {
    // `load` decodes twice — once at the picked file's own size, once at
    // the resize target — and only the first is an intermediate this
    // module owns; leaving it open is a real leak on every photo picked.
    const closeSpy = vi.spyOn(ImageBitmap.prototype, "close");

    const loaded = await browserPipeline.load(await sizedFile(4096, 3072));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(loaded.image.width).toBe(2048);
    closeSpy.mockRestore();
  });
});

describe("the long edge (task 128 · SAF-2)", () => {
  it("scales a large photo down to a 2048px long edge before anything else", async () => {
    const loaded = await browserPipeline.load(await sizedFile(4096, 3072));
    expect(loaded.width).toBe(2048);
    expect(loaded.height).toBe(1536);
    // The bitmap itself is the scaled one, not only the numbers.
    expect(loaded.image.width).toBe(2048);
    expect(loaded.image.height).toBe(1536);
  });

  it("scales a tall photo by its height", async () => {
    const loaded = await browserPipeline.load(await sizedFile(1000, 4000));
    expect(loaded.width).toBe(512);
    expect(loaded.height).toBe(2048);
  });

  it("never scales a small photo up", async () => {
    const loaded = await browserPipeline.load(await sizedFile(300, 200));
    expect(loaded.image.width).toBe(300);
    expect(loaded.image.height).toBe(200);
  });
});
