import { useState } from "react";
import type { JSX } from "react";

import {
  changePasswordSchema,
  CURRENT_PASSWORD_WRONG,
  currentPasswordLimited,
} from "../../../lib/contracts";
import { clockLabel, deviceTimeZone } from "../../../lib/dates";
import { useFormSubmit } from "../../../ui";
import { AUTH_COPY } from "../auth-copy";
import type { PasswordChange } from "../change-password";
import { AuthFieldError } from "../credentials";
import { NewPasswordField, PasswordField } from "../password-field";
import { ShellForm } from "./ShellForm";

const LABELS = {
  currentPassword: "Current password",
  password: "New password",
};

/**
 * The server's refusal, as the field it lands on: the current password
 * wrong or tried too often (round 28 #10, in the runner's own time), or the
 * new one breached. A change answers nothing.
 */
function refusalOf(result: PasswordChange): AuthFieldError | undefined {
  if (result.status === "wrong") {
    return new AuthFieldError("currentPassword", CURRENT_PASSWORD_WRONG);
  }
  if (result.status === "limited") {
    const clock = clockLabel(result.until, deviceTimeZone());
    return new AuthFieldError("currentPassword", currentPasswordLimited(clock));
  }
  if (result.status === "breached") {
    return new AuthFieldError("password", AUTH_COPY.passwordBreached);
  }
  return undefined;
}

/**
 * ACC-7: Settings › Account › Password (undrawn: design deltas). The
 * current password, then the new one on sign-up's floor; every other
 * session is signed out when it changes, and the page stays, saying so.
 * The change is the server's (`changeCredentialFn`, R-124), so the
 * per-runner limit on tries at the current password applies here as it
 * does on Change email.
 */
export function ChangePassword({
  change,
}: Readonly<{
  change: (input: {
    data: { currentPassword: string; password: string };
  }) => Promise<PasswordChange>;
}>): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const form = useFormSubmit({
    carry: "settings",
    schema: changePasswordSchema,
    action: async (values) => {
      const refusal = refusalOf(await change({ data: values }));
      if (refusal !== undefined) throw refusal;
    },
    successMessage: "Password changed. Every other device was signed out.",
    labels: LABELS,
    onSuccess: () => {
      setCurrentPassword("");
      setPassword("");
    },
  });

  return (
    <ShellForm
      form={form}
      onSubmit={() => {
        void form.submit({ currentPassword, password });
      }}
      submitLabel="Change password"
      pendingLabel="Changing password"
    >
      <PasswordField
        name="currentPassword"
        label={LABELS.currentPassword}
        autoComplete="current-password"
        value={currentPassword}
        onChange={setCurrentPassword}
        field={form.field}
        error={form.fieldErrors.currentPassword}
      />
      <NewPasswordField
        value={password}
        onChange={setPassword}
        field={form.field}
        error={form.fieldErrors.password}
      />
    </ShellForm>
  );
}
