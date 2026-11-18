/**
 * Reads the facts the module ratchet measures (design 240): the sources
 * and their imports, through the diagram generator's reader, and each
 * door's names. Only the reading is here; what the facts mean is decided
 * in `shape.ts`, which is tested.
 */
import { readFileSync } from "node:fs";

import { readSources } from "../diagrams/sources";
import { mainOf } from "../diagrams/structure";
import { doorNames } from "./doors";
import type { ShapeFacts } from "./shape";

const DOOR = /^src\/modules\/.*\/index\.ts$/u;

/**
The facts about the working tree. Run from the repo root.
*/
export async function readShapeFacts(): Promise<ShapeFacts> {
  const main = mainOf(readFileSync("wrangler.jsonc", "utf8"));
  const { paths, imports } = await readSources(main);
  return {
    paths,
    imports,
    doorNames: new Map(
      paths
        .filter((path) => DOOR.test(path))
        .map((path) => [path, doorNames(path, readFileSync(path, "utf8"))]),
    ),
  };
}
