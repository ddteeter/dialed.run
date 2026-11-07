import { createFileRoute } from "@tanstack/react-router";

import { DeskPage } from "../../modules/ops/components/DeskPage";
import { DeskCorrections } from "../../modules/safety/components/DeskCorrections";
import {
  applyCorrectionFn,
  declineCorrectionFn,
  deskCorrectionsQuery,
} from "../../modules/safety/functions";

/**
 * Desk · Corrections (D-163, R48·130): runners' corrections to shared
 * products, to apply or decline. Behind `/desk`'s not-found gate like
 * every page under it; each server function checks again.
 */
export const Route = createFileRoute("/desk/corrections")({
  loader: async () => deskCorrectionsQuery(),
  component: CorrectionsPage,
});

function CorrectionsPage() {
  return (
    <DeskPage current="corrections">
      <DeskCorrections
        queue={Route.useLoaderData()}
        apply={applyCorrectionFn}
        decline={declineCorrectionFn}
      />
    </DeskPage>
  );
}
