import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { BackToCloset } from "../../modules/closet/components/BackToCloset";
import { GarmentForm } from "../../modules/closet/components/GarmentForm";
import {
  closetNearbyFn,
  createItemFn,
  removePhotoFn,
  uploadPhotoFn,
} from "../../modules/closet/functions";
import { photoBlurStep } from "../../modules/safety/components/PhotoBlur";
import { searchBrandsFn } from "../../modules/products/functions";
import { Layout, useIdempotencyKey } from "../../ui";

export const Route = createFileRoute("/closet/new")({
  loader: async () => {
    await requireSession();
    // F at the desk's rail card (round 26 #10, task 128 · SAF-18).
    return { nearby: await closetNearbyFn() };
  },
  component: NewGarmentPage,
});

async function handleBrandInput(prefix: string) {
  await searchBrandsFn({ data: { prefix } });
}

function NewGarmentPage() {
  const navigate = useNavigate();
  const { idempotencyKey, rotate } = useIdempotencyKey();
  const { nearby } = Route.useLoaderData();

  return (
    <Layout>
      <GarmentForm
        heading="Add a garment"
        back={<BackToCloset />}
        nearby={nearby}
        save={async (garment) =>
          createItemFn({ data: { garment, idempotencyKey } })
        }
        onSaved={async (created) => {
          rotate();
          await navigate({
            to: "/closet/$itemId",
            params: { itemId: created.id },
          });
        }}
        onBrandInput={(value) => {
          void handleBrandInput(value);
        }}
        submitLabel="Add to closet"
        pendingLabel="Adding"
        successMessage="Added to your closet."
        photo={{
          upload: uploadPhotoFn,
          remove: removePhotoFn,
          renderStep: photoBlurStep,
        }}
      />
    </Layout>
  );
}
