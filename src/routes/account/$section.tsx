import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import { ChangeEmail } from "../../modules/account/components/ChangeEmail";
import { DeleteAccount } from "../../modules/account/components/DeleteAccount";
import { ConfirmEmailBand } from "../../modules/account/components/ConfirmEmailBand";
import { ExportRow } from "../../modules/account/components/ExportRow";
import {
  accountPageQuery,
  requestDeletionFn,
  requestEmailChangeFn,
  requestExportFn,
  resendConfirmationFn,
} from "../../modules/account/functions";
import {
  ACCOUNT_SECTION_TITLES,
  accountSectionOrNotFound,
  accountSectionSearch,
  DELETE_REAUTH_RETURN,
} from "../../modules/account/route-decisions";
import { ChangePassword } from "../../modules/auth/components/ChangePassword";
import { SignOutButton } from "../../modules/auth/components/SignOutButton";
import {
  changePassword,
  signOutEverywhere,
} from "../../modules/auth/credentials";
import { requireSession } from "../../modules/auth/functions";
import {
  GoogleButton,
  useGoogleSignIn,
} from "../../modules/auth/google-button";
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
  validateSearch: accountSectionSearch,
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
  const search = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate();
  // ACC-9's re-authentication for an account made with Google: a fresh
  // sign-in, back to this page with the delete sheet open again.
  const google = useGoogleSignIn({
    callbackURL: DELETE_REAUTH_RETURN,
    errorCallbackURL: DELETE_REAUTH_RETURN,
    returnedError: undefined,
    leave: (url) => {
      globalThis.location.assign(url);
    },
  });

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
              dataExport={
                <ExportRow
                  state={page.dataExport}
                  isLinkDead={search.export === "expired"}
                  request={requestExportFn}
                  onRequested={() => router.invalidate()}
                />
              }
              deletion={
                <DeleteAccount
                  hasPassword={page.account.hasPassword}
                  request={requestDeletionFn}
                  reauth={<GoogleButton google={google} />}
                  isReturningFromGoogle={search.deleting === true}
                  onScheduled={async (purgeAfter) => {
                    await router.invalidate();
                    await navigate({
                      to: "/account/leaving",
                      search: { on: purgeAfter },
                    });
                  }}
                />
              }
            />
          ),
          email: (
            <ChangeEmail
              current={page.account.email}
              request={requestEmailChangeFn}
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
