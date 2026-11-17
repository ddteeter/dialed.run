/**
 * Reads the model's `.c4` files for the scripts in `scripts/` (Node); the
 * test reads the same files through `import.meta.glob`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { readStories, type Story } from "./anchors";

const MODEL = "docs/diagrams";

/**
 * Every dynamic view under `docs/diagrams`, by repo-relative file.
 */
export function readModelStories(): Story[] {
  return readdirSync(MODEL, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".c4"))
    .toSorted((a, b) => a.localeCompare(b))
    .flatMap((entry) => {
      const file = path.join(MODEL, entry);
      return readStories(file, readFileSync(file, "utf8"));
    });
}
