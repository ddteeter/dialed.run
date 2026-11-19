/**
 * `scripts/modules/doors.ts` reads with the TypeScript compiler, which
 * the workers pool cannot load, so it runs in the `node` project.
 */
import { describe, expect, it } from "vitest";

import { doorNames } from "../../scripts/modules/doors";

const DOOR = "src/modules/feed/index.ts";

describe("doorNames", () => {
  it("names each re-export by the name it leaves under, types included", () => {
    const text = [
      `export { retractEntry, deleteRun as removeRun, type Scope } from "./retract";`,
      `export type { CoverageBand } from "./coverage";`,
      `export * as ladder from "./ladder-read";`,
    ].join("\n");

    expect(doorNames(DOOR, text)).toStrictEqual([
      "retractEntry",
      "removeRun",
      "Scope",
      "CoverageBand",
      "ladder",
    ]);
  });

  it("names what the file declares and exports itself", () => {
    const text = [
      `import { one } from "./one";`,
      `const hidden = 1;`,
      `export const first = one, second = hidden;`,
      `export function run() {}`,
      `export class Room {}`,
      `export interface Shape {}`,
      `export type Name = string;`,
      `export enum Kind { A }`,
      `export { hidden };`,
    ].join("\n");

    expect(doorNames(DOOR, text)).toStrictEqual([
      "first",
      "second",
      "run",
      "Room",
      "Shape",
      "Name",
      "Kind",
      "hidden",
    ]);
  });

  it("counts a default export once, however it is written", () => {
    expect(
      doorNames(DOOR, "export default function handle() {}"),
    ).toStrictEqual(["default"]);
    expect(
      doorNames(DOOR, "const handle = 1;\nexport default handle;"),
    ).toStrictEqual(["default"]);
  });

  it("leaves out what is not exported", () => {
    expect(
      doorNames(DOOR, `import { a } from "./a";\nfunction b() { return a; }`),
    ).toStrictEqual([]);
  });

  it("refuses a bare star, whose names only following it would tell", () => {
    expect(() => doorNames(DOOR, `export * from "./retract";`)).toThrow(
      new Error(
        `${DOOR} has an export the module shape cannot count: export * from "./retract";. ` +
          "Write it as named exports (scripts/modules/doors.ts).",
      ),
    );
  });

  it("refuses a destructured export, naming its first line", () => {
    expect(() => doorNames(DOOR, "export const { a,\n  b } = pair;")).toThrow(
      /cannot count: export const \{ a,\. Write it/u,
    );
  });
});
