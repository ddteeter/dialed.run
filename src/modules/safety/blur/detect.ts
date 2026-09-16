/**
 * Face detection in the browser — the seam, and the one rung that costs
 * nothing.
 *
 * **The unblurred frame never leaves the device.** That is W3's promise
 * and it is the reason detection is here rather than on the Worker: the
 * canvas is blurred first and only the blurred bytes are uploaded. The
 * promise survives the move from a native app to the web; what changes is
 * what does the detecting.
 *
 * **Three rungs, tried in order**, because the cheap one is free and the
 * expensive one is 11 MB:
 *
 * - a detector the caller passed in, which is what tests use;
 * - the browser's own Shape Detection API where it exists — free, no
 *   download, and exactly the artboard's behaviour on those browsers;
 * - MediaPipe behind a dynamic `import()`, paid on the first photo upload
 *   where blur is on and never paid by someone who turned blur off. The
 *   measured cost is on `loadModelDetector` below (owner's call,
 *   2026-09-15).
 *
 * When all three are gone, `unavailable` is reported honestly, tap-to-blur
 * still works, and the copy says we could not check rather than claiming a
 * clean sweep we never made.
 */
import type { DetectionAnswer, Region } from "./regions";

/**
 * What this module answers with.
 *
 * `unavailable` is NOT the same as finding nothing, and the distinction is
 * kept all the way to the copy: "no face found" after looking and after
 * not looking are the same words describing very different states.
 *
 * The shape itself lives in `./regions`, next to the mapping that reads
 * it, so there is one definition rather than two that agree today.
 */
export type DetectionOutcome = DetectionAnswer;

/**
 * The shape a model-backed detector must present. Whatever ships behind
 * `loadModelDetector` implements this and nothing else changes.
 */
export type Detector = (source: ImageBitmap) => Promise<readonly Region[]>;

/**
 * The browser's own Shape Detection API, where it exists.
 *
 * Coverage is narrow — Chromium on some platforms, never Safari or
 * Firefox — so this is a bonus rung rather than the answer. It is still
 * worth having: it is free, it needs no download, and on the browsers that
 * do have it the runner gets exactly the artboard's behaviour.
 */
function nativeDetector(): Detector | undefined {
  const candidate = (globalThis as { FaceDetector?: unknown }).FaceDetector;
  if (typeof candidate !== "function") return undefined;

  const Construct = candidate as new (options?: {
    fastMode?: boolean;
  }) => { detect: (source: ImageBitmap) => Promise<unknown> };

  return async (source) => {
    // Constructed per call rather than at module scope: CLAUDE.md's
    // client-bundle rule is that a module-scope construction is a side
    // effect rollup must keep, and this file is reachable from a route.
    const detector = new Construct({ fastMode: true });
    return boxesFrom(await detector.detect(source));
  };
}

/**
 * A holder object rather than a module-level `let`, because a lint rule
 * rejects assigning to one from inside a function. It was a keyed `Map`
 * first, and the key was the problem: `set("face", …)` runs exactly once
 * per process, so under stryker's per-test coverage only whichever test
 * ran first was recorded as reaching it, and the test that actually
 * asserts the memo never covered the line it was written for. One `??=`
 * executes on every call, so every test that loads the model covers it.
 */
const detectorMemo: { current?: Promise<Detector> } = {};

/**
 * Loads MediaPipe's face detector, behind a dynamic `import()` so none of
 * it enters the client entry chunk.
 *
 * **The cost, measured rather than remembered** (owner's call,
 * 2026-09-15, on the corrected numbers): `vision_wasm_internal.wasm` is
 * 11.21 MB raw, 2.26 MB brotli, 3.26 MB gzip, plus 224 KB of model and
 * ~370 KB of glue — and ~11.9 MB once instantiated, which is the half a
 * mid-range phone feels most. It is paid on the first photo upload where
 * blur is on, cached by the browser after, and never paid at all by
 * someone who has turned blur off (see `shouldBlurFaces`).
 *
 * **Served from our own origin, both files.** Not a CDN, and the model
 * especially: fetching it from Google at the moment a runner uploads a
 * photo would leak the one signal this whole feature exists to protect.
 * `prebuild` stages the WASM out of node_modules; the model is committed
 * beside it.
 *
 * **Memoised**, so a runner uploading four photos instantiates one WASM
 * module rather than four. Deliberately caches the FAILURE too: a browser
 * that could not load 11 MB the first time will not manage it on the
 * second, and retrying per photo would be the worst version of this
 * feature. Exported for the browser project, which is the only place the
 * model actually loads and so the only place two calls returning one
 * detector means anything.
 */
