/**
 * Part of `npm run diagrams:check` (design 229, step 3): the reader in
 * `scripts/diagrams/anchors.ts` finds steps line by line, and this holds
 * it to LikeC4's own model, so a step it cannot see fails here instead of
 * going unchecked by `test/architecture/diagram-sources.test.ts`.
 */
import { LikeC4 } from "likec4";

import { stepCountProblems } from "./diagrams/anchors";
import { readModelStories } from "./diagrams/model-files";

const likec4 = await LikeC4.fromWorkspace("docs/diagrams", { logger: false });
const model = await likec4.computedModel();

const counted = new Map<string, number>();
for (const view of model.views()) {
  if (view.$view._type === "dynamic") {
    counted.set(view.id, view.$view.edges.length);
  }
}

const problems = stepCountProblems(readModelStories(), counted);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
