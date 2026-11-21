import { createFileRoute } from "@tanstack/react-router";

import { TermsPrompt } from "../../modules/account/terms/components/TermsPrompt";
import {
  acceptTermsFn,
  termsPromptLoader,
} from "../../modules/account/functions";
import {
  termsPromptSearch,
  useSavedPage,
  useTermsPromptWiring,
} from "../../modules/account/client";
import { signOut } from "../../modules/auth/client";

/**
 * The terms prompt (ACC-6): the root's gate sends a runner behind on the
 * terms here before any page, and so does a stale tab's refused call,
 * carrying where it was as `from` (decision D-96) and, for a save, the
 * page's name in history state (D-102, `useSavedPage`). Anyone else is sent home.
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
      savedPage={useSavedPage()}
      {...wiring}
    />
  );
}
