/**
 * Renders the caption strip's PNGs, for both muxes: `scripts/demo-mux.ts`
 * (PR demos, design 180) and `scripts/diagram-record.ts` (diagram videos,
 * design 229). One copy since #851; the two had grown a near-copy each.
 *
 * What a caption looks like is `captionPage` in `caption.ts`. This file
 * reads the font from disk and drives a page through each caption, so its
 * tests run in the `node` project with a stand-in for the page.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { STRIP_HEIGHT, captionPage } from "./caption";
import type { Cue, Frame, Scene } from "./caption";

/**
 * IBM Plex Mono, the caption's face: the app's own file, so the strip
 * matches the mono the app renders.
 */
export const CAPTION_FONT = "public/fonts/ibm-plex-mono-500-latin.woff2";

/**
 * A font file as a data URL, so the caption page needs no server.
 */
export function fontDataUrl(file: string): string {
  return `data:font/woff2;base64,${readFileSync(file).toString("base64")}`;
}

/**
 * The part of a Playwright page this uses, so a test can stand in for it.
 */
export interface CaptionCamera {
  setViewportSize(size: Frame): Promise<void>;
  setContent(html: string): Promise<void>;
  screenshot(options: { path: string }): Promise<unknown>;
}

/**
 * Renders each cue's caption to `caption-<n>.png` in `dir`, at the strip's
 * size for a frame `width` wide, and returns the scenes to mux: each
 * cue's start and spoken line, with its caption's file.
 */
export async function captionScenes(
  camera: CaptionCamera,
  cues: readonly Cue[],
  width: number,
  dir: string,
): Promise<Scene[]> {
  const fontUrl = fontDataUrl(CAPTION_FONT);
  await camera.setViewportSize({ width, height: STRIP_HEIGHT });
  const scenes: Scene[] = [];
  for (const [index, { text, ...timing }] of cues.entries()) {
    const caption = path.join(dir, `caption-${String(index)}.png`);
    await camera.setContent(captionPage(text, fontUrl, width));
    await camera.screenshot({ path: caption });
    scenes.push({ ...timing, caption });
  }
  return scenes;
}
