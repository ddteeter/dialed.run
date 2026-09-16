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
 * **There is deliberately no WASM model bundled yet.** The candidates
 * measured ~2.7 MB of runtime and weights on first photo upload
 * (MediaPipe's vision WASM plus the short-range face model), against a
 * repo that treats an 89 kB saving as a result worth recording. That is a
 * product decision with a number attached, and it is the owner's — so this
 * file is the shape it plugs into, and `loadModelDetector` is where it
 * goes. Until then:
 *
 * - where the browser has a native detector, detection runs and the photo
 *   is blurred on by default, as the artboard asks;
 * - everywhere else `unavailable` is reported honestly, tap-to-blur still
 *   works, and the copy says we could not check rather than claiming a
 *   clean sweep we never made.
 */
import type { Region } from "./regions";

export type DetectionOutcome =
  | { status: "ran"; faces: readonly Region[] }
  /**
   * No detector on this browser. NOT the same as finding nothing, and
   * kept distinct all the way to the copy: "no face found" after looking
   * and after not looking are the same words describing very different
   * states.
   */
  | { status: "unavailable" };

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
 */
/**
 * Memoised, so a runner uploading four photos instantiates one WASM module
 * rather than four. Deliberately caches the FAILURE too: a browser that
 * could not load 11 MB the first time will not manage it on the second,
 * and retrying per photo would be the worst version of this feature.
 *
 * A Map rather than a mutable module-level binding, because a lint rule
 * rejects assigning to one from inside a function — and because this makes
 * the memo something a test can clear.
 */
const detectorMemo = new Map<string, Promise<Detector | undefined>>();

function loadModelDetector(): Promise<Detector | undefined> {
  const existing = detectorMemo.get("face");
  if (existing !== undefined) return existing;
  const pending = buildModelDetector();
  detectorMemo.set("face", pending);
  return pending;
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

async function buildModelDetector(): Promise<Detector | undefined> {
  try {
    const vision = await import("@mediapipe/tasks-vision");
    const files = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
    const detector = await vision.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_PATH },
      runningMode: "IMAGE",
    });
    return (source) =>
      Promise.resolve(regionsFromDetections(detector.detect(source).detections));
  } catch {
    // Law 5 on the client. A model that will not load leaves the runner
    // with tap-to-blur and copy that says we could not check — not an
    // error about a feature they never asked for.
    return undefined;
  }
}

/**
 * Finds faces, or says it could not look.
 *
 * Never throws. A detector that fails is indistinguishable, to a runner,
 * from one that is not there — and both should leave them with a working
 * tap-to-blur and honest copy rather than an error about a feature they
 * did not ask for (law 5, on the client).
 */
const absent: Detector = () =>
  Promise.reject(new Error("no face detector on this device"));

export async function detectFaces(
  source: ImageBitmap,
  detector?: Detector  ,
): Promise<DetectionOutcome> {
  // "No detector" is expressed as a detector that refuses, rather than as
  // an `undefined` with a guard above the try. Both end in the same catch
  // meaning the same thing, and two branches for one answer was a
  // distinction no input could make.
  const detect =
    detector ?? nativeDetector() ?? (await loadModelDetector()) ?? absent;
  try {
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
    // No `typeof` on width and height: `> 0` is false for a string, for
    // undefined and for NaN, so the extra checks could not change any
    // answer. x and y keep theirs, because there is no comparison on them
    // to do the same work.
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
