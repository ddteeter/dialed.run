import { createFileRoute } from "@tanstack/react-router";

import { unsubscribeSearch } from "../../modules/account/route-decisions";
import { UnsubscribeLanding } from "../../modules/email/components/UnsubscribeLanding";
import {
  resubscribeFn,
  unsubscribeFn,
  unsubscribeLinkQuery,
} from "../../modules/email/functions";
import { oneClickUnsubscribeResponse } from "../../modules/email/one-click";

/**
 * The unsubscribe link (round 26 #19, D-64): opening it asks, and its one
 * button unsubscribes, with no log-in; a mail client's own one-click
 * unsubscribe (RFC 8058) POSTs the same URL.
 */
export const Route = createFileRoute("/account/unsubscribe")({
  validateSearch: (search) => unsubscribeSearch.parse(search),
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ deps }) => unsubscribeLinkQuery({ data: { search: deps.search } }),
  server: {
    handlers: {
      POST: ({ request }) => oneClickUnsubscribeResponse(request),
    },
  },
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const search = Route.useSearch();
  return (
    <UnsubscribeLanding
      landing={Route.useLoaderData()}
      unsubscribe={() => unsubscribeFn({ data: { search } })}
      resubscribe={() => resubscribeFn({ data: { search } })}
    />
  );
}
