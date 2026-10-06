import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX, ReactNode } from "react";
import type { z } from "zod";

import {
  FailureBand,
  FormErrorSummary,
  FormStatus,
  Mono,
  SubmitButton,
  TextField,
  useFormSubmit,
} from "../../ui";
import { SignedOutPanel } from "../../ui/SignedOutPanel";
import type { ControlFailure, FormShell } from "../../ui";
import { IS_INVITE_ONLY } from "../../lib/contracts/access";
import { authFailure, authStatus } from "./auth-copy";
import { GoogleButton, type GoogleSignIn } from "./google-button";
import { PasswordField } from "./password-field";
import type { CarriedForm } from "./sign-in-search";

/**
 * The shell both auth screens wear — Au1 and Au2, and every state drawn
 * on them (round 22, `design/Auth.dc.html`).
 *
 * Sign-in and sign-up were the same page twice — wordmark, heading, the
 * form scaffolding, the "or" divider, the Google button, and a link to the
 * other one — differing by a field and a few words of copy. *"Mirror of
 * Au1: same order, same heights, so switching pages never moves the Google
 * button"* is the board's word for why they are one component.
 *
 * It takes the form's own state rather than owning it, because the two
 * pages genuinely do submit different things to different endpoints. What
 * is shared is the shape, not the submission.
 *
 * **The regions carry the board's `data-part` names** — header, wordmark,
 * form, or-divider, google, cross-link — so the conformance specs compare
 * region to region against the drawing rather than against memory.
 */
export function AuthPage(
  props: Readonly<{
    heading: string;
    submitLabel: string;
    pendingLabel: string;
    /**
     * The form's own state, as one prop — see `FormShell`, which is picked
     * off the hook rather than restated.
     */
    form: FormShell;
    /**
  What the last failed submit threw, so the band can name it (Au4).
  */
    cause: unknown;
    onSubmit: () => void;
    google: GoogleSignIn;
    /**
  Au7's notice, above the heading. Absent on every ordinary visit.
  */
    notice?: ReactNode;
    /**
  Au1's legal line, at micro, above the cross-link.
  */
    legal?: ReactNode;
    /**
     * The link to the other page. Absent on Au7: *"No cross-link: a
     * signed-out runner has an account."*
     */
    crossLink?: ReactNode;
    /**
     * Au2's Turnstile (round 27 #12): managed, directly above the primary.
     * It covers Google too — the Google attempt carries its token, checked
     * before the redirect. Not on Au1.
     */
    turnstile?: ReactNode;
    /**
  Au2's "No code? Request access", under Google (round 26 #20).
  */
    requestLink?: ReactNode;
    children: ReactNode;
  }>,
): JSX.Element {
  // The slots (notice, legal, cross-link, Turnstile, request link) are read
  // off `props` where they are placed; the rest are the page's own.
  const { heading, submitLabel, pendingLabel, form, cause, google } = props;
  const band = authFailure(form.failure, cause);

  return (
    <SignedOutPanel heading={heading} notice={props.notice}>
      <div
        data-part="form"
        data-state={formState(band, form.summaryRows.length)}
        className="flex flex-col gap-4"
      >
        {/* noValidate: the browser's own bubbles are a second, unstyled
              error system that fires before ours and says "Please fill in
              this field" — banned copy, and it would pre-empt the schema. */}
        <form
          ref={form.formRef}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            google.cancel();
            props.onSubmit();
          }}
        >
          <FormStatus>
            {authStatus({
              status: form.status,
              band,
              google: google.failure,
            })}
          </FormStatus>
          <FormErrorSummary
            rows={form.summaryRows}
            onFocusField={form.focusField}
            summaryRef={form.summaryRef}
          />
          {props.children}
          {/* The form band with Auth's two words (round 22): "Not signed
                in", not "Nothing saved". Same block, same place, same Try
                again — `FormFailureBand` hard-codes the contract's opener,
                so this is the band it wraps, given the other kicker. */}
          {band === undefined ? undefined : (
            <FailureBand
              kicker={band.kicker}
              message={band.message}
              onRetry={form.retry}
              retryRef={form.retryRef}
            />
          )}
          {props.turnstile}
          <SubmitButton
            label={submitLabel}
            pendingLabel={pendingLabel}
            pending={form.pending}
          />
        </form>
        <OrDivider />
        <GoogleButton google={google} />
        {props.requestLink}
        {props.legal}
        {props.crossLink}
      </div>
    </SignedOutPanel>
  );
}

/**
 * Which of the board's form states this is, by its own `data-state`
 * names: a band is `form-failure` (Au4), a marked field `field-failure`
 * (Au3), and rest is no state at all.
 */
