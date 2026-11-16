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
import { cpSync, rmSync } from "node:fs";
import path from "node:path";

const FROM = path.join("node_modules", "@mediapipe", "tasks-vision", "wasm");
const TO = path.join("public", "mediapipe", "wasm");

/**
 * **The whole `wasm/` folder, by name of nothing in it.** The package's
 * contract is the folder: `FilesetResolver.forVisionTasks(basePath)`
 * takes a hosted copy of it (MediaPipe's docs point it at the package's
 * `wasm/` on a CDN), and which files the loader then fetches is the
 * package's business. A hard-coded list broke the build when 1.2.2
 * dropped the non-SIMD pair. The folder is replaced, not merged, so a
 * file a newer version drops does not linger here.
 */
rmSync(TO, { recursive: true, force: true });
cpSync(FROM, TO, { recursive: true });
console.log("mediapipe wasm staged");
