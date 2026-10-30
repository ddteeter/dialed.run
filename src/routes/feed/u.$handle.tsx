import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { RunnerAtHandle } from "../../modules/feed/components/RunnerAtHandle";
import {
  followAction,
  profileAtHandleQuery,
  runnerHandleQuery,
  unfollowAction,
} from "../../modules/feed/functions";
import {
  orHandlePage,
  toHandleWhenId,
  viewerContext,
} from "../../modules/feed/redirect";
import {
  noindexHead,
  profileReportSubject,
} from "../../modules/feed/route-decisions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { ReportAffordance } from "../../modules/safety/components/ReportAffordance";
import { fileReportAction } from "../../modules/safety/functions";

/**
 * H, a runner's profile in the app (round 26 #7, FEED-10), by handle.
 * Signed-in only, and noindex (SAF-14, FEED-1). `/@handle` is the open
 * web's profile now (D-153); this is the one H.
 *
 * The segment may also be a runner's id, the address H had before, which
 * links and specs still use: it redirects to the handle the runner holds
 * now (never from an old handle, D-56). A handle is lowercase and at most
 * 20 characters, so it can never be read as an id.
 */
export const Route = createFileRoute("/feed/u/$handle")({
  head: noindexHead,
  beforeLoad: async ({ params, location }) => {
    const context = await viewerContext(getSession, location);
    await toHandleWhenId(params.handle, (userId) =>
      runnerHandleQuery({ data: { userId } }),
    );
    return context;
  },
  loader: async ({ params, context }) => {
    const [found, bell] = await Promise.all([
      profileAtHandleQuery({ data: { handle: params.handle } }),
      bellStateFn(),
    ]);
    return { found: orHandlePage(found), viewerId: context.viewerId, bell };
  },
  component: HandlePage,
});

function HandlePage() {
  const { found, viewerId, bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <RunnerAtHandle
        found={found}
        follow={followAction}
        unfollow={unfollowAction}
        reportAffordanceFor={(profile) => (
          <ReportAffordance
            subject={profileReportSubject(profile)}
            viewerId={viewerId}
            fileReport={fileReportAction}
          />
        )}
      />
    </BelledLayout>
  );
}
