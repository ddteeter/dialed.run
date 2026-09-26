import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import { usernameQuery } from "../../../modules/account/functions";
import { SignOutButton } from "../../../modules/auth/components/SignOutButton";
import { signOut } from "../../../modules/auth/credentials";
import { requireSession } from "../../../modules/auth/functions";
import { BelledLayout } from "../../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../../modules/notifications/functions";
import { SettingsIndex } from "../../../modules/onboarding/components/Settings";
import { settingsQuery } from "../../../modules/onboarding/functions";
import { blockedRunnersQuery } from "../../../modules/safety/functions";
import { Page } from "../../../ui";

/**
 * U1 · the settings index (round 22, item 20). Under You, so it keeps the
 * tab bar.
 */
export const Route = createFileRoute("/onboarding/settings/")({
  loader: async ({ location }) => {
    await requireSession(location.href);
    const [current, { blocked }, unreadCount, { username }] =
      await Promise.all([
        settingsQuery(),
        blockedRunnersQuery(),
        unreadNotificationCountFn(),
        usernameQuery(),
      ]);
    return { current, blockedCount: blocked.length, unreadCount, username };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { current, blockedCount, unreadCount, username } =
    Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <Page title="Settings" width="column">
        <SettingsIndex
          current={current}
          username={username}
          blockedCount={blockedCount}
          signOut={
            <SignOutButton
              signOut={async () => {
                await signOut();
                // The shell reads "signed in" once, at the root; tell it.
                await router.invalidate();
                await navigate({ to: "/" });
              }}
            />
          }
        />
      </Page>
    </BelledLayout>
  );
}
