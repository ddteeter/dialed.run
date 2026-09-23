import type { JSX, ReactNode, RefObject } from "react";

import { Mono } from "./Mono";
import type { FieldProps, FormFailure, SummaryRow } from "./use-form-submit";

/**
 * The render half of the Forms & failure contract (docs/product.md).
 *
 * Ported from `design/src/ui/FormField.tsx`, which is a prototype in inline
 * hex; these are the same pixels expressed in the brand tokens, so a token
 * change moves the forms with everything else.
 *
 * The contract's own summary: a form that uses these cannot get it wrong, a
 * form that hand-rolls any of them is a review failure. The two things most
 * easily lost in a port, both load-bearing:
 *
 * - **A field error is marked, not reddened.** The signal is border weight
 *   plus a hi-viz band. Pink is action in this palette and never failure,
 *   and no mark is ever carried by hue alone.
 * - **Nothing in the failure path animates.** The doctrine is explicit —
 *   "offline / error: nothing, deliberately static" — and a shake is a
 *   spring wearing a costume. The only motion is the button leaving its
 *   pending state.
 *
 * The design also specifies an ink (dark) surface for every one of these.
 * No form in v1 sits on ink, so the ink half is not written rather than
 * written and untested; `docs/deferred.md` carries it.
 */

/**
 * Exactly one per form, permanently mounted — a live region that appears
 * only when it has something to say announces nothing at all.
 *
 * It carries one sentence on *every* outcome, including success, and the
 * focus move happens after. Announce, then move.
 */
export function FormStatus({ children }: Readonly<{ children?: string }>) {
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {children}
    </div>
  );
}

/**
 * A labelled control with its message.
 *
 * The message is deliberately *not* a live region: `FormStatus` does the
 * announcing, and two live regions firing at once means one of them is
 * lost. This one is wired by `aria-describedby` instead.
 */
/**
 * The one sentence a field shows when it is wrong.
 *
 * A hi-viz band, never a colour on the border alone — that is the Forms
 * contract's rule and the reason this is a component rather than a class
 * string: `FormField` and `ChoiceList` both need it, and a second copy is
 * how one of them ends up marking an error some other way.
 *
 * Exported for the third caller, which is neither: O3's tap-list is a grid
 * of toggles whose one error belongs to the group rather than to any chip.
 * A control that does not fit `FormField`'s bordered box still owes the
 * user the same sentence in the same place, and the alternative to
 * exporting this is that control writing its own — the drift one layer
 * down that §Forms & failure exists to stop.
 *
 * The `id` is what `field()`'s `aria-describedby` points at, so the
 * message and the control that owns it agree without either restating the
 * convention.
 */
export function FieldMessage({
  name,
  error,
}: Readonly<{ name: string; error: string | undefined }>):
  JSX.Element | undefined {
  if (error === undefined) return undefined;
  return (
    <span
      id={`${name}-message`}
      className="self-start bg-failure px-3 py-2 text-small text-ink"
    >
      {error}
    </span>
  );
}

/**
 * What every labelled field takes, whatever its caption is.
 *
 * Written out on each of the three, it was the same four members with one
 * renamed — which is precisely the shape the clone detector's semantic
 * mode exists to catch, since a restated set drifts silently: add an
 * `optional` flag to one and nothing makes the other disagree out loud.
 * One type, three captions.
 */
interface LabelledFieldProps {
  /**
   * The control's `name`, which is also how `FormErrorSummary` focuses it
   * and how `FieldMessage` builds the id the control points at.
   */
  name: string;
  /**
  One sentence under the control, for what the answer is used for.
  */
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}

/**
 * What a labelled field is, minus the two things that differ.
 *
 * `FormField` and `FieldGroup` are the same idea — a caption, the control,
 * an optional hint, and the message when it fails — differing only in the
 * caption's element and whether the control gets a box. Written out twice
 * they were 44 duplicated lines and the clone detector said so; that is
 * not a rhyme to suppress, it is one idea with two spellings.
 *
 * The caption is passed in rather than branched on, because the choice is
 * not cosmetic: a single control gets `<label htmlFor>` pointing at its
 * id, and a group gets `<legend>`, since a `for` naming an id that does
 * not exist is worse than no label at all.
 *
 * The hint hides while the field is failing — two sentences under one
 * control, one of them now wrong, is worse than the one that matters
 * alone.
 */
