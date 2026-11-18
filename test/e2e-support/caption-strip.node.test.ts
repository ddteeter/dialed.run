/**
 * `e2e/support/caption-strip.ts` reads the caption font from disk, so it
 * runs in the `node` project. A stand-in records what the page was asked
 * to do; what a caption looks like is `captionPage`'s, tested beside it.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { STRIP_HEIGHT, captionPage } from "../../e2e/support/caption";
import type { Frame } from "../../e2e/support/caption";
import {
  CAPTION_FONT,
  captionScenes,
  fontDataUrl,
} from "../../e2e/support/caption-strip";
import type { CaptionCamera } from "../../e2e/support/caption-strip";

type Call =
  | { readonly viewport: Frame }
  | { readonly content: string }
  | { readonly screenshot: string };

function camera(): CaptionCamera & { readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    setViewportSize: (viewport) => {
      calls.push({ viewport });
      return Promise.resolve();
    },
    setContent: (content) => {
      calls.push({ content });
      return Promise.resolve();
    },
    screenshot: ({ path: file }) => {
      calls.push({ screenshot: file });
      return Promise.resolve();
    },
  };
}

describe("fontDataUrl", () => {
  it("is the file's bytes as a woff2 data URL", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "caption-strip-"));
    const file = path.join(dir, "face.woff2");
    writeFileSync(file, Buffer.from([0, 1, 2, 250]));
    expect(fontDataUrl(file)).toBe("data:font/woff2;base64,AAEC+g==");
  });

  it("reads the app's own IBM Plex Mono", () => {
    expect(CAPTION_FONT).toBe("public/fonts/ibm-plex-mono-500-latin.woff2");
    expect(readFileSync(CAPTION_FONT).length).toBeGreaterThan(0);
  });
});

describe("captionScenes", () => {
  it("sizes the page to the strip, then shoots each caption in order", async () => {
    const page = camera();
    const scenes = await captionScenes(
      page,
      [
        { text: "First · line", startMs: 0, audio: "a.aiff" },
        { text: "Second", startMs: 1200 },
      ],
      1280,
      "out/dir",
    );
    const fontUrl = fontDataUrl(CAPTION_FONT);
    expect(page.calls).toEqual([
      { viewport: { width: 1280, height: STRIP_HEIGHT } },
      { content: captionPage("First · line", fontUrl, 1280) },
      { screenshot: path.join("out/dir", "caption-0.png") },
      { content: captionPage("Second", fontUrl, 1280) },
      { screenshot: path.join("out/dir", "caption-1.png") },
    ]);
    expect(scenes).toEqual([
      {
        startMs: 0,
        audio: "a.aiff",
        caption: path.join("out/dir", "caption-0.png"),
      },
      { startMs: 1200, caption: path.join("out/dir", "caption-1.png") },
    ]);
  });

  it("captions a phone frame at its own width", async () => {
    const page = camera();
    await captionScenes(page, [{ text: "x", startMs: 0 }], 390, "d");
    expect(page.calls.slice(0, 2)).toEqual([
      { viewport: { width: 390, height: STRIP_HEIGHT } },
      { content: captionPage("x", fontDataUrl(CAPTION_FONT), 390) },
    ]);
  });
});
