import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";

import { signInSchema } from "../../lib/contracts";
import {
  AuthPage,
  LoginCrossLink,
  PasswordField,
  SessionNotice,
  useAuthForm,
} from "../../modules/auth/auth-page";
import { signIn } from "../../modules/auth/credentials";
import { useGoogleSignIn } from "../../modules/auth/google-button";
import { useCarriedEmail } from "../../modules/auth/carried-email";
import {
  googleReturn,
  parseSignInSearch,
} from "../../modules/auth/sign-in-search";
import { TextField } from "../../ui";

/**
 * Au2 — and Au7 when a form was carried here by an expired session. The
 * search params are parsed by the module's schema; a bad one is dropped,
 * so an edited URL is still the ordinary log-in page.
 */
export const Route = createFileRoute("/auth/login")({
  validateSearch: parseSignInSearch,
  component: LoginPage,
});

const LABELS = { email: "Email", password: "Password" };

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [email, setEmail] = useCarriedEmail(search.carried);
  const [password, setPassword] = useState("");
  const returns = googleReturn("/auth/login", search);

  const google = useGoogleSignIn({
    ...returns,
    returnedError: search.error,
    // fallow-ignore-next-line code-duplication -- two routes of the same kind are the same shape by mandate: createFileRoute + loader + useLoaderData + shell is exactly what server-functions-are-glue requires, and the branching that would make them differ is what it forbids
    leave: (url) => {
      globalThis.location.assign(url);
    },
  });
  const { form, cause } = useAuthForm({
    schema: signInSchema,
    action: signIn,
    successMessage: "Signed in.",
    labels: LABELS,
    onSuccess: async () => {
      // The shell reads "signed in" once, at the root; tell it.
      await router.invalidate();
      await navigate({ href: returns.callbackURL });
    },
  });

  return (
    // fallow-ignore-next-line code-duplication -- the AuthPage call both auth screens make; what differs is the fields, which is the entire content of the two screens
    <AuthPage
      heading="Log in"
      submitLabel="Log in"
      pendingLabel="Logging in"
      form={form}
      cause={cause}
      google={google}
      notice={<SessionNotice carried={search.carried} />}
      crossLink={<LoginCrossLink carried={search.carried} />}
      onSubmit={() => {
        void form.submit({ email, password });
      }}
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
      <PasswordField
        label={LABELS.password}
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        field={form.field}
        error={form.fieldErrors.password}
        focusOnArrival={search.carried !== undefined}
      />
    </AuthPage>
  );
}
