import { createFileRoute } from "@tanstack/react-router";

import { TermsPrompt } from "../../modules/account/components/TermsPrompt";
import {
  acceptTermsFn,
  termsPromptLoader,
} from "../../modules/account/functions";
import { useTermsPromptWiring } from "../../modules/account/use-go-home";
import { signOut } from "../../modules/auth/credentials";

/**
 * The terms prompt (ACC-6): the root's gate sends a runner behind on the
 * terms here before any page. Anyone else is sent home.
 */
export const Route = createFileRoute("/account/terms")({
  loader: termsPromptLoader,
  component: TermsPromptPage,
});

function TermsPromptPage() {
  const wiring = useTermsPromptWiring(signOut);
  return (
    <TermsPrompt
      view={Route.useLoaderData()}
      accept={acceptTermsFn}
      {...wiring}
    />
  );
}
