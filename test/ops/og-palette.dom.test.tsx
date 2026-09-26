import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { OG_PALETTE } from "../../src/modules/ops/og/palette";

/**
 * The share card's literal colours, pinned to the tokens they copy.
 *
 * In the ui project rather than beside the other card tests because this
 * reads `tokens.css` off disk, which the workers pool cannot, and a bare
 * `?raw` CSS import is claimed by the CSS pipeline first.
 */

// From the repo root, where vitest runs: `import.meta.url` is not a file
// URL in every run of the ui project.
const tokens = readFileSync("src/ui/tokens.css", "utf8");

function valueOf(css: string, token: string): string | undefined {
  return new RegExp(String.raw`${token}:\s*(#[0-9a-f]{6})`, "iu")
    .exec(css)?.[1]
    ?.toLowerCase();
}

describe("OG_PALETTE", () => {
  it.each([
    ["ink", "--night-run"],
    ["paper", "--chalk"],
    ["pink", "--course-pink"],
    ["teal", "--split-teal"],
  ] as const)("%s is tokens.css's %s", (role, token) => {
    expect(valueOf(tokens, token)).toBe(OG_PALETTE[role]);
  });

  it.each([
    ["quiet", "--quiet"],
    ["muted", "--muted"],
    ["soft", "--ink-hover"],
  ] as const)("%s is the ink block's %s", (role, token) => {
    const inkBlock = tokens.slice(tokens.indexOf('[data-ground="ink"]'));

    expect(valueOf(inkBlock, token)).toBe(OG_PALETTE[role]);
  });
});
