import type { JSX } from "react";
import { useState } from "react";

import { tapListSelectionSchema } from "../../../lib/contracts";
import type { TapListSelection } from "../../../lib/contracts";
import { toggledIn } from "../../../lib/toggled-in";
import {
  FieldMessage,
  FormFailureBand,
  FormStatus,
  Mono,
  SubmitButton,
  useFormSubmit,
} from "../../../ui";
import type { FieldProps } from "../../../ui";
import type { TapListEntry } from "../../closet";

/**
 * How many taps before the screen says the closet is worth something.
 *
 * Six, from design round 6: *"'Enough to start' appears at six and is
 * advice, not a gate."* Both halves are behaviour — the words appear at
 * six, and nothing about the submit changes there, because Next is live
 * from the first tap.
 */
const ENOUGH_TO_START = 6;

/**
 * The ink inversion a tapped row wears, and the outline an untapped one
 * does.
 *
 * Held as constants rather than written inline because the mark is a
 * *rule*, not a look: design round 6 §AB settled that pink, teal and grey
 * mean cold, dialed and warm everywhere and permanently, so a tick cannot
 * be a hue. What is left is ink — the chip fills, the text reverses — and
 * `tap-list-form.dom.test.tsx` asserts both states so a later restyle
 * cannot quietly reintroduce a coloured tick.
 */
const CHIP_ON = "flex items-center gap-1.5 rounded-full bg-night px-3 py-2 font-mono text-[11px] uppercase tracking-[0.03em] text-chalk has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-night";
const CHIP_OFF = "flex items-center gap-1.5 rounded-full border border-night/20 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.03em] text-night/70 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-night";

/**
 * Screen O3 — "tap what you own", the one list.
 *
 * Design round 6 (`Remaining Screens.dc.html` §AA) addressed lane 105 in
 * six numbered rules, and five of them are visible here:
 *
 * 1. **One list, never three.** The rows arrive already ordered; this
 *    screen does no filtering of its own, because *no row is ever absent* —
 *    a Minneapolis runner owns tights and a singlet, and one band per
 *    person is a season rather than a wardrobe.
 * 2. **The band is the sort key**, applied before the list gets here.
 * 3. **Fold at `fold`, and the disclosure states the remainder.** It states
 *    the real one: design specified 24 rows and named 14, and the table
 *    holds 18 today (D-49), so a hardcoded "10 more" would have been a lie
 *    the moment the missing six landed.
 * 4. **Nothing arrives ticked.** There is deliberately no prop for a
 *    starting selection — the state begins empty and is derived from taps
 *    only. With O2 cut, the screen opens at zero every time, and a seed
 *    prop is how that quietly stops being true.
 * 6. **`CLOSET: {n} PIECES`**, counting taps. The old "12 pieces" was a
 *    mock, not a target.
 *
 * Rule 5 — a photo-derived row rendering ticked, non-toggling and tagged
 * `FROM PHOTO` — belongs to O2, which is cut from v1. It is not
 * half-implemented here: every row is a toggle, and the difference design
 * insists on ("it must look like one") is a thing to build when the rows
 * that need it exist.
 *
 * **Next is live from the first tap, and the zero-tap state is a sentence
 * rather than a grey button.** The artboard draws Next inert until
 * something is ticked; §Forms & failure forbids the `disabled` attribute
 * on a submit, because it drops focus and stops announcing. So a zero-tap
 * Next lands on `tapListSelectionSchema`'s own message — "Tap what you
 * own, or skip for now." — which names the way out that the grey button
 * could only imply.
 *
 * No `FormErrorSummary`: it renders at two or more field errors and this
 * form has one field, so it could never appear. The primitive is not
 * hand-rolled anywhere — it is simply not reachable from a single-field
 * form.
 */
