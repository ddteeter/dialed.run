import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { signUpSchema } from "../../lib/contracts";
import { AuthCrossLink, AuthPage } from "../../modules/auth/auth-page";
// Client entry imported directly by design — see modules/auth/client.ts.
import { authClient } from "../../modules/auth/client";
import { TextField, useFormSubmit } from "../../ui";

export const Route = createFileRoute("/auth/signup")({ component: SignupPage });

const LABELS = { name: "Name", email: "Email", password: "Password" };

function SignupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // See login.tsx: Better Auth returns `{ error }` instead of rejecting.
  const action = useCallback(
    async (values: { name: string; email: string; password: string }) => {
      const result = await authClient.signUp.email(values);
      if (result.error) {
        throw new Error(result.error.message ?? "sign-up rejected");
      }
    },
    [],
  );

  const form = useFormSubmit({
    schema: signUpSchema,
    action,
    successMessage: "Account created.",
    labels: LABELS,
    onSuccess: async () => {
      await navigate({ to: "/" });
    },
  });

  return (
    <AuthPage
      heading="Sign up"
      submitLabel="Sign up"
      pendingLabel="Signing up"
      status={form.status}
      summaryRows={form.summaryRows}
      summaryRef={form.summaryRef}
      onFocusField={form.focusField}
      failure={form.failure}
      onRetry={form.retry}
      retryRef={form.retryRef}
      pending={form.pending}
      formRef={form.formRef}
      onSubmit={() => {
        void form.submit({ name, email, password });
      }}
      footer={
        <AuthCrossLink
          prompt="Already have an account?"
          to="/auth/login"
          label="Log in"
        />
      }
    >
      <TextField
        name="name"
        label={LABELS.name}
        autoComplete="name"
        value={name}
        onChange={setName}
        field={form.field}
        error={form.fieldErrors.name}
      />
      <TextField
        name="email"
        label={LABELS.email}
        type="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
        field={form.field}
        error={form.fieldErrors.email}
      />
      <TextField
        name="password"
        label={LABELS.password}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        field={form.field}
        error={form.fieldErrors.password}
        hint="At least 8 characters."
      />
    </AuthPage>
  );
}
