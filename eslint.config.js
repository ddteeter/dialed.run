import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import betterTailwind from "eslint-plugin-better-tailwindcss";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
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

/**
 * Shared primitives re-typed by hand (#793, #794; owner grant 2026-11-17).
 * Fallow's `dupes` has a size floor that a three-line span passes under,
 * so a copy of `Bracketed` or a pill constant had nothing to say no. One
 * group per primitive, each landing at zero, each with its own files
 * exempt by name below.
 */
const bracketMessage =
  "Draw bracket notation with <Bracketed> (or <BracketHeadline>) — a typed [ or ] is read aloud (D-150), and a hand copy of Bracketed's markup drifts from it.";
const bracketRestrictions = [
  // `[` or `]` typed as JSX text: heard as "left bracket" (D-150), or a
  // re-typed `Bracketed` (#790's GarminImport) if it is hidden.
  {
    selector: String.raw`JSXText[value=/[\[\]]/]`,
    message: bracketMessage,
  },
  // `{`[${tag}]`}`: the Desk heads' form of the same thing (#792).
  {
    selector: String.raw`JSXExpressionContainer > TemplateLiteral > TemplateElement:first-child[value.raw=/^\[/]`,
    message: bracketMessage,
  },
  {
    selector: String.raw`JSXExpressionContainer > Literal[value=/^\[/]`,
    message: bracketMessage,
  },
];

/**
 * `font-mono` spelled out in a class string (#794): the mono ramp is
 * `Mono`, or `MONO_CLASS` / `MONO_CASED_CLASS` for a link, a button, a
 * field or a paragraph, which a span cannot be. Not under `src/ui`, where
 * the ramp is defined and its primitives compose it. A breakpoint's
 * `desk:font-mono` is left alone: a switch of face at a width is not a
 * step the constants can name (VerdictBacklog's slot word).
 */
const handTypedMono = String.raw`(?<![\w:-])font-mono(?![\w-])`;
const monoMessage =
  "Use <Mono>, or MONO_CLASS / MONO_CASED_CLASS from ui for a link, button or field — font-mono typed by hand drifts from the ramp.";
const monoRestrictions = [
  { selector: `Literal[value=/${handTypedMono}/]`, message: monoMessage },
  {
    selector: `TemplateElement[value.raw=/${handTypedMono}/]`,
    message: monoMessage,
  },
];

/**
 * A pill control typed by hand (#793; owner, 2026-11-17): `rounded-pill`
 * with a hit area (`target` or `cursor-pointer`) and a label's weight,
 * which every ruled kind sets (R58·308) — the ink pill, the hairline pill,
 * the Desk's chalk and quiet pills, all in `src/ui/form.tsx`. `rounded-pill`
 * is also the only full-round radius, so chips, badges, avatars, dots and
 * round icon buttons wear it too; they set no weight and are not pills.
 * A template is read a quasi at a time, so the three marks have to meet
 * in one stretch of literal text between `${…}`s to be seen.
 */
const handTypedPill = String.raw`^(?=.*(?<![\w-])rounded-pill(?![\w-]))(?=.*(?<![\w-])(?:target|cursor-pointer)(?![\w-]))(?=.*(?<![\w-])font-(?:bold|semibold)(?![\w-]))`;
const pillMessage =
  "Use the pill constants from ui (INK_PILL, SECONDARY_PILL, CHALK_PILL, QUIET_PILL) — a hand-typed pill drifts from its kind (R58·308).";
const pillRestrictions = [
  { selector: `Literal[value=/${handTypedPill}/]`, message: pillMessage },
  {
    selector: `TemplateElement[value.raw=/${handTypedPill}/]`,
    message: pillMessage,
  },
];

/**
 * The groups, by name, for `primitiveExemptions`.
 */
const primitiveGroups = {
  brackets: bracketRestrictions,
  mono: monoRestrictions,
  pills: pillRestrictions,
};

/**
 * Files exempt from a group, by literal path (not a glob), each with the
 * groups it is exempt from and why. One block per file, generated: a file
 * matched by two exemption blocks would keep only the later one's
 * selectors, since `no-restricted-syntax` is replaced, not merged.
 */
