/**
 * Copies MediaPipe's WASM runtime out of `node_modules` into
 * `public/mediapipe/wasm/`, where the browser can fetch it from our own
 * origin.
 *
 * Run by `prebuild` and `pretest`, so a build or a test run never depends
 * on someone having staged it by hand — which is how CI once produced a
 * suite where every browser test failed as "model unavailable" while the
 * same tests passed locally.
 *
 * **Copied, not imported.** These are runtime assets the WASM loader
 * fetches by URL; a bundler has no part in it. And **not committed**: they
 * are a verbatim copy of a dependency's files, so they carry that
 * dependency's version and would mean an 11 MB diff every time
 * `@mediapipe/tasks-vision` moves. `public/mediapipe/README.md` says why
 * the model file next door is committed and these are not.
 *
 * Was a `node -e` one-liner in package.json; externalized on PR #73 for
 * the same reason `check-bundle.ts` was, and see that file's header for
 * why a `.ts` script works where a `.mjs` one would not lint.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const FROM = path.join("node_modules", "@mediapipe", "tasks-vision", "wasm");
const TO = path.join("public", "mediapipe", "wasm");

/**
 * Both the SIMD and non-SIMD builds, and each one's JS glue.
 *
 * The loader picks between them at runtime by feature-detecting the
 * browser, so staging only the SIMD pair works on every machine anyone
 * tests on and fails on the older ones nobody does.
 */
const FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
] as const;

mkdirSync(TO, { recursive: true });
for (const file of FILES) {
  copyFileSync(path.join(FROM, file), path.join(TO, file));
}
console.log("mediapipe wasm staged");
