/**
 * The half of `npm run diagrams:record` that is not git (design 229, step
 * 4; voiced by #851): reads the model at the merge base and at head,
 * speaks every line the plan calls for, records the views that changed in
 * the single-file build, and writes one captioned, narrated mp4 for
 * `ship --attach`.
 *
 * **Wiring only.** What to record, in which layout, what each shot says
 * and shows and every hold are decided in `scripts/diagrams/record.ts`,
 * which is tested. The voice, the caption strip and the ffmpeg graph are
 * the PR demo's (`e2e/support/speech.ts`, `caption-strip.ts`,
 * `caption.ts`), also tested. This file drives Chromium through the plan
 * and spawns ffmpeg. Homebrew's ffmpeg, like the demo.
 *
 * Arguments: the merge base's `docs/diagrams` (it may not exist), head's,
 * the built `index.html`, a scratch directory, and the mp4 to write.
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { z } from "zod";

import { DESK } from "../e2e/support/bars";
import { ffmpegPath, muxArgs, type Cue } from "../e2e/support/caption";
import { captionScenes } from "../e2e/support/caption-strip";
import { localTools, speaker, type SpokenLine } from "../e2e/support/speech";
import { readViewFacts } from "./diagrams/model";
import {
  planReport,
  recordingPlan,
  spokenLines,
  viewUrl,
  voicedPlan,
  type RecordingPlan,
  type Shot,
  type ViewTake,
} from "./diagrams/record";

/**
 * Plays one view: the whole view, then its walkthrough a step at a time.
 * `show` marks when each shot starts and holds it.
 */
async function play(
  page: Page,
  url: string,
  view: ViewTake,
  show: (shot: Shot) => Promise<void>,
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
  await show(view.opening);
  for (const [index, step] of view.steps.entries()) {
    const button = index === 0 ? "Start" : "Next";
    await page.getByRole("button", { name: button, exact: true }).click();
    await show(step);
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
 * and each shot's cue.
 */
async function film(
  browser: Browser,
  plan: RecordingPlan,
  siteUrl: string,
  work: string,
): Promise<{ video: string; endMs: number; cues: Cue[] }> {
  const context = await browser.newContext({
    viewport: DESK,
    recordVideo: { dir: path.join(work, "video"), size: DESK },
  });
  const page = await context.newPage();
  const startedAt = Date.now();
  const cues: Cue[] = [];
  const show = async ({ caption, audio, holdMs }: Shot): Promise<void> => {
    const startMs = Date.now() - startedAt;
    cues.push(
      audio === undefined
        ? { text: caption, startMs }
        : { text: caption, startMs, audio },
    );
    await page.waitForTimeout(holdMs);
  };
  for (const view of plan.views) {
    await play(page, viewUrl(siteUrl, view.id), view, show);
  }
  const endMs = Date.now() - startedAt;
  await context.close();
  const video = await page.video()?.path();
  if (video === undefined) throw new Error("Playwright wrote no video");
  return { video, endMs, cues };
}

/**
 * Renders every line before filming, so a first rendering never stalls
 * the take, and holds each shot until its line is said.
 */
async function voiced(plan: RecordingPlan): Promise<RecordingPlan> {
  const speak = speaker(localTools());
  const lines = new Map<string, SpokenLine>();
  for (const line of spokenLines(plan)) {
    lines.set(line, await speak(line, "review"));
  }
  return voicedPlan(plan, lines);
}

async function record(
  plan: RecordingPlan,
  site: string,
  work: string,
  out: string,
): Promise<void> {
  const ffmpeg = ffmpegPath(existsSync);
  const browser = await chromium.launch();
  try {
    const take = await film(browser, plan, pathToFileURL(site).href, work);
    const page = await browser.newPage();
    const scenes = await captionScenes(page, take.cues, DESK.width, work);
    execFileSync(
      ffmpeg,
      muxArgs(take.video, { frame: DESK, endMs: take.endMs }, scenes, out),
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
if (plan.views.length === 0) {
  console.log(planReport(plan));
} else {
  const narrated = await voiced(plan);
  console.log(planReport(narrated));
  await record(narrated, site, work, out);
}
