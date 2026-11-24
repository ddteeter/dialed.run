/**
 * `eslint.config.js` with `linterOptions.noInlineConfig`: a rule comment in
 * a file does not change which rules apply to it. The `node` project:
 * ESLint and the TypeScript project service cannot load in workerd.
 */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const LINT_MS = 120_000;

async function ruleIds(text: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(text, {
    filePath: "src/lib/ids.ts",
  });
  return (result?.messages ?? []).map((message) => message.ruleId ?? "");
}

describe("a rule comment in a file", () => {
  it(
    "leaves the rule on",
    async () => {
      const ids = await ruleIds(
        '/* eslint no-debugger: "off" */\nexport function f(): void {\n  debugger;\n}\n',
      );
      expect(ids).toContain("no-debugger");
    },
    LINT_MS,
  );
});
