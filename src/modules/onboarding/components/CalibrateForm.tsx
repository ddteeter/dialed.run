import type { JSX } from "react";
import { useState } from "react";

import { thermalOffsetLabel, thermalScale } from "../../../lib/contracts";
import type { DistanceUnit, TempUnit, Units } from "../../../lib/contracts";
import {
  Bracketed,
  ChoiceList,
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  Mono,
  PendingLabel,
  SubmitButton,
  TextField,
  inFlight,
  useFormSubmit,
} from "../../../ui";
import { CITY_NOT_FOUND, calibrationInput } from "../inputs";
import type { Calibration } from "../inputs";
import type { CityLookup } from "../place";
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
   * Resolves a typed city to a place, once, on submit — the provider
   * resolves a label, it does not suggest as you type (owner, 2026-09-24).
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
    action: async (values) =>
      saveCalibration({
        data: await withPlace(values, lookUpCity, setPlace),
      }),
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
        formField={{
          field: form.field,
          error: form.fieldErrors.cityLabel,
          focusField: form.focusField,
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
 * The city field's failure, shaped the way `useFormSubmit` lands a field
 * issue — so "we couldn't find that place" is the field's yellow, not the
 * form's band: the fix is in the field.
 */
class CityNotFound extends Error {
  readonly issues = [{ path: ["cityLabel"], message: CITY_NOT_FOUND }];

  constructor() {
    super(CITY_NOT_FOUND);
    this.name = "CityNotFound";
  }
}

/**
 * The calibration with its typed city resolved, when there is one to
 * resolve.
 *
 * Asked once, on submit, and only for a typed city: nothing typed, a place
 * already resolved, or the browser's own coordinates all go as they are. A
 * found place becomes the chip, so a retry after a failed save does not
 * ask again; a provider that cannot answer leaves the label to go alone.
 */
async function withPlace(
  values: Calibration,
  lookUp: LookUpCity,
  onFound: (place: Place) => void,
): Promise<Calibration> {
  if (values.cityLabel === undefined || values.lat !== undefined) {
    return values;
  }
  const label = values.cityLabel;
  const found = await lookUp({ data: { label } });
  if (found.kind === "not-found") throw new CityNotFound();
  if (found.kind === "unavailable") return values;
  onFound({ label, lat: found.lat, lng: found.lng });
  return { ...values, lat: found.lat, lng: found.lng };
}

/**
 * A typed city is an answer — resolved on submit (`withPlace`) — and a
 * blank field is no answer at all.
 */
function typedCity(typed: string): string | undefined {
  return typed.trim() === "" ? undefined : typed;
}

const HINT = "Sets your climate cohort — runners who face the same winters.";

/**
 * The three pieces of `useFormSubmit` a single field needs, travelling
 * together rather than as three separate props — `field`, `error` and
 * `focusField` are always read from the same form and always passed as a
 * set, here and on every other field in this screen.
 */
interface FieldBinding {
  field: Parameters<typeof TextField>[0]["field"];
  error: string | undefined;
  /**
  The form's own "focus this field", for the denied path.
  */
  focusField: (name: string) => void;
}

/**
 * O1's location step (round 22, item 19, as the owner corrected it on
 * 2026-09-24): the city is typed and resolved on submit, and becomes the
 * chip when found. "Use my location" is a text button under it: in flight
 * it breathes; granted → chip; denied → focus to the field, line
 * "Location's off. Type your city instead." (not yellow).
 */
function WhereYouRun({
  typed,
  onTyped,
  place,
  onPlace,
  locate,
  formField,
}: Readonly<{
  typed: string;
  onTyped: (value: string) => void;
  place: Place | undefined;
  onPlace: (place: Place | undefined) => void;
  locate: () => Promise<Coordinates>;
  formField: FieldBinding;
}>): JSX.Element {
  const { field, error, focusField } = formField;
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
      at = undefined;
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
      <div className="flex flex-col gap-2">
        <span className="text-label">
          <Mono step="sm">{LABELS.cityLabel}</Mono>
        </span>
        <div
          data-part="city-chip"
          className="flex items-center justify-between gap-3 rounded-field border border-ink px-4 py-3"
        >
          {place.label === undefined ? (
            // Located, not named: the coordinates are a measured value,
            // so they read as one.
            <Bracketed>{`${place.lat.toFixed(2)}, ${place.lng.toFixed(2)}`}</Bracketed>
          ) : (
            <span className="text-body">{place.label}</span>
          )}
          <button
            type="button"
            onClick={() => {
              onPlace(undefined);
            }}
            className="target cursor-pointer border-none bg-transparent p-0 text-ink"
          >
            <Mono step="xs">Change</Mono>
          </button>
        </div>
        <span className="text-micro text-muted">{HINT}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <TextField
        name="cityLabel"
        label={LABELS.cityLabel}
        value={typed}
        onChange={onTyped}
        field={field}
        error={error}
        hint={HINT}
        autoComplete="address-level2"
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
