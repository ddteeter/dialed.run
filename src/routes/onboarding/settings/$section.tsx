import { createFileRoute } from "@tanstack/react-router";

import { requireSession } from "../../../modules/auth/functions";
import { BelledLayout } from "../../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../../modules/notifications/functions";
import { SettingsSectionPage } from "../../../modules/onboarding/components/SettingsSubPage";
import {
  saveSharingFn,
  saveUnitsFn,
  setCountInTotalsFn,
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
    const session = await requireSession(location);
    const section = settingsSectionOrNotFound(params.section);
    return {
      section,
      // Whether the address is confirmed picks the totals switch's lines
      // (round 38 #61d); the session it already read says so.
      isVerified: session.user.emailVerified,
      ...(await settingsSubPageData(bellStateFn())),
    };
  },
  component: SectionPage,
});

function SectionPage() {
  const { section, current, isVerified, bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <SettingsSectionPage
        section={section}
        current={current}
        isVerified={isVerified}
        saveUnits={saveUnitsFn}
        saveSharing={saveSharingFn}
        saveCountInTotals={setCountInTotalsFn}
      />
    </BelledLayout>
  );
}