const primitiveExemptions = {
  // The primitives themselves: each is the one place its glyphs belong.
  "src/ui/Bracketed.tsx": ["brackets"],
  "src/ui/BracketHeadline.tsx": ["brackets"],
  // The lockup's brackets are the brand's colour, not notation.
  "src/ui/Wordmark.tsx": ["brackets"],
  // `PendingWords`: the waiting device's breathing brackets; and where the
  // pill constants are defined.
  "src/ui/form.tsx": ["brackets", "pills"],
  // The verdict scale's brackets close on the chosen cell: a motion
  // device of their own, hidden from a reader.
  "src/modules/feed/entries/components/VerdictForm.tsx": ["brackets"],
  // react-email: inline styles only, no Tailwind and so no Bracketed.
  "src/modules/email/EmailLayout.tsx": ["brackets"],
  // A satori card is an image: nothing reads its brackets aloud.
  "src/modules/ops/public-web/og/cards.tsx": ["brackets"],
  // Google's own button spec, not one of ours.
  "src/modules/auth/google-button.tsx": ["pills"],
  // Ruled exceptions, drawn as their own: A2's ink-edged Change and its
  // pair on the hi-viz card (R58·308), and AF1's outline-to-filled
  // audience toggle (R55·171).
  "src/modules/feed/attach/components/AttachKit.tsx": ["pills"],
  // A field's action: Find, the hairline pill at the field's own height
  // beside it (R58·308), and Use this under the place it found; neither
  // is a column's button, so 167.2's width rule does not reach them.
  "src/ui/CityFinder.tsx": ["pills"],
  "src/modules/feed/entries/components/OwnerAudience.tsx": ["pills"],
};

/**
 * Every primitive group but the ones named.
 */
function primitiveRestrictions(without = []) {
  return Object.entries(primitiveGroups).flatMap(([group, restrictions]) =>
    without.includes(group) ? [] : restrictions,
  );
}

/**
 * The whole set for one exempt file: what the blocks above give it, less
 * its groups. The auth module takes no cross-lane rules (its block below).
 */
function exemptBlock(path, without) {
  return {
    files: [path],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...baseRestrictions,
        ...(path.startsWith("src/modules/auth/") ? [] : crossLaneRestrictions),
        ...primitiveRestrictions(
          path.startsWith("src/ui/") ? [...without, "mono"] : without,
        ),
      ],
    },
  };
}

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
      // Scripts bundled with a skill, beside its SKILL.md. They are agent
      // tooling, not code the app ships, and a Workflow script cannot meet
      // these rules at all: it ends in a top-level `return` and calls
      // globals the harness supplies (`agent`, `pipeline`, `args`). Ignored
      // so a skill can carry its script as a file instead of a fenced block
      // in Markdown (owner, 2026-11-14). tsc still checks any `.ts` here.
      ".claude/skills/",
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
      // New in recommended at unicorn 79: it rejects the ` * ` gutter of a
      // JSDoc block, which is this repo's comment style in over 1,100
      // files. A formatting preference, not a defect (owner, 2026-11-01).
      "unicorn/no-asterisk-prefix-in-documentation-comments": "off",
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
        ...primitiveRestrictions(),
      ],
    },
  },
  {
    // Where the mono ramp is defined: `Mono` and the primitives that
    // compose it spell `font-mono`.
    files: ["src/ui/**/*.ts", "src/ui/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...baseRestrictions,
        ...crossLaneRestrictions,
        ...primitiveRestrictions(["mono"]),
      ],
    },
  },
  {
    // The auth module skips the cross-lane rules (it is where the auth
    // gate is defined), but not the primitives'.
    files: ["src/modules/auth/**/*.ts", "src/modules/auth/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...baseRestrictions,
        ...primitiveRestrictions(),
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
        ...primitiveRestrictions(),
      ],
    },
  },
  ...Object.entries(primitiveExemptions).map(([path, without]) =>
    exemptBlock(path, without),
  ),
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
    /**
     * Plan 161, step 7: the JSX accessibility rules at `recommended`, on
     * what the app renders. It catches at the keyboard what the e2e a11y
     * fixture only sees on a screen a spec reaches.
     *
     * The es-tooling fork, not `eslint-plugin-jsx-a11y` itself: upstream's
     * last release declares ESLint 9 at most, and the fork carries the
     * same rules with ESLint 10 as its peer (owner, 2026-11-03). The rule
     * names are upstream's, so moving back is the import and the prefix.
     */
    ...jsxA11y.configs.recommended,
    files: ["src/**/*.tsx"],
  },
  {
    /**
     * A region may take focus, beside `recommended`'s `tabpanel`: a row
     * that scrolls has to be reachable by keyboard (axe's
     * scrollable-region-focusable), and a labelled region is what it is
     * (owner, 2026-11-14, #659). Every other option is `recommended`'s.
     */
    files: ["src/**/*.tsx"],
    rules: {
      "jsx-a11y-x/no-noninteractive-tabindex": [
        "error",
        {
          tags: [],
          roles: ["tabpanel", "region"],
          allowExpressionValues: true,
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
