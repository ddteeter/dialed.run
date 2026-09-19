import { describe, expect, it } from "vitest";

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
