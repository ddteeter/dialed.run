import type { JSX, ReactNode, RefObject } from "react";

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
}: Readonly<{ name: string; error: string | undefined }>): JSX.Element | undefined {
  if (error === undefined) return undefined;
  return (
    <span
      id={`${name}-message`}
      className="self-start bg-hi-viz px-[10px] py-[7px] text-[13px] leading-snug text-night"
    >
      {error}
    </span>
  );
}

export function FormField({
  name,
  label,
  hint,
  error,
  children,
}: Readonly<{
  name: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}>): JSX.Element {
  const isInvalid = error !== undefined;
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={name}
        className="font-mono text-[11px] uppercase tracking-[0.1em] text-night/50"
      >
        {label}
      </label>
      {/* Weight is the signal: 1px rule -> 2px ink. The padding drops by
          1px so the box does not grow when it gains the heavier border. */}
      <div
        data-invalid={isInvalid ? "true" : undefined}
        className={
          isInvalid
            ? "flex min-h-12 items-center rounded-lg border-2 border-night bg-chalk px-[13px] py-[11px]"
            : "flex min-h-12 items-center rounded-lg border border-night/15 bg-chalk px-[14px] py-[12px]"
        }
      >
        {children}
      </div>
      {hint !== undefined && !isInvalid ? (
        <span className="text-xs leading-snug text-night/50">{hint}</span>
      ) : undefined}
      <FieldMessage name={name} error={error} />
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
        className="w-full border-none bg-transparent outline-none"
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
      className="flex flex-col gap-2.5 border border-night p-4 outline-none"
    >
      <span className="font-display text-[11px] uppercase tracking-[0.12em]">
        Nothing saved
      </span>
      <span className="text-[15px] leading-snug">
        {rows.length} fields need a fix.
      </span>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((row) => (
          <li key={row.name}>
            <button
              type="button"
              onClick={() => {
                onFocusField(row.name);
              }}
              className="cursor-pointer border-none bg-transparent p-0 text-left text-sm underline underline-offset-[3px]"
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
    <div className="flex flex-col items-start gap-3 border border-night p-4">
      <span className="font-display text-[11px] uppercase tracking-[0.12em]">
        Nothing saved
      </span>
      <span className="text-[15px] leading-snug">{failure.message}</span>
      <button
        ref={retryRef}
        type="button"
        onClick={onRetry}
        className="cursor-pointer rounded-lg border border-night bg-night px-4 py-2.5 text-sm font-bold text-chalk"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Never the `disabled` attribute: a disabled button drops focus and stops
 * announcing, so the guard against a double submit lives in the handler
 * (`useFormSubmit`) and this only reports the state.
 *
 * The button does not resize. Both labels occupy one grid cell, so the
 * width is fixed by the longer of the two and nothing shifts when it
 * flips. Pending is the brackets breathing — the label text stays plain,
 * because bracket *notation* is reserved for measured values and this is a
 * verb.
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
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      className={`grid min-h-[52px] place-items-center rounded-[10px] border-none bg-pink px-6 py-4 font-display text-base uppercase tracking-[-0.01em] text-night ${
        pending ? "cursor-default" : "cursor-pointer"
      }`}
    >
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
          className="flex gap-[0.4em] [grid-area:1/1]"
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
    </button>
  );
}

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
        className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
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
    <label className="flex items-center gap-2 text-sm font-semibold">
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
  value,
  field,
  onChange,
  error,
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
    value: TOption | undefined;
    onChange: (value: TOption) => void;
  }
>): JSX.Element {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 font-mono text-[11px] uppercase tracking-[0.1em] text-night/50">
        {legend}
      </legend>
      {options.map((option) => (
        <label
          key={option}
          className="flex items-center gap-3 rounded-lg border border-night/15 bg-chalk px-[14px] py-[12px] text-sm font-semibold"
        >
          <input
            {...field(name)}
            type="radio"
            value={option}
            checked={value === option}
            onChange={() => {
              onChange(option);
            }}
          />
          {optionLabels[option]}
          {optionNotes === undefined ? undefined : (
            <span className="ml-auto font-mono text-[13px] font-normal tabular-nums text-night/60">
              {optionNotes[option]}
            </span>
          )}
        </label>
      ))}
      {hint !== undefined && error === undefined ? (
        <span className="text-xs leading-snug text-night/50">{hint}</span>
      ) : undefined}
      <FieldMessage name={name} error={error} />
    </fieldset>
  );
}
