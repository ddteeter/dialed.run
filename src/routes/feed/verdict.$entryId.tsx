import { createFileRoute } from "@tanstack/react-router";

import { PhotoBlur } from "../../modules/safety/components/PhotoBlur";

import { bandFloorC } from "../../lib/temperature";
import { getSession } from "../../modules/auth/functions";
import { VerdictForm } from "../../modules/feed/components/VerdictForm";
import { bandContextFor } from "../../modules/feed/route-decisions";
import {
  entryDetailQuery,
  itemBandWearStatQuery,
  submitVerdictAction,
  uploadPhotoAction,
  verdictBandCountsQuery,
  viewerUnitsQuery,
} from "../../modules/feed/functions";
import { orBackToFeed, requireSignedIn } from "../../modules/feed/redirect";
import { Layout } from "../../ui";

export const Route = createFileRoute("/feed/verdict/$entryId")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async ({ params }) => {
    const entry = orBackToFeed(
      await entryDetailQuery({ data: { entryId: params.entryId } }),
    );
    return {
      entry,
      units: await viewerUnitsQuery(),
      ...(await bandContextFor(entry, bandFloorC, async (bandFloor) =>
        verdictBandCountsQuery({
          data: { bandFloorC: bandFloor, excludeEntryId: params.entryId },
        }),
      )),
    };
  },
  component: VerdictPage,
});

function VerdictPage() {
  const { entry, bandFloor, bandCounts, units } = Route.useLoaderData();

  return (
    <Layout>
      <VerdictForm
        entry={entry}
        bandFloor={bandFloor}
        bandCounts={bandCounts}
        units={units}
        submitVerdict={submitVerdictAction}
        uploadPhoto={uploadPhotoAction}
        renderPhotoStep={(file, onReady, announce) => (
          <PhotoBlur file={file} onReady={onReady} onAnnounce={announce} />
        )}
        itemBandWearStat={itemBandWearStatQuery}
      />
    </Layout>
  );
}
