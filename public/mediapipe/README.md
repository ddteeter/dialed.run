# `public/mediapipe/`

What the on-device blur step loads at runtime. Two halves, and they are
committed differently on purpose.

## `blaze_face_short_range.tflite` (committed, 224 KB)

Google's **BlazeFace (short-range)** face-detection model, in TensorFlow
Lite format — the model MediaPipe's `FaceDetector` task runs. "Short range"
is the front-camera variant: faces within about two metres, which is what a
mirror shot or a phone held at arm's length is. It is the thing that finds
the face; the blurring itself is ours (`src/modules/safety/blur/`).

- **Where it came from**: Google's published MediaPipe model catalogue —
  the `blaze_face_short_range` face-detector asset, downloaded once and
  committed under the name `src/modules/safety/blur/detect.ts` loads it by
  (`MODEL_PATH`).
- **Licence**: **Apache License, Version 2.0**, stated on Google's own
  model card for this model under "LICENSED UNDER". The full text is in
  `LICENSE` beside this file and the attribution is in `NOTICE`, which is
  what Apache 2.0 §4 asks of anyone redistributing the work. The card also
  gives the model's size as 224 KB, matching this file, and the weights'
  internal strings name `facedetector_front_blaze_2019_10_17_v0` — so the
  provenance is checkable rather than asserted.
- **Why it is committed rather than staged**: it is not in the npm package.
  `@mediapipe/tasks-vision` ships the WASM runtime and no weights — the
  published examples fetch the model from that Google bucket at page load.
  Doing that in production would put a third-party request on the upload
  path of a privacy feature, and make the blur step fail whenever that
  bucket is slow or blocked. 224 KB in git, once, buys an app that does not
  phone anyone to blur a face.

## `wasm/` (gitignored, ~11 MB)

The MediaPipe WASM runtime, **copied out of `node_modules` by
`npm run stage:mediapipe`** — which `prebuild` and `pretest` both call, so
it is present for any build and any test run without anyone staging it by
hand. Gitignored because it is a verbatim copy of a dependency's files and
carries a dependency's version with it; committing it would mean a 11 MB
diff every time `@mediapipe/tasks-vision` moves.

If a test fails with the model "unavailable", `wasm/` is empty: run
`npm run stage:mediapipe`.

Nothing here is modified from what Google published. If the model is ever
swapped for another, `NOTICE` has to be re-checked against the new model's
card — the licence travels with the specific model, not with MediaPipe in
general.
