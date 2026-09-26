import type { JSX } from "react";

import { distanceUnitSchema, tempUnitSchema } from "../../../lib/contracts";
import type { DistanceUnit, TempUnit } from "../../../lib/contracts";
import { ChoiceList } from "../../../ui";
import type { FieldProps } from "../../../ui";

/**
 * The words each unit goes by on screen.
 *
 * Exported so a form can put them in its `labels` map for the error
 * summary without writing them a second time — the summary says "Units —
 * pick one", and a form that spelled that differently from its own field
 * label would be pointing at a control the user cannot find.
 */
export const UNIT_LABELS = {
  tempUnit: "Temperature",
  distanceUnit: "Distance",
};

/**
 * The segments' own words: N draws `°F °C` and `MI KM`. Short because a
 * segmented pair is read at a glance, and the legend already says which
 * quantity each pair is.
 */
const TEMP_LABELS: Readonly<Record<TempUnit, string>> = {
  f: "°F",
  c: "°C",
};
const DISTANCE_LABELS: Readonly<Record<DistanceUnit, string>> = {
  mi: "mi",
  km: "km",
};

/**
 * The two unit pairs, which O1 and the units sub-page ask identically.
 *
 * **Two segmented pairs** (round 22, item 19: *"Units: two segmented
 * pairs, °F/°C and mi/km, defaulted from locale"*) — both answers visible
 * at once, which is a radio group's job and not a select's, so each pair
 * is `ChoiceList` laid out as chips. The enums come from the schema
 * (`tempUnitSchema.options`), so the only thing written here is the part a
 * person reads.
 */
export function UnitFields({
  tempUnit,
  distanceUnit,
  onTempUnit,
  onDistanceUnit,
  field,
  errors,
}: Readonly<{
  tempUnit: TempUnit | "";
  distanceUnit: DistanceUnit | "";
  onTempUnit: (value: TempUnit) => void;
  onDistanceUnit: (value: DistanceUnit) => void;
  field: (name: string) => FieldProps;
  /**
   * The two messages, if either field has one. Taken as a pair rather than
   * the whole `fieldErrors` map, so this cannot silently start reading a
   * field that is not its own.
   */
  errors: Readonly<{
    tempUnit?: string | undefined;
    distanceUnit?: string | undefined;
  }>;
}>): JSX.Element {
  return (
    <div data-part="units" className="flex flex-wrap gap-6">
      <ChoiceList
        name="tempUnit"
        legend={UNIT_LABELS.tempUnit}
        layout="chips"
        field={field}
        value={tempUnit}
        options={tempUnitSchema.options}
        optionLabels={TEMP_LABELS}
        onChange={onTempUnit}
        error={errors.tempUnit}
      />
      <ChoiceList
        name="distanceUnit"
        legend={UNIT_LABELS.distanceUnit}
        layout="chips"
        field={field}
        value={distanceUnit}
        options={distanceUnitSchema.options}
        optionLabels={DISTANCE_LABELS}
        onChange={onDistanceUnit}
        error={errors.distanceUnit}
      />
    </div>
  );
}
