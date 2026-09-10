import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { GarmentForm } from "../../modules/closet/components/GarmentForm";
import { formValuesFromItem } from "../../modules/closet/form-mapping";
import { getItemFn, updateItemFn } from "../../modules/closet/functions";
import { searchBrandsFn } from "../../modules/products/functions";
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

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl uppercase tracking-[-0.01em]">
          Edit piece
        </h1>
        <GarmentForm
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
          submitLabel="Save changes"
          pendingLabel="Saving"
          successMessage="Changes saved."
        />
      </div>
    </Layout>
  );
}
