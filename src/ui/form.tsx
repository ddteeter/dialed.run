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
      {isInvalid ? (
        <span
          id={`${name}-message`}
          className="self-start bg-hi-viz px-[10px] py-[7px] text-[13px] leading-snug text-night"
        >
          {error}
        </span>
      ) : undefined}
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
}>): JSX.Element {
  return (
    <FormField name={name} label={label} error={error} hint={hint}>
      <input
        {...field(name)}
        id={name}
        type={type}
        autoComplete={autoComplete}
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
