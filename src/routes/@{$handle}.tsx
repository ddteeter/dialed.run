import { createFileRoute } from "@tanstack/react-router";

import { signedInQuery } from "../modules/auth/functions";
import { NotPublicPage } from "../modules/feed/components/PublicFrame";
import { PublicProfilePage } from "../modules/feed/components/PublicProfile";
import { publicProfileQuery } from "../modules/feed/functions";
import { publicProfileSearch } from "../modules/feed/inputs";
import {
  profileOrNotFound,
  publicProfileHead,
} from "../modules/feed/public-profile-shape";
import { PUBLIC_ORIGIN } from "../modules/ops/og/site-head";

/**
 * `/@handle`: a runner's profile they made PUBLIC, for anyone (round 41
 * #86d, D-151), and one 404 page for every profile that is not (#86f).
 * H, the signed-in profile, is `/feed/u/<handle>` (D-154).
 *
 * The same page for every viewer, as `/kit/<id>` is: the loader reads no
 * session, the root reads none on this path (`lib/open-web`), and what
 * differs for a signed-in viewer is filled in the browser. `?all=true`
 * lists every kit; each list is its own URL for the edge to keep.
 */
export const Route = createFileRoute("/@{$handle}")({
  validateSearch: (search) => publicProfileSearch.parse(search),
  loaderDeps: ({ search }) => ({ all: search.all }),
  loader: async ({ params, deps }) =>
    profileOrNotFound(
      await publicProfileQuery({
        data: { handle: params.handle, all: deps.all },
      }),
    ),
  head: ({ loaderData }) => publicProfileHead(loaderData),
  component: ProfilePage,
  notFoundComponent: NotPublic,
});

function ProfilePage() {
  return (
    <PublicProfilePage
      profile={Route.useLoaderData()}
      origin={PUBLIC_ORIGIN}
      askSignedIn={signedInQuery}
    />
  );
}

function NotPublic() {
  return <NotPublicPage page={Route.useParams()} askSignedIn={signedInQuery} />;
}