export function TapListForm({
  entries,
  fold,
  saveTapList,
  onSaved,
  onSkip,
}: Readonly<{
  /**
   * The whole list, already in the runner's band order. Ordering happens
   * server-side (`tapListFor`) because reaching `modules/closet` from a
   * component would drag `db/schema` into the client bundle — the trap
   * CLAUDE.md records twice.
   */
  entries: readonly TapListEntry[];
  /**
  How many rows sit above the fold. The rest are one tap behind a disclosure.
  */
  fold: number;
  saveTapList: (input: { data: TapListSelection }) => Promise<unknown>;
  onSaved: () => void;
  /**
   * Every step past O1 is skippable and a runner who bails still has a
   * working app (packet requirement 4). Skip writes nothing — it is not a
   * submit with an empty payload.
   */
  onSkip: () => void;
}>): JSX.Element {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  const hidden = entries.slice(fold);
  const shown = expanded ? entries : entries.slice(0, fold);

  const form = useFormSubmit({
    schema: tapListSelectionSchema,
    action: (values) => saveTapList({ data: values }),
    onSuccess: onSaved,
    successMessage: "Closet started.",
  });

  return (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({ keys: [...ticked] });
      }}
    >
      <FormStatus>{form.status}</FormStatus>

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 p-0 font-mono text-[11px] uppercase tracking-[0.1em] text-night/50">
          Common in your climate · tap to add
        </legend>
        <div className="flex flex-wrap gap-2">
          {shown.map((entry) => (
            <TapChip
              key={entry.key}
              label={entry.garment.name}
              isOn={ticked.has(entry.key)}
              field={form.field}
              onToggle={() => {
                setTicked((previous) => toggledIn(previous, entry.key));
              }}
            />
          ))}
        </div>
        <Disclosure
          remaining={hidden.length}
          expanded={expanded}
          onToggle={() => {
            setExpanded((previous) => !previous);
          }}
        />
        <FieldMessage name="keys" error={form.fieldErrors.keys} />
      </fieldset>

      <div className="flex items-center justify-between border-t border-night/15 pt-3">
        {/* A count is a measured value, so it is mono — and the words are
            written in normal case because `Mono` uppercases in CSS, which
            keeps the accessible name readable. "1 pieces" is design's copy
            verbatim (rule 6); the whole-UI copy pass owns the plural. */}
        <Mono>Closet: {ticked.size} pieces</Mono>
        <Mono className="text-night/50">
          {ticked.size >= ENOUGH_TO_START ? "Enough to start" : "Tap what you own"}
        </Mono>
      </div>

      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton label="Next" pendingLabel="Saving" pending={form.pending} />
      <button
        type="button"
        onClick={onSkip}
        className="cursor-pointer self-center border-none bg-transparent p-0 text-sm underline underline-offset-[3px]"
      >
        Skip for now
      </button>
    </form>
  );
}

/**
 * One offer.
 *
 * A real `<input type="checkbox">` inside its label, visually hidden: a
 * multi-select from a fixed set is what a checkbox group *is*, and a
 * screen reader announces "Running tights, checkbox, checked" without the
 * screen having to say so twice. The `+` and `✓` the artboard draws are
 * therefore decoration — `aria-hidden`, because the checked state is
 * already spoken and hearing "check mark" after it is noise.
 *
 * `field()` is spread for the same reason `ChoiceList` spreads it: it
 * carries `aria-invalid`/`aria-describedby` so the group's one message is
 * announced with the control, and `onInput`, which clears that message the
 * moment a runner does the thing it asked for.
 */
function TapChip({
  label,
  isOn,
  field,
  onToggle,
}: Readonly<{
  label: string;
  isOn: boolean;
  field: (name: string) => FieldProps;
  onToggle: () => void;
}>): JSX.Element {
  return (
    <label className={isOn ? CHIP_ON : CHIP_OFF}>
      <input
        {...field("keys")}
        type="checkbox"
        className="sr-only"
        checked={isOn}
        onChange={onToggle}
      />
      <span aria-hidden="true">{isOn ? "✓" : "+"}</span>
      {label}
    </label>
  );
}

/**
 * "Everything else · N more".
 *
 * The label does not change when it opens: a disclosure's accessible name
 * is what it discloses, and `aria-expanded` is what carries the state. A
 * button whose name flips to "Fewer" announces a different control every
 * time it is pressed.
 *
 * It renders nothing when nothing is hidden — a disclosure over an empty
 * set is a control that lies. The fold works at any list length, which is
 * what makes D-49's six missing rows a content gap rather than a blocked
 * screen.
 */
function Disclosure({
  remaining,
  expanded,
  onToggle,
}: Readonly<{
  remaining: number;
  expanded: boolean;
  onToggle: () => void;
}>): JSX.Element | undefined {
  if (remaining === 0) return undefined;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="cursor-pointer self-start rounded-full border border-dashed border-night/30 bg-transparent px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.04em] text-night/60"
    >
      Everything else · {remaining} more
      <span aria-hidden="true"> ▾</span>
    </button>
  );
}
