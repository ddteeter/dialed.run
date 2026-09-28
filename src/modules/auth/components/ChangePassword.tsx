import { useState } from "react";
import type { JSX } from "react";

import { changePasswordSchema } from "../../../lib/contracts";
import { useFormSubmit } from "../../../ui";
import { NewPasswordField, PasswordField } from "../password-field";
import { ShellForm } from "./ShellForm";

const LABELS = {
  currentPassword: "Current password",
  password: "New password",
};

/**
 * ACC-7: Settings › Account › Password (undrawn: design deltas). The
 * current password, then the new one on sign-up's floor; every other
 * session is signed out when it changes, and the page stays, saying so.
 */
export function ChangePassword({
  change,
}: Readonly<{
  change: (values: {
    currentPassword: string;
    password: string;
  }) => Promise<void>;
}>): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const form = useFormSubmit({
    schema: changePasswordSchema,
    action: change,
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
