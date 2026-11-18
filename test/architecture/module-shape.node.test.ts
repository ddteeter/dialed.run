/**
 * The module ratchet (design 240, #796 step 3): each module's fan-out,
 * each door's width, the imports that go around a module's doors and the
 * files in each unit stay within budget, or at the number pinned in
 * `module-shape.json`, which only goes down. What each number counts, and
 * the budgets, are in `scripts/modules/shape.ts`.
 *
 * When this fails on a number that rose: bring it back down, or propose a
 * sub-module (CLAUDE.md). When it fails on one that fell: `npm run
 * modules:pin` lowers the pin. `npm run modules:pin -- --print` shows
 * every number.
 *
 * In the `node` project because the imports are read by
 * dependency-cruiser and the doors by the TypeScript compiler, neither of
 * which the workers pool can load.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readShapeFacts } from "../../scripts/modules/read";
import {
  measureShape,
  pinsSchema,
  shapeProblems,
} from "../../scripts/modules/shape";

const shape = measureShape(await readShapeFacts());
const pins = pinsSchema.parse(
  JSON.parse(readFileSync("test/architecture/module-shape.json", "utf8")),
);

describe("the module shape", () => {
  it("reads the modules", () => {
    expect(Object.keys(shape.fanOut)).toContain("feed");
    expect(shape.doorWidth.feed).toBeGreaterThan(0);
  });

  it("is within budget, or at its pin", () => {
    expect(shapeProblems(shape, pins)).toStrictEqual([]);
  });
});
