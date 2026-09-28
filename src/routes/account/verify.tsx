import { createFileRoute } from "@tanstack/react-router";

import { LinkLanding } from "../../modules/account/components/LinkLanding";
import { confirmEmailFn } from "../../modules/account/functions";
import { tokenSearch } from "../../modules/account/route-decisions";

/**
 * Where a confirm link lands (round 26 #11): opening it is the confirm.
 * One of three landings — confirmed, already confirmed, run out.
 */
export const Route = createFileRoute("/account/verify")({
  validateSearch: (search) => tokenSearch.parse(search),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) => confirmEmailFn({ data: { token: deps.token ?? "" } }),
  component: VerifyPage,
});

function VerifyPage() {
  return <LinkLanding landing={Route.useLoaderData()} />;
}
