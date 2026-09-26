import { createFileRoute } from "@tanstack/react-router";

import { requireSession } from "../../../modules/auth/functions";
import { BelledLayout } from "../../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../../modules/notifications/functions";
import { SettingsSectionPage } from "../../../modules/onboarding/components/SettingsSubPage";
import {
  saveSharingFn,
  saveUnitsFn,
  settingsSubPageData,
} from "../../../modules/onboarding/functions";
import { settingsSectionOrNotFound } from "../../../modules/onboarding/route-decisions";

/**
 * A settings sub-page — Units or Privacy — each its own small form with
 * its own Save (round 22, item 20). An unknown section is X1.
 */
export const Route = createFileRoute("/onboarding/settings/$section")({
  loader: async ({ params, location }) => {
    // Signed in first: a signed-out visitor to a bad section is sent to
    // log in, not told the page does not exist.
    await requireSession(location.href);
    const section = settingsSectionOrNotFound(params.section);
    return {
      section,
      ...(await settingsSubPageData(unreadNotificationCountFn())),
    };
  },
  component: SectionPage,
});

function SectionPage() {
  const { section, current, unreadCount } = Route.useLoaderData();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <SettingsSectionPage
        section={section}
        current={current}
        saveUnits={saveUnitsFn}
        saveSharing={saveSharingFn}
      />
    </BelledLayout>
  );
}
