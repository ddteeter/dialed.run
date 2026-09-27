import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { PASSWORD_MIN_LENGTH, signUpSchema } from "../../lib/contracts";
import {
  AuthCrossLink,
  AuthLegal,
  AuthPage,
  CREDENTIAL_LABELS,
  CredentialFields,
  useAuthForm,
} from "../../modules/auth/auth-page";
import { signUp } from "../../modules/auth/credentials";
import { useGoogleSignIn } from "../../modules/auth/google-button";
import {
  googleReturn,
  parseSignInSearch,
} from "../../modules/auth/sign-in-search";

/**
 * Au2 · create an account (round 26 renumbered it): email and password
 * only. The handle is O0's, the first onboarding step (round 26 #7).
 */
export const Route = createFileRoute("/auth/signup")({
  // Only `error` matters here: a failed Google round trip comes back to
  // sign-up, and says so (Au6).
  validateSearch: parseSignInSearch,
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const search = Route.useSearch();
  const google = useGoogleSignIn({
    ...googleReturn("/auth/signup", search),
    returnedError: search.error,
    leave: (url) => {
      globalThis.location.assign(url);
    },
  });
  const { form, cause } = useAuthForm({
    schema: signUpSchema,
    action: signUp,
    // The same words for a new address and a registered one: Au4 follows
    // either way, and so does this sentence (round 26 #11).
    successMessage: "Check your email.",
    labels: CREDENTIAL_LABELS,
    onSuccess: async () => {
      await navigate({ to: "/account/check-email", search: { email } });
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
        void form.submit({ email, password });
      }}
    >
      <CredentialFields
        form={form}
        email={email}
        onEmail={setEmail}
        password={password}
        onPassword={setPassword}
        passwordAutoComplete="new-password"
        passwordHint={`At least ${String(PASSWORD_MIN_LENGTH)} characters.`}
      />
    </AuthPage>
  );
}
