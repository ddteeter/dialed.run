import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { CalibrateForm } from "../../modules/onboarding/components/CalibrateForm";
import {
  localeUnitsQuery,
  saveCalibrationFn,
  lookUpCityFn,
} from "../../modules/onboarding/functions";
import { geolocate } from "../../modules/onboarding/geolocate";
import { OnboardingProgress, OnboardingShell, Page } from "../../ui";

/**
 * Screen O1. No `Layout`: onboarding is a flow rather than a tab, and a
 * tab bar here offers four ways out of a two-minute path. Each step wears
 * `OnboardingShell` instead: its `<main>`, and from 1040 up a bar with
 * only the wordmark (R49·138).
 */
// fallow-ignore-next-line code-duplication -- two steps of one flow are the same route by mandate: createFileRoute + requireSession + one loader call + Page + a component, which is exactly what server-functions-are-glue requires a route to be, and the branching that would make them differ is what it forbids
export const Route = createFileRoute("/onboarding/calibrate")({
  loader: async ({ location }) => {
    await requireSession(location);
    return { defaults: await localeUnitsQuery() };
  },
  component: CalibratePage,
});

function CalibratePage() {
  const { defaults } = Route.useLoaderData();
  const navigate = useNavigate();

  return (
    <OnboardingShell>
      <Page
        title="One question does most of the work"
        kicker={<OnboardingProgress at="city" />}
        width="step"
      >
        <CalibrateForm
          defaults={defaults}
          locate={geolocate}
          lookUpCity={lookUpCityFn}
          saveCalibration={saveCalibrationFn}
          onSaved={() => {
            void navigate({ to: "/onboarding/taplist" });
          }}
        />
      </Page>
    </OnboardingShell>
  );
}
