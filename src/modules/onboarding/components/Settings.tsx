import { Link } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX, ReactNode } from "react";
import type { z } from "zod";

import { thermalOffsetLabel, thermalScale } from "../../../lib/contracts";
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
import { sharingInput, unitsInput } from "../inputs";
import type { SharingChoice, UnitsChoice } from "../inputs";
import type { CurrentSettings } from "../profile";
import { UNIT_LABELS, UnitFields } from "./UnitFields";

/**
 * Settings, as round 22 rules it (item 20): *"U1/N's tap-through index
 * wins; the one long form is drift. Each sub-page is its own small form
 * with its own Save."*
 *
 * **Every row says its current value** — U1's *"a settings list you can
 * read without opening anything"* — and **a row with nowhere to go is
 * absent**: account, notifications, export and delete have no page yet,
 * and a row that opens nothing is a dead control (round 22's rule for
 * Strava, item 23, applied to its neighbours).
 */

const TEMP_WORDS: Readonly<Record<TempUnit, string>> = {
  f: "Fahrenheit",
  c: "Celsius",
};
const DISTANCE_WORDS: Readonly<Record<DistanceUnit, string>> = {
  mi: "miles",
  km: "kilometres",
};

/**
 * One tap-through row: the setting, what it is now, and the way in.
 */
function SettingsRow({
  to,
  params,
  label,
  value,
  action = "›",
}: Readonly<{
  to: NonNullable<LinkProps["to"]>;
  /**
   * The sub-page a `$section` row opens; `{}` for a row whose route has no
   * params. Always passed, so no row can leave it `undefined` by accident.
   */
  params: NonNullable<LinkProps["params"]>;
  label: string;
  value: ReactNode;
  /**
  "›" when it opens something, and the verb when there is something to do.
  */
  action?: string;
}>): JSX.Element {
  return (
    <li>
      <Link
        to={to}
        params={params}
        data-part="settings-row"
        className="target flex items-center justify-between gap-3 border-b border-hairline py-3 text-ink no-underline"
      >
        <span className="flex flex-col gap-1">
          <span className="text-body font-semibold">{label}</span>
          <span className="text-small text-muted">{value}</span>
        </span>
        <span className="shrink-0 text-body">{action}</span>
      </Link>
    </li>
  );
}

/**
 * One of U1's groups: a mono heading over its rows.
 */
function SettingsGroup({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>): JSX.Element {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="m-0 text-muted">
        <Mono step="xs">{title}</Mono>
      </h2>
      <ul className="m-0 flex list-none flex-col p-0">{children}</ul>
    </section>
  );
}

/**
 * U1 · the index.
 */
export function SettingsIndex({
  current,
  blockedCount,
  signOut,
}: Readonly<{
  current: CurrentSettings;
  blockedCount: number;
  /**
  The foot's Sign out, the route's to wire (it needs the router).
  */
  signOut: ReactNode;
}>): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title="You">
        <CalibrationRow
          thermalLevel={current.thermalLevel}
          tempUnit={current.tempUnit}
        />
        <SettingsRow
          to="/onboarding/settings/$section"
          params={{ section: "units" }}
          label="Units"
          value={`${TEMP_WORDS[current.tempUnit]}, ${DISTANCE_WORDS[current.distanceUnit]}`}
        />
      </SettingsGroup>
      <SettingsGroup title="Who sees what">
        <SettingsRow
          to="/onboarding/settings/$section"
          params={{ section: "sharing" }}
          label="Privacy"
          value={
            current.shareDefault
              ? "New runs go to the feed"
              : "New runs stay private"
          }
        />
      </SettingsGroup>
      <SettingsGroup title="Review">
        <SettingsRow
          to="/safety/blocked"
          params={{}}
          label="Blocked runners"
          value={`${String(blockedCount)} blocked`}
        />
      </SettingsGroup>
      <SettingsGroup title="Data">
        <SettingsRow
          to="/runs/strava"
          params={{}}
          label="Connections"
          value="Strava"
        />
      </SettingsGroup>
      {signOut}
    </div>
  );
}

/**
 * *"Unanswered calibration row: 'How you run' · 'Not answered' in --muted
 * · 'Answer ›'."* Answered, it states the answer and its offset, as U1
 * draws it — a runner is never made to open O1 to find out what they
 * picked.
 */
function CalibrationRow({
  thermalLevel,
  tempUnit,
}: Readonly<{
  thermalLevel: number | undefined;
  tempUnit: TempUnit;
}>): JSX.Element {
  const answer = thermalScale.find((entry) => entry.value === thermalLevel);
  if (answer === undefined) {
    return (
      <SettingsRow
        to="/onboarding/calibrate"
        params={{}}
        label="How you run"
        value="Not answered"
        action="Answer ›"
      />
    );
  }
  return (
    <SettingsRow
      to="/onboarding/calibrate"
      params={{}}
      label="How you run"
      value={
        <>
          Currently {answer.label},{" "}
          <Mono>{thermalOffsetLabel(answer.value, tempUnit)}</Mono> offset
        </>
      }
    />
  );
}

