# Proposed: reject arbitrary-value utilities and raw hex (task 113)

`eslint.config.js` is a forbidden zone, so this is the rule, not the commit.
Paste the selectors into `crossLaneRestrictions` and it is done.

## Why a rule is still needed after the namespaces are cleared

Task 113 cleared Tailwind's default `--text-*`, `--radius-*`, `--tracking-*`,
`--leading-*`, `--breakpoint-*`, `--container-*`, `--font-weight-*` and
`--color-*` namespaces, so `text-sm`, `rounded-md`, `sm:`, `font-medium` and
`bg-white` no longer compile. That closes the larger hole — a lane reaching
for a rival scale that was simply present — but not the one the codebase
actually fell into:

```
text-[11px]  tracking-[0.08em]  rounded-[10px]  px-[14px]  text-[#8B8B93]
```

An arbitrary value is not a namespace, so clearing namespaces cannot reach
it. 93 accumulated because nothing said no.

## The rule

`tokens.js` ships nine `LINT` entries and **the intent ports, the patterns do
not**: they match CSS declarations (`font-size:\s*\d`) and this codebase
styles with Tailwind utilities in JSX. Same rules, against what we write.

Modelled on the existing `requireUserId` selector — `no-restricted-syntax`,
already composed as an array here for the documented reason that a later
block replaces rather than merges it.

```js
// eslint.config.js — append to `crossLaneRestrictions`.

// The scale properties, not a catch-all for `-[`: `[grid-area:1/1]` is a
// bare arbitrary *property* and `has-[:focus-visible]` is a variant, and
// neither is a value on a scale. `env(…)` is excluded for the same reason —
// `pb-[env(safe-area-inset-bottom)]` is the device telling us a number.
const arbitraryValue = String.raw`(text|tracking|leading|font|rounded|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|space-x|space-y|gap|gap-x|gap-y|w|h|min-w|min-h|max-w|max-h|size|basis|inset|inset-x|inset-y|top|bottom|left|right|border|border-t|border-b|border-l|border-r|bg|fill|stroke|outline|outline-offset|ring|shadow|decoration|underline-offset|grid-cols|grid-rows|col-span|row-span|aspect|translate-x|translate-y|scale|rotate|duration|delay|ease|z|opacity)-\[(?!env\()`;

const noArbitrary =
  "No arbitrary values. The scale is design/tokens.js, ported in src/styles.css — pick a step (text-body, rounded-card, px-4), or raise a design delta if none fits.";
const noHex =
  "No raw hex. Use a T1 role (bg-panel, text-muted, border-hairline); the values live in src/ui/tokens.css.";

// Four selectors rather than two, because a class string reaches the DOM
// two ways and the second is where the worst of them were hiding:
// `SubmitButton`'s `min-h-[52px] … rounded-[10px] … tracking-[-0.01em]` was
// a template literal, which a `Literal` selector does not see at all.
{ selector: `JSXAttribute[name.name='className'] Literal[value=/${arbitraryValue}/]`, message: noArbitrary },
{ selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=/${arbitraryValue}/]`, message: noArbitrary },
{ selector: `VariableDeclarator > Literal[value=/${arbitraryValue}/]`, message: noArbitrary },
{ selector: `VariableDeclarator > TemplateLiteral > TemplateElement[value.raw=/${arbitraryValue}/]`, message: noArbitrary },

// Theme.dc.html T1: "Every colour in the app comes from a variable in T1; a
// raw hex in component code is a review failure." src/ui/tokens.css is where
// T1's light column lives and the only place a hex belongs.
{ selector: String.raw`JSXAttribute[name.name='className'] Literal[value=/#[0-9A-Fa-f]{3,8}\b/]`, message: noHex },
{ selector: String.raw`JSXAttribute[name.name='className'] TemplateElement[value.raw=/#[0-9A-Fa-f]{3,8}\b/]`, message: noHex },
```

## Measured, not asserted

Run as a standalone flat config over `src` on each side:

| tree                               | reports |
| ---------------------------------- | ------- |
| `main` at this lane's branch point | **56**  |
| this branch                        | **0**   |

56 rather than 93 because a report is per _node_: one className carrying
`text-[11px] tracking-[0.08em]` is one literal and one report.

And it bites on each shape a new one could take — verified with a throwaway
component, not reasoned about:

| written                                           | reported                         |
| ------------------------------------------------- | -------------------------------- |
| `className="text-[14px] rounded-[7px]"`           | yes (one node)                   |
| ``const CLS = `flex rounded-[9px]` ``             | yes                              |
| ``className={`bg-[#abcdef] ${CLS}`}``             | yes, twice — arbitrary _and_ hex |
| `className="duration-[250ms]"`                    | yes (helps task 114)             |
| `pb-[env(safe-area-inset-bottom)]`                | no, by design                    |
| `[grid-area:1/1]`, `has-[:focus-visible]:outline` | no, by design                    |

## What it does not catch

- **An off-step spacing fraction** — `py-1.5` is 6px, `px-3.5` is 14px.
  Tailwind computes those from `--spacing` arithmetically, so they are
  neither an arbitrary value nor a namespace. 24 existed; all 24 are
  collapsed, and a 25th would pass. Catching it needs an enumerated
  allowlist per property, which is a bigger rule than the problem currently
  justifies.
- **`LINT`'s `mono-is-not-prose` and `uppercase-floor`**, both of which need
  an element's text length or its computed step. `uppercase-floor` is now
  partly true by construction — `Mono` owns the only legal uppercase and
  applies it per step — but a hand-written `uppercase` beside a `text-*`
  still lints clean. Five existed; all five are fixed.
- **A class that does not exist at all.** Tailwind drops an unknown utility
  silently, so `text-bdoy` renders unstyled and nothing anywhere complains.
  That is what made this lane's migration dangerous, and no eslint rule can
  see it — it needs the built stylesheet read back. Worth its own check if
  a second lane hits it.
