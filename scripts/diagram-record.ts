/**
 * The half of `npm run diagrams:record` that is not git (design 229, step
 * 4): reads the model at the merge base and at head, records the views
 * whose hash changed in the single-file build, and writes one captioned
 * mp4 for `ship --attach`.
 *
 * **Wiring only.** What to record, in which layout, the captions and every
 * hold are decided in `scripts/diagrams/record.ts`, which is tested; the
 * caption strip and the ffmpeg graph are the PR demo's
 * (`e2e/support/caption.ts`). This file drives Chromium through the plan
 * and spawns ffmpeg. Homebrew's ffmpeg, like the demo.
 *
 * Arguments: the merge base's `docs/diagrams` (it may not exist), head's,
 * the built `index.html`, a scratch directory, and the mp4 to write.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { z } from "zod";

import {
  FFMPEG_CANDIDATES,
  STRIP_HEIGHT,
  captionPage,
  muxArgs,
  type Frame,
  type Scene,
} from "../e2e/support/caption";
import { readViewFacts } from "./diagrams/model";
import {
  planReport,
  recordingPlan,
  viewUrl,
  type RecordingPlan,
  type ViewTake,
} from "./diagrams/record";

/**
 * The PR demo's desk frame, so the two videos look alike side by side.
 */
const FRAME: Frame = { width: 1280, height: 720 };
const FONT = "public/fonts/ibm-plex-mono-500-latin.woff2";

interface Cue {
  readonly text: string;
  readonly startMs: number;
}

/**
 * Plays one view: the whole view, then its walkthrough a step at a time.
 * `mark` records when each caption starts.
 */
async function play(
  page: Page,
  url: string,
  view: ViewTake,
  mark: (text: string) => void,
): Promise<void> {
  // A fresh document per view: the viewer keeps a walkthrough's state
  // across a change of hash.
  await page.goto("about:blank");
  await page.goto(url);
  await page.locator(".react-flow__node").first().waitFor();
  if (view.layout === "sequence") {
    await page
      .locator(".mantine-SegmentedControl-innerLabel", { hasText: "Sequence" })
      .click();
  }
  mark(view.opening.caption);
  await page.waitForTimeout(view.opening.holdMs);
  for (const [index, step] of view.steps.entries()) {
    const button = index === 0 ? "Start" : "Next";
    await page.getByRole("button", { name: button, exact: true }).click();
    mark(step.caption);
    await page.waitForTimeout(step.holdMs);
  }
  if (view.steps.length > 0) {
    // The viewer and the plan agree on the step count: there is no next.
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeDisabled();
  }
}

/**
 * Records every view in the plan in one take: the raw video, its length
 * and each caption's start.
 */
async function film(
  browser: Browser,
  plan: RecordingPlan,
  siteUrl: string,
  work: string,
): Promise<{ video: string; endMs: number; cues: Cue[] }> {
  const context = await browser.newContext({
    viewport: FRAME,
    recordVideo: { dir: path.join(work, "video"), size: FRAME },
  });
  const page = await context.newPage();
  const startedAt = Date.now();
  const cues: Cue[] = [];
  const mark = (text: string): void => {
    cues.push({ text, startMs: Date.now() - startedAt });
  };
  for (const view of plan.views) {
    await play(page, viewUrl(siteUrl, view.id), view, mark);
  }
  const endMs = Date.now() - startedAt;
  await context.close();
  const video = await page.video()?.path();
  if (video === undefined) throw new Error("Playwright wrote no video");
  return { video, endMs, cues };
}

/**
 * Renders each caption to a PNG at the strip's size.
 */
async function captionScenes(
  browser: Browser,
  cues: readonly Cue[],
  work: string,
): Promise<Scene[]> {
  const fontUrl = `data:font/woff2;base64,${readFileSync(FONT).toString("base64")}`;
  const page = await browser.newPage({
    viewport: { width: FRAME.width, height: STRIP_HEIGHT },
  });
  const scenes: Scene[] = [];
  for (const [index, cue] of cues.entries()) {
    const caption = path.join(work, `caption-${String(index)}.png`);
    await page.setContent(captionPage(cue.text, fontUrl, FRAME.width));
    await page.screenshot({ path: caption });
    scenes.push({ startMs: cue.startMs, caption });
  }
  return scenes;
}

async function record(
  plan: RecordingPlan,
  site: string,
  work: string,
  out: string,
): Promise<void> {
  const ffmpeg = FFMPEG_CANDIDATES.find((candidate) => existsSync(candidate));
  if (ffmpeg === undefined) {
    throw new Error(`ffmpeg not found at ${FFMPEG_CANDIDATES.join(" or ")}`);
  }
  const browser = await chromium.launch();
  try {
    const take = await film(browser, plan, pathToFileURL(site).href, work);
    const scenes = await captionScenes(browser, take.cues, work);
    execFileSync(
      ffmpeg,
      muxArgs(take.video, { frame: FRAME, endMs: take.endMs }, scenes, out),
      { stdio: "inherit" },
    );
    console.log(`${out} (${String(Math.round(take.endMs / 1000))} s)`);
  } finally {
    await browser.close();
  }
}

const [baseDir, headDir, site, work, out] = z
  .tuple([z.string(), z.string(), z.string(), z.string(), z.string()])
  .parse(process.argv.slice(2));

// A video from an earlier run must not be attached for this one.
rmSync(out, { force: true });

const plan = recordingPlan(
  existsSync(baseDir) ? await readViewFacts(baseDir) : [],
  await readViewFacts(headDir),
);
console.log(planReport(plan));
if (plan.views.length > 0) await record(plan, site, work, out);