function FieldShell({
  name,
  caption,
  hint,
  error,
  children,
}: Readonly<LabelledFieldProps & { caption: ReactNode }>): JSX.Element {
  return (
    <>
      {caption}
      {children}
      {hint !== undefined && error === undefined ? (
        <span className="text-micro text-muted">{hint}</span>
      ) : undefined}
      <FieldMessage name={name} error={error} />
    </>
  );
}

/**
 * A labelled group of controls with **no field box**.
 *
 * `FormField` draws a bordered box because the control inside it is a
 * borderless input inset by `px-4 py-3`: the box *is* that control's
 * visible boundary. A group whose members draw their own boxes — radio
 * chips, the verdict row — does not need a sixth border around five, and
 * design's round 17 ruled it out in as many words: *"neither the row nor
 * the chips sit inside a field box."*
 *
 * Which also fixes a real defect. `field-box` removes the outline from its
 * descendants (`ui/a11y.css`), on the correct assumption that the child is
 * that inset input — so wrapping a *button group* in one suppressed every
 * button's focus ring and left only the container ringed. Tabbing across
 * A3's five verdicts showed no indication of which one had focus, on the
 * single control the whole product turns on. Rule 06's "never removed" was
 * failing by construction.
 *
 * **A `<legend>`, not a `<label htmlFor>`.** There is no one control to
 * point at, and a `for` naming an id that does not exist is worse than no
 * label at all. The legend is the group's only label, so it wears
 * `--label` (T1, round 13) rather than `--muted`.
 *
 * The row or stack the members sit in is the caller's, because it is the
 * one thing that genuinely differs — chips wrap, the verdict is five
 * columns that must not.
 */
export function FieldGroup({
  name,
  legend,
  hint,
  error,
  children,
}: Readonly<LabelledFieldProps & { legend: string }>): JSX.Element {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <FieldShell
        name={name}
        hint={hint}
        error={error}
        caption={
          <legend className="mb-2 p-0 text-label">
            <Mono step="sm">{legend}</Mono>
          </legend>
        }
      >
        {children}
      </FieldShell>
    </fieldset>
  );
}

export function FormField({
  name,
  label,
  hint,
  error,
  children,
}: Readonly<LabelledFieldProps & { label: string }>): JSX.Element {
  const isInvalid = error !== undefined;
  return (
    <div className="flex flex-col gap-2">
      <FieldShell
        name={name}
        hint={hint}
        error={error}
        caption={
          /* `--label`, not `--muted`: the mono caption inside the field IS
             the label (the contract's Forms row says so in as many words),
             and T1's round-13 row bans --muted from being a control's only
             label on paper. */
          <label htmlFor={name} className="text-label">
            <Mono step="sm">{label}</Mono>
          </label>
        }
      >
        {/* Weight is the signal: 1px rule -> 2px ink, and the box does not
            grow when it gains the heavier one.

            That used to be a 1px padding compensation — `px-[13px]
            py-[11px]` against `px-[14px] py-[12px]` — which the 4px grid
            cannot express: SPACE is "a 4px step, nothing else. 1px and 2px
            exist only as border widths." So the second pixel is an inset
            ring instead. A ring is a box-shadow, so it occupies no space at
            all and there is nothing left to compensate for. */}
        <div
          data-invalid={isInvalid ? "true" : undefined}
          // `field-box` (ui/a11y.css) is the focus half: the box is the
          // control's visible boundary, so the ring lands on it rather than
          // on the borderless input inset inside it. It also removes the
          // ring from that input, which is what five `outline-none`
          // utilities used to do without saying where the ring had gone.
          //
          // Which is why a *group* does not get one — see `FieldGroup`.
          className={
            isInvalid
              ? "field-box flex min-h-12 items-center rounded-field border border-ink inset-ring-1 inset-ring-ink bg-ground px-4 py-3"
              : "field-box flex min-h-12 items-center rounded-field border border-hairline bg-ground px-4 py-3"
          }
        >
          {children}
        </div>
      </FieldShell>
    </div>
  );
}

