import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { signUpSchema } from "../../lib/contracts";
import { AuthCrossLink, AuthPage } from "../../modules/auth/auth-page";
import { signUp } from "../../modules/auth/credentials";
import { TextField, useFormSubmit } from "../../ui";

export const Route = createFileRoute("/auth/signup")({ component: SignupPage });

const LABELS = { name: "Name", email: "Email", password: "Password" };

function SignupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const form = useFormSubmit({
    schema: signUpSchema,
    action: signUp,
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
      form={form}
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
