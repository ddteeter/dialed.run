import { Link } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX, ReactNode } from "react";
import type { z } from "zod";

import { thermalOffsetLabel, thermalScale } from "../../../lib/contracts";
import { notificationSettingsSchema } from "../../../lib/email";
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
  username,
  blockedCount,
  runReminderEmail,
  signOut,
}: Readonly<{
  current: CurrentSettings;
  /**
  The runner's handle, or nothing for an account that has not reached O0.
  */
  username: string | undefined;
  blockedCount: number;
  /**
  Whether the Strava run reminder comes by email (ACC-11).
  */
  runReminderEmail: boolean;
  /**
  The foot's Sign out, the route's to wire (it needs the router).
  */
  signOut: ReactNode;
}>): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title="You">
        {/* U1's first row is Account ("drew.t · email, password"): the
            handle, the address and the password live behind it (ACC-7/8). */}
        <SettingsRow
          to="/account/$section"
          params={{ section: "sign-in" }}
          label="Account"
          value={
            username === undefined
              ? "Email, password"
              : `@${username} · email, password`
          }
        />

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
        {/* U1 draws Notifications under Review, after Blocked runners. */}
        <SettingsRow
          to="/account/$section"
          params={{ section: "notifications" }}
          label="Notifications"
          value={
            runReminderEmail
              ? "Run reminders by email"
              : "Run reminders in the app only"
          }
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
      {/* Settings › About (ACC-13; round 26 #14, D-52): the legal texts.
          Terms and Copyright join when the owner's texts exist. */}
      <SettingsGroup title="About">
        <SettingsRow
          to="/privacy"
          params={{}}
          label="Privacy policy"
          value="What we keep, and who sees it"
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

/**
 * One kind of notification on Settings › Notifications (round 26 #19,
 * "SETTINGS › NOTIFICATIONS · PER KIND"): what it is, when it comes, and
 * how it reaches you by email. No push column — PWA push is out of scope
 * (decision D-44), so the board's Push switches are absent.
 */
function NotificationKind({
  title,
  when,
  children,
}: Readonly<{
  title: string;
  when: string;
  children: ReactNode;
}>): JSX.Element {
  return (
    <section className="flex flex-col gap-2 border-b border-hairline pb-4">
      <h2 className="m-0 text-body font-semibold">{title}</h2>
      <p className="m-0 text-small text-quiet">{when}</p>
      {children}
    </section>
  );
}

/**
A kind whose email is not a switch: "IN THE APP ONLY", "ALWAYS SENT".
*/
function FixedEmail({ text }: Readonly<{ text: string }>): JSX.Element {
  return (
    <p className="m-0 flex items-center justify-between gap-3 text-body">
      Email
      <Mono step="xs" className="text-quiet">
        {text}
      </Mono>
    </p>
  );
}

/**
 * Settings › Notifications (ACC-11): only the Strava run reminder can be
 * emailed in v1, on by default; Useful stays in the app; account and
 * security email always comes.
 */
export function NotificationsForm({
  current,
  save,
  changeEmail,
}: Readonly<{
  current: { email: string; runReminder: boolean };
  save: (input: { data: { runReminder: boolean } }) => Promise<unknown>;
  /**
  The "Change email" link, the route's to wire.
  */
  changeEmail: ReactNode;
}>): JSX.Element {
  return (
    <SectionForm
      schema={notificationSettingsSchema}
      initial={{ runReminder: current.runReminder }}
      save={save}
      successMessage="Notifications saved."
      // One field, so no summary rows (SharingForm's reasoning).
      labels={{}}
    >
      {({ value, onChange, form }) => (
        <div className="flex flex-col gap-4">
          <NotificationKind
            title="Run reminders"
            when="When a run lands on Strava. Only while Strava is connected."
          >
            <ToggleField
              name="runReminder"
              label="Email"
              field={form.field}
              isOn={value.runReminder}
              onChange={(runReminder) => {
                onChange({ runReminder });
              }}
            />
          </NotificationKind>
          <NotificationKind
            title="Useful on your runs"
            when="When a runner finds your run useful."
          >
            <FixedEmail text="In the app only" />
          </NotificationKind>
          <NotificationKind
            title="Account and security"
            when="Confirming your email, password and email changes."
          >
            <FixedEmail text="Always sent" />
          </NotificationKind>
          <p className="m-0 text-small text-quiet">
            Emails go to <strong>{current.email}</strong>. {changeEmail}
          </p>
        </div>
      )}
    </SectionForm>
  );
}

/**
 * U1 · Account (ACC-7, ACC-8, ACC-10, ACC-9): the address and whether it
 * is confirmed, the handle, the password, signing out everywhere, the
 * export, and deleting the account (round 27 #13, #14). A row with
 * nowhere to go is absent — an account made with Google has no password
 * to change.
 */
export function AccountIndex({
  account,
  username,
  confirmBand,
  signOutEverywhere,
  deletion,
}: Readonly<{
  account: { email: string; isVerified: boolean; hasPassword: boolean };
  username: string | undefined;
  /**
   * Round 26 #11's nag — "Confirm your email to share runs. Resend link" —
   * which draws nothing once the address is confirmed (route's to wire).
   */
  confirmBand: ReactNode;
  signOutEverywhere: ReactNode;
  /**
  U1's last row, Delete account, and its sheet (ACC-9; the route's to wire).
  */
  deletion: ReactNode;
}>): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      {/* The nag sits at the top, as it does on Feed and You. */}
      {confirmBand}
      <SettingsGroup title="Sign-in">
        <SettingsRow
          to="/account/$section"
          params={{ section: "email" }}
          label="Email"
          value={
            account.isVerified
              ? account.email
              : `${account.email} · not confirmed yet`
          }
          action="Change ›"
        />
        <SettingsRow
          to="/account/username"
          params={{}}
          label="Username"
          value={username === undefined ? "Not picked" : `@${username}`}
        />
        {account.hasPassword ? (
          <SettingsRow
            to="/account/$section"
            params={{ section: "password" }}
            label="Password"
            value="Change the password you log in with"
          />
        ) : undefined}
      </SettingsGroup>
      {signOutEverywhere}
      {/* Round 27 #13: "Export your data" · Get a copy (ACC-10). */}
      <SettingsGroup title="Your data">
        <li>
          {/* A file the server answers with, not a page: fetched by the
              browser as a download, never drawn by the router. */}
          <Link
            to="/account/export"
            reloadDocument
            download
            data-part="settings-row"
            className="target flex items-center justify-between gap-3 border-b border-hairline py-3 text-ink no-underline"
          >
            <span className="flex flex-col gap-1">
              <span className="text-body font-semibold">Export your data</span>
              <span className="text-small text-muted">
                Runs, closet, entries and photo links, as one file
              </span>
            </span>
            <span className="shrink-0 text-body">Get a copy</span>
          </Link>
        </li>
      </SettingsGroup>
      {deletion}
    </div>
  );
}
