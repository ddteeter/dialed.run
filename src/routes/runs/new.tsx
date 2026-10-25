import { Link, createFileRoute } from "@tanstack/react-router";

import { viewerUnitsQuery } from "../../modules/feed/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { UploadForm } from "../../modules/runs/components/UploadForm";
import {
  getGarminPickerFn,
  getImportOutcomeFn,
  importGarminActivityFn,
  garminImportEnabledFn,
  retimeRunFn,
  startFileImport,
} from "../../modules/runs/functions";
import { AddRunShell } from "../../modules/runs/components/AddRunShell";

/**
Screen A1: upload & auto-conditions (docs/product.md). Every outcome — the
parsed card, a duplicate's receipt, a parse failure, a stall — renders here,
in place; nothing navigates while a file is read (round 22).
*/
export const Route = createFileRoute("/runs/new")({
  // D-102's name for the page, in round 30 #4b's words.
  staticData: { savedPage: "Log a run" },
  // fallow-ignore-next-line code-duplication -- two signed-in routes with a Promise.all loader and a BelledLayout shell are the same route shape by mandate: createFileRoute + loader + useLoaderData + shell is exactly what server-functions-are-glue requires a route to be, and the branching that would make them differ is what it forbids
  loader: async () => {
    const [units, bell, hasGarmin] = await Promise.all([
      viewerUnitsQuery(),
      bellStateFn(),
      // Plan 152: the owner's alone; the list itself loads after A1 renders.
      garminImportEnabledFn(),
    ]);
    return { units, bell, hasGarmin };
  },
  component: NewRunPage,
});

function NewRunPage() {
  const { units, bell, hasGarmin } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <AddRunShell>
        <UploadForm
          upload={startFileImport}
          getOutcome={getImportOutcomeFn}
          retime={retimeRunFn}
          units={units}
          garmin={
            hasGarmin
              ? {
                  picker: getGarminPickerFn,
                  importActivity: importGarminActivityFn,
                }
              : undefined
          }
        />
        <p className="text-center text-small text-muted desk:max-w-column">
          No file?{" "}
          <Link
            to="/runs/manual"
            data-target="inline"
            className="font-semibold text-cold-text"
          >
            Enter the run by hand
          </Link>{" "}
          instead.
        </p>
      </AddRunShell>
    </BelledLayout>
  );
}
