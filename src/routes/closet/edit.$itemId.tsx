import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { BackToCloset } from "../../modules/closet/components/BackToCloset";
import { GarmentForm } from "../../modules/closet/components/GarmentForm";
import {
  formValuesFromItem,
  productPlaceholders,
  storedLinkErrors,
} from "../../modules/closet/form-mapping";
import { photoUrlFor } from "../../modules/closet/photo-url";
import {
  getItemFn,
  removePhotoFn,
  updateItemFn,
  uploadPhotoFn,
} from "../../modules/closet/functions";
import { garmentLoader } from "../../modules/closet/garment-page";
import { viewerUnitsQuery } from "../../modules/feed/functions";
import { photoBlurStep } from "../../modules/safety/components/PhotoBlur";
import { searchBrandsFn } from "../../modules/products/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";

export const Route = createFileRoute("/closet/edit/$itemId")({
  loader: garmentLoader(
    requireSession,
    (itemId) => getItemFn({ data: { itemId } }),
    viewerUnitsQuery,
    bellStateFn,
  ),
  component: EditGarmentPage,
});

async function handleBrandInput(prefix: string) {
  await searchBrandsFn({ data: { prefix } });
}

function EditGarmentPage() {
  const { detail, units, bell } = Route.useLoaderData();
  const navigate = useNavigate();

  return (
    <BelledLayout {...bell}>
      <GarmentForm
        heading={`Edit ${detail.item.name}`}
        tempUnit={units.temp}
        back={<BackToCloset />}
        initial={formValuesFromItem(detail.item, detail.effective)}
        stored={{
          errors: storedLinkErrors(detail.item, detail.linkDetail),
          placeholders: productPlaceholders(detail.item, detail.effective),
        }}
        save={async (garment) =>
          updateItemFn({ data: { itemId: detail.item.id, garment } })
        }
        onSaved={async () => {
          await navigate({
            to: "/closet/$itemId",
            params: { itemId: detail.item.id },
          });
        }}
        onBrandInput={(value) => {
          void handleBrandInput(value);
        }}
        submitLabel="Save"
        pendingLabel="Saving"
        successMessage="Changes saved."
        photo={{
          url: photoUrlFor(detail.item),
          upload: uploadPhotoFn,
          remove: removePhotoFn,
          renderStep: photoBlurStep,
        }}
      />
    </BelledLayout>
  );
}
