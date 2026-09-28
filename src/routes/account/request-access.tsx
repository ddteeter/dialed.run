import { createFileRoute } from "@tanstack/react-router";

import { RequestAccess } from "../../modules/account/components/RequestAccess";
import {
  requestAccessFn,
  turnstileSiteKeyQuery,
} from "../../modules/account/functions";

/**
 * Au5 · Request access (task 126, ACC-5; round 26 #20): "No code?" on the
 * sign-up form opens this.
 */
export const Route = createFileRoute("/account/request-access")({
  loader: async () => turnstileSiteKeyQuery(),
  component: RequestAccessPage,
});

function RequestAccessPage() {
  const { siteKey } = Route.useLoaderData();
  return <RequestAccess siteKey={siteKey} request={requestAccessFn} />;
}
