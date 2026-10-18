import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { ManualRunForm } from "../../modules/runs/components/ManualRunForm";
import { submitManualRun } from "../../modules/runs/functions";
import { Page } from "../../ui";

// fallow-ignore-next-line code-duplication -- two routes of the same kind are the same shape by mandate: createFileRoute + loader + useLoaderData + shell is exactly what server-functions-are-glue requires, and the branching that would make them differ is what it forbids
export const Route = createFileRoute("/runs/manual")({
  loader: async () => ({ bell: await bellStateFn() }),
  component: ManualRunPage,
});

function ManualRunPage() {
  const { bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <Page title="Log a run" width="panel">
        <ManualRunForm submitRun={submitManualRun} />
      </Page>
    </BelledLayout>
  );
}
