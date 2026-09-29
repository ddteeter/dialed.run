import { createFileRoute } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { ClosetGrid } from "../../modules/closet/components/ClosetGrid";
import { listItemsFn } from "../../modules/closet/functions";
import { closetSearch } from "../../modules/closet/inputs";
import { Layout } from "../../ui";

export const Route = createFileRoute("/closet/")({
  // `?retired=true` after a retire, `?deleted=` after a delete: both
  // optional, so every other link to /closet omits them.
  validateSearch: closetSearch,
  loader: async () => {
    await requireSession();
    const listing = await listItemsFn({ data: { includeRetired: true } });
    return { listing };
  },
  component: ClosetPage,
});

function ClosetPage() {
  const search = Route.useSearch();
  const { listing } = Route.useLoaderData();
  return (
    <Layout>
      <ClosetGrid
        listing={listing}
        initialShowRetired={search.retired}
        deleted={search.deleted}
      />
    </Layout>
  );
}
