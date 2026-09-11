import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { GarmentForm } from "../../modules/closet/components/GarmentForm";
import { createItemFn } from "../../modules/closet/functions";
import { searchBrandsFn } from "../../modules/products/functions";
import { Layout, useIdempotencyKey } from "../../ui";

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
  const { idempotencyKey, rotate } = useIdempotencyKey();

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl uppercase tracking-[-0.01em]">
          Add a piece
        </h1>
        <GarmentForm
          save={async (garment) => createItemFn({ data: { garment, idempotencyKey } })}
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
        />
      </div>
    </Layout>
  );
}
