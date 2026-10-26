# Design: 158 unique field ids (R-165)

## Problem

A form repeated on every row of the Desk's Review list — RECEIVED ON on
copyright holds, the CyberTipline report number on quarantine rows — gave
its field the same `id` on every row, because `TextField` used the field's
`name` as its id. Every later row's `<label for>` named the first row's
input, so a screen reader heard the later fields unlabelled. The message id
and `field()`'s `aria-describedby` were built from the `name` too, so two
failing rows described each other's input with the first row's message.

## Approach

All in the shared primitives; no visible output changes.

- `src/ui/form.tsx`: `TextField` and `ChoiceField` take a per-instance
  `useId()` (unique per instance, stable across SSR and hydration) as the
  control's id, and pass it to `FormField`'s new optional `id` prop and to
  `field(name, id)`. `FormField` uses `id ?? name` for the label's `htmlFor`
  and the message id, so its direct callers (a single field on a page,
  with their own `<input id={name}>`) are unchanged.
- `src/ui/use-form-submit.ts`: `field(name, id?)` names the message from
  `id ?? name` through one exported `messageIdFor`, which `FieldMessage`
  and `CityFinder` also use — the pointer and the message cannot drift.
  `FieldOf` types the two-argument `field` the id-taking controls want.
- Callers that wrap `field`: `CityFinder`'s own `field` takes the id;
  `RequestAccess`'s note counter wrapper passes it through.
- The `name` keeps every job that is scoped to one form: focusing a field,
  the summary rows, the field error keys.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: none changed visibly; Desk Review (copyright holds, quarantine)
  becomes correctly labelled.

## Test plan

- `test/ui/form.dom.test.tsx` "a field repeated on every row (R-165)" (ui):
  two rows, each its own form; typing through row 2's label fills row 2;
  each row's select is its own label's; two failing rows each describe
  their input with their own message.
- Existing describedby assertions now check the message id against the
  control's id, not a hard-coded `name-message`.
- `city-finder` and `conditions-tab` dom tests and the feed-city e2e assert
  the accessible description rather than `#cityLabel-message`.
- The moderation e2e finds RECEIVED ON by its label, not its name.

## Open questions

None. `FieldGroup`, `ChoiceList` and the hand-built `FormField` callers keep
name-based ids: none of them repeats on a page today.
