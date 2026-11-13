import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import {
  ownThemeQuery,
  setThemeFn,
  usernameQuery,
} from "../../../modules/account/functions";
import { notificationSettingsQuery } from "../../../modules/email/functions";
import { SignOutButton } from "../../../modules/auth/components/SignOutButton";
import { signOut } from "../../../modules/auth/credentials";
import { requireSession } from "../../../modules/auth/functions";
import { BelledLayout } from "../../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../../modules/notifications/functions";
import { SettingsIndex } from "../../../modules/onboarding/components/Settings";
import {
  isPrivacyReviewDueQuery,
  settingsQuery,
} from "../../../modules/onboarding/functions";
import { blockedRunnersQuery } from "../../../modules/safety/functions";
import { Page } from "../../../ui";
import { ThemeSwitch } from "../../../ui/ThemeSwitch";

/**
 * U1 · the settings index (round 22, item 20). Under You, so it keeps the
 * tab bar.
 */
export const Route = createFileRoute("/onboarding/settings/")({
  staticData: { title: "Settings" },
  loader: async ({ location }) => {
    await requireSession(location);
    const [
      current,
      { blocked },
      bell,
      { username },
      notifications,
      theme,
      isPrivacyReviewDue,
    ] = await Promise.all([
      settingsQuery(),
      blockedRunnersQuery(),
      bellStateFn(),
      usernameQuery(),
      notificationSettingsQuery(),
      ownThemeQuery(),
      isPrivacyReviewDueQuery(),
    ]);
    return {
      current,
      blockedCount: blocked.length,
      bell,
      username,
      runReminderEmail: notifications.runReminder,
      theme,
      isPrivacyReviewDue,
    };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const {
    current,
    blockedCount,
    bell,
    username,
    runReminderEmail,
    theme,
    isPrivacyReviewDue,
  } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  return (
    <BelledLayout {...bell}>
      <Page title="Settings" width="column">
        <SettingsIndex
          current={current}
          username={username}
          blockedCount={blockedCount}
          runReminderEmail={runReminderEmail}
          isPrivacyReviewDue={isPrivacyReviewDue}
          display={<ThemeSwitch initial={theme} save={setThemeFn} />}
          signOut={
            <SignOutButton
              username={username}
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
