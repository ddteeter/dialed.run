import type { JSX } from "react";

import { distanceUnitSchema, tempUnitSchema } from "../../../lib/contracts";
import type { DistanceUnit, TempUnit } from "../../../lib/contracts";
import { ChoiceField } from "../../../ui";
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

const TEMP_LABELS: Readonly<Record<TempUnit, string>> = {
  f: "Fahrenheit",
  c: "Celsius",
};
const DISTANCE_LABELS: Readonly<Record<DistanceUnit, string>> = {
  mi: "Miles",
  km: "Kilometres",
};

/**
 * The two unit selects, which two screens ask for identically.
 *
 * O1 offers them as a locale guess a runner can correct, and settings
 * shows the saved pair back. The controls are the same in both — same
 * enums, same words, same order — and they were written out twice, which
 * semantic dupes found as a 25-line clone.
 *
 * **It is the words that make this worth extracting, not the markup.**
 * "Kilometres" versus "Kilometers" is a real choice, and so is which of
 * the pair comes first; a second copy is how one screen ends up saying
 * something the other does not. The enums already come from the schema
 * (`tempUnitSchema.options`), so the only thing that was ever duplicated
 * is the part a person reads.
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
  onTempUnit: (value: TempUnit | "") => void;
  onDistanceUnit: (value: DistanceUnit | "") => void;
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
    <>
      <ChoiceField
        name="tempUnit"
        label={UNIT_LABELS.tempUnit}
        field={field}
        value={tempUnit}
        options={tempUnitSchema.options}
        optionLabels={TEMP_LABELS}
        onChange={onTempUnit}
        error={errors.tempUnit}
      />
      <ChoiceField
        name="distanceUnit"
        label={UNIT_LABELS.distanceUnit}
        field={field}
        value={distanceUnit}
        options={distanceUnitSchema.options}
        optionLabels={DISTANCE_LABELS}
        onChange={onDistanceUnit}
        error={errors.distanceUnit}
      />
    </>
  );
}
