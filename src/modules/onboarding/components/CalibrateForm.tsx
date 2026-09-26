import type { JSX } from "react";
import { useState } from "react";

import { thermalOffsetLabel, thermalScale } from "../../../lib/contracts";
import type {
  CityLookup,
  DistanceUnit,
  TempUnit,
  Units,
} from "../../../lib/contracts";
import {
  Bracketed,
  ChoiceList,
  CityFinder,
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  Icon,
  Mono,
  PendingLabel,
  SubmitButton,
  inFlight,
  useFormSubmit,
} from "../../../ui";
import type { FieldProps } from "../../../ui";
import { CITY_UNCONFIRMED, calibrationInput } from "../inputs";
import type { Calibration } from "../inputs";
import { UNIT_LABELS, UnitFields } from "./UnitFields";

const LABELS = {
  thermalLevel: "Warm or cold",
  cityLabel: "Where you run",
  ...UNIT_LABELS,
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

/**
 * `+8°` … `−8°`, in whichever unit is currently selected.
 *
 * **Design's requirement, not decoration**: *"The offset is visible on
 * purpose. You'll see it change as we learn."* Recomputed from the unit
 * rather than stored, so switching to Celsius moves the offsets with it.
 */
function offsetLabels(unit: TempUnit): Record<string, string> {
  return Object.fromEntries(
    thermalScale.map((entry) => [
      String(entry.value),
      thermalOffsetLabel(entry.value, unit),
    ]),
  );
}

/**
 * Where the runner runs, once there is an answer: a typed city the lookup
 * found (its name and coordinates), or the browser's coordinates alone.
 */
interface Place {
  label?: string | undefined;
  lat: number;
  lng: number;
}

type Coordinates = { lat: number; lng: number } | undefined;

/**
 * Screen O1 — "one question does the calibration" — with round 22's
 * answer for the location step (item 19).
 *
 * **Only the first question is required.** A denied geolocation permission
 * must not block onboarding (requirement 1), so the city is picked, typed,
 * located or left blank, and the units default from the locale. Someone
 * can finish having answered one thing, which is the two-tap target.
 */
export function CalibrateForm({
  defaults,
  locate,
  lookUpCity,
  saveCalibration,
  onSaved,
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
  locate: () => Promise<Coordinates>;
  /**
   * Find (round 26 #12): resolves a typed city to one place, when the
   * runner asks — the provider resolves a label, it does not suggest as
   * you type. Nothing is saved until Use this.
   */
  lookUpCity: LookUpCity;
  saveCalibration: (input: { data: Calibration }) => Promise<unknown>;
  /**
   * Where O1 goes next. A prop rather than a `navigate` inside the action,
   * because the contract is announce-*then*-move (D-44).
   */
  onSaved: () => void;
}>): JSX.Element {
  const [thermalLevel, setThermalLevel] = useState<string | undefined>();
  const [typed, setTyped] = useState("");
  const [place, setPlace] = useState<Place>();
  const [tempUnit, setTempUnit] = useState<TempUnit>(defaults.temp);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(
    defaults.distance,
  );

  const form = useFormSubmit({
    schema: calibrationInput,
    action: async (values) => saveCalibration({ data: confirmed(values) }),
    onSuccess: onSaved,
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
          cityLabel: place === undefined ? typedCity(typed) : place.label,
          lat: place?.lat,
          lng: place?.lng,
          tempUnit,
          distanceUnit,
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
        optionNotes={offsetLabels(tempUnit)}
        hint="The offset is visible on purpose. You'll see it change as we learn."
        value={thermalLevel}
        field={form.field}
        onChange={setThermalLevel}
        error={form.fieldErrors.thermalLevel}
      />

      <WhereYouRun
        typed={typed}
        onTyped={setTyped}
        place={place}
        onPlace={setPlace}
        locate={locate}
        lookUpCity={lookUpCity}
        formField={{
          field: form.field,
          error: form.fieldErrors.cityLabel,
          focusField: form.focusField,
          announce: form.announce,
        }}
      />

      <UnitFields
        tempUnit={tempUnit}
        distanceUnit={distanceUnit}
        onTempUnit={setTempUnit}
        onDistanceUnit={setDistanceUnit}
        field={form.field}
        errors={form.fieldErrors}
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

type LookUpCity = (input: { data: { label: string } }) => Promise<CityLookup>;

/**
 * A typed city nobody pressed Find on (round 26 #12): Next says so on the
 * field — *"Press Find, or clear the field to skip."* Shaped the way
 * `useFormSubmit` lands a field issue, so it is the field's yellow and
 * focus goes to it: the fix is in the field.
 */
class CityUnconfirmed extends Error {
  readonly issues = [{ path: ["cityLabel"], message: CITY_UNCONFIRMED }];
}

/**
 * The calibration, once its place is one the runner confirmed: a found
 * city arrives with its coordinates (Use this made it the chip), the
 * browser's location arrives as coordinates alone, and a blank field is no
 * answer. A label with no coordinates is only ever typed text nobody
 * found, and that is the one thing Next refuses.
 */
function confirmed(values: Calibration): Calibration {
  if (values.cityLabel !== undefined && values.lat === undefined) {
    throw new CityUnconfirmed();
  }
  return values;
}

/**
 * A typed city is an answer only once found; a blank field is no answer
 * at all.
 */
function typedCity(typed: string): string | undefined {
  return typed.trim() === "" ? undefined : typed;
}

/**
 * The three pieces of `useFormSubmit` a single field needs, travelling
 * together rather than as three separate props — `field`, `error` and
 * `focusField` are always read from the same form and always passed as a
 * set, here and on every other field in this screen.
 */
interface FieldBinding {
  field: (name: string) => FieldProps;
  error: string | undefined;
  /**
  The form's own "focus this field", for the denied path.
  */
  focusField: (name: string) => void;
  /**
  The screen's one status region, for what Find says.
  */
  announce: (status: string) => void;
}

/**
 * O1's location step (round 22, item 19; round 26 #12): the field and
 * Find, then "Weather for {resolved}", then Use this makes the chip and
 * the field goes. "Change city" brings the field back empty. "Use my
 * location" is a text button under the field: in flight it breathes;
 * granted → chip; denied → focus to the field, line "Location's off.
 * Type your city instead." (not yellow).
 */
function WhereYouRun({
  typed,
  onTyped,
  place,
  onPlace,
  locate,
  lookUpCity,
  formField,
}: Readonly<{
  typed: string;
  onTyped: (value: string) => void;
  place: Place | undefined;
  onPlace: (place: Place | undefined) => void;
  locate: () => Promise<Coordinates>;
  lookUpCity: LookUpCity;
  formField: FieldBinding;
}>): JSX.Element {
  const { field, error, focusField, announce } = formField;
  const [isLocating, setIsLocating] = useState(false);
  const [isDenied, setIsDenied] = useState(false);

  async function askForLocation(): Promise<void> {
    if (isLocating) return;
    setIsLocating(true);
    setIsDenied(false);
    let at: Coordinates;
    try {
      at = await locate();
    } catch {
      // `locate` promises never to reject, but a browser with no
      // geolocation at all throws before it can keep that promise — and a
      // throw here would leave the button breathing forever. No
      // coordinates is the answer either way.
    }
    setIsLocating(false);
    if (at === undefined) {
      setIsDenied(true);
      focusField("cityLabel");
    } else {
      onPlace(at);
    }
  }

  if (place !== undefined) {
    return (
      <CityChip
        place={place}
        onChange={() => {
          onTyped("");
          onPlace(undefined);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <CityFinder
        name="cityLabel"
        label={LABELS.cityLabel}
        value={typed}
        onChange={onTyped}
        field={field}
        error={error}
        lookUp={lookUpCity}
        onUse={(found) => {
          onPlace({ label: found.address, lat: found.lat, lng: found.lng });
        }}
        announce={announce}
      />
      {isDenied ? (
        // Not yellow: nothing is wrong with the form. It is a fact about
        // the device, and the field is the way on.
        <p className="m-0 text-small text-quiet">
          Location&rsquo;s off. Type your city instead.
        </p>
      ) : undefined}
      <button
        type="button"
        {...inFlight(isLocating)}
        onClick={() => {
          void askForLocation();
        }}
        className="target cursor-pointer self-start border-none bg-transparent p-0 text-body font-semibold text-ink underline underline-offset-4"
      >
        <PendingLabel
          label="Use my location"
          pendingLabel="Use my location"
          pending={isLocating}
        />
      </button>
    </div>
  );
}

/**
 * What is saved, as round 26's O1 draws it: the provider's name for the
 * place, uppercased (in CSS, so the accessible name stays in normal case),
 * on a teal chip with a way to remove it, and "Change city" under it. The
 * browser's coordinates, when that is all there is, read as a measured
 * value. Both ways out bring the field back empty.
 */
function CityChip({
  place,
  onChange,
}: Readonly<{ place: Place; onChange: () => void }>): JSX.Element {
  const name = place.label ?? "your location";
  return (
    <div className="flex flex-col items-start gap-2">
      <span className="text-label">
        <Mono step="sm">{LABELS.cityLabel}</Mono>
      </span>
      <div
        data-part="city-chip"
        className="flex items-center gap-3 rounded-pill bg-teal px-4 py-2 text-accent-ink"
      >
        {place.label === undefined ? (
          <Bracketed>{`${place.lat.toFixed(2)}, ${place.lng.toFixed(2)}`}</Bracketed>
        ) : (
          <Mono step="sm">{place.label}</Mono>
        )}
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onChange}
          className="target cursor-pointer border-none bg-transparent p-0 text-accent-ink"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="target cursor-pointer border-none bg-transparent p-0 text-body font-semibold text-cold-text"
      >
        Change city
      </button>
    </div>
  );
}
