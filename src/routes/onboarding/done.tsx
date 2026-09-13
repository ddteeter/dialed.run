import { createFileRoute } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { NowGoRun } from "../../modules/onboarding/components/NowGoRun";
import { completeOnboardingFn } from "../../modules/onboarding/functions";
import { Page } from "../../ui";

/**
 * Screen P3, and the only place `onboarding_complete` flips.
 *
 * The write is in the loader because *arriving here* is what finishing
 * means — there is no button on this screen whose job is to end
 * onboarding, and design deliberately gave it none. Re-entering the route
 * is harmless: the write is an upsert keyed by the user, so it is
 * idempotent by construction rather than by a guard (law 8b).
 */
export const Route = createFileRoute("/onboarding/done")({
  loader: async () => {
    await requireSession();
    await completeOnboardingFn();
  },
  component: DonePage,
});

function DonePage() {
  return (
    <Page width="narrow">
      <NowGoRun />
    </Page>
  );
}
