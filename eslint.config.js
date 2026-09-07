import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

/**
 * `no-restricted-syntax` is REPLACED, not merged, when a later flat-config
 * block redefines it. Selectors therefore live in composed arrays rather
 * than in per-block rule definitions — a second block that "adds a rule"
 * silently deletes every selector defined before it, which is exactly the
 * bug that shipped the first draft of the auth-gate rules with the
 * redirect check quietly inert.
 */

/**
Phase 0 house rules (000 §2 typed URLs; CLAUDE.md parse-don't-cast).
*/
const baseRestrictions = [
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
];

/**
 * Cross-lane rules added after the PR #2–#5 review. Each encodes a
 * duplication four parallel lanes actually produced, not one they might.
 *
 * The auth-gate rules (no local requireUserId, no direct auth.api.getSession,
 * no open-coded login redirect) travel with lane 101, which is the PR that
 * introduces the shared gate they point at. A rule naming an import that
 * does not exist yet is worse than no rule.
 */
const crossLaneRestrictions = [
  {
    // Casing is presentation. The brand's uppercase display type is real
    // (docs/product.md §Brand) but belongs in CSS: a shouted string
    // literal also becomes the accessible name, and a screen reader cannot
    // tell a shouted word from an initialism. <Bracketed> applies
    // `uppercase` itself. The 5-character floor spares genuine
    // initialisms and units — GPX, TCX, FIT, KM, MIN.
    selector: String.raw`JSXElement > JSXText[value=/^\s*[A-Z][A-Z ]{4,}\s*$/]`,
    message:
      "Uppercase with a CSS class (or <Bracketed>), not in the string — the literal becomes the accessible name.",
  },
  {
    selector: 'JSXExpressionContainer > Literal[value=/^[A-Z][A-Z ]{4,}$/]',
    message:
      "Uppercase with a CSS class (or <Bracketed>), not in the string — the literal becomes the accessible name.",
  },
];

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
      "no-restricted-syntax": ["error", ...baseRestrictions],
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
    // Application source only.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/modules/auth/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...baseRestrictions,
        ...crossLaneRestrictions,
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
