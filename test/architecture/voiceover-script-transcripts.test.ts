import { describe, expect, it } from "vitest";

import script from "../../docs/launch/voiceover-script.md?raw";

/**
 * `docs/launch/voiceover-script.md` tells the owner what each screen
 * should say, and names the transcript each screen's lines were read from
 * (design 197). A transcript is named after its test's title, so renaming
 * a test moves the file and leaves the script pointing at nothing. This
 * pins every path the script names to a file that exists.
 */

/**
Every checked-in transcript, by its path under `e2e/transcripts/`. Lazy:
only the keys are read.
*/
const ROOT = "../../e2e/transcripts/";
const transcripts = new Set(
  Object.keys(import.meta.glob("../../e2e/transcripts/**/*.txt")).map((key) =>
    key.slice(ROOT.length),
  ),
);

/**
A transcript path as the script writes one: in backticks, a spec file's
folder, then the test's title.
*/
const named = Array.from(
  script.matchAll(/`([^`\n]+\.spec\.ts\/[^`\n]*)`/gu),
  (match) => match[1] ?? "",
);

describe("the VoiceOver script's transcripts", () => {
  it("names transcripts at all, so a change in how it writes them cannot pass on nothing", () => {
    expect(named.length).toBeGreaterThan(20);
    expect(transcripts.size).toBeGreaterThan(named.length);
  });

  it("names only transcripts that exist", () => {
    const missing = named.filter((path) => !transcripts.has(path));
    expect(missing).toEqual([]);
  });
});
