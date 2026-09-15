import { createCanvas } from "canvas";
import { describe, expect, it } from "vitest";

import { browserPipeline } from "../../src/modules/safety/blur/pipeline";

/**
 * The production pipeline, exercised rather than asserted about.
 *
 * It is four lines of wiring — decode, detect, paint, encode — but the
 * wiring is the part that decides which implementation each caller gets,
 * and a mis-wired `detect` would silently mean no photo is ever checked.
 */

function jpegFile(): File {
  const canvas = createCanvas(40, 30);
  const context = canvas.getContext("2d");
  context.fillStyle = "#123456";
  context.fillRect(0, 0, 40, 30);
  return new File([Uint8Array.from(canvas.toBuffer("image/png"))], "run.png", {
    type: "image/png",
  });
}

describe("loading a picked file", () => {
  it("reports the image's own dimensions", async () => {
    const loaded = await browserPipeline.load(jpegFile());

    // The canvas is sized from these, so a wrong answer letterboxes or
    // crops every photo in the app.
    expect(loaded.width).toBe(40);
    expect(loaded.height).toBe(30);
  });

  it("hands back something a canvas can draw", async () => {
    const loaded = await browserPipeline.load(jpegFile());
    expect(loaded.image).toBeDefined();
  });
});

describe("what the pipeline is wired to", () => {
  it("uses the real detector, paint and encoder", async () => {
    // Not identity checks against the imports — those would pass with the
    // wiring crossed. Each is exercised for the behaviour it owns.
    const canvas = document.createElement("canvas");
    const loaded = await browserPipeline.load(jpegFile());

    const outcome = await browserPipeline.detect(loaded.image);
    // No detector in this environment, so `unavailable` — which is the
    // honest answer and NOT the same as "ran and found nothing".
    expect(outcome.status).toBe("unavailable");

    browserPipeline.paint(canvas, loaded.image, loaded.width, loaded.height, []);
    expect(canvas.width).toBe(40);

    const file = await browserPipeline.toFile(canvas, "out.jpg");
    expect(file?.name).toBe("out.jpg");
    expect(file?.size).toBeGreaterThan(0);
  });
});
