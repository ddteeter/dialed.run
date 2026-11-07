import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { test as base } from "./a11y";
import type { A11y } from "./a11y";

import {
  AFINFO,
  SAY,
  durationMs,
  forSpeech,
  paceOf,
  recordAt as recordAtWhen,
  sayArgs,
  speechKey,
} from "./caption";
import type { Cue, Frame, Pace } from "./caption";
import type { Locator, Page } from "@playwright/test";

/**
 * The base test for `*.demo.spec.ts`. Recording is configured by the `demo`
 * Playwright project; this adds the parts a project cannot express:
 *
 * - a synthetic cursor (dot + click ripple) is drawn where the mouse acts,
 *   because otherwise a click reads as content mutating for no visible
 *   reason — animated from rAF, independent of page CSS;
 * - `goto` resolves only after `document.fonts.ready`, so a recording never
 *   opens on fallback-font frames mid-swap (the FOUT window);
 * - `scene()` narrates and paces the recording (see below);
 * - while recording, the a11y fixture's checks are off: CI runs them on
 *   these same journeys, and in a video they are only dead air.
 *
 * Motion is deliberately NOT stripped: demos are a primary review surface
 * and must show the Motion Doctrine's real behavior (owner decision,
 * 2026-09-06 — see docs/design-deltas.md). Doctrine moves cap at 320ms,
 * well inside the demo project's slowMo gaps, and Playwright's
 * actionability checks wait out moving targets. If a demo flakes on
 * timing, fix its waits — do not re-add a motion-strip stylesheet.
 */
/**
 * Milliseconds of pacing per Playwright action, and the switch that decides
 * whether anything is recorded at all. Mirrors `playwright.config.ts`, which
 * owns the `slowMo` and `video` options this cannot reach.
 */
const demoSlowMo = Number(process.env.DEMO_SLOWMO ?? 0);

/**
 * The recording in progress: when it started and every line narrated so
 * far. One worker runs the demos, so one recording at a time.
 */
const recording: { startedAt: number; cues: Cue[]; pace: Pace } = {
  startedAt: 0,
  cues: [],
  pace: "review",
};

/**
 * Rendered lines, kept across runs, so a re-record only synthesizes what
 * changed. The key covers the spoken text and the rate (`speechKey`).
 */
const VOICE_CACHE = "node_modules/.cache/demo-voice";

/**
 * `say` and `afinfo`, awaited rather than run synchronously. Playwright
 * records the video in this process, so a synchronous call stalls it: the
 * frames that arrive during a first rendering are stamped late, and the
 * narration drifted up to seven seconds behind the picture (measured
 * 2026-11-06, first recording of new lines).
 */
const run = promisify(execFile);

/**
 * Render `spoken` with the system voice, or reuse an earlier rendering.
 */
async function voiced(spoken: string): Promise<string> {
  mkdirSync(VOICE_CACHE, { recursive: true });
  const { pace } = recording;
  const file = path.resolve(VOICE_CACHE, `${speechKey(spoken, pace)}.aiff`);
  if (!existsSync(file)) await run(SAY, sayArgs(spoken, file, pace));
  return file;
}

/**
 * Narrate the next stretch of the recording, and hold while the line is
 * spoken, so a viewer hears what is being demonstrated before it happens.
 *
 * **This narrates; the `expect` beside it proves.** A line is a claim about
 * what the next few actions show, and it is checked by the assertion that
 * follows, never instead of one. Write it in the spec, where a reviewer
 * reads it in the diff; nothing here generates text at record time, which
 * is how a video ends up describing intent rather than behaviour.
 *
 * `text` is the caption; `say` is the spoken form, when the caption's
 * shorthand would sound wrong aloud (`forSpeech` handles `·` on its own).
 *
 * **Inert without `DEMO_SLOWMO`.** CI runs these journeys as assertions and
 * has no use for the pause, so this returns immediately and costs nothing.
 *
 * **It never touches the page.** The caption and the voice are laid over
 * the recording afterwards by `npm run demo:mux`, from the `cues.json` the
 * fixture below writes, so no locator can match a caption and nothing
 * covers the app. The page is only the clock.
 *
 * The cue is stamped after the line is rendered: a first recording of a
 * new line holds a little longer before it, and a cached one does not.
 */
export async function scene(
  page: Page,
  text: string,
  options: { readonly say?: string } = {},
): Promise<void> {
  if (demoSlowMo === 0) return;
  const audio = await voiced(options.say ?? forSpeech(text));
  const { stdout } = await run(AFINFO, [audio]);
  const holdMs = durationMs(stdout);
  recording.cues.push({
    text,
    startMs: Date.now() - recording.startedAt,
    audio,
  });
  await page.waitForTimeout(holdMs);
}

/**
 * `test.use(recordAt(PHONE))` records a spec at phone size: the viewport
 * and the video together, so the page fills the frame. Without it, a demo
 * records at the `demo` project's desk size.
 */
export function recordAt(size: Frame): ReturnType<typeof recordAtWhen> {
  return recordAtWhen(size, demoSlowMo !== 0);
}

