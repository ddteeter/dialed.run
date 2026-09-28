import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import { ChangeEmail } from "../../modules/account/components/ChangeEmail";
import { ConfirmEmailBand } from "../../modules/account/components/ConfirmEmailBand";
import {
  accountPageQuery,
  requestEmailChangeFn,
  resendConfirmationFn,
} from "../../modules/account/functions";
import {
  ACCOUNT_SECTION_TITLES,
  accountSectionOrNotFound,
} from "../../modules/account/route-decisions";
import { ChangePassword } from "../../modules/auth/components/ChangePassword";
import { SignOutButton } from "../../modules/auth/components/SignOutButton";
import {
  changePassword,
  signOutEverywhere,
} from "../../modules/auth/credentials";
import { requireSession } from "../../modules/auth/functions";
import { saveNotificationSettingsFn } from "../../modules/email/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import {
  AccountIndex,
  NotificationsForm,
} from "../../modules/onboarding/components/Settings";
import { PickedSubPage } from "../../modules/onboarding/components/SettingsSubPage";

/**
 * The account's settings pages, one route as Settings' own sections are
 * (ACC-7, ACC-8, ACC-11): U1 Account at `sign-in`, its Email and Password,
 * and Notifications — where every email footer's "Email settings" lands.
 * An unknown section is X1.
 */
export const Route = createFileRoute("/account/$section")({
  loader: async ({ params, location }) => {
    // Signed in first: a signed-out visitor to a bad section is sent to
    // log in, not told the page does not exist.
    await requireSession(location.href);
    return {
      section: accountSectionOrNotFound(params.section),
      page: await accountPageQuery(),
      unreadCount: await unreadNotificationCountFn(),
    };
  },
  component: AccountSectionRoute,
});

function AccountSectionRoute() {
  const { section, page, unreadCount } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <PickedSubPage
        section={section}
        titles={ACCOUNT_SECTION_TITLES}
        pages={{
          "sign-in": (
            <AccountIndex
              account={page.account}
              username={page.username}
              confirmBand={
                <ConfirmEmailBand
                  account={page.account}
                  resend={resendConfirmationFn}
                />
              }
              signOutEverywhere={
                <SignOutButton
                  isEverywhere
                  signOut={async () => {
                    await signOutEverywhere();
                    await router.invalidate();
                    await navigate({ to: "/" });
                  }}
                />
              }
            />
          ),
          email: (
            <ChangeEmail
              current={page.account.email}
              isVerified={page.account.isVerified}
              request={requestEmailChangeFn}
              resend={resendConfirmationFn}
            />
          ),
          password: <ChangePassword change={changePassword} />,
          notifications: (
            <NotificationsForm
              current={page.notifications}
              save={saveNotificationSettingsFn}
              changeEmail={
                <Link
                  data-target="inline"
                  to="/account/$section"
                  params={{ section: "email" }}
                  className="font-semibold text-ink underline underline-offset-4"
                >
                  Change email
                </Link>
              }
            />
          ),
        }}
      />
    </BelledLayout>
  );
}
