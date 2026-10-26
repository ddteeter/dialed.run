import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import betterTailwind from "eslint-plugin-better-tailwindcss";
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
/**
 * The seconds-timestamp rule, kept separate from `baseRestrictions` only so
 * `src/lib/now.ts` — the one file that may do the division — can compose
 * the others without it. Filtering an array by message text would have
 * worked until someone reworded the message.
 */
const nowSecondsRestriction = {
  // Every timestamp column in src/db/schema*.ts stores whole unix
  // seconds, and `Math.floor(Date.now() / 1000)` had been written out 62
  // times across 36 files before `nowSeconds()` existed. That is a rival
  // truth of the cheapest kind: nothing makes two copies disagree
  // loudly, and the one that drifts — millis into a seconds column, a
  // `round` where the others `floor` — writes a value read back as a
  // date in the year 56000 rather than as an error. The repo already
  // carries a test named "stamps last_run_at in epoch seconds, not
  // milliseconds" because that exact thing was worth guarding once.
  //
  // Matches any division of `Date.now()`, not just the `floor` idiom, so
  // the near-misses are caught too. `src/lib/now.ts` is exempted below —
  // it is the one place the division belongs.
  selector:
    "BinaryExpression[operator='/'] > CallExpression[callee.object.name='Date'][callee.property.name='now']",
  message:
    "Use nowSeconds() from lib/now — dividing Date.now() by hand is how milliseconds reach a seconds column.",
};

const baseRestrictions = [
  nowSecondsRestriction,
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
/**
 * Arbitrary values on a scale property (docs/proposals/113): `text-[11px]`,
 * `rounded-[10px]`, `duration-[250ms]`. The scale is design/tokens.js,
 * ported in src/styles.css; 93 of these accumulated because nothing said no.
 * The scale properties only, not a catch-all for `-[`: `[grid-area:1/1]` is
 * an arbitrary *property* and `has-[:focus-visible]` a variant, and neither
 * is a value on a scale, and neither is a grid track template
 * (`grid-cols-[auto_1fr]`), which is composition. `env(…)` is the device
 * telling us a number; `var(…)`, or a `calc(…)` over one, is a token.
 * Raw hex is `test/architecture/palette-only.test.ts`'s, which also reads
 * inline styles, so it is not repeated here.
 */
const arbitraryValue = String.raw`(?<![\w-])(text|tracking|leading|font|rounded|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|space-x|space-y|gap|gap-x|gap-y|w|h|min-w|min-h|max-w|max-h|size|basis|inset|inset-x|inset-y|top|bottom|left|right|border|border-t|border-b|border-l|border-r|bg|fill|stroke|outline|outline-offset|ring|shadow|decoration|underline-offset|col-span|row-span|aspect|translate-x|translate-y|scale|rotate|duration|delay|ease|z|opacity)-\[(?!env\(|var\(|calc\([^\]]*var\()`;
const noArbitrary =
  "No arbitrary values. The scale is design/tokens.js, ported in src/styles.css — pick a step (text-body, rounded-card, px-4), or raise a design delta if none fits.";

const crossLaneRestrictions = [
  // A class string reaches the DOM as an attribute literal, an attribute
  // template, or a const — `SubmitButton`'s worst offenders were a template
  // literal, which a `Literal` selector does not see at all.
  {
    selector: `JSXAttribute[name.name='className'] Literal[value=/${arbitraryValue}/]`,
    message: noArbitrary,
  },
  {
    selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=/${arbitraryValue}/]`,
    message: noArbitrary,
  },
  {
    selector: `VariableDeclarator > Literal[value=/${arbitraryValue}/]`,
    message: noArbitrary,
  },
  {
    selector: `VariableDeclarator > TemplateLiteral > TemplateElement[value.raw=/${arbitraryValue}/]`,
    message: noArbitrary,
  },
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
    selector: "JSXExpressionContainer > Literal[value=/^[A-Z][A-Z ]{4,}$/]",
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
      // Claude Code's git worktrees, each a full checkout of another
      // branch: `npm run lint` in the primary checkout linted ~2,200 extra
      // files per worktree (measured 2026-10-24) and reported other
      // branches' errors as this one's. Gitignored — the same trap.
      ".claude/worktrees/",
      // `stage:mediapipe` copies four files out of node_modules so the
      // browser can fetch them from our own origin, and two are minified
      // dependency glue: ~2,900 errors between them, which buries every
      // real finding in the run. Gitignored, but flat config does not read
      // .gitignore — the same trap as `.stryker-tmp/` above. CI was green
      // only by step ordering (lint runs before the `pretest`/`prebuild`
      // that stage), so anyone who ran the suite first saw the wall.
      "public/mediapipe/wasm/",
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
      // A drizzle builder is a thenable, not a Promise, and typescript-eslint
      // v8 skips thenables by default — so `db.insert(t).values(v);` with no
      // `await` and no `batch()` sent nothing and linted clean. Measured: 0
      // existing violations when this was turned on.
      "@typescript-eslint/no-floating-promises": [
        "error",
        { checkThenables: true },
      ],
      // New in strict at typescript-eslint 8.71, and wrong here as of 8.72:
      // `SQLiteUpdateSetSource<T>` inside a generic function is a mapped
      // type over T's columns that has no members until T is known, so the
      // rule calls it `{}`. Every caller passes a real table, where the type
      // checks column names and values (`setOnSubject`, `didClaim`). Back on
      // when upstream skips deferred mapped types (R-168).
      "@typescript-eslint/no-generated-empty-object-type": "off",
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
    // The one file allowed to divide `Date.now()`, because it is the
    // function everything else is required to call. Re-stated rather than
    // filtered: `no-restricted-syntax` is REPLACED by a later block (see
    // the note at the top), so this has to name every selector that should
    // still apply here.
    files: ["src/lib/now.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...baseRestrictions.filter(
          (restriction) => restriction !== nowSecondsRestriction,
        ),
        ...crossLaneRestrictions,
      ],
    },
  },
  {
    /**
     * Tailwind drops a class it does not know in silence — no error, an
     * unstyled element and a green suite (docs/proposals/082). This asks
     * Tailwind v4's own `candidatesToCss` against our compiled theme, so
     * `text-sm` (cleared by task 113) is reported, not just typos.
     */
    files: ["src/**/*.ts", "src/**/*.tsx"],
    plugins: { "better-tailwindcss": betterTailwind },
    settings: {
      "better-tailwindcss": {
        entryPoint: "src/styles.css",
        detectComponentClasses: true,
        // Fully anchored, or the pattern matches nothing and fails open:
        // the const is never linted and the run is green.
        variables: [
          ["^classNames?$", [{ match: "strings" }]],
          ["^.*CLASS(ES)?$", [{ match: "strings" }]],
          ["^.*[Cc]lass(es)?$", [{ match: "strings" }]],
        ],
      },
    },
    rules: {
      "better-tailwindcss/no-unknown-classes": [
        "error",
        {
          // Hand-written CSS hooks, not utilities, and they must stay
          // unlayered: `.field-box` was an `@utility` once, and the layer
          // let `input:focus-visible` win and draw a second ring on every
          // field (PR #104; src/ui/a11y.css). `.photo-hatch` shares the
          // hatch rule with `.ink-partial` (src/ui/ink.css).
          ignore: ["^field-box$", "^photo-hatch$"],
        },
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