/**
 * Fill a field, and while recording type it a key at a time, so a viewer
 * sees what goes in rather than a field that is suddenly full. CI fills it
 * at once.
 */
export async function typeSlowly(field: Locator, text: string): Promise<void> {
  if (demoSlowMo === 0) {
    await field.fill(text);
    return;
  }
  await field.fill("");
  await field.pressSequentially(text, { delay: 70 });
}

/**
 * Layout stamps `html[data-hydrated]` once React attaches; driving
 * controlled inputs before that races hydration's state reset. Shared by
 * every demo spec — one wait, not one copy per journey.
 */
export async function hydrated(page: Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

const paced = base.extend({
  page: async ({ page }, use, testInfo) => {
    // The video starts with the page, which exists by the time this runs,
    // so a cue lands a few milliseconds late at most.
    recording.startedAt = Date.now();
    recording.cues = [];
    recording.pace = paceOf(testInfo.project.name);
    await page.addInitScript(() => {
      const layer = "pointer-events:none;z-index:2147483647;position:fixed;";

      const pink = "255,45,135";
      let dot: HTMLDivElement | undefined;
      let targetX = -100;
      let targetY = -100;
      let x = -100;
      let y = -100;

      const track = (): void => {
        x += (targetX - x) * 0.3;
        y += (targetY - y) * 0.3;
        if (dot !== undefined) {
          dot.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
        }
        requestAnimationFrame(track);
      };

      const ensureDot = (): void => {
        if (dot !== undefined) return;
        dot = document.createElement("div");
        dot.style.cssText = `${layer}left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;background:rgba(${pink},0.25);border:2px solid rgba(${pink},0.9);`;
        document.documentElement.insertAdjacentElement("beforeend", dot);
        requestAnimationFrame(track);
      };

      const ripple = (clickX: number, clickY: number): void => {
        const ring = document.createElement("div");
        ring.style.cssText = `${layer}left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;border:3px solid rgba(${pink},0.9);`;
        document.documentElement.insertAdjacentElement("beforeend", ring);
        const started = performance.now();
        const grow = (now: number): void => {
          const progress = Math.min((now - started) / 450, 1);
          ring.style.transform = `translate(${String(clickX)}px, ${String(clickY)}px) scale(${String(1 + progress * 1.6)})`;
          ring.style.opacity = String(1 - progress);
          if (progress < 1) {
            requestAnimationFrame(grow);
          } else {
            ring.remove();
          }
        };
        requestAnimationFrame(grow);
      };

      globalThis.addEventListener(
        "mousemove",
        (event) => {
          ensureDot();
          targetX = event.clientX;
          targetY = event.clientY;
        },
        { capture: true, passive: true },
      );
      globalThis.addEventListener(
        "mousedown",
        (event) => {
          ensureDot();
          ripple(event.clientX, event.clientY);
        },
        { capture: true, passive: true },
      );

      // Reflected into the DOM so the Node side can wait on a selector —
      // `page.evaluate` callbacks may not touch browser globals (lint).
      // Polled rather than awaited: the `document.fonts.ready` promise
      // captured at init-script time is replaced once a loading cycle starts
      // and never resolves, and React's document-level hydration can wipe
      // the attribute — the interval self-heals both.
      setInterval(() => {
        const isAnyFaceLoaded = [...document.fonts].some(
          (face) => face.status === "loaded",
        );
        if (isAnyFaceLoaded && document.fonts.status === "loaded") {
          document.documentElement.dataset.fontsReady = "true";
        }
      }, 100);
    });

    const rawGoto = page.goto.bind(page);
    page.goto = async (...args: Parameters<Page["goto"]>) => {
      const response = await rawGoto(...args);
      await page
        .locator('html[data-fonts-ready="true"]')
        .waitFor({ state: "attached" });
      return response;
    };

    // The frame the video was sized to: `recordAt` keeps the two equal,
    // and so does the `demo` project's default. Read before the test can
    // resize the page.
    const frame = page.viewportSize();
    await use(page);
    if (demoSlowMo !== 0 && frame !== null) {
      writeFileSync(
        testInfo.outputPath("cues.json"),
        JSON.stringify(
          {
            frame,
            endMs: Date.now() - recording.startedAt,
            cues: recording.cues,
          },
          undefined,
          2,
        ),
      );
    }
  },
});

/**
 * The a11y fixture's stand-in while recording. Its checks run before every
 * action and walk the page at the end, resizing it twice; CI already runs
 * them on these journeys, and in a recording they are pauses and a closing
 * sequence nobody is meant to watch.
 */
const SILENT_A11Y: A11y = {
  checkNow: () => Promise.resolve(),
  endOfTest: () => Promise.resolve(),
  findings: () => [],
};

export const test: typeof paced =
  demoSlowMo === 0
    ? paced
    : paced.extend({
        // A plain value, not a fixture function: nothing runs to make it,
        // and the auto fixture it replaces never runs either.
        a11y: SILENT_A11Y,
      });

export { expect } from "@playwright/test";
