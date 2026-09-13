import { Link } from "@tanstack/react-router";
import type { JSX } from "react";
import { useState } from "react";

import {
  thermalOffsetLabel,
  thermalScale,
} from "../../../lib/contracts";
import type { DistanceUnit, TempUnit } from "../../../lib/contracts";
import {
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  Mono,
  SubmitButton,
  ToggleField,
  useFormSubmit,
} from "../../../ui";
import { UNIT_LABELS, UnitFields } from "./UnitFields";
import { preferencesInput } from "../inputs";
import type { Preferences } from "../inputs";
import type { CurrentSettings } from "../profile";

const LABELS = {
  ...UNIT_LABELS,
  shareDefault: "Share to feed by default",
};

/**
 * Settings — the three rows lane 105 owns out of design's U1 index.
 *
 * U1 is a ten-row screen spanning account, privacy, blocked runners,
 * notifications, connections, export and delete; those belong to other
 * lanes and to D-32. What is here is what this packet owns: how you run
 * warm or cold, units, and the sharing default.
 *
 * **Design's rule for this screen is that every row says its current
 * value** — "a settings list you can read without opening anything". The
 * calibration row honours that literally: it states the answer *and* the
 * offset, rather than making someone open O1 to find out what they picked.
 *
 * One form and one save for the two rows that are editable here.
 * Recalibrating is a link rather than a fourth control, because it is O1's
 * five-answer question with its visible offset and not a row in a
 * preferences form (requirement 6) — and because a control that navigates
 * away mid-form would lose the unsaved units beside it.
 */
export function SettingsForm({
  current,
  savePreferences,
}: Readonly<{
  current: CurrentSettings;
  savePreferences: (input: { data: Preferences }) => Promise<unknown>;
}>): JSX.Element {
  const [tempUnit, setTempUnit] = useState<TempUnit | "">(current.tempUnit);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit | "">(
    current.distanceUnit,
  );
  const [shareDefault, setShareDefault] = useState(current.shareDefault);

  const form = useFormSubmit({
    schema: preferencesInput,
    action: (values) => savePreferences({ data: values }),
    successMessage: "Settings saved.",
    labels: LABELS,
  });

  return (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({ tempUnit, distanceUnit, shareDefault });
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        onFocusField={form.focusField}
        summaryRef={form.summaryRef}
      />

      <section className="flex flex-col gap-3">
        <h2 className="m-0 font-mono text-[11px] uppercase tracking-[0.1em] text-night/50">
          You
        </h2>
        <CalibrationRow
          thermalLevel={current.thermalLevel}
          tempUnit={tempUnit === "" ? current.tempUnit : tempUnit}
        />
        <UnitFields
          tempUnit={tempUnit}
          distanceUnit={distanceUnit}
          onTempUnit={setTempUnit}
          onDistanceUnit={setDistanceUnit}
          field={form.field}
          errors={form.fieldErrors}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 font-mono text-[11px] uppercase tracking-[0.1em] text-night/50">
          Every new entry
        </h2>
        <ToggleField
          name="shareDefault"
          label={LABELS.shareDefault}
          field={form.field}
          isOn={shareDefault}
          onChange={setShareDefault}
        />
        <p className="m-0 text-xs leading-snug text-night/50">
          You can flip it per run.
        </p>
      </section>

      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label="Save settings"
        pendingLabel="Saving"
        pending={form.pending}
      />
    </form>
  );
}

/**
 * "How you run warm or cold — currently About average, 0° offset."
 *
 * The offset is in the units *selected above*, not the units saved,
 * because the select is what the person is looking at. Changing the
 * temperature unit and watching this line move is the same "you'll see it
 * change as we learn" promise O1 makes, applied to the one thing on this
 * screen that can demonstrate it before a save.
 *
 * Shows nothing but the offer when there is no answer yet — someone can
 * reach settings without ever finishing O1, since every step is skippable.
 * "Currently unset, 0° offset" would be a measured value invented for
 * someone who has not given one.
 */
function CalibrationRow({
  thermalLevel,
  tempUnit,
}: Readonly<{
  thermalLevel: number | undefined;
  tempUnit: TempUnit;
}>): JSX.Element {
  const answer = thermalScale.find((entry) => entry.value === thermalLevel);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-night/15 bg-chalk px-[14px] py-[12px]">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">How you run warm or cold</span>
        {answer === undefined ? (
          <span className="text-xs text-night/50">Not answered yet.</span>
        ) : (
          <span className="text-xs text-night/50">
            Currently {answer.label},{" "}
            <Mono>{thermalOffsetLabel(answer.value, tempUnit)}</Mono> offset
          </span>
        )}
      </div>
      <Link
        to="/onboarding/calibrate"
        className="shrink-0 rounded-full border border-night/20 px-3.5 py-2 text-xs font-semibold"
      >
        Recalibrate
      </Link>
    </div>
  );
}