function formState(
  band: ControlFailure | undefined,
  fieldErrors: number,
): string | undefined {
  if (band !== undefined) return "form-failure";
  return fieldErrors > 0 ? "field-failure" : undefined;
}

/**
 * "OR", between two hairlines. The rules are drawn, not bordered, so the
 * word sits on their centre line; they are decoration, and the word is
 * what a reader hears.
 */
function OrDivider(): JSX.Element {
  return (
    <div data-part="or-divider" className="flex items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
      <Mono step="xs" className="text-muted">
        or
      </Mono>
      <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
    </div>
  );
}

/**
 * The cross-link, so neither page hard-codes the other's path.
 *
 * *"Cross-link is a text link, pinned to the foot."* The prompt is quiet
 * and the link is ink, bold, underlined — never pink, which is the
 * product's own verbs and not a way between two forms.
 */
export function AuthCrossLink({
  prompt,
  to,
  label,
  redirect,
}: Readonly<{
  prompt: string;
  to: "/auth/login" | "/auth/signup";
  label: string;
  /**
   * The way back a deep link brought to log-in, carried across to the
   * other form so a runner who makes their account with Google instead
   * still lands where they were going.
   */
  redirect?: string | undefined;
}>): JSX.Element {
  return (
    <p
      data-part="cross-link"
      className="m-0 pt-4 text-center text-body text-quiet"
    >
      {prompt}{" "}
      <Link
        data-target="inline"
        to={to}
        search={{ redirect }}
        className="font-bold text-ink underline underline-offset-4"
      >
        {label}
      </Link>
    </p>
  );
}

/**
 * Au2's cross-link, which Au7 does not have: *"No cross-link: a signed-out
 * runner has an account."*
 */
export function LoginCrossLink({
  carried,
  redirect,
}: Readonly<{
  carried: CarriedForm | undefined;
  redirect?: string | undefined;
}>): JSX.Element | undefined {
  if (carried !== undefined) return undefined;
  return (
    <AuthCrossLink
      prompt="New here?"
      to="/auth/signup"
      label="Create an account"
      redirect={redirect}
    />
  );
}

/**
 * The lines under Au2 (ACC-6, ACC-13; round 27 #12; D-52, D-71): micro,
 * muted, above the cross-link — the terms line, linking the Terms and the
 * policy, and the age line. Never under Au1 (D-52). No checkbox: creating
 * the account is the acceptance, and the server records the terms'
 * version and when as the account is made (`account/terms-acceptance`).
 */
export function AuthLegal(): JSX.Element {
  return (
    <div className="flex flex-col gap-1 text-micro text-muted">
      <p className="m-0">
        By creating an account you agree to the{" "}
        <Link data-target="inline" to="/terms" className={INLINE_LINK}>
          Terms
        </Link>{" "}
        and have read the{" "}
        <Link data-target="inline" to="/privacy" className={INLINE_LINK}>
          Privacy policy
        </Link>
        .
      </p>
      <p className="m-0">dialed.run is for runners 16 and over.</p>
    </div>
  );
}

const INLINE_LINK = "text-ink underline underline-offset-4";

/**
 * Au7's notice: *"an ink block (square, --hiviz-text eyebrow on ink only)
 * — a statement, not an error, so no yellow and no band."*
 *
 * *"It names what's kept, not why the session died"*, and it names the
 * carried form by its own noun. Rendered only when a form was carried:
 * *"Arrival with nothing carried shows no notice at all — just Au2."*
 */
export function SessionNotice({
  carried,
}: Readonly<{ carried: CarriedForm | undefined }>): JSX.Element | undefined {
  if (carried === undefined) return undefined;
  return (
    <div
      data-part="session-notice"
      data-state="session-expired"
      data-ground="ink"
      className="flex flex-col gap-2 bg-ground p-4 text-ink"
    >
      <Mono step="xs" className="text-hiviz-text">
        You were signed out
      </Mono>
      {/* One string, so the sentence is one run of text and not three. */}
      <span className="text-body">
        {`Log in and you're back on your ${carried}. What you entered is kept.`}
      </span>
    </div>
  );
}

/**
 * The two fields both forms ask for, by the names the error summary uses.
 */
export const CREDENTIAL_LABELS = { email: "Email", password: "Password" };

/**
Au2's, with the invite code first (ACC-5).
*/
export const SIGN_UP_LABELS = {
  inviteCode: "Invite code",
  ...CREDENTIAL_LABELS,
};

