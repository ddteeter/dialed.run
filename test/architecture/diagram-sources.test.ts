/**
 * Every step of every story names where it was read, and the name still
 * resolves (design 229, step 3): the path is a file, and the file holds
 * each symbol. A move or a rename that leaves a story behind fails here.
 * The comment's form is in `scripts/diagrams/anchors.ts`.
 */
import { describe, expect, it } from "vitest";

import { anchorProblems, readStories } from "../../scripts/diagrams/anchors";

const model: Record<string, string> = import.meta.glob(
  "../../docs/diagrams/**/*.c4",
  { query: "?raw", import: "default", eager: true },
);

/**
 * What a source comment may cite. A story citing a file outside these
 * fails as "not a file": widen the glob for it.
 */
const sources: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "../../wrangler.jsonc"],
  { query: "?raw", import: "default", eager: true },
);

function repoRelative(
  files: Record<string, string>,
): [path: string, text: string][] {
  return Object.entries(files).map(([path, text]) => [
    path.replace(/^(?:\.\.\/)+/u, ""),
    text,
  ]);
}

const files = new Map(repoRelative(sources));

const stories = repoRelative(model).flatMap(([file, text]) =>
  readStories(file, text),
);

describe("the stories' source comments", () => {
  it("reads the flows", () => {
    expect(stories.map((story) => story.view)).toContain("importStory");
  });

  it("anchor every step to a file and symbols that exist", () => {
    expect(anchorProblems(stories, files)).toStrictEqual([]);
  });
});
