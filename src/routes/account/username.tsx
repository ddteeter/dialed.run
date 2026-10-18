import { createFileRoute } from "@tanstack/react-router";

import { HandleForm } from "../../modules/account/components/HandleForm";
import {
  claimUsernameFn,
  usernameQuery,
} from "../../modules/account/functions";
import { requireSession } from "../../modules/auth/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { SettingsSubPage } from "../../modules/onboarding/components/SettingsSubPage";

/**
 * Settings › Username (round 26 #7): the same field and rule as O0, and a
 * Save. The old handle is kept, so `/@old` says the runner changed their
 * name rather than pointing anywhere.
 */
export const Route = createFileRoute("/account/username")({
  loader: async ({ location }) => {
    await requireSession(location);
    const [account, bell] = await Promise.all([usernameQuery(), bellStateFn()]);
    return { username: account.username, bell };
  },
  component: UsernamePage,
});

function UsernamePage() {
  const { username, bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <SettingsSubPage title="Username">
        <HandleForm
          initial={username}
          claim={claimUsernameFn}
          submitLabel="Save"
          pendingLabel="Saving"
          successMessage="Username saved."
        />
      </SettingsSubPage>
    </BelledLayout>
  );
}
