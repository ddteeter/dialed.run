import { createFileRoute } from "@tanstack/react-router";

import { tokenSearch } from "../../modules/account/client";
import { resetPassword } from "../../modules/auth/client";
import { ResetPassword } from "../../modules/auth/components/ResetPassword";

/**
ACC-4: the reset link's page, where the new password is set.
*/
export const Route = createFileRoute("/account/reset")({
  validateSearch: (search) => tokenSearch.parse(search),
  component: ResetPage,
});

function ResetPage() {
  const { token } = Route.useSearch();
  return <ResetPassword token={token} reset={resetPassword} />;
}
