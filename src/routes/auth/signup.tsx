import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { PASSWORD_MIN_LENGTH, signUpSchema } from "../../lib/contracts";
import { turnstileSiteKeyQuery } from "../../modules/account/functions";
import {
  AuthCrossLink,
  AuthLegal,
  AuthPage,
  CredentialFields,
  InviteCodeField,
  RequestAccessLink,
  SIGN_UP_LABELS,
  useAuthForm,
} from "../../modules/auth/auth-page";
import { signUp } from "../../modules/auth/credentials";
import { useGoogleSignIn } from "../../modules/auth/google-button";
import {
  googleReturn,
  parseSignInSearch,
} from "../../modules/auth/sign-in-search";
import { Turnstile, useTurnstileToken } from "../../ui";

/**
 * Au2 · create an account (round 26 renumbered it): the invite code while
 * invite-only is on (round 26 #20), then email and password. The handle is
 * O0's, the first onboarding step (round 26 #7). Turnstile sits directly
 * above the primary and covers Google too (round 27 #12).
 */
export const Route = createFileRoute("/auth/signup")({
  // `error`: a failed Google round trip comes back to sign-up, and says so
  // (Au6). `code`: an invite link's, via `/join`.
  validateSearch: parseSignInSearch,
  loader: async () => turnstileSiteKeyQuery(),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { siteKey } = Route.useLoaderData();
  const [inviteCode, setInviteCode] = useState(search.code ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // A Turnstile answer works once: every attempt takes it (ACC-5).
  const turnstile = useTurnstileToken();

  const google = useGoogleSignIn({
    ...googleReturn("/auth/signup", search),
    returnedError: search.error,
    leave: (url) => {
      globalThis.location.assign(url);
    },
    admission: () => ({ inviteCode, turnstileToken: turnstile.take() }),
  });
  const { form, cause } = useAuthForm({
    schema: signUpSchema,
    action: (values) => signUp(values, turnstile.take()),
    // The same words for a new address and a registered one: Au4 follows
    // either way, and so does this sentence (round 26 #11).
    successMessage: "Check your email.",
    labels: SIGN_UP_LABELS,
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
      turnstile={
        <Turnstile
          key={turnstile.widgetKey}
          siteKey={siteKey}
          action="sign-up"
          onToken={turnstile.onToken}
        />
      }
      requestLink={<RequestAccessLink />}
      crossLink={
        <AuthCrossLink
          prompt="Have an account?"
          to="/auth/login"
          label="Log in"
          redirect={search.redirect}
        />
      }
      onSubmit={() => {
        void form.submit({ inviteCode, email, password });
      }}
    >
      <InviteCodeField
        form={form}
        value={inviteCode}
        onChange={setInviteCode}
      />
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
