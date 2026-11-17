/**
 * Every step of every story names where it was read, and the name still
 * resolves (design 229, step 3): the path is a file, and the file holds
 * each name. A move or a rename that leaves a story behind fails here.
 * The comment's form is in `scripts/diagrams/anchors.ts`.
 *
 * In the `node` project because the steps come from LikeC4's parse tree,
 * which the workers pool cannot load.
 */
import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { anchorProblems } from "../../scripts/diagrams/anchors";
import { readModelStories } from "../../scripts/diagrams/model";

const stories = await readModelStories();

const cited = new Set(
  stories.flatMap((story) =>
    story.steps.flatMap((step) => (step.cites ?? []).map((cite) => cite.path)),
  ),
);

const files = new Map(
  [...cited]
    .filter((path) => existsSync(path) && statSync(path).isFile())
    .map((path) => [path, readFileSync(path, "utf8")]),
);

describe("the stories' source comments", () => {
  it("reads the flows", () => {
    expect(stories.map((story) => story.view)).toContain("importStory");
  });

  it("anchor every step to a file and names that exist", () => {
    expect(anchorProblems(stories, files)).toStrictEqual([]);
  });
});
