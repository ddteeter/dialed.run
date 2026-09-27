import { createFileRoute } from "@tanstack/react-router";

import { ForgotPassword } from "../../modules/auth/components/ForgotPassword";
import { requestPasswordReset } from "../../modules/auth/credentials";

/**
ACC-4: "Forgot it?" — the address a reset link goes to.
*/
export const Route = createFileRoute("/account/forgot")({
  component: ForgotPage,
});

function ForgotPage() {
  return <ForgotPassword request={requestPasswordReset} />;
}
