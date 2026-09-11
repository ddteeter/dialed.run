import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { signInSchema } from "../../lib/contracts";
import { AuthCrossLink, AuthPage } from "../../modules/auth/auth-page";
import { signIn } from "../../modules/auth/credentials";
import { TextField, useFormSubmit } from "../../ui";

export const Route = createFileRoute("/auth/login")({ component: LoginPage });

const LABELS = { email: "Email", password: "Password" };

function LoginPage() {
  // fallow-ignore-next-line code-duplication -- two routes of the same kind are the same shape by mandate: createFileRoute + loader + useLoaderData + shell is exactly what server-functions-are-glue requires, and the branching that would make them differ is what it forbids
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
    // fallow-ignore-next-line code-duplication -- the AuthPage call both auth screens make; what differs is the fields, which is the entire content of the two screens
    <AuthPage
      heading="Log in"
      submitLabel="Log in"
      pendingLabel="Signing in"
      form={form}
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
