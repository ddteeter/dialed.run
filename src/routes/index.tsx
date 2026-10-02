import { createFileRoute } from "@tanstack/react-router";

import { Landing } from "../modules/auth/components/Landing";
import { getSession } from "../modules/auth/functions";
import { onboardingGateQuery } from "../modules/onboarding/functions";
import { startOnboardingIfNeeded } from "../modules/onboarding/route-decisions";

/**
 * The marketing page, and the door into onboarding (R-52).
 *
 * A signed-in runner who has not finished onboarding is sent to O1 from
 * here rather than only at signup, because every step past O1 is skippable
 * and bailing therefore has to be recoverable — a one-shot redirect at
 * account creation strands the exact person the skippable design invites.
 * A signed-out visitor is never redirected: this is the only page they can
 * see. A runner with no handle never gets this far: the root route sends
 * them to O0 first, whatever else is unfinished (round 26 #7).
 */
export const Route = createFileRoute("/")({
  loader: async () => {
    const [session, isUnfinished] = await Promise.all([
      getSession(),
      onboardingGateQuery(),
    ]);
    startOnboardingIfNeeded(isUnfinished);
    return { signedIn: session !== null };
  },
  component: Home,
});

function Home() {
  const { signedIn } = Route.useLoaderData();
  return <Landing signedIn={signedIn} />;
}
