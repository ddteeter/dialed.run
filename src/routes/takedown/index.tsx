import { createFileRoute } from "@tanstack/react-router";

import { takedownSearchSchema } from "../../lib/contracts/takedown";
import { turnstileSiteKeyQuery } from "../../modules/account/functions";
import { TakedownRequest } from "../../modules/safety/components/TakedownRequest";
import { takedownRequestFn } from "../../modules/safety/functions";

/**
 * `/takedown` (design 136, decision D-117): the TAKE IT DOWN Act's way to
 * ask for an intimate image to come down, open to anyone, signed in or
 * not. Linked from every page's footer, and from a public kit's Report
 * this kit with its link filled in (round 41 #86c).
 */
export const Route = createFileRoute("/takedown/")({
  validateSearch: takedownSearchSchema,
  loader: async () => turnstileSiteKeyQuery(),
  component: TakedownPage,
});

function TakedownPage() {
  const { siteKey } = Route.useLoaderData();
  return (
    <TakedownRequest
      siteKey={siteKey}
      request={takedownRequestFn}
      location={Route.useSearch().location}
    />
  );
}
