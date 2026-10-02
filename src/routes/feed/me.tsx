import { createFileRoute } from "@tanstack/react-router";

import { ConfirmEmailBand } from "../../modules/account/components/ConfirmEmailBand";
import { resendConfirmationFn } from "../../modules/account/functions";
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
  loader: async () => ({
    you: await ownProfileQuery(),
    bell: await bellStateFn(),
  }),
  component: OwnProfilePage,
});

function OwnProfilePage() {
  const { you, bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <OwnProfile
        profile={you.profile}
        confirmBand={
          <ConfirmEmailBand
            account={you.account}
            resend={resendConfirmationFn}
          />
        }
      />
    </BelledLayout>
  );
}
