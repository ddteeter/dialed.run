import { createFileRoute } from "@tanstack/react-router";

import { DeletionLinkLanding } from "../../modules/account/data/components/DeletionLinkLanding";
import {
  confirmDeletionLinkFn,
  readDeletionLinkFn,
} from "../../modules/account/functions";
import { tokenSearch } from "../../modules/account/client";

/**
 * Where the Desk's deletion link lands (round 64 #374.3), signed out: a
 * closed account can't sign in. Opening it changes nothing (D-64): the
 * loader reads what the link would do, and the page's one button spends
 * it.
 */
export const Route = createFileRoute("/account/deletion")({
  component: DeletionPage,
  validateSearch: (search) => tokenSearch.parse(search),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) =>
    readDeletionLinkFn({ data: { token: deps.token ?? "" } }),
});

function DeletionPage() {
  const token = Route.useSearch({ select: (search) => search.token ?? "" });
  return (
    <DeletionLinkLanding
      landing={Route.useLoaderData()}
      confirm={() => confirmDeletionLinkFn({ data: { token } })}
    />
  );
}
