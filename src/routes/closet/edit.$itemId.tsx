import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import type { GarmentFormValues } from "../../modules/closet/components/GarmentForm";
import { GarmentForm } from "../../modules/closet/components/GarmentForm";
import {
  formValuesFromItem,
  garmentWithResolvedProduct,
} from "../../modules/closet/form-mapping";
import { getItemFn, updateItemFn } from "../../modules/closet/functions";
import {
  resolveProductFn,
  searchBrandsFn,
} from "../../modules/products/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/closet/edit/$itemId")({
  loader: async ({ params }) => {
    await requireSession();
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

  async function handleSubmit(values: GarmentFormValues) {
    const garment = await garmentWithResolvedProduct(values, resolveProductFn);

    await updateItemFn({ data: { itemId: detail.item.id, garment } });
    await navigate({
      to: "/closet/$itemId",
      params: { itemId: detail.item.id },
    });
  }

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl uppercase tracking-[-0.01em]">
          Edit piece
        </h1>
        <GarmentForm
          initial={formValuesFromItem(detail.item, detail.effective)}
          onSubmit={(values) => {
            void handleSubmit(values);
          }}
          onBrandInput={(value) => {
            void handleBrandInput(value);
          }}
          submitLabel="Save changes"
        />
      </div>
    </Layout>
  );
}
