import type { JSX } from "react";
import { useState } from "react";

import type { ManualSky, Units } from "../../../lib/contracts";
import { manualSkies } from "../../../lib/contracts";
import { bandLabel } from "../../../lib/temperature";
import {
  ChoiceList,
  ControlFailureBand,
  FormFailureBand,
  FormStatus,
  inFlight,
  Mono,
  PendingLabel,
  Sheet,
  SubmitButton,
  useControlAction,
  useFormSubmit,
} from "../../../ui";
import {
  BAND_OPTIONS,
  SET_CONDITION_BANDS,
  conditionsPickSchema,
  SKY_WORDS,
} from "../run-conditions";

/**
 * The server functions, handed in rather than imported, in their own shape
 * — a component never reaches `../functions` (CLAUDE.md).
 */
export interface ConditionsActions {
  setConditions: (input: {
    data: { runId: string; bandFloorC: number; sky: ManualSky };
  }) => Promise<boolean>;
  retryWeather: (input: { data: { runId: string } }) => Promise<boolean>;
}

/**
 * The state a failed pick or retry leaves true: the run still has no
 * conditions. The word is R's own row ("NO CONDITIONS").
 */
const STILL_TRUE = "No conditions";

/**
 * R2b — "No weather saved" (Remaining Screens R2b), opened from run
 * detail's "No conditions · Set ›" and the list's "SET CONDITIONS ›"
 * (round 22). *"A whole-form failure, so it's outlined, not yellow — the
 * fix isn't in the form."*
 *
 * **Set conditions picks, never types** (round 22: *"the runner picks from
 * what R2b offers and never types a number"*): the band and the sky, the
 * two picks round 26 draws. The band is stored as its middle with
 * `source='manual'`, the sky beside it. **Try again** asks the provider
 * once more, and fails as a control does, with the band saying what is
 * still true.
 */
export function SetConditionsSheet({
  runId,
  units,
  open,
  onClose,
  onDone,
  actions,
}: Readonly<{
  runId: string;
  units: Units;
  open: boolean;
  onClose: () => void;
  /**
  After either lands: the caller reloads the run and closes the sheet.
  */
  onDone: () => Promise<void>;
  actions: ConditionsActions;
}>): JSX.Element {
  const [isPicking, setIsPicking] = useState(false);
  const retry = useControlAction({
    kicker: STILL_TRUE,
    action: async () => actions.retryWeather({ data: { runId } }),
    onSuccess: onDone,
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={isPicking ? "Set conditions" : "No weather saved"}
    >
      {isPicking ? (
        <SetConditionsForm
          runId={runId}
          units={units}
          actions={actions}
          onDone={onDone}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <FormStatus>{retry.status}</FormStatus>
          <Mono step="xs" className="text-muted">
            No history for that time
          </Mono>
          <div
            data-slot="weather-unavailable"
            className="flex flex-col items-start gap-3 border border-ink p-4"
          >
            <h2 className="m-0">
              <Mono step="sm">No weather saved</Mono>
            </h2>
            <p className="m-0 text-body">
              We have no record for that hour. Set the conditions yourself and
              the run still counts.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsPicking(true);
                }}
                className="target rounded-field border-none bg-ink px-4 text-body font-bold text-ground"
              >
                Set conditions
              </button>
              <button
                type="button"
                {...inFlight(retry.pending)}
                onClick={() => {
                  void retry.run();
                }}
                className="target rounded-field border border-ink bg-transparent px-4 text-body font-semibold"
              >
                <PendingLabel
                  label="Try again"
                  pendingLabel="Trying"
                  pending={retry.pending}
                />
              </button>
            </div>
          </div>
          <ControlFailureBand
            failure={retry.failure}
            onRetry={retry.retry}
            retryRef={retry.retryRef}
          />
        </div>
      )}
    </Sheet>
  );
}

/**
 * R2b's two picks (round 26, item 2): **How warm**, the twelve 5 °C bands
 * in the runner's unit, three to a row, coldest top-left; and **Sky**.
 * Nothing is preselected — *"a guess we make would look like a reading we
 * took"* — and both are required, each refusal on its own group. The
 * button says the pick once there is one: "Set 41–50° and rain".
 *
 * A form, so it is the Form Contract's: `useFormSubmit`, the schema's
 * sentences, `SubmitButton`, `FormFailureBand`.
 */
function SetConditionsForm({
  runId,
  units,
  actions,
  onDone,
}: Readonly<{
  runId: string;
  units: Units;
  actions: ConditionsActions;
  onDone: () => Promise<void>;
}>): JSX.Element {
  const [band, setBand] = useState("");
  const [sky, setSky] = useState<ManualSky | "">("");
  const form = useFormSubmit({
    schema: conditionsPickSchema,
    action: async (values) =>
      actions.setConditions({ data: { runId, ...values } }),
    successMessage: "Conditions set.",
    labels: { bandFloorC: "How warm", sky: "Sky" },
    onSuccess: onDone,
  });
  const bandLabels = Object.fromEntries(
    SET_CONDITION_BANDS.map((floor) => [
      String(floor),
      bandLabel(floor, units.temp),
    ]),
  );
  const label =
    band === "" || sky === ""
      ? "Set conditions"
      : `Set ${bandLabel(Number(band), units.temp)} and ${SKY_WORDS[sky].toLowerCase()}`;

  return (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({ bandFloorC: band, sky });
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <p className="m-0 text-small text-label">
        Roughly is fine. This stays on your run and never counts toward anyone
        else&rsquo;s.
      </p>
      {/* Three to a row, coldest top-left (round 26, item 2): the primitive
          wraps its chips, and this is the grid they wrap into. */}
      <div className="[&_fieldset>div]:grid [&_fieldset>div]:grid-cols-3">
        <ChoiceList
          name="bandFloorC"
          legend={`How warm · °${units.temp.toUpperCase()}`}
          layout="chips"
          options={BAND_OPTIONS}
          optionLabels={bandLabels}
          value={band}
          field={form.field}
          onChange={setBand}
          error={form.fieldErrors.bandFloorC}
        />
      </div>
      <ChoiceList
        name="sky"
        legend="Sky"
        layout="chips"
        options={manualSkies}
        optionLabels={SKY_WORDS}
        value={sky}
        field={form.field}
        onChange={setSky}
        error={form.fieldErrors.sky}
      />
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label={label}
        pendingLabel="Setting"
        pending={form.pending}
      />
    </form>
  );
}