/**
 * Au2's first field, above email and Google (round 26 #20): INVITE CODE,
 * filled from `/join?code=`, under the board's one line saying why. Not
 * drawn at all when invite-only is off — the one flag (`lib/contracts/access.ts`)
 * removes it and `RequestAccessLink` together.
 */
export function InviteCodeField({
  form,
  value,
  onChange,
  isInviteOnly = IS_INVITE_ONLY,
}: Readonly<{
  form: Pick<ReturnType<typeof useFormSubmit>, "field" | "fieldErrors">;
  value: string;
  onChange: (code: string) => void;
  isInviteOnly?: boolean;
}>): JSX.Element | undefined {
  if (!isInviteOnly) return undefined;
  return (
    <>
      <p className="m-0 text-body">dialed.run is invite-only for now.</p>
      <TextField
        name="inviteCode"
        label={SIGN_UP_LABELS.inviteCode}
        autoComplete="off"
        value={value}
        onChange={onChange}
        field={form.field}
        error={form.fieldErrors.inviteCode}
      />
    </>
  );
}

/**
 * "No code? Request access", under Google, opening Au5 (round 26 #20).
 * Goes with the field when the flag is off.
 */
export function RequestAccessLink({
  isInviteOnly = IS_INVITE_ONLY,
}: Readonly<{ isInviteOnly?: boolean }>): JSX.Element | undefined {
  if (!isInviteOnly) return undefined;
  return (
    <p
      data-part="request-access"
      className="m-0 text-center text-body text-quiet"
    >
      No code?{" "}
      <Link
        data-target="inline"
        to="/account/request-access"
        className="font-bold text-ink underline underline-offset-4"
      >
        Request access
      </Link>
    </p>
  );
}

/**
 * Email then password — everything sign-up asks for since round 26 #7 took
 * the name to O0, and everything log-in has ever asked for. One component
 * because the two forms are now the same two fields, differing only in what
 * the password field says about itself.
 */
export function CredentialFields({
  form,
  email,
  onEmail,
  password,
  onPassword,
  passwordAutoComplete,
  passwordHint,
  focusPasswordOnArrival = false,
  hasForgotLink = false,
}: Readonly<{
  form: Pick<ReturnType<typeof useFormSubmit>, "field" | "fieldErrors">;
  email: string;
  onEmail: (email: string) => void;
  password: string;
  onPassword: (password: string) => void;
  passwordAutoComplete: "current-password" | "new-password";
  /**
  Au2's "At least 10 characters."; log-in shows none (round 26 #18).
  */
  passwordHint?: string | undefined;
  focusPasswordOnArrival?: boolean | undefined;
  /**
  Au1's "Forgot it?" (ACC-4), under Password on log-in only.
  */
  hasForgotLink?: boolean | undefined;
}>): JSX.Element {
  return (
    <>
      <TextField
        name="email"
        label={CREDENTIAL_LABELS.email}
        type="email"
        autoComplete="email"
        value={email}
        onChange={onEmail}
        field={form.field}
        error={form.fieldErrors.email}
      />
      <PasswordField
        label={CREDENTIAL_LABELS.password}
        autoComplete={passwordAutoComplete}
        value={password}
        onChange={onPassword}
        field={form.field}
        error={form.fieldErrors.password}
        hint={passwordHint}
        focusOnArrival={focusPasswordOnArrival}
      />
      {hasForgotLink ? (
        <Link
          to="/account/forgot"
          className="target inline-flex items-center self-start text-small font-semibold text-ink underline underline-offset-4"
        >
          Forgot it?
        </Link>
      ) : undefined}
    </>
  );
}

/**
 * `useFormSubmit`, keeping what the last failed submit threw.
 *
 * The hook classifies a throw into network / server / session, which is
 * every other form's whole need; Au4 also tells a rate limit apart from a
 * fault, and that fact is on the error. So the action is wrapped to keep
 * it, and nothing else about the hook changes — the same schema, the same
 * announce-then-move, the same double-submit guard.
 */
export function useAuthForm<TSchema extends z.ZodType>({
  schema,
  action,
  successMessage,
  labels,
  onSuccess,
}: Readonly<{
  schema: TSchema;
  action: (values: z.output<TSchema>) => Promise<void>;
  successMessage: string;
  labels: Record<string, string>;
  onSuccess: () => Promise<void>;
}>) {
  const [cause, setCause] = useState<unknown>();
  const form = useFormSubmit({
    schema,
    action: async (values: z.output<TSchema>) => {
      try {
        await action(values);
      } catch (error: unknown) {
        setCause(error);
        throw error;
      }
    },
    successMessage,
    labels,
    onSuccess,
  });
  return { form, cause };
}
