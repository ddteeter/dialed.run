import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { CalibrateForm } from "../../modules/onboarding/components/CalibrateForm";
import {
  localeUnitsQuery,
  saveCalibrationFn,
} from "../../modules/onboarding/functions";
import { geolocate } from "../../modules/onboarding/geolocate";
import { Page } from "../../ui";

/**
 * Screen O1. No `Layout`: onboarding is a flow rather than a tab, and a
 * tab bar here offers four ways out of a two-minute path.
 */
// fallow-ignore-next-line code-duplication -- two steps of one flow are the same route by mandate: createFileRoute + requireSession + one loader call + Page + a component, which is exactly what server-functions-are-glue requires a route to be, and the branching that would make them differ is what it forbids
export const Route = createFileRoute("/onboarding/calibrate")({
  loader: async () => {
    await requireSession();
    return { defaults: await localeUnitsQuery() };
  },
  component: CalibratePage,
});

function CalibratePage() {
  const { defaults } = Route.useLoaderData();
  const navigate = useNavigate();

  return (
    <Page title="One question does most of the work" width="narrow">
      <CalibrateForm
        defaults={defaults}
        locate={geolocate}
        saveCalibration={saveCalibrationFn}
        onSaved={() => {
          void navigate({ to: "/onboarding/taplist" });
        }}
      />
    </Page>
  );
}
