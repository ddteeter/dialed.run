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
import { garmentLoader } from "../../modules/closet/garment-page";
import {
  garmentBandCountQuery,
  viewerUnitsQuery,
} from "../../modules/feed/functions";
import {
  correctionContextFn,
  fileCorrectionFn,
} from "../../modules/products/functions";
import { PhotoBeingChecked } from "../../modules/safety/components/NoticeBand";
import { photoBlurStep } from "../../modules/safety/components/PhotoBlur";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";

export const Route = createFileRoute("/closet/$itemId")({
  loader: garmentLoader(
    requireSession,
    (itemId) => getItemFn({ data: { itemId } }),
    viewerUnitsQuery,
    bellStateFn,
  ),
  component: GarmentDetailPage,
});

const CORRECTION = {
  loadContext: correctionContextFn,
  fileCorrection: fileCorrectionFn,
};

function GarmentDetailPage() {
  const { detail, units, bell } = Route.useLoaderData();
  return (
    <BelledLayout {...bell}>
      <GarmentDetail
        detail={detail}
        units={units}
        // Feed's (the band is the run's weather), asked for by round 26's
        // delete sheet when it opens — never with the page (task 128).
        bandCount={garmentBandCountQuery}
        retire={retireItemFn}
        unretire={unretireItemFn}
        remove={deleteItemFn}
        uploadPhoto={uploadPhotoFn}
        removePhoto={removePhotoFn}
        renderPhotoStep={photoBlurStep}
        photoChecking={<PhotoBeingChecked />}
        // §AG's WRONG? sheet (R-74): asked for only when it opens.
        correction={CORRECTION}
      />
    </BelledLayout>
  );
}
