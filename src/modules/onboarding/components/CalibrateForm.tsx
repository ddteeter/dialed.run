import type { JSX } from "react";
import { useState } from "react";

import {
  distanceUnitSchema,
  tempUnitSchema,
  thermalScale,
} from "../../../lib/contracts";
import type { DistanceUnit, TempUnit, Units } from "../../../lib/contracts";
import {
  ChoiceField,
  ChoiceList,
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  SubmitButton,
  TextField,
  useFormSubmit,
} from "../../../ui";
import { calibrationInput } from "../inputs";
import type { Calibration } from "../inputs";

const LABELS = {
  thermalLevel: "Warm or cold",
  cityLabel: "Where you run",
  tempUnit: "Temperature",
  distanceUnit: "Distance",
};

/**
 * The five answers, keyed by the value they write. Derived from
 * `thermalScale` rather than restated — the +2..−2 mapping reads backwards
 * to about half of people, so it exists once.
 */
const THERMAL_OPTIONS = thermalScale.map((entry) => String(entry.value));
const THERMAL_LABELS = Object.fromEntries(
  thermalScale.map((entry) => [String(entry.value), entry.label]),
);

const TEMP_LABELS: Readonly<Record<TempUnit, string>> = {
  f: "Fahrenheit",
  c: "Celsius",
};
const DISTANCE_LABELS: Readonly<Record<DistanceUnit, string>> = {
  mi: "Miles",
  km: "Kilometres",
};

/**
 * Screen O1 — "one question does the calibration".
 *
 * **Only the first question is required.** A denied geolocation permission
 * must not block onboarding (requirement 1), so the city is typed or left
 * blank and the units default from the locale. Someone can finish having
 * answered one thing, which is the two-tap target.
 *
 * The offset is visible on purpose: the design's own words. A runner is
 * told how their answer is used rather than having it inferred silently.
 */
export function CalibrateForm({
  defaults,
  locate,
  saveCalibration,
}: Readonly<{
  /**
  Units guessed from the browser's locale, editable here.
  */
  defaults: Units;
  /**
   * Asks the browser where the runner is. Resolves to nothing when the
   * permission is denied — a refusal is an answer, not an error, so it
   * never reaches the failure band.
   */
  locate: () => Promise<{ lat: number; lng: number } | undefined>;
  saveCalibration: (input: { data: Calibration }) => Promise<unknown>;
}>): JSX.Element {
  const [thermalLevel, setThermalLevel] = useState<string | undefined>();
  const [cityLabel, setCityLabel] = useState("");
  const [tempUnit, setTempUnit] = useState<TempUnit | "">(defaults.temp);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit | "">(
    defaults.distance,
  );
  const [located, setLocated] = useState<{ lat: number; lng: number }>();

  const form = useFormSubmit({
    schema: calibrationInput,
    action: (values) => saveCalibration({ data: values }),
    successMessage: "Calibrated.",
    labels: LABELS,
  });

  return (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({
          thermalLevel: Number(thermalLevel),
          cityLabel: cityLabel === "" ? undefined : cityLabel,
          lat: located?.lat,
          lng: located?.lng,
          tempUnit: tempUnit === "" ? undefined : tempUnit,
          distanceUnit: distanceUnit === "" ? undefined : distanceUnit,
        });
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        onFocusField={form.focusField}
        summaryRef={form.summaryRef}
      />

      <ChoiceList
        name="thermalLevel"
        legend="Compared to people you run with, do you run warm or cold?"
        options={THERMAL_OPTIONS}
        optionLabels={THERMAL_LABELS}
        value={thermalLevel}
        field={form.field}
        onChange={setThermalLevel}
        error={form.fieldErrors.thermalLevel}
      />

      <TextField
        name="cityLabel"
        label={LABELS.cityLabel}
        value={cityLabel}
        onChange={setCityLabel}
        field={form.field}
        error={form.fieldErrors.cityLabel}
        hint="Sets your climate cohort — runners who face the same winters."
      />
      <LocateButton
        locate={locate}
        located={located !== undefined}
        onLocated={setLocated}
      />

      <ChoiceField
        name="tempUnit"
        label={LABELS.tempUnit}
        field={form.field}
        value={tempUnit}
        options={tempUnitSchema.options}
        optionLabels={TEMP_LABELS}
        onChange={setTempUnit}
        error={form.fieldErrors.tempUnit}
      />
      <ChoiceField
        name="distanceUnit"
        label={LABELS.distanceUnit}
        field={form.field}
        value={distanceUnit}
        options={distanceUnitSchema.options}
        optionLabels={DISTANCE_LABELS}
        onChange={setDistanceUnit}
        error={form.fieldErrors.distanceUnit}
      />

      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label="Start running"
        pendingLabel="Saving"
        pending={form.pending}
      />
    </form>
  );
}

/**
 * The geolocate offer.
 *
 * A refusal is not a failure: it never reaches the form's failure band,
 * and the runner keeps the typed-city path they already had. That is
 * requirement 1's "permission denial must not block" as a behaviour rather
 * than a caught exception.
 */
function LocateButton({
  locate,
  located,
  onLocated,
}: Readonly<{
  locate: () => Promise<{ lat: number; lng: number } | undefined>;
  located: boolean;
  /**
   * Handed the answer including "no answer", rather than being called only
   * on success. A `if (at) onLocated(at)` guard reads as caution and is
   * not: the caller stores it either way, so the guard changes nothing and
   * only adds a branch no test can tell apart.
   */
  onLocated: (at: { lat: number; lng: number } | undefined) => void;
}>): JSX.Element {
  const [asked, setAsked] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="self-start rounded-md border border-night/20 px-3 py-2 text-sm font-semibold"
        onClick={() => {
          void locate().then((at) => {
            setAsked(true);
            onLocated(at);
          });
        }}
      >
        Use my location
      </button>
      {located ? (
        <span className="text-xs text-night/50">Got it.</span>
      ) : undefined}
      {asked && !located ? (
        <span className="text-xs text-night/50">
          No location — the city above is enough.
        </span>
      ) : undefined}
    </div>
  );
}
