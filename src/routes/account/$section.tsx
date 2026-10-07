import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import {
  AccountUnlessBehindOnTerms,
  AccountWhileBehind,
} from "../../modules/account/components/AccountWhileBehind";
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
 * An unknown section is X1. Behind on the terms, U1 is read only, with
 * Sign out everywhere, Get a copy and Delete account live (round 30 #4a;
 * D-95); the root's gate keeps the other sections closed.
 */
export const Route = createFileRoute("/account/$section")({
  validateSearch: accountSectionSearch,
  loader: async ({ params, location }) => {
    // Signed in first: a signed-out visitor to a bad section is sent to
    // log in, not told the page does not exist.
    await requireSession(location);
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

  // The three U1 keeps live while the runner is behind on the terms, so
  // both pages get the same ones.
  const signOutEverywhereButton = (
    <SignOutButton
      isEverywhere
      signOut={async () => {
        await signOutEverywhere();
        await router.invalidate();
        await navigate({ to: "/" });
      }}
    />
  );
  const exportRow = (
    <ExportRow
      state={page.dataExport}
      isLinkDead={search.export === "expired"}
      request={requestExportFn}
      onRequested={() => router.invalidate()}
    />
  );
  const deletion = (
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
  );

  const pages = {
    "sign-in": (
      <AccountUnlessBehindOnTerms
        isBehind={page.isBehindOnTerms}
        behind={
          <AccountWhileBehind
            account={page.account}
            username={page.username}
            isStravaConnected={page.isStravaConnected}
            signOutEverywhere={signOutEverywhereButton}
            dataExport={exportRow}
            deletion={deletion}
          />
        }
      >
        <AccountIndex
          account={page.account}
          username={page.username}
          confirmBand={
            <ConfirmEmailBand
              account={page.account}
              resend={resendConfirmationFn}
            />
          }
          signOutEverywhere={signOutEverywhereButton}
          dataExport={exportRow}
          deletion={deletion}
        />
      </AccountUnlessBehindOnTerms>
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
  };

  return (
    <AccountUnlessBehindOnTerms
      isBehind={page.isBehindOnTerms}
      behind={
        // Round 30 #4a: no tab bar, and back goes to the gate.
        <PickedSubPage
          section={section}
          titles={ACCOUNT_SECTION_TITLES}
          pages={pages}
          back="terms"
        />
      }
    >
      <BelledLayout unreadCount={unreadCount}>
        <PickedSubPage
          section={section}
          titles={ACCOUNT_SECTION_TITLES}
          pages={pages}
        />
      </BelledLayout>
    </AccountUnlessBehindOnTerms>
  );
}
