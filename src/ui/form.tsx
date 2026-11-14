import { Fragment, useId } from "react";
import type { ComponentProps, JSX, ReactNode, Ref, RefObject } from "react";

import { spokenFormOf } from "../lib/contracts";
import { Mono } from "./Mono";
import type { MonoStep } from "./Mono";
import { Spoken } from "./Spoken";
import { describedByFor, hintIdFor, messageIdFor } from "./use-form-submit";
import type {
  FieldOf,
  FieldProps,
  FormFailure,
  FormShell,
  SummaryRow,
} from "./use-form-submit";

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
 * The design also specifies an ink (dark) surface for every one of these
 * (R-36, R48·135): "Border goes 1px rule → 2px ink (2px paper on dark)",
 * "same geometry, darker rule", the same hi-viz band. Nothing here draws
 * it separately, because every class below is a T1 role: on a dark page,
 * a `night` block or an inverted one, `--hairline` is the darker rule
 * (`#2A2A31`) and `--ink` the 2px paper (`#F4F3EF`), and the band's
 * `--failure` with ink text does not change. `test/ui/contrast.dom.test.tsx`
 * pins those values; `test/architecture/palette-only.test.ts` keeps a
 * fixed colour out of this file.
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
 * The `<form>` every submit form opens with: the ref `useFormSubmit` needs
 * to focus a field, `noValidate` — the browser's own bubbles are a second,
 * unstyled error system that fires before ours and would pre-empt the
 * schema — the submit handler that turns the event into a call to
 * `form.submit`, and the one `FormStatus` region every form mounts.
 *
 * Lifted out of `RequestAccess` and `DeskAccess`'s `NewCodeForm`, which had
 * it duplicated line for line: the clone detector caught the same six
 * attributes and the same status region twice, which is the "AuthPage took
 * these as nine separate props" story again (see `FormShell`) one level
 * lower — the scaffolding around the fields rather than the fields' own
 * props.
 */
export function FormElement({
  form,
  dataPart,
  onSubmit,
  children,
}: Readonly<{
  form: Pick<
    FormShell,
    "formRef" | "status" | "summaryRows" | "focusField" | "summaryRef"
  >;
  dataPart: string;
  onSubmit: () => void;
  children: ReactNode;
}>): JSX.Element {
  return (
    <form
      ref={form.formRef}
      noValidate
      data-part={dataPart}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        onFocusField={form.focusField}
        summaryRef={form.summaryRef}
      />
      {children}
    </form>
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
      id={messageIdFor(name)}
      // The field's full width at every size, so two messages in a two-up
      // row line up (R55·179, 180).
      className="self-stretch bg-failure px-3 py-2 text-small text-accent-ink"
    >
      <ErrorWords message={error} />
    </span>
  );
}

/**
 * A schema's message as the board draws it, and said in words where the
 * drawing is marks a screen reader would read out — "3–20 … or _" is
 * "3 dash 20 … or underscore" (R-179). The server sends the plain string;
 * the said form is the contract's, looked up by it (`spokenFormOf`).
 *
 * Both halves sit inside `FieldMessage`'s span, so the description its
 * id names is the said sentence whole: the drawn half is `aria-hidden`.
 */
function ErrorWords({ message }: Readonly<{ message: string }>): ReactNode {
  const said = spokenFormOf(message);
  return said === undefined ? message : <Spoken shown={message} said={said} />;
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
   * One sentence under the control, for what the answer is used for.
   *
   * A node, not only a string, for a sentence that is drawn one way and
   * said another — the username rule's "3–20 … _" (`Spoken`).
   */
  hint?: ReactNode;
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
 *
 * Each sentence wears an id built from the control's (`hintIdFor`,
 * `messageIdFor`), and the control names whichever is showing through
 * `describedByFor` — so a hint is heard with its field, not only seen
 * under it. A control passed in raw takes the same call.
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
        <span id={hintIdFor(name)} className="text-micro text-muted">
          {hint}
        </span>
      ) : undefined}
      <FieldMessage name={name} error={error} />
    </>
  );
}

/**
 * A control's `field` props, described by whichever of its hint and
 * message is showing and then by anything `field` already named
 * (`describedByFor`), for the controls here drawn inside a `FieldShell`.
 */
function described(
  props: FieldProps,
  controlId: string,
  sentences: Readonly<{ hint: ReactNode; error: string | undefined }>,
): FieldProps {
  return {
    ...props,
    "aria-describedby": describedByFor(
      controlId,
      sentences,
      props["aria-describedby"],
    ),
  };
}

/**
 * `field()`'s props, also described by one more sentence when there is
 * one — a single option's, which `described` then puts after the field's
 * own hint or message.
 */
