import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import type { JSX, ReactNode } from "react";
import type { z } from "zod";

import {
  FailureBand,
  FormErrorSummary,
  FormField,
  FormStatus,
  Mono,
  SignedOutLayout,
  SubmitButton,
  Wordmark,
  useFormSubmit,
} from "../../ui";
import type { FieldProps, FormShell } from "../../ui";
import { AUTH_KICKER, authFailureMessage, authStatus } from "./auth-copy";
import { GoogleButton, type GoogleSignIn } from "./google-button";
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
export function AuthPage({
  heading,
  submitLabel,
  pendingLabel,
  form,
  cause,
  onSubmit,
  google,
  notice,
  legal,
  crossLink,
  children,
}: Readonly<{
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
  children: ReactNode;
}>): JSX.Element {
  const bandMessage = authFailureMessage(form.failure, cause);

  return (
    <SignedOutLayout action="none">
      {/* The panel: a 390 column on paper, top-aligned under the bar and
          never vertically centred, "centring jumps when a band appears"
          (Au2 1040). */}
      <main
        data-part="panel"
        className="mx-auto flex w-full max-w-panel flex-col gap-7 px-6 pt-12 pb-12 wide:pt-14"
      >
        <div data-part="header" className="flex flex-col gap-5">
          {/* From 720 up the bar's wordmark is the one: "The panel drops
              its own wordmark, so there is one." */}
          <span data-part="wordmark" className="wide:hidden">
            <Wordmark brackets={false} className="text-title" />
          </span>
          {notice}
          <h1 className="m-0 font-display text-display uppercase">{heading}</h1>
        </div>

        <div
          data-part="form"
          data-state={formState(bandMessage, form.summaryRows.length)}
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
              onSubmit();
            }}
          >
            <FormStatus>
              {authStatus({
                status: form.status,
                bandMessage,
                googleFailed: google.failure !== undefined,
              })}
            </FormStatus>
            <FormErrorSummary
              rows={form.summaryRows}
              onFocusField={form.focusField}
              summaryRef={form.summaryRef}
            />
            {children}
            {/* The form band with Auth's two words (round 22): "Not signed
                in", not "Nothing saved". Same block, same place, same Try
                again — `FormFailureBand` hard-codes the contract's opener,
                so this is the band it wraps, given the other kicker. */}
            {bandMessage === undefined ? undefined : (
              <FailureBand
                kicker={AUTH_KICKER}
                message={bandMessage}
                onRetry={form.retry}
                retryRef={form.retryRef}
              />
            )}
            <SubmitButton
              label={submitLabel}
              pendingLabel={pendingLabel}
              pending={form.pending}
            />
          </form>
          <OrDivider />
          <GoogleButton google={google} />
          {legal}
          {crossLink}
        </div>
      </main>
    </SignedOutLayout>
  );
}

/**
 * Which of the board's form states this is, by its own `data-state`
 * names: a band is `form-failure` (Au4), a marked field `field-failure`
 * (Au3), and rest is no state at all.
 */
function formState(
  bandMessage: string | undefined,
  fieldErrors: number,
): string | undefined {
  if (bandMessage !== undefined) return "form-failure";
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
}: Readonly<{
  prompt: string;
  to: "/auth/login" | "/auth/signup";
  label: string;
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
}: Readonly<{ carried: CarriedForm | undefined }>): JSX.Element | undefined {
  if (carried !== undefined) return undefined;
  return (
    <AuthCrossLink
      prompt="New here?"
      to="/auth/signup"
      label="Create an account"
    />
  );
}

/**
Au1's legal line: micro, muted, above the cross-link.
*/
export function AuthLegal(): JSX.Element {
  return (
    <p className="m-0 text-micro text-muted">
      By creating an account you agree to the terms and privacy policy.
    </p>
  );
}

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
 * The password field: the Form Contract's field with a Show control
 * inside the box (Au1–Au7 all draw it).
 *
 * `FormField` rather than `TextField` because the box holds two things;
 * every attribute `TextField` would have set is set here from the same
 * `field()` helper, which is the part a hand-rolled field loses.
 *
 * `focusOnArrival` is Au7's *"focus in Password"*: the email is already
 * there, so the password is the one thing left to type.
 */
export function PasswordField({
  label,
  value,
  onChange,
  field,
  error,
  hint,
  autoComplete,
  focusOnArrival = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  field: (name: string) => FieldProps;
  error?: string | undefined;
  hint?: string | undefined;
  autoComplete: "current-password" | "new-password";
  focusOnArrival?: boolean | undefined;
}>): JSX.Element {
  const [isShown, setIsShown] = useState(false);
  // Arrival is once. An inline callback ref here was a new function on
  // every render, so React re-ran it on every keystroke anywhere on the
  // page and pulled the cursor out of Email into Password mid-word. Held
  // stable, React calls it when the input mounts (and hands it `null` on
  // the way out) — and again only if `focusOnArrival` itself changes.
  const focusOnArrivalRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (focusOnArrival) node?.focus();
    },
    [focusOnArrival],
  );

  return (
    <FormField name="password" label={label} error={error} hint={hint}>
      <input
        {...field("password")}
        ref={focusOnArrivalRef}
        id="password"
        type={isShown ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="w-full border-none bg-transparent"
      />
      <button
        type="button"
        aria-controls="password"
        onClick={() => {
          setIsShown((shown) => !shown);
        }}
        className="target shrink-0 cursor-pointer border-none bg-transparent p-0 text-small font-semibold text-ink"
      >
        {isShown ? "Hide" : "Show"}
      </button>
    </FormField>
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
