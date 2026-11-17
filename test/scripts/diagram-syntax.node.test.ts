/**
 * `scripts/diagrams/syntax.ts` reads with the TypeScript compiler, which
 * the workers pool cannot load, so it runs in the `node` project.
 */
import { describe, expect, it } from "vitest";

import { fileSyntax, mainEntries } from "../../scripts/diagrams/syntax";

const MAIN = [
  `import { handle } from "./modules/runs";`,
  `/* export class Retired {} */`,
  `// export function retired() {}`,
  `export default {`,
  `  // email(message) {},`,
  `  async fetch(request): Promise<Response> {`,
  `    const options = { retry(x: number) { return x; }, queue: 1 };`,
  `    return handle(request, options);`,
  `  },`,
  `  queue: drain,`,
  `  scheduled,`,
  `} satisfies ExportedHandler;`,
].join("\n");

describe("mainEntries", () => {
  it("names each handler on the default export, under satisfies, past comments", () => {
    expect(mainEntries("src/server.ts", MAIN)).toStrictEqual([
      "fetch",
      "queue",
      "scheduled",
    ]);
  });

  it("reads the object under `as` and parentheses too", () => {
    expect(
      mainEntries("src/server.ts", "export default ({ fetch } as Handler);"),
    ).toStrictEqual(["fetch"]);
  });

  it("names every other export, so a closed list can refuse it", () => {
    const text = [
      MAIN,
      "export class Room {}",
      "export function helper() {}",
      "export const limit = {",
      "  a: 1,",
      "};",
      `export { Workflow } from "./workflow";`,
    ].join("\n");

    expect(mainEntries("src/server.ts", text)).toStrictEqual([
      "fetch",
      "queue",
      "scheduled",
      "export class Room",
      "export function helper",
      "export const limit = {",
      `export { Workflow } from "./workflow";`,
    ]);
  });

  it("names a default export that is not an object, rather than reading nothing", () => {
    expect(
      mainEntries("src/server.ts", "export default createApp({\n  a: 1,\n});"),
    ).toStrictEqual(["export default createApp({"]);
  });
});

describe("fileSyntax", () => {
  it("finds a createServerFn call, not a mention in a comment or a string", () => {
    expect(
      fileSyntax(
        "src/modules/runs/functions.ts",
        `export const f = createServerFn({ method: "GET" }).handler(go);`,
      ).createsServerFunction,
    ).toBe(true);
    expect(
      fileSyntax(
        "src/ui/use-form-submit.ts",
        `// createServerFn() is wired in a route\nconst s = format("createServerFn(");`,
      ).createsServerFunction,
    ).toBe(false);
  });

  it("reports an import of a computed path, and only that", () => {
    const text = [
      `const a = await import("../products");`,
      "const b = await import(`../closet`);",
      "const c = await import(`../${name}`);",
      `const d = await import(target);`,
      "const e = `${String(count)} import(s) stalled`;",
      `type F = import("../auth").X;`,
    ].join("\n");

    expect(
      fileSyntax("src/modules/feed/x.ts", text).computedImports,
    ).toStrictEqual(["import(`../${name}`)", "import(target)"]);
  });

  it("reads JSX, whose text holds apostrophes", () => {
    const text = [
      `export function A() {`,
      `  return <p>Don't {go()}</p>;`,
      `}`,
      `const f = await import(where);`,
    ].join("\n");

    expect(
      fileSyntax("src/modules/feed/A.tsx", text).computedImports,
    ).toStrictEqual(["import(where)"]);
  });
});
