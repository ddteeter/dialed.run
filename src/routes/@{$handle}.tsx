import { createFileRoute } from "@tanstack/react-router";

import { confirmEmailGate } from "../modules/account/components/ConfirmEmailSheet";
import {
  ownAccountQuery,
  resendConfirmationFn,
} from "../modules/account/functions";
import { getSession } from "../modules/auth/functions";
import { RunnerAtHandle } from "../modules/feed/components/RunnerAtHandle";
import {
  followAction,
  profileAtHandleQuery,
  unfollowAction,
} from "../modules/feed/functions";
import { orHandlePage, requireSignedIn } from "../modules/feed/redirect";
import {
  noindexHead,
  profileReportSubject,
} from "../modules/feed/route-decisions";
import { BelledLayout } from "../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../modules/notifications/functions";
import { ReportAffordance } from "../modules/safety/components/ReportAffordance";
import { fileReportAction } from "../modules/safety/functions";

/**
 * A runner's profile by handle (round 26 #7, FEED-10). Signed-in only, and
 * noindex (SAF-14, FEED-1). The one H: `/feed/u/$userId` redirects here.
 */
export const Route = createFileRoute("/@{$handle}")({
  head: noindexHead,
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async ({ params }) => {
    const [found, session, bell, account] = await Promise.all([
      profileAtHandleQuery({ data: { handle: params.handle } }),
      getSession(),
      bellStateFn(),
      ownAccountQuery(),
    ]);
    return {
      found: orHandlePage(found),
      viewerId: requireSignedIn(session).user.id,
      bell,
      account,
    };
  },
  component: HandlePage,
});

function HandlePage() {
  const { found, viewerId, bell, account } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <RunnerAtHandle
        found={found}
        follow={followAction}
        unfollow={unfollowAction}
        confirmFirst={confirmEmailGate(account, resendConfirmationFn)}
        reportAffordanceFor={(profile, guard) => (
          <ReportAffordance
            subject={profileReportSubject(profile)}
            viewerId={viewerId}
            fileReport={fileReportAction}
            guard={guard}
          />
        )}
      />
    </BelledLayout>
  );
}
