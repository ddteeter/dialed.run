import { createFileRoute } from "@tanstack/react-router";

import { unsubscribeSearch } from "../../modules/account/route-decisions";
import { UnsubscribeLanding } from "../../modules/email/components/UnsubscribeLanding";
import { resubscribeFn, unsubscribeFn } from "../../modules/email/functions";
import { oneClickUnsubscribeResponse } from "../../modules/email/one-click";

/**
 * The unsubscribe link (round 26 #19): opening it is the unsubscribe, with
 * no log-in and no confirm, and a mail client's own one-click unsubscribe
 * (RFC 8058) POSTs the same URL.
 */
export const Route = createFileRoute("/account/unsubscribe")({
  validateSearch: (search) => unsubscribeSearch.parse(search),
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ deps }) => unsubscribeFn({ data: { search: deps.search } }),
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
      resubscribe={() => resubscribeFn({ data: { search } })}
    />
  );
}
