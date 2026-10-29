import { createFileRoute } from "@tanstack/react-router";

import { signedInQuery } from "../../modules/auth/functions";
import { PublicKitPage } from "../../modules/feed/components/PublicKit";
import { NotPublicPage } from "../../modules/feed/components/PublicFrame";
import { publicKitQuery } from "../../modules/feed/functions";
import {
  kitOrNotFound,
  publicKitHead,
} from "../../modules/feed/public-kit-shape";
import { PUBLIC_ORIGIN } from "../../modules/ops/og/site-head";

/**
 * `/k/<id>`: a kit its runner made PUBLIC, for anyone (round 41 #86c,
 * D-150), and one 404 page for every kit that is not (#86f).
 *
 * The same page for every viewer (D-153): the loader reads no session,
 * the root reads none on this path (`lib/open-web`), and what differs for
 * a signed-in viewer is filled in the browser. The server function sets
 * the cache headers the page leaves with.
 */
export const Route = createFileRoute("/k/$entryId")({
  loader: async ({ params }) =>
    kitOrNotFound(await publicKitQuery({ data: { entryId: params.entryId } })),
  head: ({ loaderData }) => publicKitHead(loaderData, PUBLIC_ORIGIN),
  component: KitPage,
  notFoundComponent: NotPublic,
});

function KitPage() {
  return (
    <PublicKitPage
      kit={Route.useLoaderData()}
      origin={PUBLIC_ORIGIN}
      askSignedIn={signedInQuery}
    />
  );
}

function NotPublic() {
  return <NotPublicPage page={Route.useParams()} askSignedIn={signedInQuery} />;
}
