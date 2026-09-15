import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

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

/**
Installs a browser detector that answers with exactly this.
*/
function nativeReturning(result: unknown): void {
  Reflect.set(globalThis, "FaceDetector", function FaceDetector() {
    return { detect: () => Promise.resolve(result) };
  });
}

/**
 * The `null` a real `boundingBox` can be. Parsed through zod rather than
 * written, same idiom as the other fixtures.
 */
const NOTHING = z.null().parse(JSON.parse("null"));

describe("reading boxes out of a browser API we do not control", () => {
  it("treats a non-array result as no faces", async () => {
    nativeReturning({ notAnArray: true });
    // A shape change should cost a detection, not crash a photo upload.
    expect(await detectFaces(SOURCE)).toEqual({ status: "ran", faces: [] });
  });

  it.each([
    ["x", { x: "no", y: 1, width: 2, height: 2 }],
    ["y", { x: 1, y: "no", width: 2, height: 2 }],
    ["width", { x: 1, y: 1, width: "no", height: 2 }],
    ["height", { x: 1, y: 1, width: 2, height: "no" }],
  ])("drops a box whose %s is not a number", async (_label, box) => {
    nativeReturning([{ boundingBox: box }]);
    expect(await detectFaces(SOURCE)).toEqual({ status: "ran", faces: [] });
  });

  it.each([
    ["width", { x: 1, y: 1, width: 0, height: 5 }],
    ["height", { x: 1, y: 1, width: 5, height: 0 }],
    ["a negative width", { x: 1, y: 1, width: -5, height: 5 }],
  ])("drops a box with no %s to blur", async (_label, box) => {
    // A zero-area region blurs nothing while making the copy claim a face
    // was covered.
    nativeReturning([{ boundingBox: box }]);
    expect(await detectFaces(SOURCE)).toEqual({ status: "ran", faces: [] });
  });

  it.each([
    ["a null boundingBox", { boundingBox: NOTHING }],
    ["no boundingBox at all", { somethingElse: 1 }],
    ["an entry that is not an object", "not an entry"],
  ])("skips an entry with %s", async (_label, entry) => {
    nativeReturning([entry]);
    expect(await detectFaces(SOURCE)).toEqual({ status: "ran", faces: [] });
  });

  it("keeps the good boxes beside the bad ones", async () => {
    nativeReturning([
      { boundingBox: { x: 1, y: 1, width: 2, height: 2 } },
      { boundingBox: { x: 9, y: 9, width: 0, height: 9 } },
      { boundingBox: { x: 5, y: 5, width: 5, height: 5 } },
    ]);

    // One bad box must not cost the runner the other two blurs.
    const outcome = await detectFaces(SOURCE);
    expect(outcome).toEqual({
      status: "ran",
      faces: [
        { x: 1, y: 1, width: 2, height: 2 },
        { x: 5, y: 5, width: 5, height: 5 },
      ],
    });
  });

  it("accepts a box at the origin, which is a real position", async () => {
    // Zero x/y is valid; only zero SIZE is not.
    nativeReturning([{ boundingBox: { x: 0, y: 0, width: 4, height: 4 } }]);
    expect(await detectFaces(SOURCE)).toEqual({
      status: "ran",
      faces: [{ x: 0, y: 0, width: 4, height: 4 }],
    });
  });
});

describe("loading the model at most once", () => {
  it("caches the outcome, including a failure", async () => {
    // No native detector here, so both calls fall through to the model
    // loader — which cannot load 11 MB of WASM in this pool and fails.
    // A browser that could not manage it once will not manage it on the
    // second photo, and retrying per photo would be the worst version of
    // this feature.
    const first = await detectFaces(SOURCE);
    const second = await detectFaces(SOURCE);

    expect(first).toEqual({ status: "unavailable" });
    expect(second).toEqual(first);
  });
});
