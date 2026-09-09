import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";
import type { RefObject } from "react";

import {
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  Layout,
  SubmitButton,
  Wordmark,
} from "../../ui";
import type { FormFailure, SummaryRow } from "../../ui";
import { GoogleButton } from "./google-button";

/**
 * The shell both auth screens wear.
 *
 * Sign-in and sign-up were the same page twice — wordmark, heading, the
 * form scaffolding, the "or" divider, the Google button, and a link to the
 * other one — differing by a `name` field and five words of copy. That was
 * D-25's real content: `RETRY_GENERIC` inlined in both was the visible
 * symptom, and fixing only the string would have left the two pages free to
 * drift in every other respect.
 *
 * It takes the form's own state rather than owning it, because the two
 * pages genuinely do submit different things to different endpoints. What
 * is shared is the shape, not the submission.
 */
export function AuthPage({
  heading,
  submitLabel,
  pendingLabel,
  status,
  summaryRows,
  summaryRef,
  onFocusField,
  failure,
  onRetry,
  retryRef,
  pending,
  formRef,
  onSubmit,
  children,
  footer,
}: Readonly<{
  heading: string;
  submitLabel: string;
  pendingLabel: string;
  status: string;
  summaryRows: readonly SummaryRow[];
  summaryRef: RefObject<HTMLDivElement | null>;
  onFocusField: (name: string) => void;
  failure: FormFailure | undefined;
  onRetry: () => void;
  retryRef: RefObject<HTMLButtonElement | null>;
  pending: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  onSubmit: () => void;
  children: ReactNode;
  footer: ReactNode;
}>): JSX.Element {
  return (
    <Layout>
      <div className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-12">
        <Wordmark className="text-2xl" />
        <h1 className="font-display text-3xl uppercase leading-none">
          {heading}
        </h1>
        {/* noValidate: the browser's own bubbles are a second, unstyled
            error system that fires before ours and says "Please fill in
            this field" — banned copy, and it would pre-empt the schema. */}
        <form
          ref={formRef}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <FormStatus>{status}</FormStatus>
          <FormErrorSummary
            rows={summaryRows}
            onFocusField={onFocusField}
            summaryRef={summaryRef}
          />
          {children}
          <FormFailureBand
            failure={failure}
            onRetry={onRetry}
            retryRef={retryRef}
          />
          <SubmitButton
            label={submitLabel}
            pendingLabel={pendingLabel}
            pending={pending}
          />
        </form>
        <p className="text-center text-xs uppercase text-night/40">or</p>
        <GoogleButton />
        <p className="text-sm">{footer}</p>
      </div>
    </Layout>
  );
}

/**
The cross-link, so neither page hard-codes the other's path.
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
    <>
      {prompt}{" "}
      <Link to={to} className="font-semibold text-pink">
        {label}
      </Link>
    </>
  );
}