export function loadModelDetector(): Promise<Detector> {
  detectorMemo.current ??= buildModelDetector();
  return detectorMemo.current;
}

/**
 * Where the WASM runtime and the model are served from.
 *
 * Exported and pinned by a test against what `public/` actually holds,
 * because a wrong path here fails the way this feature fails worst:
 * silently. The detector simply never loads, `detectFaces` reports
 * `unavailable`, the copy honestly says we could not check, and nobody
 * finds out that the reason is a renamed file.
 */
export const WASM_PATH = "/mediapipe/wasm";
export const MODEL_PATH = "/mediapipe/blaze_face_short_range.tflite";

/**
 * MediaPipe's detections as this app's regions.
 *
 * Split out of the builder so it can be tested: everything around it
 * needs 11 MB of WASM fetched over HTTP, which no test environment will
 * do, but the mapping is arithmetic on an object and is where a mistake
 * would actually show — blurring the wrong rectangle looks like a broken
 * feature rather than a coordinate bug.
 *
 * A detection without a box is dropped rather than defaulted: a zero
 * region blurs nothing while letting the copy claim a face was covered.
 */
export function regionsFromDetections(
  detections: readonly {
    boundingBox?:
      | { originX: number; originY: number; width: number; height: number }
      | undefined;
  }[],
): readonly Region[] {
  return detections.flatMap((detection) => {
    const box = detection.boundingBox;
    return box === undefined
      ? []
      : [{ x: box.originX, y: box.originY, width: box.width, height: box.height }];
  });
}

/**
 * **Rejects rather than resolving to `undefined` when the model will not
 * load**, and that is the whole reason this function has no `try` of its
 * own. `detectFaces` already catches everything and answers `unavailable`
 * — law 5 on the client — so a second catch here was one more way to say
 * the same thing, and the mutant that emptied it changed no answer any
 * caller could observe. Deleting it deleted the mutant, and `absent`, the
 * refusing detector that only existed to turn the `undefined` back into a
 * rejection, went with it.
 */
async function buildModelDetector(): Promise<Detector> {
  const vision = await import("@mediapipe/tasks-vision");
  const files = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
  // No `runningMode`: MediaPipe's default is already IMAGE, and `detect()`
  // below is the IMAGE-mode call — asking for VIDEO would make it throw.
  // Passing "IMAGE" explicitly was a literal no test could observe (the
  // mutant that emptied it detected the same faces), and an unobservable
  // claim is worse than a default the browser test pins.
  const detector = await vision.FaceDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL_PATH },
  });
  return (source) =>
    Promise.resolve(regionsFromDetections(detector.detect(source).detections));
}

/**
 * Finds faces, or says it could not look.
 *
 * Never throws. A detector that fails is indistinguishable, to a runner,
 * from one that is not there — and both should leave them with a working
 * tap-to-blur and honest copy rather than an error about a feature they
 * did not ask for (law 5, on the client).
 */
export async function detectFaces(
  source: ImageBitmap,
  detector?: Detector,
): Promise<DetectionOutcome> {
  try {
    // Choosing the rung is INSIDE the try, because failing to load the
    // model and failing to run it are the same answer to a runner. Left
    // outside, a rejected `loadModelDetector()` would throw out of a
    // function whose docblock promises it never throws.
    const detect = detector ?? nativeDetector() ?? (await loadModelDetector());
    return { status: "ran", faces: await detect(source) };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Reads boxes out of whatever the detector returned.
 *
 * Parsed rather than cast: this crosses out of a browser API we do not
 * control, and a shape change should cost us a detection rather than a
 * crash inside a photo upload.
 */
function isPositive(value: unknown): value is number {
  return typeof value === "number" && value > 0;
}

function boxesFrom(result: unknown): readonly Region[] {
  if (!Array.isArray(result)) return [];
  const regions: Region[] = [];
  for (const entry of result) {
    const box: unknown = (entry as { boundingBox?: unknown } | undefined)
      ?.boundingBox;
    if (typeof box !== "object" || box === null) continue;
    const { x, y, width, height } = box as Record<string, unknown>;
    // width and height carry their `typeof` INSIDE `isPositive`, and it is
    // load-bearing: an earlier comment here claimed `> 0` was false for a
    // string, which is only true of a string that is not a number. `"5" >
    // 0` is `true`, so a box reporting its width as text would have been
    // accepted and then used as a number.
    if (
      typeof x === "number" &&
      typeof y === "number" &&
      isPositive(width) &&
      isPositive(height)
    ) {
      regions.push({ x, y, width, height });
    }
  }
  return regions;
}
