import { createFileRoute } from "@tanstack/react-router";

import { DeskPage } from "../../modules/ops/components/DeskPage";
import { DeskKit } from "../../modules/safety/components/DeskKit";
import { deskKitQuery } from "../../modules/safety/functions";
import { kitOriginSchema } from "../../modules/safety/components/kit-origin";

/**
 * The Desk's view of a kit (R-154, #388): where Review's other photos and
 * matches, and a removal request's "Open the kit", lead. Under Review in
 * the rail, since that is where an operator comes from. Behind `/desk`'s
 * not-found gate like every page under it; the server function checks
 * again. The search says which row the operator came from, so the back
 * link can name it and return there (Round 51 · 153).
 */
export const Route = createFileRoute("/desk/kit/$entryId")({
  validateSearch: kitOriginSchema,
  loader: async ({ params }) =>
    deskKitQuery({ data: { entryId: params.entryId } }),
  component: KitPage,
});

function KitPage() {
  return (
    <DeskPage current="review">
      <DeskKit kit={Route.useLoaderData()} origin={Route.useSearch()} />
    </DeskPage>
  );
}
