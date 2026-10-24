---
paths:
  - "src/ui/**"
  - "src/**/*.tsx"
  - "src/**/*.css"
  - "e2e/**"
---

# UI: tokens, design truth, motion, forms

Loaded when you touch a component, a stylesheet or an e2e spec.

## Styling: the `@theme` block is the index

Tailwind v4 + the brand tokens in `src/ui/tokens.css` (`docs/product.md`
§Brand). Fonts: Archivo / Archivo Black / IBM Plex Mono.

**`src/styles.css`'s `@theme inline` block is the index of what you may
type.** Task 113 cleared Tailwind's default namespaces (`--color-*`,
`--text-*`, `--radius-*`, … set to `initial`), so `text-sm`, `rounded-md` and
`bg-slate-500` do not exist. What exists is exactly what that block defines.
Read it before reaching for a utility you remember from another project.

Two lint rules hold this (`eslint.config.js`):

- `better-tailwindcss/no-unknown-classes` asks Tailwind's own compiler
  whether each class exists against our theme. **A class Tailwind does not
  know is otherwise dropped in silence** — an unstyled element and a green
  suite. It reads `className` and consts named `*class*`/`*CLASS*`; a class
  assembled at runtime is still invisible to it, so do not build class names
  by concatenation.
- No arbitrary values on a scale property (`text-[11px]`, `gap-x-[7px]`).
  `env(…)`, `var(…)` and grid track templates are allowed. Raw colour is
  `test/architecture/palette-only.test.ts`'s.

## Contracts outrank artboards

The bundle in `design/` carries two kinds of thing (owner's call, 2026-09-17):

- **Contracts** — `design/tokens.js` (type, mono ramp, spacing, radius,
  breakpoints, measures), `Theme.dc.html`'s T1 colour table,
  `design/motion.js`, `design/icons.js`, `Form Contract.dc.html`,
  `Desktop Contract.dc.html`, `Accessibility Contract.dc.html`. **The truth
  for values.** Every number you type comes from one of them.
- **Artboards** — the `*.dc.html` screen boards. **The truth for
  composition**: what a screen contains, where it sits, the hierarchy, the
  copy, which states exist.

Where they disagree, **the contract wins and the drawing will not catch up**:
`tokens.js`'s PRECEDENCE block says a size on a board that is not in the
scale is a COLLAPSE entry — move it to the nearest step — not a token and not
drift. **Never measure a board. Read the contract.** For a screen that is
already built, a difference from its board is drift unless it is recorded.

## Undesigned surfaces (placeholder protocol)

UI with no artboard or `docs/product.md` screen ID is fine to build —
inventing design language is not:

- Compose ONLY existing `ui/` primitives, the brand tokens, and
  bracket-notation text. Never a new glyph, emoji, icon, icon library,
  colour, or font. A text label in the existing system is always the correct
  placeholder (the 🔔-emoji bell is the canonical violation).
- **Icons come from `ui/`'s `<Icon name="…">`** (manifest in
  `src/ui/icons.tsx`). A glyph not in the manifest is itself an undesigned
  surface: request it via `docs/design-deltas.md`.
- Add (or extend) the surface's entry in `docs/design-deltas.md`'s open queue
  in the same PR, and list it under **"Design deltas"** in the PR body.

## Motion

Motion comes from the Motion Doctrine (`design/motion.js`, ported to
`src/ui/motion.css`'s `--dur-*`/`--ease-*` vars and `DURATION`/`EASING` in
`src/ui/motion.ts`).
Every transition uses those tokens; `test/ui/motion-tokens-only.dom.test.tsx`
rejects a raw `ms`/`s` value or `cubic-bezier(` anywhere else. Only surfaces
in the doctrine's per-surface map animate; anything else stays still until
requested via design-deltas. The NEVER list is binding: no
bounce/spring/overshoot, no spinners or skeleton shimmer (brackets breathe
instead), no scroll-driven motion, nothing over 400ms, no stagger except the
dressing-order reveal. Reduced motion collapses to a 90ms opacity change —
never to zero.

## Forms use the primitives, always

`docs/product.md` §Forms & failure is the contract; `ui/form.tsx` +
`ui/use-form-submit.ts` are the implementation. A form that hand-rolls any of
`useFormSubmit`, `FormField`, `TextField`, `FormStatus`, `FormErrorSummary`,
`FormFailureBand` or `SubmitButton` is a review failure.
`test/architecture/forms-use-primitives.test.ts` checks that a `<form>` is
wired through `useFormSubmit`/`FormShell`; the field markup is still yours to
get right.

- **Never the `disabled` attribute** — it drops focus and stops announcing.
  `aria-disabled` + `aria-busy`, with the double-submit guard in the handler.
  `test/architecture/no-disabled-attribute.test.ts` enforces it.
- **Pink is action, never failure.** A field error is marked by border weight
  and a hi-viz band, never by hue alone, and nothing in the failure path
  animates.
- **Error copy lives in the schema**, in zod's `message`. A hand-written
  client rule (`if (!email.includes("@"))`) is a bug: add it to the schema,
  which both sides share.

## Components and mutation testing

A component never imports a server function (root CLAUDE.md); it takes one as
a prop typed with the server function's own shape. Every `.tsx` under `src/ui`
and `src/modules` is in the mutation ratchet — see
`.claude/rules/testing.md` for what Stryker does and does not mutate in JSX.
