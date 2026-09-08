import { createFileRoute, useNavigate } from "@tanstack/react-router";

import type { Garment } from "../../lib/contracts";
import { requireSession } from "../../modules/auth/functions";
import type { GarmentFormValues } from "../../modules/closet/components/GarmentForm";
import { GarmentForm } from "../../modules/closet/components/GarmentForm";
import { createItemFn } from "../../modules/closet/functions";
import {
  resolveProductFn,
  searchBrandsFn,
} from "../../modules/products/functions";
import { Layout } from "../../ui";
import { garmentFromFormValues } from "../../modules/closet/form-mapping";

export const Route = createFileRoute("/closet/new")({
  loader: async () => {
    await requireSession();
    return {};
  },
  component: NewGarmentPage,
});

async function handleBrandInput(prefix: string) {
  await searchBrandsFn({ data: { prefix } });
}

function NewGarmentPage() {
  const navigate = useNavigate();

  async function handleSubmit(values: GarmentFormValues) {
    let garment: Garment = garmentFromFormValues(values);

    // Identity-first (D-27): resolving brand+model links product_id and
    // pre-fills product attributes the garment's own columns don't set.
    // Deferred until lane 107 merges: once enrichment lands, a pasted
    // productUrl should also call enrichment.requestEnrichment(productId,
    // url) here — saving never waits on it either way.
    if (values.brand.trim() !== "" && values.name.trim() !== "") {
      const { product } = await resolveProductFn({
        data: {
          brandName: values.brand,
          productName: values.name,
          sourceUrl: values.productUrl === "" ? undefined : values.productUrl,
        },
      });
      garment = { ...garment, productId: product.id };
    }

    const created = await createItemFn({ data: garment });
    await navigate({ to: "/closet/$itemId", params: { itemId: created.id } });
  }

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl uppercase tracking-[-0.01em]">
          Add a piece
        </h1>
        <GarmentForm
          onSubmit={(values) => {
            void handleSubmit(values);
          }}
          onBrandInput={(value) => {
            void handleBrandInput(value);
          }}
          submitLabel="Add to closet"
        />
      </div>
    </Layout>
  );
}