function alsoDescribedBy(
  props: FieldProps,
  id: string | undefined,
): FieldProps {
  if (id === undefined) return props;
  const named = props["aria-describedby"];
  return {
    ...props,
    "aria-describedby": named === undefined ? id : `${named} ${id}`,
  };
}

// The visible legend: `--label`, as the paragraph below says.
const LEGEND_CLASS = "mb-2 p-0 text-label";

// A legend that is a question — O1's "How do you usually run?" — is
// TYPE.heading, directly over its answers (R55·227). A name stays mono.
const QUESTION_LEGEND_CLASS = "mb-2 p-0 font-display text-heading text-ink";

function legendClass(isHidden: boolean, isQuestion: boolean): string {
  if (isHidden) return "sr-only";
  return isQuestion ? QUESTION_LEGEND_CLASS : LEGEND_CLASS;
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
function FieldGroup({
  name,
  legend,
  isLegendHeading,
  isQuestion,
  hint,
  error,
  children,
}: Readonly<
  LabelledFieldProps & {
    legend: string;
    isLegendHeading: boolean;
    isQuestion: boolean;
  }
>): JSX.Element {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <FieldShell
        name={name}
        hint={hint}
        error={error}
        caption={
          <legend className={legendClass(isLegendHeading, isQuestion)}>
            {isQuestion ? legend : <Mono step="sm">{legend}</Mono>}
          </legend>
        }
      >
        {children}
      </FieldShell>
    </fieldset>
  );
}

/**
 * A field with a button beside it — the field and **Find** (round 26 #12)
 * is the one today.
 *
 * **The button sits in the box's row, not in the field's.** Beside the
 * whole field it had to guess how far down the box starts, which is the
 * label's height plus the gap — CityFinder guessed `mt-6` against a real
 * 32px, and the two also grew to different heights, so Find sat 8px high
 * and 1.5px short on both screens that carry it. In the box's row the
 * label is above both and `items-stretch` makes the row as tall as the
 * taller of the two and both of them that tall — the box through its
 * grid cell, the button directly — so their edges meet whichever one
 * sets the height. The hint and the message run under the pair, which is
 * where a sentence about either belongs.
 */
