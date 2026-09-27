import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EMAIL_PALETTE } from "../../src/modules/email/palette";

/**
 * An email's literal colours, pinned to the light-column tokens they copy
 * (`ops/og/palette`'s pattern). In the ui project because it reads
 * `tokens.css` off disk, which the workers pool cannot.
 */
const tokens = readFileSync("src/ui/tokens.css", "utf8");
const light = tokens.slice(0, tokens.indexOf('[data-ground="ink"]'));

function valueOf(token: string): string | undefined {
  return new RegExp(String.raw`${token}:\s*(#[0-9a-f]{6})`, "iu")
    .exec(light)?.[1]
    ?.toLowerCase();
}

describe("EMAIL_PALETTE", () => {
  it.each([
    ["ground", "--chalk"],
    ["panel", "--panel"],
    ["ink", "--night-run"],
    ["action", "--course-pink"],
    ["quiet", "--quiet"],
    ["muted", "--muted"],
    ["hairline", "--hairline"],
  ] as const)("%s is tokens.css's %s", (role, token) => {
    expect(valueOf(token)).toBe(EMAIL_PALETTE[role]);
  });
});
