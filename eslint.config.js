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
 */
const crossLaneRestrictions = [
  {
    // Four copies across three lanes had already become three different
    // error types (Error / UnauthenticatedError / AuthRequiredError), so
    // no caller could reliably tell "signed out" from "broken".
    selector:
      "FunctionDeclaration[id.name=/^(requireUserId|requireUser|requireSession)$/], VariableDeclarator[id.name=/^(requireUserId|requireUser|requireSession)$/]",
    message:
      "Don't redefine the auth gate. Import { requireUserId } from modules/auth (server functions) or { requireSession } from modules/auth/functions (route loaders).",
  },
  {
    // routes/feed/photo.$.tsx reached past the module for a session, which
    // is how a fifth idiom starts.
    selector:
      "CallExpression[callee.property.name='getSession'][callee.object.property.name='api'][callee.object.object.name='auth']",
    message:
      "Don't call auth.api.getSession directly. Use requireUserId / requireSession / getSession from modules/auth.",
  },
  {
    // The redirect-to-login dance is the guard's job, once.
    selector:
      "CallExpression[callee.name='redirect'] Property[key.name='to'][value.value='/auth/login']",
    message:
      "Use requireSession() from modules/auth/functions instead of hand-rolling getSession + redirect.",
  },
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
      // Every stryker run leaves a full copy of the project in a sandbox
      // under here, so linting it means linting the repo N+1 times — which
      // OOMs the eslint process rather than failing cleanly. Gitignored,
      // but flat config does not read .gitignore.
      ".stryker-tmp/",
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
  {
    /**
     * Two test files, named rather than a `test/**` blanket, because the
     * exemption is about one specific fact and should not spread quietly.
     *
     * `useFormSubmit` *parses* a rejection instead of using `instanceof`,
     * because a server function's rejection has crossed a structured clone
     * and arrives as a plain object with no prototype. These tests must
     * therefore reject with the shapes production actually produces —
     * plain objects, bare strings, malformed payloads. Wrapping them in an
     * `Error` to satisfy the rule makes every one of them assert a case
     * that cannot occur, which is worse than not testing at all.
     *
     * Turning it off here rather than dodging it: the tests previously
     * routed through a helper that `throw`s (allowed, since
     * `only-throw-error` permits an `unknown` throw) purely to sit outside
     * this rule. A construct that exists to avoid a rule invites being
     * "corrected" — a fixer did exactly that, rewriting a rejection to
     * `Object.assign(new Error(), { issues })` and silently destroying
     * what the test proved.
     */
    files: [
      "test/ui/form.dom.test.tsx",
      "test/modules/verdict-form.dom.test.tsx",
    ],
    rules: {
      "@typescript-eslint/prefer-promise-reject-errors": "off",
    },
  },
  prettier,
);
