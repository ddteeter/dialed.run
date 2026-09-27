import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import { resetRequestSchema } from "../../../lib/contracts";
import { FormStatus, TextField, useFormSubmit } from "../../../ui";
import { SignedOutPanel } from "../../../ui/SignedOutPanel";
import { ShellForm } from "./ShellForm";

/**
The Auth board's cross-link, quiet prompt and bold ink link.
*/
const BACK_LINK_CLASS = "font-bold text-ink underline underline-offset-4";

/**
 * A request that did not go, in the band: the reset link is the thing not
 * sent, so the kicker says so rather than the contract's "Nothing saved".
 */
const NOT_SENT = "Not sent";

/**
 * ACC-4's first step, from Au1's "Forgot it?" (undrawn: design deltas).
 *
 * It answers the same whatever the address — "If {address} has an
 * account…" — because Better Auth does, and the page must not be a way to
 * find out who has one. An unconfirmed account gets no link (round 26 #11:
 * a reset by email waits for a confirmed address), which the same sentence
 * also covers.
 */
export function ForgotPassword({
  request,
}: Readonly<{
  request: (values: { email: string }) => Promise<void>;
}>): JSX.Element {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | undefined>();
  const form = useFormSubmit({
    schema: resetRequestSchema,
    action: request,
    successMessage: "Reset link requested.",
    labels: { email: "Email" },
    onSuccess: () => {
      setSentTo(email);
    },
  });

  if (sentTo !== undefined) {
    return (
      <SignedOutPanel heading="Check your inbox">
        <div data-part="reset-requested" className="flex flex-col gap-5">
          <FormStatus>{form.status}</FormStatus>
          <p className="m-0 text-lead">
            If <strong>{sentTo}</strong> has a dialed.run account, a link to set
            a new password is on its way.
          </p>
          <p className="m-0 text-body text-quiet">
            It works once, for 1 hour. Not there? Check spam.
          </p>
          <Link
            to="/auth/login"
            className={`target inline-flex items-center self-start ${BACK_LINK_CLASS}`}
          >
            Back to log in
          </Link>
        </div>
      </SignedOutPanel>
    );
  }

  return (
    <SignedOutPanel heading="Forgot your password?">
      <ShellForm
        form={form}
        onSubmit={() => {
          void form.submit({ email });
        }}
        submitLabel="Send link"
        pendingLabel="Sending"
        kicker={NOT_SENT}
      >
        <p className="m-0 text-body text-quiet">
          We&apos;ll email you a link to set a new one.
        </p>
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          field={form.field}
          error={form.fieldErrors.email}
        />
      </ShellForm>
      <p className="m-0 text-center text-body text-quiet">
        Remembered it?{" "}
        <Link data-target="inline" to="/auth/login" className={BACK_LINK_CLASS}>
          Log in
        </Link>
      </p>
    </SignedOutPanel>
  );
}