function BesideTheBox({
  action,
  children,
}: Readonly<{ action: ReactNode; children: JSX.Element }>): JSX.Element {
  return (
    <div data-part="field-row" className="flex items-stretch gap-2">
      <div className="grid min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function FormField({
  name,
  id: controlId = name,
  label,
  hint,
  error,
  action,
  children,
}: Readonly<
  LabelledFieldProps & {
    /**
     * The control's id, which the label points at and the message is named
     * after. Defaults to `name`, which is right for a field that appears
     * once on a page; a field repeated on every row of a list takes a
     * per-instance one, or every row's label names the first row's control
     * (R-165). `TextField` and `ChoiceField` pass a `useId()`.
     */
    id?: string | undefined;
    label: string;
    /**
    A button that belongs beside the box — see `BesideTheBox`.
    */
    action?: ReactNode;
  }
>): JSX.Element {
  const isInvalid = error !== undefined;
  // Weight is the signal: 1px rule -> 2px ink, and the box does not grow
  // when it gains the heavier one.
  //
  // That used to be a 1px padding compensation — `px-[13px] py-[11px]`
  // against `px-[14px] py-[12px]` — which the 4px grid cannot express:
  // SPACE is "a 4px step, nothing else. 1px and 2px exist only as border
  // widths." So the second pixel is an inset ring instead. A ring is a
  // box-shadow, so it occupies no space at all and there is nothing left
  // to compensate for.
  //
  // Form Contract 02b, carried in tokens.js since round 28: 50 tall
  // (`min-h-field`, HEIGHT.field), 16px type (`text-field`, TYPE.field,
  // which the control inherits through preflight's `font: inherit`) and
  // radius 10 (`rounded-field`). The minimum is the height, with no
  // vertical padding, so a control can fill the box: a `<select>` that
  // stretches is a 48px target (plan 161, step 6), where one centred in
  // padding was 37 and drew a box inside the box.
  const box = (
    <div
      data-invalid={isInvalid ? "true" : undefined}
      // `field-box` (ui/a11y.css) is the focus half: the box is the
      // control's visible boundary, so the ring lands on it rather than
      // on the borderless input inset inside it. It also removes the
      // ring from that input, which is what five `outline-none`
      // utilities used to do without saying where the ring had gone.
      //
      // Which is why a *group* does not get one — see `FieldGroup`.
      //
      // R55·179: the fill is `--panel` in both themes and never changes
      // with state; the rest edge is `--hairline`, and `--hairline-2` in
      // dark, where `--hairline` disappears against the panel.
      className={
        isInvalid
          ? "field-box flex min-h-field items-center rounded-field border border-ink inset-ring-1 inset-ring-ink bg-panel px-4 text-field"
          : "field-box flex min-h-field items-center rounded-field border border-hairline bg-panel px-4 text-field dark:border-hairline-2"
      }
    >
      {children}
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <FieldShell
        name={controlId}
        hint={hint}
        error={error}
        caption={
          /* `--label`, not `--muted`: the mono caption inside the field IS
             the label (the contract's Forms row says so in as many words),
             and T1's round-13 row bans --muted from being a control's only
             label on paper. */
          <label htmlFor={controlId} className="text-label">
            <Mono step="sm">{label}</Mono>
          </label>
        }
      >
        {action === undefined ? (
          box
        ) : (
          <BesideTheBox action={action}>{box}</BesideTheBox>
        )}
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
 * **The id is per instance, not the `name`.** The Desk's Review list
 * repeats a form on every row, and a `name`-built id made every row's
 * label point at the first row's input, so a screen reader heard every
 * later field unlabelled (R-165). `useId()` is unique per instance and
 * stable across server render and hydration; the `name` still does the
 * jobs that are scoped to one form.
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
  action,
  placeholder,
  onBlur,
}: Readonly<{
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  field: FieldOf;
  error?: string | undefined;
  hint?: ReactNode;
  type?: "text" | "email" | "password" | "url" | "date";
  placeholder?: string | undefined;
  /**
  Leaving the box, for a field checked then and not while typing (round 43 #93).
  */
  onBlur?: ((value: string) => void) | undefined;
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
  /**
  A button beside the box, level with it — `FormField`'s `action`.
  */
  action?: ReactNode;
}>): JSX.Element {
  const id = useId();
  return (
    <FormField
      name={name}
      id={id}
      label={label}
      error={error}
      hint={hint}
      action={action}
    >
      <input
        {...described(field(name, id), id, { hint, error })}
        id={id}
        type={type}
        autoComplete={autoComplete}
        list={list}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onBlur={(event) => {
          onBlur?.(event.target.value);
        }}
        // A long link is one line, cut at its end while unfocused (#93).
        className="w-full border-none bg-transparent text-ellipsis"
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
      // R55·180: kicker, sentence and list at an 8 rhythm, rows 8 apart.
      className="flex flex-col gap-2 border border-ink p-4"
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
              // Its 44 target grows by padding against an equal negative
              // margin, which adds no layout height (R55·180). A wrapped
              // row keeps TYPE.body's own leading: 180's 1.4 is not a step,
              // and a step's leading is not overridden (#653).
              className="target -my-3 cursor-pointer border-none bg-transparent px-0 py-3 text-left text-body underline underline-offset-4"
            >
              {row.label} — <ErrorWords message={row.message} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The band that says something failed and the fix is not in any field.
 *
 * One block, two callers, and the difference is only the first word:
 *
 * - **A form's** band opens "Nothing saved" and sits directly above the
 *   submit button, where the eyes already are (`FormFailureBand`).
 * - **A control's** band opens with the state that is still true — "Not
 *   marked", "Still blocked" — and sits directly under the control that
 *   failed, because the control has to stay where the thumb left it
 *   (round 23, item 9; design's product.md §4a). `ControlFailureBand`.
 *
 * Never a toast, because a toast takes the retry away with it when it
 * leaves; never a timer, for the same reason; nothing animates in or out.
 * No hi-viz: yellow means "the fix is here", and it isn't.
 *
 * `data-part` and `data-state` are the names round 22 draws the band
 * under, so the conformance harness can find it on either kind of screen.
 */
export function FailureBand({
  kicker,
  message,
  onRetry,
  retryLabel = "Try again",
  retryRef,
  part = "failure-band",
  state = "failed",
  children,
}: Readonly<{
  kicker: string;
  message: string;
  /**
   * Try again. Left out where pressing again cannot fix it — a refusal, or
   * a change that already loaded what the next press needs — and the band
   * ends in `children`, or nothing.
   */
  onRetry?: (() => void) | undefined;
  /**
   * What the retry says. "Reload" only where the page itself cannot be
   * redrawn — round 22's root crash, *"this band alone on paper with
   * 'Reload'"* — since there pressing again means loading the document.
   */
  retryLabel?: "Try again" | "Reload";
  retryRef?: RefObject<HTMLButtonElement | null> | undefined;
  /**
   * The name the band's board draws it under. `control-failure` is Au6's,
   * for Google's band under its button (round 33); everything else is
   * round 22's `failure-band`.
   */
  part?: "failure-band" | "control-failure";
  /**
  Which failure this is, for a screen that draws more than one.
  */
  state?: string;
  /**
  What ends the band besides Try again: the link to the page that fixes it.
  */
  children?: ReactNode;
}>): JSX.Element {
  return (
    <div
      data-part={part}
      data-state={state}
      className="flex flex-col items-start gap-3 border border-ink p-4"
    >
      <Mono step="xs">{kicker}</Mono>
      <span className="text-body">{message}</span>
      {onRetry === undefined ? undefined : (
        <button
          ref={retryRef}
          type="button"
          onClick={onRetry}
          className="target cursor-pointer rounded-pill border border-ink bg-ink px-4 py-3 text-body font-bold text-ground"
        >
          {retryLabel}
        </button>
      )}
      {children}
    </div>
  );
}

/**
 * Nothing was saved and the fix is not in the form — the form's case of
 * `FailureBand`. The values are never cleared, so `Try again` resubmits
 * exactly what was typed.
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
  return (
    <ControlFailureBand
      failure={failure && { kicker: "Nothing saved", message: failure.message }}
      onRetry={onRetry}
      retryRef={retryRef}
    />
  );
}

/**
 * What a control that failed says: the state still true, and why.
 */
export interface ControlFailure {
  kicker: string;
  message: string;
}

/**
 * A control's case of `FailureBand` — see `useControlAction`, which
 * produces the failure this renders.
 */
export function ControlFailureBand({
  failure,
  onRetry,
  retryRef,
}: Readonly<{
  failure: ControlFailure | undefined;
  onRetry: () => void;
  retryRef?: RefObject<HTMLButtonElement | null> | undefined;
}>): JSX.Element | undefined {
  if (failure === undefined) return undefined;
  return (
    <FailureBand
      kicker={failure.kicker}
      message={failure.message}
      onRetry={onRetry}
      retryRef={retryRef}
    />
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
  align = "center",
}: Readonly<{
  label: ReactNode;
  pendingLabel: string;
  pending: boolean;
  /**
  Where the shorter label sits inside the longer one's width. Centred by
  default, which is right for a button that centres its words; a text
  control set flush to a column's edge says which edge, or its word floats
  inward by half the difference (#632 B-09, E1-07).
  */
  align?: PendingAlign | undefined;
}>): JSX.Element {
  return (
    <span className={PENDING_ALIGN[align]}>
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
      {/* Inline, not a flex row (#632 P2a-03, E1-06): a flex row made the
          words one item, so when they wrapped that item took the whole
          width and pushed `]` to the far edge. As text, each bracket is
          glued to the word beside it — there is no space to break at. */}
      <span
        className="[grid-area:1/1]"
        style={{ visibility: pending ? undefined : "hidden" }}
      >
        <span className="breathe mr-1" aria-hidden="true">
          [
        </span>
        {pendingLabel}
        <span className="breathe ml-1" aria-hidden="true">
          ]
        </span>
      </span>
    </span>
  );
}

type PendingAlign = "start" | "center" | "end";

const PENDING_ALIGN: Readonly<Record<PendingAlign, string>> = {
  start: "grid items-center justify-items-start",
  center: "grid place-items-center",
  end: "grid items-center justify-items-end",
};

/**
 * One primary per surface, and its kind says what kind of surface it is
 * (R54·167.1):
 *
 * - `action`, the product flow (A1–A3, manual entry, O1–O3, P3, Add
 *   garment, W1): pink display caps at RADIUS.card, 52 high — the one
 *   filled button that is not a pill (167.3's exception, now in tokens.js's
 *   RADIUS_RULES).
 * - `ink`, account, signed-out, settings Save and confirm sheets: an ink
 *   pill, `HEIGHT.control` high. Not the product's pink, because these
 *   are not product screens.
 * - `chalk`, the Desk's (round 44 #104): a chalk-filled pill in the
 *   ground's ink, 44 high, because on the Desk the main action is often a
 *   removal and nothing should pull the operator toward it.
 *
 * **Width** (167.2): below 720 a button is full width and stacked. At
 * ≥720 in a column it hugs its label — SPACE 6 a side, 200 minimum —
 * left-aligned. Inside a desk drawer it is the drawer's full width again,
 * stacked: the drawer is a 390 column, so hugging there would leave
 * ragged buttons (`in-data-[slot=sheet]`).
 */
const HUG_WIDE_CLASS =
  "w-full wide:w-auto wide:min-w-50 wide:self-start wide:in-data-[slot=sheet]:w-full wide:in-data-[slot=sheet]:self-stretch";

const SUBMIT_TONE = {
  action: `grid min-h-13 place-items-center rounded-card border-none bg-action px-6 py-4 font-display uppercase text-accent-ink ${HUG_WIDE_CLASS}`,
  chalk:
    "inline-flex min-h-11 items-center justify-center self-start rounded-pill border-none bg-ink px-5 font-bold text-ground",
  ink: `flex min-h-control items-center justify-center rounded-pill border-none bg-ink px-6 font-bold text-ground ${HUG_WIDE_CLASS}`,
  /**
   * The secondary, on every surface (R54·167.1): a hairline pill, 48 high,
   * the same width rule as the primary beside it. Never alone — a lone
   * action is the primary and takes its surface's kind. Its tertiary is a
   * text link. A tone too, for the hairline-pill Save that is a form's
   * submit (P2.5, R55·229).
   */
  secondary: `flex min-h-control items-center justify-center rounded-pill border border-hairline bg-transparent px-6 font-semibold text-ink ${HUG_WIDE_CLASS}`,
} as const;

/**
 * The secondary as a class, for a press that is not a form's submit:
 * Keep it, Send and block. The site writes `target` beside it, where the
 * hit-area check reads each site's class.
 */
export const SECONDARY_PILL = `cursor-pointer text-body ${SUBMIT_TONE.secondary}`;

/**
 * The Desk's main action as a class, for the one Desk press that is not a
 * form's submit (the copyright hold's).
 */
export const CHALK_PILL = `cursor-pointer text-body ${SUBMIT_TONE.chalk}`;

/**
 * The account and confirm primary as a class, for a press that is not a
 * form's submit: a confirm sheet's verb, Keep my account (R54·167.1).
 * The site writes `target` beside it, as it does for `CHALK_PILL`.
 */
export const INK_PILL = `cursor-pointer text-body ${SUBMIT_TONE.ink}`;

/**
 * The product flow's primary as a class, for a press that is not a form's
 * submit: P3's "I have a run to upload" (R54·167.1). The site writes
 * `target` beside it, as it does for the pills.
 */
export const ACTION_PRIMARY = `cursor-pointer text-body ${SUBMIT_TONE.action}`;

/**
 * A Desk decision that is not the bar's main one (Keep, Approve, Decline),
 * beside a literal `target` (the hit-area check reads each site's class):
 * an outline pill in the ground's ink, 44 high (round 44 #105). One chalk
 * pill per bar, at most; everything else beside it is this.
 */
export const QUIET_PILL =
  "inline-flex min-h-11 cursor-pointer items-center justify-center self-start rounded-pill border border-ink bg-transparent px-5 text-body font-bold text-ink";

/**
 * Backing out of a question a Desk row asked (Cancel): underlined text,
 * quieter than the pills beside it (round 44 #105).
 */
export const QUIET_CANCEL =
  "inline-flex min-h-11 cursor-pointer items-center self-start border-none bg-transparent p-0 text-body font-semibold text-ink underline underline-offset-4";

/**
 * Never the `disabled` attribute: a disabled button drops focus and stops
 * announcing, so the guard against a double submit lives in the handler
 * (`useFormSubmit`) and this only reports the state.
 */
export function SubmitButton({
  label,
  pendingLabel,
  pending,
  ref,
  tone = "action",
}: Readonly<{
  /**
  Words, or a `Spoken` measure: R2b's "Set 41–50° and dry".
  */
  label: ReactNode;
  pendingLabel: string;
  pending: boolean;
  /**
  `chalk` on the Desk; `ink` on account, settings and confirms; `secondary` for a hairline-pill submit.
  */
  tone?: keyof typeof SUBMIT_TONE | undefined;
  /**
  For a form that must focus its submit: the delete sheet, back from Google.
  */
  ref?: Ref<HTMLButtonElement> | undefined;
}>): JSX.Element {
  return (
    <button
      ref={ref}
      type="submit"
      {...inFlight(pending)}
      className={`target text-body ${SUBMIT_TONE[tone]} ${
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

/**
 * A row of a `ChoiceList` in its one card (R54·166.2): rows split by
 * hairlines, the chosen one marked by a 2px ink edge drawn inward that
 * follows the card's corners at its ends. The ring and the edge mark the
 * choice, never weight — every label is 400 (166.5).
 */
const OPTION_ROW_CLASS =
  "target flex cursor-pointer items-center gap-3 border-t border-hairline px-4 py-3 text-body font-normal first:rounded-t-card first:border-t-0 last:rounded-b-card has-[:checked]:inset-ring-2 has-[:checked]:inset-ring-ink";

/**
 * A row holding a detail is checked by definition, so its ring is plain;
 * the label inside carries the target and the words' layout.
 */
const OPTION_DETAIL_ROW_CLASS =
  "flex flex-col gap-2 border-t border-hairline px-4 py-3 first:rounded-t-card first:border-t-0 last:rounded-b-card inset-ring-2 inset-ring-ink";
const OPTION_DETAIL_LABEL_CLASS =
  "target flex cursor-pointer items-center gap-3 text-body font-normal";

/**
 * How a `ChoiceList`'s options sit: wrapped chips, chips in three columns,
 * or stacked rows in one card (the default).
 */
const OPTIONS_LAYOUT: Readonly<Record<"chips" | "chip-grid" | "rows", string>> =
  {
    chips: "flex flex-wrap gap-2",
    "chip-grid": "grid grid-cols-3 gap-2",
    rows: "flex flex-col rounded-card border border-hairline",
  };

function optionsLayout(layout: "chips" | "chip-grid" | undefined): string {
  return OPTIONS_LAYOUT[layout ?? "rows"];
}

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
 * The value of `ChoiceField`'s "Not set" option: nothing chosen. Exported
 * so a caller that models "nothing chosen" as `undefined` maps it to the select
 * with the option's own value, not a second copy of it.
 */
export const NO_CHOICE = "";

/**
 * What the empty option says when the caller has no placeholder. Words,
 * not "—": a dash is read as "dash" or as nothing at all, and neither
 * says the field is unanswered. Manual entry's own select already says it.
 */
const NOT_SET = "Not set";

/**
 * A native `<select>` with the arrow drawn as the text mark ▾, inset to match
 * the label's padding. Every select in the app is this one, and it sits in a
 * `FormField` box.
 *
 * The box draws the border and the `px-4` inset; the select itself is
 * borderless and fills the box's full height, so the whole 48px is the
 * target (plan 161, step 6). Chromium draws its own arrow about 3px inside
 * the select and ignores the padding, so it never lined up with the label.
 * `appearance-none` hides the native one, and the ▾ sits at the select's
 * right edge, which is the box's `px-4`: 16px in from the border, the same
 * as the label's 16px from the left. `pr-6` keeps a long label from running
 * under it. The mark is ▾ rather than an icon because design already draws
 * it: round 28's Desk remove-reason select, the boards' "SORT: MOST DIALED
 * ▾", and `MoreDisclosure`'s "more".
 *
 * The ▾ is `aria-hidden` — the select already says it is a select — and
 * `pointer-events-none`, so a click on it lands on the select and opens it.
 * `--muted` has a light and a dark value, so it reads on the Desk too.
 *
 * Takes everything a `<select>` takes but `className`: one look, in one
 * place, is the point.
 */
export function Select(
  props: Readonly<Omit<ComponentProps<"select">, "className">>,
): JSX.Element {
  return (
    <span className="relative flex min-h-target w-full self-stretch">
      <select
        {...props}
        className="min-h-target w-full appearance-none border-none bg-transparent pr-6 font-normal"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 flex items-center text-muted"
      >
        ▾
      </span>
    </span>
  );
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
  placeholder = NOT_SET,
  hairlineBefore,
}: Readonly<
  Omit<ChoosableProps<TOption>, "field"> & {
    /**
    Takes the select's per-instance id — see `FieldOf`.
    */
    field: FieldOf;
    label: string;
    value: TOption | "";
    onChange: (value: TOption | "") => void;
    /**
     * What "nothing chosen" means here, when it means something: Edit's
     * product value, which applies until the runner picks their own
     * (round 43 #94). Otherwise the option reads `NOT_SET`.
     */
    placeholder?: string | undefined;
    /**
     * An option the list is ruled off before: a native `<hr>` in the
     * select, which the platform draws as its separator. D8's rule select
     * sets the CSAM option apart from the terms' rules (round 39 #76).
     */
    hairlineBefore?: TOption | undefined;
  }
>): JSX.Element {
  // Per instance, for the reason `TextField` gives (R-165).
  const id = useId();
  return (
    <FormField name={name} id={id} label={label} error={error}>
      <Select
        {...described(field(name, id), id, { hint: undefined, error })}
        id={id}
        value={value}
        onChange={(event) => {
          const picked = options.find(
            (option) => option === event.target.value,
          );
          onChange(picked ?? NO_CHOICE);
        }}
      >
        <option value={NO_CHOICE}>{placeholder}</option>
        {options.map((option) => (
          <Fragment key={option}>
            {option === hairlineBefore ? <hr /> : undefined}
            <option value={option}>{optionLabels[option]}</option>
          </Fragment>
        ))}
      </Select>
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
 *
 * **Drawn, not native** (R54·166): the checkbox is a 20 square with a
 * 2px ink edge that fills ink with a `--ground` tick (`control-check`),
 * before its words at 400. The switch is a 48×28 track at the row's
 * right that fills pink (`control-switch`), after its words at 600,
 * because they name the row. Which one is 166.3's rule: a setting that
 * saves the moment it changes is a switch; an option that goes with a
 * submit is a checkbox. Both stay the native input, so the keyboard and
 * the form read them as before.
 */
export function ToggleField({
  name,
  label,
  field,
  isOn,
  onChange,
  inputRef,
  isSwitch = false,
}: Readonly<{
  name: string;
  label: string;
  field: (name: string) => FieldProps;
  isOn: boolean;
  onChange: (isOn: boolean) => void;
  /**
  The box itself, for a caller that moves focus to it — Privacy's switch, unlocked.
  */
  inputRef?: Ref<HTMLInputElement> | undefined;
  /**
   * Announced as a switch, on or off, rather than a box ticked or not:
   * for a setting that takes effect at once, as W3's blur does
   * (Accessibility Contract rule 05, R-84). A field saved with its form
   * stays a checkbox. The control is still a native checkbox underneath,
   * so space toggles it and the form reads it the same way.
   */
  isSwitch?: boolean | undefined;
}>): JSX.Element {
  const input = (
    <input
      ref={inputRef}
      {...field(name)}
      role={isSwitch ? "switch" : undefined}
      type="checkbox"
      checked={isOn}
      onChange={(event) => {
        onChange(event.target.checked);
      }}
      className={isSwitch ? "control-switch" : "control-check"}
    />
  );
  // R54·166.3/166.5: a switch is at its row's right, and the label names
  // the row, so it is TYPE.body 600. A checkbox leads, and its label is a
  // choice, so it is 400. Either way the label is the 44 target.
  return isSwitch ? (
    <label className={SWITCH_ROW_CLASS}>
      {label}
      {input}
    </label>
  ) : (
    <label className={CHECK_ROW_CLASS}>
      {input}
      {label}
    </label>
  );
}

const SWITCH_ROW_CLASS =
  "target flex cursor-pointer items-center justify-between gap-4 text-body font-semibold";

const CHECK_ROW_CLASS =
  "target flex cursor-pointer items-center gap-3 text-body font-normal";

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
export function ChoiceList<TOption extends string>(
  props: Readonly<
    ChoosableProps<TOption> & {
      legend: string;
      /**
       * The group's heading already says the legend, so the legend is for
       * assistive technology alone — Settings › Privacy, where "Who sees
       * new runs" is the group's MONO.xs kicker (round 42 #92). The group
       * keeps its accessible name; the words are not printed twice.
       */
      isLegendHeading?: boolean | undefined;
      /**
       * `"question"` when the legend asks something — O1's warm/cold
       * question — so it is set at TYPE.heading over the answers
       * (R55·227). Omitted, the legend is a name, in mono.
       */
      legendStep?: "question" | undefined;
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
       * How each option's words are said, where that differs from how
       * they are drawn: R2b's bands, drawn "41–50°" and said "41 to 50
       * degrees" (round 53 · 162.3). The drawn words are `aria-hidden`,
       * so the option's accessible name is the said one.
       */
      optionSaid?: Readonly<Record<TOption, string>> | undefined;
      /**
       * A sentence under each option's label, saying what it means — A3's
       * PRIVATE "Only you." (round 41 #86a). Inside the label for
       * `optionNotes`' reason: it joins the option's accessible name, so
       * the choice is announced with its meaning rather than as a bare word.
       */
      optionHints?: Readonly<Record<TOption, string>> | undefined;
      /**
       * Something under one option's words that belongs to that choice
       * only, shown while it is the one checked — W1's way-out line under
       * the intimate-image reason (R55·215, R37). It sits inside the
       * chosen row but outside the label, so a link in it is its own
       * control and not part of the radio's name. Stacked rows only.
       */
      optionDetail?: Readonly<Partial<Record<TOption, ReactNode>>> | undefined;
      /**
       * Sets each option's words in `Mono` at this step, so a segmented
       * label reads as one: MONO.xs capitals for SYSTEM / LIGHT / DARK
       * (R50·143.3) and PRIVATE / SHARED / PUBLIC (round 41 #86a/b).
       *
       * The capitals are `Mono`'s CSS, not the string: `optionLabels`
       * stays sentence case so a screen reader says the word rather than
       * spelling it (`ui/audience.ts`). Omitted, the words are the
       * option's own text, as every other group has them.
       */
      optionStep?: MonoStep | undefined;
      /**
       * The id of a sentence elsewhere on the page that describes one
       * option, or `undefined` for none — A3's audience line, which is
       * about the checked radio only, so it is heard with that one and
       * not with both (a11y judgment audit, 2026-11-04). It joins the
       * group's own hint or message rather than replacing it.
       */
      optionDescribedBy?: ((option: TOption) => string | undefined) | undefined;
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
       *
       * `chip-grid` is the same chips in three columns instead of a wrap —
       * R2b's twelve temperature bands, *"a 3-column radiogroup, coldest
       * top-left"* (round 26, item 2), where reading order is the scale.
       */
      layout?: "chips" | "chip-grid" | undefined;
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
  >,
): JSX.Element {
  // `optionHints` and `optionStep` are read from `props` where they are
  // used, the option parts only `OptionLabel` needs.
  const {
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
  } = props;
  const isChips = layout !== undefined;
  return (
    <FieldGroup
      name={name}
      legend={legend}
      isLegendHeading={props.isLegendHeading === true}
      isQuestion={props.legendStep === "question"}
      hint={hint}
      error={error}
    >
      <div className={optionsLayout(layout)}>
        {options.map((option) => (
          <OptionRow
            key={option}
            isChips={isChips}
            detail={value === option ? props.optionDetail?.[option] : undefined}
          >
            <input
              {...described(
                alsoDescribedBy(field(name), props.optionDescribedBy?.(option)),
                name,
                { hint, error },
              )}
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
              className={isChips ? CHIP_INPUT_CLASS : "control-radio"}
            />
            <OptionLabel
              label={optionLabels[option]}
              said={props.optionSaid?.[option]}
              hint={props.optionHints?.[option]}
              step={props.optionStep}
            />
            {optionNotes === undefined ? undefined : (
              <Mono step="md" className="ml-auto tabular-nums text-quiet">
                {optionNotes[option]}
              </Mono>
            )}
          </OptionRow>
        ))}
      </div>
    </FieldGroup>
  );
}

/**
 * One option: its label, the whole row, or — while the option holds a
 * detail (R55·215) — the row as a box holding the label and the detail
 * under it, the chosen ring on the box so the detail reads as part of the
 * choice. The label keeps the row's target and pointer.
 */
function OptionRow({
  isChips,
  detail,
  children,
}: Readonly<{
  isChips: boolean;
  detail: ReactNode;
  children: ReactNode;
}>): JSX.Element {
  if (isChips) return <label className={OPTION_CHIP_CLASS}>{children}</label>;
  if (detail === undefined) {
    return <label className={OPTION_ROW_CLASS}>{children}</label>;
  }
  return (
    <div data-part="option-with-detail" className={OPTION_DETAIL_ROW_CLASS}>
      <label className={OPTION_DETAIL_LABEL_CLASS}>{children}</label>
      <div className="pl-8">{detail}</div>
    </div>
  );
}

/**
 * A `ChoiceList` option's words: its label, said another way when the
 * group gives one, in `Mono` when the group asks for a step, and its hint
 * beneath when it has one. A label alone stays a
 * bare string, so a group with neither renders exactly as it did.
 */
function OptionLabel({
  label,
  said,
  hint,
  step,
}: Readonly<{
  label: string;
  said: string | undefined;
  hint: string | undefined;
  step: MonoStep | undefined;
}>): JSX.Element {
  const text =
    said === undefined ? label : <Spoken shown={label} said={said} />;
  // `font-normal`: a row's label is `font-semibold`, written for body-text
  // labels, and a `Mono` label inherited it, so PRIVATE / SHARED came out
  // bold beside the Theme chips' regular SYSTEM / LIGHT / DARK (#632 R-02).
  // MONO.xs is regular everywhere.
  const words =
    step === undefined ? (
      text
    ) : (
      <Mono step={step} className="font-normal">
        {text}
      </Mono>
    );
  if (hint === undefined) return <>{words}</>;
  return (
    <span className="flex flex-col gap-1">
      {words}
      <span className="text-small font-normal text-muted">{hint}</span>
    </span>
  );
}

/**
 * A form's last two parts: its failure band, then its submit, wired to
 * the same `useFormSubmit` state. One place, so the band never drifts from
 * the button it sits above.
 */
export function FormEnd({
  form,
  label,
  pendingLabel,
  tone,
}: Readonly<{
  form: Pick<FormShell, "failure" | "retry" | "retryRef" | "pending">;
  label: string;
  pendingLabel: string;
  tone?: keyof typeof SUBMIT_TONE | undefined;
}>): JSX.Element {
  return (
    <>
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        tone={tone}
        label={label}
        pendingLabel={pendingLabel}
        pending={form.pending}
      />
    </>
  );
}
