import { createFileRoute } from "@tanstack/react-router";

import { DeskPage } from "../../modules/ops/components/DeskPage";
import { DeskDuplicates } from "../../modules/safety/components/DeskDuplicates";
import { deskDuplicatesQuery } from "../../modules/safety/functions";

/**
 * Desk D2 · Duplicates (task 110): the read-only report of product names
 * that are probably one product (D-30). Behind `/desk`'s not-found gate
 * like every page under it; the server function checks again.
 */
export const Route = createFileRoute("/desk/duplicates")({
  loader: async () => deskDuplicatesQuery(),
  component: DuplicatesPage,
});

function DuplicatesPage() {
  return (
    <DeskPage current="duplicates">
      <DeskDuplicates report={Route.useLoaderData()} />
    </DeskPage>
  );
}
