import { afterEach, describe, expect, it } from "vitest";

import {
  detectFaces,
  loadModelDetector,
} from "../../src/modules/safety/blur/detect";
import type { DetectionOutcome } from "../../src/modules/safety/blur/detect";

/**
 * The only tests that run the actual model.
 *
 * Everything else about `detect.ts` is covered against injected detectors,
 * which proves the plumbing and proves nothing about MediaPipe: for most
 * of this lane's life the 11 MB of WASM had never been executed once, and
 * the suite was green throughout. Neither other project can run it —
 * workerd has no DOM, happy-dom refuses to execute a fetched script, and
 * neither has an origin for `FilesetResolver` to fetch from. This project
 * is a real Chromium with vitest's own vite server serving `public/`, so
 * `/mediapipe/wasm` resolves exactly as it does in production.
 *
 * It is a vitest project rather than a Playwright spec on purpose.
 * Playwright's runner is invisible to stryker (`testRunner: "vitest"`), so
 * a spec over there would demonstrate the model and kill no mutants —
 * and eight of `detect.ts`'s mutants live in code only a loaded model
 * reaches.
 */

/**
 * A face, drawn rather than photographed.
 *
 * A committed photo would be a picture of a real person in a repo that
 * exists to keep pictures of real people private, and a licence question
 * on top. The model does not need one: it finds this drawn head, at
 * centre `(128,130)` with radii `68x86`. Drawn also means the fixture is
 * reviewable as code and cannot drift.
 */
const HEAD = { x: 128, y: 130, radiusX: 68, radiusY: 86 };

function drawnFace(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ink = canvas.getContext("2d");
  if (!ink) throw new Error("no 2d context in the browser project");

  ink.fillStyle = "#cfd6dd";
  ink.fillRect(0, 0, 256, 256);
  ink.fillStyle = "#e0ac82";
  ink.beginPath();
  ink.ellipse(HEAD.x, HEAD.y, HEAD.radiusX, HEAD.radiusY, 0, 0, Math.PI * 2);
  ink.fill();

  ink.fillStyle = "#ffffff";
  for (const eyeX of [103, 153]) {
    ink.beginPath();
    ink.ellipse(eyeX, 112, 14, 9, 0, 0, Math.PI * 2);
    ink.fill();
  }
  ink.fillStyle = "#2b2b2b";
  for (const eyeX of [103, 153]) {
    ink.beginPath();
    ink.arc(eyeX, 112, 6, 0, Math.PI * 2);
    ink.fill();
  }

  ink.strokeStyle = "#3a2a1a";
  ink.lineWidth = 5;
  const brows: readonly (readonly [number, number, number, number])[] = [
    [90, 96, 117, 93],
    [139, 93, 166, 96],
  ];
  const browPath = new Path2D();
  for (const [fromX, fromY, toX, toY] of brows) {
    browPath.moveTo(fromX, fromY);
    browPath.lineTo(toX, toY);
  }
  ink.stroke(browPath);

  ink.strokeStyle = "#b8865f";
  ink.lineWidth = 4;
  ink.beginPath();
  ink.moveTo(128, 118);
  ink.lineTo(128, 146);
  ink.stroke();

  ink.strokeStyle = "#8c4a3f";
  ink.lineWidth = 5;
  ink.beginPath();
  ink.arc(128, 158, 22, 0.2 * Math.PI, 0.8 * Math.PI);
  ink.stroke();
  return canvas;
}

/**
An image with nothing in it at all.
*/
function blank(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  return canvas;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "FaceDetector");
});

/**
 * Asserts one detection, over the head the fixture draws.
 *
 * **Over it rather than exactly on it.** The first version of this pinned
 * the box to `{56, 69, 142x142}`, and a refactor of the *eyebrows* into a
 * `Path2D` moved it to 143x143 — a one-pixel anti-aliasing difference. A
 * model's output is not a constant, and a test that says it is fails for
 * reasons that have nothing to do with what it was written to check. What
 * matters is that the box covers the face: a detector returning a corner
 * would satisfy a length assertion while blurring the wrong part of every
 * photo.
 */
function expectOneFaceOverTheHead(outcome: DetectionOutcome): void {
  if (outcome.status !== "ran") throw new Error(outcome.status);
  expect(outcome.faces).toHaveLength(1);
  const [face] = outcome.faces;
  if (!face) throw new Error("no face");
  expect(face.x).toBeLessThan(HEAD.x);
  expect(face.y).toBeLessThan(HEAD.y);
  expect(face.x + face.width).toBeGreaterThan(HEAD.x);
  expect(face.y + face.height).toBeGreaterThan(HEAD.y);
}

describe("the model, actually loaded", () => {
  it("finds the face in a drawn one", async () => {
    const source = await createImageBitmap(drawnFace());

    expectOneFaceOverTheHead(await detectFaces(source));
  }, 60_000);

  it("reports an empty list rather than nothing when there is no face", async () => {
    const outcome = await detectFaces(await createImageBitmap(blank()));

    // `faces: undefined` would let `blurSummary` read a count off
    // nothing, and "ran with no faces" is the state the copy leans on
    // hardest — it is the only one allowed to say "No face found".
    expect(outcome).toEqual({ status: "ran", faces: [] });
  }, 60_000);

  it("builds one detector however many photos are picked", async () => {
    // The memo's reason for existing: a runner uploading four photos
    // instantiates 11.9 MB of WASM once, not four times. Identity is what
    // says so — both calls returning a working detector does not.
    expect(await loadModelDetector()).toBe(await loadModelDetector());
  }, 60_000);

  it("falls through to the model when the browser's own detector is not usable", async () => {
    // A `FaceDetector` global that is not constructible. Skipping the
    // guard would hand back a detector that throws on every photo, and
    // the model below it would never be reached — which looks identical
    // to a browser that simply has no detector.
    Reflect.set(globalThis, "FaceDetector", { notAConstructor: true });

    const source = await createImageBitmap(drawnFace());

    expectOneFaceOverTheHead(await detectFaces(source));
  }, 60_000);
});
