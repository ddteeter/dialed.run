/**
 * `npm run modules:pin`: measures the module shape (design 240) and
 * rewrites `test/architecture/module-shape.json`, the numbers over
 * budget. It only lowers: a pin that would rise, or a new one, is
 * refused, and added by hand on the owner's say. With `--print` it shows
 * every number and writes nothing.
 *
 * Only the reading and the writing are here. What the numbers are is
 * decided in `scripts/modules/shape.ts`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { readShapeFacts } from "./modules/read";
import {
  measureShape,
  pinsSchema,
  repinned,
  shapeKinds,
} from "./modules/shape";

const PINS = "test/architecture/module-shape.json";

const shape = measureShape(await readShapeFacts());

if (process.argv.includes("--print")) {
  for (const kind of shapeKinds) console.log(kind, shape[kind]);
} else {
  const pins = existsSync(PINS)
    ? pinsSchema.parse(JSON.parse(readFileSync(PINS, "utf8")))
    : undefined;
  try {
    const next = repinned(shape, pins);
    writeFileSync(PINS, `${JSON.stringify(next, undefined, 2)}\n`);
    console.log(`wrote ${PINS}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
