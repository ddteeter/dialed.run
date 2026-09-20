# Proposal — `eslint-plugin-better-tailwindcss` for the unknown-class gap

**Status**: written and measured, not landed. `eslint.config.js` is a
forbidden zone (CLAUDE.md §Forbidden zones), so the config change below is
the owner's to make. Raised in #82 item 1; this document replaces the
hand-rolled `check:styles` script that was in the first draft of PR #83.

## The gap

Tailwind drops an unknown utility in silence. No error, no warning — the
element renders unstyled and every gate stays green, because tsc sees a
string, eslint sees a string, and a component test's `toHaveClass` asserts
the class is in the _attribute_, which it is. Nothing asserts a **rule**
exists for it.

Measured on this branch: `text-bdoy` and `bg-nonesuch` added to
`Wordmark.tsx` pass `typecheck`, `lint`, `build`, `check:bundle` and the
2,832-test suite while neither reaches the stylesheet.

It is not hypothetical. Task 113 clears Tailwind's default namespaces
(`--color-*`, `--text-*`, `--radius-*`, … set to `initial`) so `text-sm`
and `rounded-md` stop existing. That turned roughly 600 styled elements
into unstyled ones in one commit with every check green, and clearing a
namespace is a thing this repo now does deliberately.

## Why a dependency rather than a script

The first draft of PR #83 was ~280 lines of `scripts/check-styles.ts`: a
TypeScript AST walk to extract class tokens, plus a selector-escaping
regex to ask whether the built CSS carried a rule for each. It worked. It
also had two traps that each cost a round, **and both were traps of its own
making**:

- `.text-sm` is a substring of `.text-small`, so a containment test reports
  a class as present that Tailwind dropped — it hid 84 real sites;
- a token touching an interpolation is a fragment, so `` `pb-${size}` ``
  must not be read as a class called `pb-`.

`eslint-plugin-better-tailwindcss` has neither trap, because it never looks
at emitted selectors. Its `no-unknown-classes` rule calls **Tailwind v4's
own `candidatesToCss(classes)`** against the compiled entry point and
reports anything that comes back `null`. That is the authoritative answer to
"is this a class", asked of the only component that knows.

It also already handles what the script handled by hand or not at all:
`group`/`peer` and named groups, prefixes, custom component classes,
concatenated classes, and an `ignore` list. 4.7.0, ~830k downloads/week,
published 2026-08-26.

## Measured on this repo

Run with a throwaway flat config (`--no-config-lookup`), so nothing in the
forbidden zone was touched:

| case                                                                          | result                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------- |
| whole repo, `src/**/*.{ts,tsx}`                                               | **2 reports**, both `breathe` — see below |
| `text-bdoy`, `bg-nonesuch` in a `className` attribute                         | both reported                             |
| `text-sm`, `rounded-md` in a class const                                      | both reported                             |
| 24 variant tokens (`wide:m-0`, `backdrop:bg-ink/60`, `has-[:checked]:bg-ink`) | not reported, correctly                   |
| 9 arbitrary values (`pb-[env(safe-area-inset-bottom)]`, `[grid-area:1/1]`)    | not reported, correctly                   |

**`text-sm` being reported is the finding that matters**: it proves the rule
resolves _our_ theme through `entryPoint`, not Tailwind's defaults. A rule
that answered from the stock scale would call `text-sm` valid and miss the
entire 113 regression shape.

## The config, as measured

```js
// eslint.config.js
import betterTailwind from "eslint-plugin-better-tailwindcss";

{
  files: ["src/**/*.ts", "src/**/*.tsx"],
  plugins: { "better-tailwindcss": betterTailwind },
  settings: {
    "better-tailwindcss": {
      entryPoint: "src/styles.css",
      detectComponentClasses: true,
      // Patterns MUST be fully anchored — `CLASS$` matches nothing, and
      // fails open: the const is simply never linted and the run is green.
      // Cost me two rounds to notice. These cover the class strings held in
      // a const, which are also the ones stryker mutates and the ones
      // carrying documented rules (mono is the tell a value was measured,
      // 1px -> 2px ink marks a field error).
      variables: [
        ["^classNames?$", [{ match: "strings" }]],
        ["^.*CLASS(ES)?$", [{ match: "strings" }]],
        ["^.*[Cc]lass(es)?$", [{ match: "strings" }]],
      ],
    },
  },
  rules: { "better-tailwindcss/no-unknown-classes": "error" },
}
```

Step 1 is `npm i -D eslint-plugin-better-tailwindcss`. **The dependency is
deliberately not in this PR**: knip reports a devDependency nothing imports
as unused and blocks the commit, which is correct — a package installed for
a config that has not landed is dead weight, and suppressing knip to hold it
would be fixing the rule rather than the code. Install it in the same change
that adds the config.

## The one thing that must be decided with it

`.breathe` is the repo's only report, twice, in `src/ui/form.tsx`. It is
real and correct: `breathe` is a hand-written `.breathe` rule in
`src/ui/motion.css` (the Motion Doctrine's breathing brackets), not a
Tailwind utility, so Tailwind genuinely does not know it.

Two ways to settle it, and **the second is better**:

1. `ignore: ["^breathe$"]` in the rule's options. One line, and it puts a
   permanent exception in the config for a class the design system owns.
2. **Convert it to `@utility breathe { … }`** in the CSS. Tailwind then
   registers it, `detectComponentClasses` finds it, the rule goes quiet
   without an exception, and — this is the part worth the change — it
   becomes discoverable the same way every other class is. That is the
   answer to the standing question about custom classes: a class defined as
   an `@utility` is in the same index as the rest of the system, and a
   class defined as a bare `.rule` is not.

`src/ui/motion.css` belongs to **task 114**, so option 2 is 114's to make.
Recommend landing with `ignore: ["^breathe$"]` and a note in 114 to remove
the ignore when it converts the rule.

## What is still not covered

The rule asks _"would Tailwind generate this?"_. It does not ask _"did
Tailwind emit this in the build?"_. Those differ when Tailwind's scanner
never sees the class — a name assembled at runtime, or a file outside
`@source`. The plugin's `no-concatenated-classes` (in its recommended set)
is aimed squarely at the first, which is the common half.

The deleted script asked the second question and would have caught the
residual case. It is not worth 280 lines of tooling to hold that margin;
recorded here so the choice is visible rather than forgotten.

## Related

`eslint-plugin-tailwindcss` v4 (a different package) ships
`no-arbitrary-value` and `no-custom-classname`, which overlap **D-76**'s
hand-written arbitrary-value rule. It is **not** a clean swap:
`no-arbitrary-value` has no allowlist option, and D-76 has to keep
`pb-[env(safe-area-inset-bottom)]` and `[grid-area:1/1]`. Since this repo
forbids `eslint-disable`, an all-or-nothing rule cannot express that. Worth
a look when D-76 is picked up, not a reason to delay it.
