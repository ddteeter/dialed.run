import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { signInSchema } from "../../lib/contracts";
import { AuthCrossLink, AuthPage } from "../../modules/auth/auth-page";
import { signIn } from "../../modules/auth/credentials";
import { TextField, useFormSubmit } from "../../ui";

export const Route = createFileRoute("/auth/login")({ component: LoginPage });

const LABELS = { email: "Email", password: "Password" };

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const form = useFormSubmit({
    schema: signInSchema,
    action: signIn,
    successMessage: "Signed in.",
    labels: LABELS,
    onSuccess: async () => {
      await navigate({ to: "/" });
    },
  });

  return (
    <AuthPage
      heading="Log in"
      submitLabel="Log in"
      pendingLabel="Signing in"
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
        void form.submit({ email, password });
      }}
      footer={
        <AuthCrossLink prompt="New here?" to="/auth/signup" label="Sign up" />
      }
    >
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
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        field={form.field}
        error={form.fieldErrors.password}
      />
    </AuthPage>
  );
}
