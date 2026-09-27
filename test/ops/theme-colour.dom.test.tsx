import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { SITE_META } from "../../src/modules/ops/og/site-head";

/**
 * The browser-chrome colour, written where a CSS variable cannot reach: a
 * `<meta name="theme-color">` and a static JSON manifest. Both are copies
 * of the `--night-run` token (the icon tile's ink), so both are pinned to
 * `tokens.css` here rather than trusted.
 *
 * In the ui project because it reads files off disk, from the repo root
 * where vitest runs.
 */

function nightRun(): string {
  const tokens = readFileSync("src/ui/tokens.css", "utf8");
  const match = /--night-run:\s*(#[0-9a-f]{6})/iu.exec(tokens);
  if (match?.[1] === undefined) throw new Error("no --night-run in tokens.css");
  return match[1].toLowerCase();
}

const manifestSchema = z.object({
  theme_color: z.string(),
  background_color: z.string(),
});

describe("the theme colour is --night-run", () => {
  it("in the page's theme-color meta", () => {
    const meta = SITE_META.find(
      (tag) => "name" in tag && tag.name === "theme-color",
    );

    expect(meta?.content.toLowerCase()).toBe(nightRun());
  });

  it("in the web manifest, for the chrome and the splash", () => {
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")),
    );

    expect(manifest.theme_color.toLowerCase()).toBe(nightRun());
    expect(manifest.background_color.toLowerCase()).toBe(nightRun());
  });
});
