import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { HandleForm } from "../../modules/account/components/HandleForm";
import { HandleStep } from "../../modules/account/components/HandleStep";
import { claimUsernameFn } from "../../modules/account/functions";
import { requireSession } from "../../modules/auth/functions";
import { Page } from "../../ui";

/**
 * O0 · pick a handle (round 26 #7), the first step of onboarding for email
 * and Google alike. `/` sends a signed-in runner with no handle here before
 * anything else; Next goes on to O1.
 */
export const Route = createFileRoute("/onboarding/handle")({
  loader: async ({ location }) => {
    await requireSession(location.href);
  },
  component: HandlePage,
});

function HandlePage() {
  const navigate = useNavigate();

  return (
    <Page width="panel">
      <HandleStep>
        <HandleForm
          claim={claimUsernameFn}
          submitLabel="Next"
          pendingLabel="Checking"
          successMessage="Handle saved."
          onClaimed={() => {
            void navigate({ to: "/onboarding/calibrate" });
          }}
        />
      </HandleStep>
    </Page>
  );
}
