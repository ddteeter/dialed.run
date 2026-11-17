/**
 * The half of `npm run diagrams:stale` that is not git: reads the paths
 * `scripts/diagram-stale.sh` pipes in, one per line, and prints the
 * stories that cite one (design 229, step 3).
 */
import { readFileSync } from "node:fs";

import { staleReport, staleStories } from "./diagrams/anchors";
import { readModelStories } from "./diagrams/model";

const changed = readFileSync(0, "utf8")
  .split("\n")
  .filter((path) => path !== "");

const stale = staleStories(await readModelStories(), changed);
console.log(staleReport(stale));
