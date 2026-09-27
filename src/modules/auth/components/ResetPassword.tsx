import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import { newPasswordSchema } from "../../../lib/contracts";
import { FormStatus, useFormSubmit } from "../../../ui";
import { SignedOutPanel } from "../../../ui/SignedOutPanel";
import { NewPasswordField } from "../password-field";
import { ShellForm } from "./ShellForm";
import { ResetLinkExpired } from "../credentials";

const LINK_CLASS =
  "target inline-flex items-center self-start rounded-pill bg-ink px-5 font-bold text-ground no-underline";

/**
 * What a reset attempt came to: the password is set, or the link had run
 * out — which is not a failure the form can fix, so it replaces the form
 * rather than banding it.
 */
type Outcome = "set" | "expired";

/**
 * ACC-4's second step: the link's page, where the new password is set
 * (undrawn: design deltas). The link is single use and lives an hour, and
 * spending it signs every session out, so the way on is Log in.
 */
export function ResetPassword({
  token,
  reset,
}: Readonly<{
  /**
  The link's token, or nothing for a link with none — which has run out.
  */
  token: string | undefined;
  reset: (token: string, values: { password: string }) => Promise<void>;
}>): JSX.Element {
  const [password, setPassword] = useState("");
  const [outcome, setOutcome] = useState<Outcome | undefined>(
    token === undefined ? "expired" : undefined,
  );
  const form = useFormSubmit({
    schema: newPasswordSchema,
    action: async (values): Promise<Outcome> => {
      // `token` is undefined only when the "expired" panel above already
      // took over the render, so submitting the form means it is defined —
      // narrowed explicitly rather than with `?? ""`, which would have sent
      // a real request with a placeholder token instead of stopping here.
      if (token === undefined) return "expired";
      try {
        await reset(token, values);
        return "set";
      } catch (error: unknown) {
        if (error instanceof ResetLinkExpired) return "expired";
        throw error;
      }
    },
    successMessage: "Password set.",
    onSuccess: (result) => {
      setOutcome(result);
    },
  });

  if (outcome === "set") {
    return (
      <SignedOutPanel heading="Password set">
        <div data-part="reset-done" className="flex flex-col gap-6">
          <FormStatus>{form.status}</FormStatus>
          <p className="m-0 text-lead">
            Log in with it. Every other device was signed out.
          </p>
          <Link to="/auth/login" className={LINK_CLASS}>
            Log in
          </Link>
        </div>
      </SignedOutPanel>
    );
  }

  if (outcome === "expired") {
    return (
      <SignedOutPanel heading="That link has run out">
        <div data-part="reset-expired" className="flex flex-col gap-6">
          <p className="m-0 text-lead">
            Reset links work once, for 1 hour. Ask for another.
          </p>
          <Link to="/account/forgot" className={LINK_CLASS}>
            Send another
          </Link>
        </div>
      </SignedOutPanel>
    );
  }

  return (
    <SignedOutPanel heading="Set a new password">
      <ShellForm
        form={form}
        onSubmit={() => {
          void form.submit({ password });
        }}
        submitLabel="Set password"
        pendingLabel="Setting password"
      >
        <NewPasswordField
          value={password}
          onChange={setPassword}
          field={form.field}
          error={form.fieldErrors.password}
        />
      </ShellForm>
    </SignedOutPanel>
  );
}
