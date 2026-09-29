import { createFileRoute } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { GarmentDetail } from "../../modules/closet/components/GarmentDetail";
import {
  deleteItemFn,
  getItemFn,
  removePhotoFn,
  retireItemFn,
  unretireItemFn,
  uploadPhotoFn,
} from "../../modules/closet/functions";
import { garmentBandCountQuery } from "../../modules/feed/functions";
import { PhotoBeingChecked } from "../../modules/safety/components/NoticeBand";
import { photoBlurStep } from "../../modules/safety/components/PhotoBlur";
import { Layout } from "../../ui";

export const Route = createFileRoute("/closet/$itemId")({
  loader: async ({ params }) => {
    await requireSession();
    // The band count is feed's (the band is the run's weather), so it is
    // composed here for round 26's delete sheet (task 128 · SAF-16).
    const [detail, bandCount] = await Promise.all([
      getItemFn({ data: { itemId: params.itemId } }),
      garmentBandCountQuery({ data: { itemId: params.itemId } }),
    ]);
    return { detail, bandCount };
  },
  component: GarmentDetailPage,
});

function GarmentDetailPage() {
  const { detail, bandCount } = Route.useLoaderData();
  return (
    <Layout>
      <GarmentDetail
        detail={detail}
        bandCount={bandCount}
        retire={retireItemFn}
        unretire={unretireItemFn}
        remove={deleteItemFn}
        uploadPhoto={uploadPhotoFn}
        removePhoto={removePhotoFn}
        renderPhotoStep={photoBlurStep}
        photoChecking={<PhotoBeingChecked />}
      />
    </Layout>
  );
}
