import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { OnboardingHandle } from "../../modules/account/components/OnboardingHandle";
import {
  claimUsernameFn,
  keepPlaceholderFn,
  renameNoticeQuery,
} from "../../modules/account/functions";
import { requireSession } from "../../modules/auth/functions";
import { Page } from "../../ui";

/**
 * O0 · pick a handle (round 26 #7), the first step of onboarding for email
 * and Google alike. `/` sends a signed-in runner with no handle here before
 * anything else; Next goes on to O1. A runner a moderator renamed is sent
 * here too, once, for the re-pick (ACC-12; round 27 #16), and goes home.
 */
export const Route = createFileRoute("/onboarding/handle")({
  loader: async ({ location }) => {
    await requireSession(location.href);
    return renameNoticeQuery();
  },
  component: HandlePage,
});

function HandlePage() {
  const { notice } = Route.useLoaderData();
  const navigate = useNavigate();

  return (
    <Page width="panel">
      <OnboardingHandle
        notice={notice}
        claim={claimUsernameFn}
        keep={keepPlaceholderFn}
        onFirstHandle={() => {
          void navigate({ to: "/onboarding/calibrate" });
        }}
        onRepicked={() => {
          void navigate({ to: "/" });
        }}
      />
    </Page>
  );
}