/**
 * A single-line text control, wired.
 *
 * `FormField` owns the label, the mark and the message; this owns the
 * input inside it and the four attributes that are easy to forget — the
 * `id` that the label points at, the `name` that focus-a-field looks up,
 * and the `aria-invalid`/`aria-describedby`/`readOnly` that `field()`
 * returns. Every one of those going missing is silent.
 *
 * The input carries no border of its own: the box around it is the mark,
 * and a second border inside it would be two marks for one error.
 */
export function TextField({
  name,
  label,
  value,
  onChange,
  field,
  error,
  hint,
  type = "text",
  autoComplete,
  list,
}: Readonly<{
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  field: (name: string) => FieldProps;
  error?: string | undefined;
  hint?: string | undefined;
  type?: "text" | "email" | "password" | "url";
  autoComplete?: string | undefined;
  /**
   * The id of a `<datalist>` holding suggestions for this field.
   *
   * Here because two forms needed it and both hand-rolled `FormField` plus
   * a raw `<input>` to get it — screen F for brands, and P2.5 for brands
   * and models. That is the shape §Forms & failure warns about: the
   * primitive exists so a field cannot quietly lose its `id`, its `name`,
   * or its `aria-describedby`, and a form that rebuilds it to add one
   * attribute gives all of that up. P2.5's brand field did exactly that
   * and shipped a datalist nothing pointed at — caught by a test asserting
   * the `list` named an element that exists.
   */
  list?: string | undefined;
}>): JSX.Element {
  return (
    <FormField name={name} label={label} error={error} hint={hint}>
      <input
        {...field(name)}
        id={name}
        type={type}
        autoComplete={autoComplete}
        list={list}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="w-full border-none bg-transparent"
      />
    </FormField>
  );
}

/**
 * The summary, at two or more field errors only.
 *
 * One error focuses its field instead — a summary listing a single row is
 * a step between the user and the fix. Its rows are buttons, not anchors:
 * a form is not a document, and the target is a control, not a location.
 */
