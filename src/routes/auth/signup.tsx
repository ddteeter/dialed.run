import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";

import { PASSWORD_MIN_LENGTH, signUpSchema } from "../../lib/contracts";
import {
  AuthCrossLink,
  AuthLegal,
  AuthPage,
  PasswordField,
  useAuthForm,
} from "../../modules/auth/auth-page";
import { signUp } from "../../modules/auth/credentials";
import { useGoogleSignIn } from "../../modules/auth/google-button";
import { TextField } from "../../ui";

/**
 * Au1. The name field stays until the username task replaces it (owner,
 * 2026-09-24): the board's two fields are that task's, not this one's.
 */
export const Route = createFileRoute("/auth/signup")({ component: SignupPage });

const LABELS = { name: "Name", email: "Email", password: "Password" };

function SignupPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const google = useGoogleSignIn({
    callbackURL: "/",
    leave: (url) => {
      globalThis.location.assign(url);
    },
  });
  const { form, cause } = useAuthForm({
    schema: signUpSchema,
    action: signUp,
    successMessage: "Account created.",
    labels: LABELS,
    onSuccess: async () => {
      await router.invalidate();
      await navigate({ to: "/" });
    },
  });

  return (
    <AuthPage
      heading="Create account"
      submitLabel="Create account"
      pendingLabel="Creating account"
      form={form}
      cause={cause}
      google={google}
      legal={<AuthLegal />}
      crossLink={
        <AuthCrossLink
          prompt="Have an account?"
          to="/auth/login"
          label="Log in"
        />
      }
      onSubmit={() => {
        void form.submit({ name, email, password });
      }}
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
      <PasswordField
        label={LABELS.password}
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        field={form.field}
        error={form.fieldErrors.password}
        hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters.`}
      />
    </AuthPage>
  );
}
