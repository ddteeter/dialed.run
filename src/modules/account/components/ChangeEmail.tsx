import { useState } from "react";
import type { JSX } from "react";

import {
  changeEmailSchema,
  CURRENT_PASSWORD_WRONG,
  currentPasswordLimited,
} from "../../../lib/contracts";
import { clockLabel, deviceTimeZone } from "../../../lib/dates";
import {
  FailureBand,
  FormFailureBand,
  FormStatus,
  SubmitButton,
  TextField,
  useFormSubmit,
} from "../../../ui";
import type { ChangeResult, ResendResult } from "../verification";
import { ConfirmEmailSheet } from "./ConfirmEmailSheet";
import { limitedMessage } from "./ResendLink";

/**
 * The server's refusal of the current password — wrong, or tried too
 * often — shaped the way `useFormSubmit` lands a field issue: the fix is
 * in that field.
 */
class PasswordRefused extends Error {
  readonly issues: readonly { path: string[]; message: string }[];
  constructor(message: string) {
    super(message);
    this.issues = [{ path: ["currentPassword"], message }];
  }
}

/**
 * ACC-8: Settings › Account › Email (undrawn: design deltas). The account
 * moves only when the new address's link is opened, so the page says where
 * the link went and that nothing has changed yet. Waits for a confirmed
 * address (round 26 #11): the button draws at full strength and opens the
 * "Confirm your email first" sheet. Asks for the current password, as
 * Change password does: an open session alone must not be able to move
 * the account's address.
 */
export function ChangeEmail({
  current,
  isVerified,
  request,
  resend,
}: Readonly<{
  current: string;
  isVerified: boolean;
  request: (input: {
    data: { email: string; currentPassword: string };
  }) => Promise<ChangeResult>;
  resend: (input: { data: { email: string } }) => Promise<ResendResult>;
}>): JSX.Element {
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [outcome, setOutcome] = useState<ChangeResult | undefined>();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const form = useFormSubmit({
    schema: changeEmailSchema,
    action: async (values) => {
      const result = await request({ data: values });
      if (result.status === "wrong-password") {
        throw new PasswordRefused(CURRENT_PASSWORD_WRONG);
      }
      if (result.status === "password-limited") {
        const clock = clockLabel(result.until, deviceTimeZone());
        throw new PasswordRefused(currentPasswordLimited(clock));
      }
      return result;
    },
    successMessage: "Link sent.",
    onSuccess: setOutcome,
    // Nothing was sent, so nothing is announced as sent: an unconfirmed
    // address opens "Confirm your email first", and the hour's limit
    // draws its own band (seam 7's refusal, #139).
    refusal: {
      matches: (result) => result.status !== "sent",
      answer: (result) => {
        setOutcome(result);
        if (result.status === "unverified") setIsSheetOpen(true);
      },
    },
  });

  return (
    <>
      <form
        ref={form.formRef}
        noValidate
        data-part="form"
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (isVerified) {
            void form.submit({ email, currentPassword });
          } else {
            setIsSheetOpen(true);
          }
        }}
      >
        <FormStatus>{form.status}</FormStatus>
        <p className="m-0 text-body">
          Now <strong>{current}</strong>. We&apos;ll send a link to the new
          address, and the account moves when you open it.
        </p>
        <TextField
          name="email"
          label="New email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          field={form.field}
          error={form.fieldErrors.email}
        />
        <TextField
          name="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
          field={form.field}
          error={form.fieldErrors.currentPassword}
        />
        {outcome?.status === "sent" ? (
          <p data-state="sent" className="m-0 text-body">
            <span className="font-semibold">Sent ✓</span> Open the link we sent
            to the new address. Your email stays {current} until you do.
          </p>
        ) : undefined}
        {outcome?.status === "limited" ? (
          <FailureBand
            kicker="Not sent"
            message={limitedMessage(outcome.until)}
            onRetry={() => {
              void form.submit({ email, currentPassword });
            }}
          />
        ) : undefined}
        <FormFailureBand
          failure={form.failure}
          onRetry={form.retry}
          retryRef={form.retryRef}
        />
        <SubmitButton
          label="Send link"
          pendingLabel="Sending"
          pending={form.pending}
        />
      </form>
      <ConfirmEmailSheet
        open={isSheetOpen}
        onClose={() => {
          setIsSheetOpen(false);
        }}
        email={current}
        resend={resend}
      />
    </>
  );
}
