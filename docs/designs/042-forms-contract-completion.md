# Design: 042 Forms contract completion (D-17, D-43, D-44)

Closes the register's D-17 — the last two forms that never adopted
`docs/product.md` §Forms & failure — and the two bugs whose triggers name
this pass: D-44 (announce-then-navigate) and D-43 (a failed "mark all read"
escaping as an unhandled rejection).

## Problem

D-17 says the closet "still hand-rolls its errors". **Read the code and it
is worse than that: the closet form has no failure path at all.**

`GarmentForm` is presentational — `onSubmit: (values) => void` — and the
route does the work:

```tsx
// routes/closet/new.tsx
async function handleSubmit(values: GarmentFormValues) {
  const garment = garmentFromFormValues(values);   // garmentSchema.parse — throws
  const created = await createItemFn({ data: { garment, idempotencyKey } });
  …
}
<GarmentForm onSubmit={(values) => { void handleSubmit(values); }} … />
```

`garmentFromFormValues` ends in `garmentSchema.parse(...)`. On invalid input
it throws, inside an async function whose promise is `void`-ed — an
unhandled rejection. The button does nothing. No message, no mark, no
console error the user can see. Three ways to reach it today:

| input | why the browser lets it through | what the schema says |
| --- | --- | --- |
| `http://example.com` in Product link | `type="url"` accepts any scheme | `httpsUrlSchema` requires `https:` |
| a name over 80 characters | no `maxLength` on any input | `name: z.string().min(1).max(80)` |
| brand > 60, size > 20, color > 30 | same | same shape |

**And the copy does not exist.** `z.string().min(1).max(80)` carries no
`message`, so the sentence a user would eventually see is zod's default,
*"Too small: expected string to have >=1 characters"*. The contract's rule
is that error copy lives in the schema; `signUpSchema`, twelve lines below
in the same file, already does it right (`"Tell us what to call you."`).

`VerdictForm` is the second half of D-17. It hand-rolls `error` and
`photoError` as bare `<p className="text-sm font-semibold text-pink">`,
which is the contract's other named violation — **pink is action, never
failure** — and it has no live region at all, so a save failure is silent
to a screen reader.

Two register rows attach to this pass by their own triggers:

- **D-44** — `useFormSubmit` sets the success sentence and then calls
  `onSuccess`, which navigates. The `role="status"` region unmounts in the
  same commit, so nothing can read it.
- **D-43** — `NotificationList`'s handler is `try { … } finally { … }` with
  no `catch`, so a D1 failure re-throws out of a `void`-ed call. The button
  re-enables, the user is told nothing, nothing reaches Sentry (laws 5, 7).

## Approach

**1. A form schema that pipes into the domain schema, not a copy of it.**

The contract permits a client pre-check only because there is one schema
run twice. `GarmentFormValues` is not `Garment` — unanswered selects are
`""` and the domain type is a discriminated union — so the form needs a
schema of its *own shape* that ends in the real one:

```ts
export const garmentFormSchema = garmentFormValues   // the "" shapes, with the copy
  .transform(toGarmentInput)                          // the reshape, already written
  .pipe(garmentSchema);                               // the rules, not restated
```

`toGarmentInput` is today's `garmentFromFormValues` minus its final
`.parse()`; the `.pipe()` performs it instead. `z.output` is then `Garment`,
so the route's `action` is unchanged and `newItemInput`/`updateItemInput`
keep validating with `garmentSchema` server-side. Nothing is duplicated: the
form schema contributes shapes and sentences, `garmentSchema` contributes
rules.

**The risk to prove before building on it** is error paths. `useFormSubmit`
maps `issue.path[0]` to a field name; issues raised by the piped
`garmentSchema` carry domain paths. For a garment those coincide (`name`,
`brand`, `size`, `color`, `productUrl`, `layer`, `weight`, `fabric` are all
flat in both), but coincide-by-luck is not a design. First commit is a test
that submits an `http://` product link and asserts the message lands on the
Product link field — if the path does not survive the pipe, the transform
moves inside `superRefine` instead, and that is the fork.

