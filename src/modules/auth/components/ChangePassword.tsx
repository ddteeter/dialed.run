import { useState } from "react";
import type { JSX } from "react";

import {
  changePasswordSchema,
  CURRENT_PASSWORD_WRONG,
  currentPasswordLimited,
} from "../../../lib/contracts";
import { viewerClockLabel } from "../../../lib/dates";
import type { ViewerZone } from "../../../lib/dates";
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
function refusalOf(
  result: PasswordChange,
  viewer: ViewerZone,
): AuthFieldError | undefined {
  if (result.status === "wrong") {
    return new AuthFieldError("currentPassword", CURRENT_PASSWORD_WRONG);
  }
  if (result.status === "limited") {
    const clock = viewerClockLabel(result.until, viewer);
    return new AuthFieldError("currentPassword", currentPasswordLimited(clock));
  }
  return result.status === "breached"
    ? new AuthFieldError("password", AUTH_COPY.passwordBreached)
    : undefined;
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
  viewer,
}: Readonly<{
  change: (input: {
    data: { currentPassword: string; password: string };
  }) => Promise<PasswordChange>;
  /**
   * The runner's home zone, for the limit's clock (R-96 (3)).
   */
  viewer: ViewerZone;
}>): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const form = useFormSubmit({
    carry: "settings",
    schema: changePasswordSchema,
    action: async (values) => {
      const refusal = refusalOf(await change({ data: values }), viewer);
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
