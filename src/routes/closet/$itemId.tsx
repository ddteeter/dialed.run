import { createFileRoute } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { GarmentDetail } from "../../modules/closet/components/GarmentDetail";
import {
  deleteItemFn,
  getItemFn,
  retireItemFn,
  unretireItemFn,
  uploadPhotoFn,
} from "../../modules/closet/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/closet/$itemId")({
  loader: async ({ params }) => {
    await requireSession();
    return { detail: await getItemFn({ data: { itemId: params.itemId } }) };
  },
  component: GarmentDetailPage,
});

function GarmentDetailPage() {
  return (
    <Layout>
      <GarmentDetail
        detail={Route.useLoaderData().detail}
        retire={retireItemFn}
        unretire={unretireItemFn}
        remove={deleteItemFn}
        uploadPhoto={uploadPhotoFn}
      />
    </Layout>
  );
}
