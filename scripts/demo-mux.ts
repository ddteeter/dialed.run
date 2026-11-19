/**
 * `npm run demo:mux`: turn each recorded demo into the video a reviewer
 * watches (design 180, step 1). `npm run demo` runs it after recording.
 *
 * For every `test-results/<dir>/cues.json` that `e2e/support/demo.ts`
 * wrote beside a `video.webm`: render each caption to a PNG in headless
 * Chromium, then have ffmpeg pad the frame with a strip above the app,
 * overlay each caption while it is current, mix in each spoken line at its
 * start, and write `demo.mp4` next to the recording.
 *
 * **Wiring only.** Every decision (the graph, the timings, the caption's
 * look) is in `e2e/support/caption.ts`, and the caption PNGs are rendered
 * by `e2e/support/caption-strip.ts`; both are tested. This file spawns
 * Chromium and ffmpeg and is negated in `stryker.conf.json` (owner's call,
 * 2026-11-06). macOS only, like the voice; ffmpeg must be on the PATH.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import { ffmpegPath, muxArgs, recordingSchema } from "../e2e/support/caption";
import { captionScenes } from "../e2e/support/caption-strip";

const ffmpeg = ffmpegPath(existsSync);

const RESULTS = "test-results";

const cueFiles = readdirSync(RESULTS, { recursive: true, encoding: "utf8" })
  .filter((entry) => path.basename(entry) === "cues.json")
  .map((entry) => path.join(RESULTS, entry));

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  for (const cueFile of cueFiles) {
    const dir = path.dirname(cueFile);
    const video = path.join(dir, "video.webm");
    if (!existsSync(video)) {
      console.warn(`${dir}: no video.webm beside cues.json, skipped`);
      continue;
    }
    const take = recordingSchema.parse(
      JSON.parse(readFileSync(cueFile, "utf8")),
    );
    const scenes = await captionScenes(page, take.cues, take.frame.width, dir);
    const out = path.join(dir, "demo.mp4");
    execFileSync(ffmpeg, muxArgs(video, take, scenes, out), {
      stdio: "inherit",
    });
    console.log(`${out} (${String(scenes.length)} lines)`);
  }
} finally {
  await browser.close();
}
