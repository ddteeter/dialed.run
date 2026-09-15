import { afterEach, describe, expect, it, vi } from "vitest";

import { detectFaces } from "../../src/modules/safety/blur/detect";
import type { Detector } from "../../src/modules/safety/blur/detect";

/**
 * `ImageBitmap` is never touched by these — the detector receives it and
 * hands it on — so a placeholder stands in for one the workers pool has
 * no way to create.
 */
const SOURCE = {} as ImageBitmap;

/**
 * Detectors the tests reach for, hoisted because a lint rule wants arrow
 * functions out of the scopes that use them once.
 */
const findsOneFace: Detector = () =>
  Promise.resolve([{ x: 1, y: 2, width: 3, height: 4 }]);
const findsNothing: Detector = () => Promise.resolve([]);
const throws: Detector = () => Promise.reject(new Error("wasm gone"));
const findsCorner: Detector = () =>
  Promise.resolve([{ x: 9, y: 9, width: 9, height: 9 }]);

afterEach(() => {
  Reflect.deleteProperty(globalThis, "FaceDetector");
});

describe("with no detector anywhere", () => {
  it("says it could not look, rather than that it found nothing", async () => {
    // The distinction the copy depends on. Reporting `{status:"ran",
    // faces:[]}` here would let the UI print "No face found" about a photo
    // nothing ever examined.
    expect(await detectFaces(SOURCE)).toEqual({ status: "unavailable" });
  });
});

describe("with a detector", () => {
  it("passes on what it found", async () => {
    expect(await detectFaces(SOURCE, findsOneFace)).toEqual({
      status: "ran",
      faces: [{ x: 1, y: 2, width: 3, height: 4 }],
    });
  });

  it("reports an empty result as having run", async () => {
    // This IS "no face found": something looked and saw nothing.
    expect(await detectFaces(SOURCE, findsNothing)).toEqual({
      status: "ran",
      faces: [],
    });
  });

  it("degrades to unavailable when the detector throws", async () => {
    // Law 5 on the client: a broken detector must leave the runner with a
    // working tap-to-blur and honest copy, not an error about a feature
    // they never asked for.
    expect(await detectFaces(SOURCE, throws)).toEqual({
      status: "unavailable",
    });
  });
});

describe("the browser's own Shape Detection API", () => {
  it("is used when the browser has one", async () => {
    const detect = vi.fn().mockResolvedValue([
      { boundingBox: { x: 10, y: 20, width: 30, height: 40 } },
    ]);
    Reflect.set(globalThis, "FaceDetector", function FaceDetector() {
      return { detect };
    });

    expect(await detectFaces(SOURCE)).toEqual({
      status: "ran",
      faces: [{ x: 10, y: 20, width: 30, height: 40 }],
    });
    expect(detect).toHaveBeenCalledWith(SOURCE);
  });

  it("ignores entries whose shape is not what we expect", async () => {
    Reflect.set(globalThis, "FaceDetector", function FaceDetector() {
      return {
        detect: () =>
          Promise.resolve([
            { boundingBox: { x: 1, y: 1, width: 2, height: 2 } },
            { boundingBox: { x: "no", y: 1, width: 2, height: 2 } },
            { notABoundingBox: true },
            undefined,
          ]),
      };
    });

    // Parsed, not cast: this crosses out of a browser API we do not
    // control, and a shape change should cost a detection rather than
    // crash inside a photo upload.
    const outcome = await detectFaces(SOURCE);
    expect(outcome).toEqual({
      status: "ran",
      faces: [{ x: 1, y: 1, width: 2, height: 2 }],
    });
  });

  it("drops a zero-sized box", async () => {
    Reflect.set(globalThis, "FaceDetector", function FaceDetector() {
      return {
        detect: () =>
          Promise.resolve([{ boundingBox: { x: 1, y: 1, width: 0, height: 5 } }]),
      };
    });

    // A zero-width region blurs nothing while making the copy claim a
    // face was covered.
    expect(await detectFaces(SOURCE)).toEqual({ status: "ran", faces: [] });
  });

  it("degrades when the browser's detector rejects", async () => {
    Reflect.set(globalThis, "FaceDetector", function FaceDetector() {
      return { detect: () => Promise.reject(new Error("not allowed")) };
    });

    expect(await detectFaces(SOURCE)).toEqual({ status: "unavailable" });
  });

  it("is ignored when the global is not constructible", async () => {
    Reflect.set(globalThis, "FaceDetector", "definitely not a constructor");
    expect(await detectFaces(SOURCE)).toEqual({ status: "unavailable" });
  });

  it("gives an explicitly passed detector precedence", async () => {
    const native = vi.fn();
    Reflect.set(globalThis, "FaceDetector", function FaceDetector() {
      return { detect: native };
    });
    const outcome = await detectFaces(SOURCE, findsCorner);

    expect(outcome).toEqual({ status: "ran", faces: [{ x: 9, y: 9, width: 9, height: 9 }] });
    expect(native).not.toHaveBeenCalled();
  });
});