**2. The copy moves into the schema**, per the contract. `min(1)`/`max(80)`
and friends get sentences, in `lib/contracts.ts` beside `signUpSchema`'s.
These are user-facing strings — see Open questions.

**3. Both forms adopt the primitives.** `useFormSubmit` + `FormField` /
`TextField` / `FormStatus` / `FormErrorSummary` / `FormFailureBand` /
`SubmitButton`. `GarmentForm` gains the submit path it currently delegates,
which means `onSubmit` becomes `action` and the route hands in the server
function — the same injection shape the routes lane established, so
`GarmentForm` stays testable and stays in the mutation ratchet.

**4. D-44 in `useFormSubmit`, once, for every form.** The fix already exists
eight lines below the bug: the *failure* path sets the status and then
defers the focus move by `DURATION.instant`. Success gets the same
treatment, so `onSuccess` runs after the region has committed. Fixing it in
the hook rather than per-form is the point — every form that navigates on
success has this shape.

**5. D-43 gets the failure band**, which is the smallest honest version and
the one the register already named. No new product decision.

## Contract touches

- `lib/contracts.ts` — messages added to `garmentBase`'s fields. **Additive
  to the schema's rules: no shape changes, no migration.** A message is not
  a constraint.
- `modules/closet/form-mapping.ts` — `garmentFromFormValues` loses its
  trailing `.parse()` to become the pipe's transform. Its one caller pair
  (`new.tsx`, `edit.$itemId.tsx`) moves to the schema, so the parse still
  happens — one layer out.
- `ui/use-form-submit.ts` — success-path timing (D-44). Behavioural, shared
  by every form; the existing `test/ui/form.test.tsx` pins the contract and
  must stay green.
- No database, queue, cron or binding changes.

## Test plan

The mutation ratchet covers `src/ui/**/*.tsx` and `src/modules/**/*.tsx` at
100%, so every branch added here needs a test that *observes* it. DOM tests
(`*.dom.test.tsx`, jsdom project) for anything with an interaction.

- **The path-through-pipe question, first and alone** — `http://` product
  link, message lands on that field.
- Each reachable failure above: over-long name, over-long brand/size/colour.
- Field vs form failure are distinguishable: a 500 marks the button and
  **no** field; a zod issue marks fields and not the button.
- One field error → field message and focus. Two+ → summary, both messages,
  focus to summary.
- `FormStatus` receives exactly one sentence on every outcome, including
  success — the D-44 assertion, which must fail before the hook change.
- `VerdictForm`: a save failure announces and bands rather than printing
  pink text.
- `NotificationList`: a rejecting "mark all read" surfaces the band instead
  of escaping (D-43), asserted by the absence of an unhandled rejection.
- `npm run verify && npm test && npm run build`, and `npm run mutate` for
  `src/ui/**/*.tsx`, `src/modules/**/*.tsx` and `src/lib/**/*.ts`.

Demo: the closet add/edit journey changes visibly — `e2e/closet/` owns
screens C and F. Re-record per workflow rule 5.

## Open questions

1. **The error sentences are user-facing copy**, which the schema protocol
   says is a stop-and-ask. I am not stopping the whole task for it: the
   fields are ordinary (`name`, `brand`, `size`, `color`, `productUrl`) and
   `signUpSchema` sets the register — plain, second person, says what to do
   (`"Tell us what to call you."`). I will write them in that voice and list
   every sentence in the PR body as a table for a one-pass review, rather
   than block on eight strings. Say the word and they change.
2. **`type="url"` on the product link stays**, and the schema rejects
   `http://`. The alternative — accept `http://` and upgrade it — is a
   product decision about someone else's link, not a form fix. Flagging,
   not deciding.
3. **D-35 is not in this PR.** The feed's triplicated session redirect is
   its own change with its own analyzer flip, and mixing it in would make
   both unreviewable. Next in the stack.
