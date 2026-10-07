import { createFileRoute } from "@tanstack/react-router";

import { TermsPrompt } from "../../modules/account/components/TermsPrompt";
import {
  acceptTermsFn,
  termsPromptLoader,
} from "../../modules/account/functions";
import { termsPromptSearch } from "../../modules/account/route-decisions";
import { useTermsPromptWiring } from "../../modules/account/use-go-home";
import { signOut } from "../../modules/auth/credentials";

/**
 * The terms prompt (ACC-6): the root's gate sends a runner behind on the
 * terms here before any page, and so does a stale tab's refused call,
 * carrying where it was as `from` (decision D-96) and, for a save, the
 * page's name as `save` (D-102). Anyone else is sent home.
 */
export const Route = createFileRoute("/account/terms")({
  validateSearch: termsPromptSearch,
  loader: termsPromptLoader,
  component: TermsPromptPage,
});

function TermsPromptPage() {
  const search = Route.useSearch();
  const wiring = useTermsPromptWiring(signOut, search.from);
  return (
    <TermsPrompt
      view={Route.useLoaderData()}
      accept={acceptTermsFn}
      savedPage={search.save}
      {...wiring}
    />
  );
}
