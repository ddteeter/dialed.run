import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "coverage/",
      ".guardrails/",
      "src/routeTree.gen.ts",
      "worker-configuration.d.ts",
      "design/",
      "plan/",
      ".dependency-cruiser.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  unicorn.configs.recommended,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // House rule (000 §2): no string-literal app URLs — typed Link/navigate only.
      // House rule (CLAUDE.md): no structural casts on parsed JSON.
      "no-restricted-syntax": [
        "error",
        {
          selector: String.raw`JSXAttribute[name.name=/^(href|action)$/] Literal[value=/^\u002F/]`,
          message:
            "No string-literal app URLs. Use TanStack Router's typed <Link to> / navigate.",
        },
        {
          selector: String.raw`CallExpression[callee.name='fetch'] > Literal[value=/^\u002F/]:first-child`,
          message:
            "No string-literal app URLs in fetch. Call server functions directly.",
        },
        {
          selector:
            "TSAsExpression[expression.callee.object.name='JSON'][expression.callee.property.name='parse']",
          message:
            "Parse, don't cast: JSON.parse output goes through a zod schema in lib/codecs.",
        },
      ],
      // Workers/React codebase adjustments to unicorn defaults:
      "unicorn/prevent-abbreviations": "off",
      "unicorn/name-replacements": "off",
      "unicorn/filename-case": [
        "error",
        { cases: { kebabCase: true, pascalCase: true } },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "sonarjs/no-duplicate-string": "off",
    },
  },
  prettier,
);
