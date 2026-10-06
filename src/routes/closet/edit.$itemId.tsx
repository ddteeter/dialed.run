import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { BackToCloset } from "../../modules/closet/components/BackToCloset";
import { GarmentForm } from "../../modules/closet/components/GarmentForm";
import { formValuesFromItem } from "../../modules/closet/form-mapping";
import { photoUrlFor } from "../../modules/closet/photo-url";
import {
  getItemFn,
  removePhotoFn,
  updateItemFn,
  uploadPhotoFn,
} from "../../modules/closet/functions";
import { photoBlurStep } from "../../modules/safety/components/PhotoBlur";
import { searchBrandsFn } from "../../modules/products/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/closet/edit/$itemId")({
  loader: async ({ params, location }) => {
    await requireSession(location);
    const detail = await getItemFn({ data: { itemId: params.itemId } });
    return { detail };
  },
  component: EditGarmentPage,
});

async function handleBrandInput(prefix: string) {
  await searchBrandsFn({ data: { prefix } });
}

function EditGarmentPage() {
  const { detail } = Route.useLoaderData();
  const navigate = useNavigate();

  return (
    <Layout>
      <GarmentForm
        heading={`Edit ${detail.item.name}`}
        back={<BackToCloset />}
        initial={formValuesFromItem(detail.item, detail.effective)}
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
    </Layout>
  );
}
