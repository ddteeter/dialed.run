import { createFileRoute } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { SettingsForm } from "../../modules/onboarding/components/SettingsForm";
import {
  savePreferencesFn,
  settingsQuery,
} from "../../modules/onboarding/functions";
import { Page } from "../../ui";

/**
 * The first settings surface (design U1), holding the three rows this
 * packet owns. The rest of U1 — account, privacy, blocked runners,
 * notifications, connections, export, delete — belongs to other lanes and
 * to D-32, and this page is where they will join.
 */
export const Route = createFileRoute("/onboarding/settings")({
  loader: async () => {
    await requireSession();
    return { current: await settingsQuery() };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { current } = Route.useLoaderData();

  return (
    <Page title="Settings" width="narrow">
      <SettingsForm current={current} savePreferences={savePreferencesFn} />
    </Page>
  );
}
