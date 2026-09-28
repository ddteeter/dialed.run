import { createFileRoute } from "@tanstack/react-router";

import { CheckEmail } from "../../modules/account/components/CheckEmail";
import {
  optionalAccountQuery,
  resendConfirmationFn,
} from "../../modules/account/functions";
import {
  checkEmailSearch,
  checkEmailView,
  startOverIfNoAddress,
} from "../../modules/account/route-decisions";

/**
 * Au4 · "Check your email" (round 26 #11): where every email sign-up ends,
 * and where "Log in to resend" comes back to.
 */
export const Route = createFileRoute("/account/check-email")({
  validateSearch: (search) => checkEmailSearch.parse(search),
  loaderDeps: ({ search }) => ({ email: search.email }),
  loader: async ({ deps }) => {
    const account = await optionalAccountQuery();
    startOverIfNoAddress(account, deps.email);
    return checkEmailView(account, deps.email ?? "");
  },
  component: CheckEmailPage,
});

function CheckEmailPage() {
  const { email, isSignedIn } = Route.useLoaderData();
  return (
    <CheckEmail
      email={email}
      isSignedIn={isSignedIn}
      resend={resendConfirmationFn}
    />
  );
}