export function FormErrorSummary({
  rows,
  onFocusField,
  summaryRef,
}: Readonly<{
  rows: readonly SummaryRow[];
  onFocusField: (name: string) => void;
  summaryRef: RefObject<HTMLDivElement | null>;
}>): JSX.Element | undefined {
  if (rows.length < 2) return undefined;
  return (
    <div
      ref={summaryRef}
      tabIndex={-1}
      className="flex flex-col gap-3 border border-ink p-4"
    >
      <Mono step="xs">Nothing saved</Mono>
      <span className="text-body">{rows.length} fields need a fix.</span>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => (
          <li key={row.name}>
            <button
              type="button"
              onClick={() => {
                onFocusField(row.name);
              }}
              className="target cursor-pointer border-none bg-transparent p-0 text-left text-body underline underline-offset-4"
            >
              {row.label} — {row.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Nothing was saved and the fix is not in the form.
 *
 * It sits directly above the submit button, where the eyes already are —
 * not at the top of the form, and never a toast, because a toast takes the
 * retry away with it when it leaves. No hi-viz here either: yellow means
 * "the fix is here", and it isn't. The values are never cleared, so
 * `Try again` resubmits exactly what was typed.
 */
export function FormFailureBand({
  failure,
  onRetry,
  retryRef,
}: Readonly<{
  failure: FormFailure | undefined;
  onRetry: () => void;
  retryRef?: RefObject<HTMLButtonElement | null> | undefined;
}>): JSX.Element | undefined {
  if (failure === undefined) return undefined;
  return (
    <div className="flex flex-col items-start gap-3 border border-ink p-4">
      <Mono step="xs">Nothing saved</Mono>
      <span className="text-body">{failure.message}</span>
      <button
        ref={retryRef}
        type="button"
        onClick={onRetry}
        className="target cursor-pointer rounded-field border border-ink bg-ink px-4 py-3 text-body font-bold text-ground"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * The two attributes a control wears while its work is in flight.
 *
 * **Never the `disabled` attribute** — it drops the element from the tab
 * order and hides why it is unavailable (Accessibility Contract rule 07,
 * Form Contract §5). The guard against a second press lives in the
 * handler, and this only reports the state.
 *
 * A named pair rather than two attributes typed at nine call sites,
 * because the failure mode is writing one of them: `aria-disabled` alone
 * says "unavailable" and never says why, `aria-busy` alone says "working"
 * and still invites the second press. They are one fact and this is one
 * gate for it.
 *
 * `|| undefined` rather than the boolean: React renders `aria-busy="false"`
 * for `false`, and a control that is *not* busy should carry no claim at
 * all rather than a claim in the negative.
 */
export function inFlight(isPending: boolean): {
  "aria-disabled": true | undefined;
  "aria-busy": true | undefined;
} {
  return {
    "aria-disabled": isPending || undefined,
    "aria-busy": isPending || undefined,
  };
}

/**
 * A control's label, and what it says instead while it is working.
 *
 * **The control does not resize.** Both labels occupy one grid cell, so
 * the width is fixed by the longer of the two and nothing shifts when it
 * flips — which is what lets a button change what it says mid-press
 * without moving the thing underneath it.
 *
 * Pending is the brackets breathing. The label text stays plain, because
 * bracket *notation* is reserved for measured values and a pending verb is
 * not one; the brackets here are the waiting device, which is why they are
 * `aria-hidden` and the verb is not.
 *
 * Extracted from `SubmitButton` when design's round 13 ruled that the
 * eight controls which used to dim themselves to 40% get this treatment
 * instead — *"pending verbs are the rest verb in -ing, in brackets,
 * breathing. Never 'Loading', 'Please wait', 'Processing'."* Nine copies
 * of a grid-stacked label swap is exactly the clone the `dupes` gate is
 * for, and the second copy is where the brackets stop breathing.
 */
export function PendingLabel({
  label,
  pendingLabel,
  pending,
}: Readonly<{
  label: ReactNode;
  pendingLabel: string;
  pending: boolean;
}>): JSX.Element {
  return (
    <span className="grid place-items-center">
      <span
        className="[grid-area:1/1]"
        // `undefined`, not `"visible"`: an explicit "visible" and an
        // omitted property render identically, so the literal would be a
        // mutant no test could ever distinguish. Only the hiding half is
        // a real decision, and it is the half that is asserted.
        style={{ visibility: pending ? "hidden" : undefined }}
      >
        {label}
      </span>
      <span
        className="flex gap-1 [grid-area:1/1]"
        style={{ visibility: pending ? undefined : "hidden" }}
      >
        <span className="breathe" aria-hidden="true">
          [
        </span>
        {pendingLabel}
        <span className="breathe" aria-hidden="true">
          ]
        </span>
      </span>
    </span>
  );
}

/**
 * Never the `disabled` attribute: a disabled button drops focus and stops
 * announcing, so the guard against a double submit lives in the handler
 * (`useFormSubmit`) and this only reports the state.
 */
export function SubmitButton({
  label,
  pendingLabel,
  pending,
}: Readonly<{
  label: string;
  pendingLabel: string;
  pending: boolean;
}>): JSX.Element {
  return (
    <button
      type="submit"
      {...inFlight(pending)}
      className={`target grid min-h-13 place-items-center rounded-card border-none bg-action px-6 py-4 font-display text-body uppercase  text-ink ${
        pending ? "cursor-default" : "cursor-pointer"
      }`}
    >
      <PendingLabel
        label={label}
        pendingLabel={pendingLabel}
        pending={pending}
      />
    </button>
  );
}

/**
 * A chosen chip is marked in ink, never in hue — the same rule the tap
 * list follows, and for the same reason: hue means verdict everywhere in
 * this app, and a pink "selected" chip beside a teal bracket is a third
 * accent that means nothing.
 */
const OPTION_CHIP_CLASS =
  "target relative flex cursor-pointer items-center justify-center rounded-pill border border-hairline px-3 py-2 text-body has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-ground has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink";

const CHIP_INPUT_CLASS =
  "absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none opacity-0";

/**
 * What every "pick one of a set" control needs, whatever it looks like.
 *
 * `ChoiceField` and `ChoiceList` are deliberately different controls — a
 * select hides its options, a radio group shows them, and which one is
 * right depends on whether comparing the choices *is* the question. What
 * they genuinely share is this: a named field, a set of options, the words
 * for them, the `field()` helper, and one sentence when it is wrong.
 *
 * Shared as a type rather than merged as a component, because the part
 * that repeats is the shape of the inputs and not the behaviour.
 */
interface ChoosableProps<TOption extends string> {
  name: string;
  options: readonly TOption[];
  optionLabels: Readonly<Record<TOption, string>>;
  field: (name: string) => FieldProps;
  error?: string | undefined;
}

/**
 * A `<select>` over a set the schema already holds.
 *
 * `GarmentForm` had three of these written out — layer, weight, fabric —
 * identical but for the field name, the enum and the label map, which is
 * the copy-then-rename `semantic` mode sees.
 *
 * **It parses the choice rather than casting it.** Each of the three used
 * to read `event.target.value as GarmentFormValues["layer"]` — a cast on
 * a value that arrives from the DOM as a plain `string`, which is the
 * thing CLAUDE.md's trust-boundary rule is about. Looking the value up in
 * `options` instead is both narrower and honest: anything that is not one
 * of them, including the empty choice, comes back as `""`.
 *
 * The empty option is unconditional because all three fields are
 * optional — a category that admits a layer does not require one, and a
 * select with no empty choice cannot express "not answered". A required
 * choice is a different control and should not reuse this one by adding a
 * flag to it.
 */
// fallow-ignore-next-line code-duplication -- two controls that share ChoosableProps must destructure the same prop names; what is left after extracting the shared type is the declaration itself, and merging the components would merge a select with a radio group
export function ChoiceField<TOption extends string>({
  name,
  label,
  error,
  field,
  value,
  options,
  optionLabels,
  onChange,
}: Readonly<
  ChoosableProps<TOption> & {
    label: string;
    value: TOption | "";
    onChange: (value: TOption | "") => void;
  }
>): JSX.Element {
  return (
    <FormField name={name} label={label} error={error}>
      <select
        {...field(name)}
        id={name}
        value={value}
        onChange={(event) => {
          const picked = options.find(
            (option) => option === event.target.value,
          );
          onChange(picked ?? "");
        }}
        className="rounded-field border border-hairline bg-panel px-3 py-2 font-normal"
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels[option]}
          </option>
        ))}
      </select>
    </FormField>
  );
}

/**
 * A checkbox with its label, for a yes/no attribute.
 *
 * `GarmentForm` wrote this twice — wind resistant, water resistant —
 * identical but for the field name and the words, which is the same
 * copy-then-rename `ChoiceField` above replaced for the selects.
 *
 * The label wraps the input rather than pointing at it with `htmlFor`,
 * which is why this does not compose `FormField`: a checkbox's hit area
 * should include its words, and `FormField`'s bordered box is sized for a
 * control that fills it. A checkbox that grows a validation error is a
 * different control and should not be bolted on here.
 */
export function ToggleField({
  name,
  label,
  field,
  isOn,
  onChange,
}: Readonly<{
  name: string;
  label: string;
  field: (name: string) => FieldProps;
  isOn: boolean;
  onChange: (isOn: boolean) => void;
}>): JSX.Element {
  return (
    <label className="target flex items-center gap-2 text-body font-semibold">
      <input
        {...field(name)}
        type="checkbox"
        checked={isOn}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {label}
    </label>
  );
}

/**
 * One of a handful of choices, all visible at once.
 *
 * A `<select>` hides its options behind a tap and reads them out one at a
 * time; O1's five answers are the question, and comparing them is how a
 * runner picks. So this is a radio group, not a `ChoiceField`, and the
 * difference is not styling — it is whether the choices can be read
 * together.
 *
 * **A real `<fieldset>` and `<legend>`.** The label of a radio group is
 * the question, and a screen reader announces it from the legend when
 * focus enters the group. A `<div>` with a heading above it looks
 * identical and announces five unexplained options.
 *
 * `field()` is spread onto each input for the same reason every other
 * control spreads it: `readOnly` carries §5's "inputs stay focusable while
 * in flight, never disabled". A radio ignores `readOnly` the way a select
 * does, so it is inert here rather than wrong, and the double-submit guard
 * lives in the handler regardless.
 */
export function ChoiceList<TOption extends string>({
  name,
  legend,
  hint,
  options,
  optionLabels,
  optionNotes,
  layout,
  value,
  field,
  onChange,
  error,
  readOnly,
}: Readonly<
  ChoosableProps<TOption> & {
    legend: string;
    /**
    One sentence under the group, for what the answer is used for.
    */
    hint?: string | undefined;
    /**
     * A measured value shown beside each option — O1's `+8°` offsets.
     *
     * Mono, because that is what mono is for: the tell that a number came
     * from the system rather than from a person. It sits *inside* the
     * label, so it joins the option's accessible name ("Always freezing
     * plus 8 degrees") instead of being decoration a screen reader skips —
     * which matters here, since design's whole point is that the offset is
     * visible on purpose.
     */
    optionNotes?: Readonly<Record<TOption, string>> | undefined;
    /**
     * `chips` wraps the options; omitted, they stack one per line.
     *
     * No `= "rows"` default: the stacked layout is what you get by not
     * asking, so naming it twice would be a value nothing reads.
     *
     * A layout prop rather than a second component, because the control is
     * identical — a radio group with a legend, all options readable
     * together — and only the shape differs. Round 11 §AH needs `chips`
     * for thirteen colour names, where thirteen stacked rows would bury
     * the rest of the form; `rows` stays the default so the five-answer
     * groups O1 was built for do not move.
     *
     * **A chip is still words, never a swatch.** Design's reason, and the
     * one thing a future caller must not undo: *"thirteen swatches is
     * thirteen accents in one viewport"*, and hue means verdict
     * everywhere else in this app.
     */
    layout?: "chips" | undefined;
    /**
     * `""` is "not answered", the same spelling `ChoiceField` uses for a
     * `<select>` with no choice made — an unanswered control reaches the
     * DOM as an empty string, and converting it to `undefined` at every
     * call site was four lines that did nothing: `"" === option` is false
     * for every option, which is exactly what `undefined` means here.
     */
    value: TOption | "" | undefined;
    onChange: (value: TOption) => void;
    /**
     * Shown as an answer, not asked as a question — A3's chips after Log
     * it (design round 20: *"the verdict row and chips stay, read-only, so
     * the receipt is read against the answer"*).
     *
     * **Not `disabled`.** Accessibility rule 07 bans dropping a control out
     * of the tab order, and a receipt is exactly what a reader should be
     * able to walk. `readOnly` does nothing to a radio in any browser, so
     * the group is `aria-disabled` — announced as unavailable, still
     * focusable — and a change is simply not passed on. The input stays
     * controlled, so the choice on screen cannot move.
     */
    readOnly?: boolean | undefined;
  }
>): JSX.Element {
  const isChips = layout === "chips";
  return (
    <FieldGroup name={name} legend={legend} hint={hint} error={error}>
      <div className={isChips ? "flex flex-wrap gap-2" : "contents"}>
        {options.map((option) => (
          <label
            key={option}
            className={
              isChips
                ? OPTION_CHIP_CLASS
                : "target flex items-center gap-3 rounded-field border border-hairline bg-ground px-4 py-3 text-body font-semibold"
            }
          >
            <input
              {...field(name)}
              type="radio"
              value={option}
              checked={value === option}
              aria-disabled={readOnly === true || undefined}
              onChange={() => {
                if (!readOnly) onChange(option);
              }}
              // A chip's own box is the mark, so the control fills it
              // rather than sitting beside it — and `sr-only` is not the
              // way to do that: it clips the input to a 1px corner, so a
              // pointer aimed at the chip lands on the label text instead
              // of on the radio. `TapListForm` found that with Playwright,
              // which clicks the control and not the label.
              className={isChips ? CHIP_INPUT_CLASS : undefined}
            />
            {optionLabels[option]}
            {optionNotes === undefined ? undefined : (
              <Mono step="md" className="ml-auto tabular-nums text-quiet">
                {optionNotes[option]}
              </Mono>
            )}
          </label>
        ))}
      </div>
    </FieldGroup>
  );
}
