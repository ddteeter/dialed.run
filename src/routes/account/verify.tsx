import { createFileRoute } from "@tanstack/react-router";

import { LinkLanding } from "../../modules/account/components/LinkLanding";
import {
  confirmEmailFn,
  readEmailLinkFn,
} from "../../modules/account/functions";
import { tokenSearch } from "../../modules/account/route-decisions";

/**
 * Where a confirm or change link lands (round 26 #11). Opening it changes
 * nothing (owner, 2026-11-15; D-64): the loader reads what the link would
 * do, and the landing's one button spends it.
 */
export const Route = createFileRoute("/account/verify")({
  validateSearch: (search) => tokenSearch.parse(search),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) => readEmailLinkFn({ data: { token: deps.token ?? "" } }),
  component: VerifyPage,
});

function VerifyPage() {
  const { token = "" } = Route.useSearch();
  return (
    <LinkLanding
      landing={Route.useLoaderData()}
      confirm={() => confirmEmailFn({ data: { token } })}
    />
  );
}