/**
 * What a sub-page's form hands the fields it holds: the value being edited,
 * a way to change it, and the form's `field()` and errors.
 */
interface SectionFields<TValue> {
  value: TValue;
  onChange: (value: TValue) => void;
  form: Pick<ReturnType<typeof useFormSubmit>, "field" | "fieldErrors">;
}

/**
 * One sub-page's small form — round 22, item 20's *"each sub-page is its
 * own small form with its own Save"*: its own state, seeded from what is
 * saved, the contract's status, summary and band, and one Save. What it
 * holds is the caller's, as a render function over `SectionFields`.
 */
function SectionForm<TSchema extends z.ZodType>({
  schema,
  initial,
  save,
  successMessage,
  labels,
  children,
}: Readonly<{
  schema: TSchema;
  initial: z.output<TSchema>;
  save: (input: { data: z.output<TSchema> }) => Promise<unknown>;
  successMessage: string;
  labels: Record<string, string>;
  children: (fields: SectionFields<z.output<TSchema>>) => ReactNode;
}>): JSX.Element {
  const [value, setValue] = useState(initial);
  const form = useFormSubmit({
    schema,
    action: (values) => save({ data: values }),
    successMessage,
    labels,
  });

  return (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit(value);
      }}
    >
      <SubPageHead form={form} />
      {children({ value, onChange: setValue, form })}
      <SaveFoot form={form} />
    </form>
  );
}

/**
 * The units sub-page's fields: the two segmented pairs.
 */
function UnitsFields({
  value,
  onChange,
  form,
}: Readonly<SectionFields<UnitsChoice>>): JSX.Element {
  return (
    <UnitFields
      tempUnit={value.tempUnit}
      distanceUnit={value.distanceUnit}
      onTempUnit={(tempUnit) => {
        onChange({ ...value, tempUnit });
      }}
      onDistanceUnit={(distanceUnit) => {
        onChange({ ...value, distanceUnit });
      }}
      field={form.field}
      errors={form.fieldErrors}
    />
  );
}

/**
 * The units sub-page: two segmented pairs and a Save of its own.
 */
export function UnitsForm({
  current,
  saveUnits,
}: Readonly<{
  current: CurrentSettings;
  saveUnits: (input: { data: UnitsChoice }) => Promise<unknown>;
}>): JSX.Element {
  const initial = {
    tempUnit: current.tempUnit,
    distanceUnit: current.distanceUnit,
  };
  return (
    <SectionForm
      schema={unitsInput}
      initial={initial}
      save={saveUnits}
      successMessage="Units saved."
      labels={UNIT_LABELS}
    >
      {UnitsFields}
    </SectionForm>
  );
}

const SHARE_DEFAULT_LABEL = "Share to feed by default";

/**
 * The privacy sub-page's one field, and what it means per run.
 */
function SharingFields({
  value,
  onChange,
  form,
}: Readonly<SectionFields<SharingChoice>>): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <ToggleField
        name="shareDefault"
        label={SHARE_DEFAULT_LABEL}
        field={form.field}
        isOn={value.shareDefault}
        onChange={(shareDefault) => {
          onChange({ shareDefault });
        }}
      />
      <p className="m-0 text-micro text-muted">You can flip it per run.</p>
    </div>
  );
}

/**
 * The privacy sub-page: the default a new run starts from, and a Save of
 * its own.
 */
export function SharingForm({
  current,
  saveSharing,
}: Readonly<{
  current: CurrentSettings;
  saveSharing: (input: { data: SharingChoice }) => Promise<unknown>;
}>): JSX.Element {
  return (
    <SectionForm
      schema={sharingInput}
      initial={{ shareDefault: current.shareDefault }}
      save={saveSharing}
      successMessage="Privacy saved."
      // No summary labels: labels name rows in the error summary, which
      // appears only for two or more failing fields, and this form has
      // one. The field carries its own label. Add one here with a second
      // field.
      labels={{}}
    >
      {SharingFields}
    </SectionForm>
  );
}

/**
 * A sub-page's head: the screen's one status region, and the summary when
 * two or more fields fail.
 */
function SubPageHead({
  form,
}: Readonly<{
  form: Pick<
    ReturnType<typeof useFormSubmit>,
    "status" | "summaryRows" | "focusField" | "summaryRef"
  >;
}>): JSX.Element {
  return (
    <>
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        onFocusField={form.focusField}
        summaryRef={form.summaryRef}
      />
    </>
  );
}

/**
 * A sub-page's foot: the band directly above its one Save.
 */
function SaveFoot({
  form,
}: Readonly<{
  form: Pick<
    ReturnType<typeof useFormSubmit>,
    "failure" | "retry" | "retryRef" | "pending"
  >;
}>): JSX.Element {
  return (
    <>
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton label="Save" pendingLabel="Saving" pending={form.pending} />
    </>
  );
}
