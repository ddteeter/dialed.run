import { createFileRoute } from "@tanstack/react-router";

import { ConfirmEmailBand } from "../../modules/account/components/ConfirmEmailBand";
import {
  ownAccountQuery,
  resendConfirmationFn,
} from "../../modules/account/functions";
import { getSession } from "../../modules/auth/functions";
import { OwnProfile } from "../../modules/feed/components/OwnProfile";
import { ownProfileQuery } from "../../modules/feed/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";

export const Route = createFileRoute("/feed/me")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  // Three independent reads, in parallel, as the tuple they arrive in.
  loader: () =>
    Promise.all([ownProfileQuery(), bellStateFn(), ownAccountQuery()]),
  component: OwnProfilePage,
});

function OwnProfilePage() {
  const [profile, bell, account] = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <OwnProfile
        profile={profile}
        confirmBand={
          <ConfirmEmailBand account={account} resend={resendConfirmationFn} />
        }
      />
    </BelledLayout>
  );
}
