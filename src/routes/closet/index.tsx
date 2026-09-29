import { createFileRoute, useLocation } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { ClosetGrid } from "../../modules/closet/components/ClosetGrid";
import { listItemsFn } from "../../modules/closet/functions";
import { closetSearch } from "../../modules/closet/inputs";
import { Layout } from "../../ui";

export const Route = createFileRoute("/closet/")({
  // `?retired=true` after a retire, optional so every other link to
  // /closet omits it. A delete's landing rides history state instead.
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
  // Round 26 #3's "{name} deleted.", from the navigation the delete made:
  // history state, which a link cannot carry (task 128, PR #129 review).
  const deleted = useLocation({
    select: (location) => location.state.deletedGarment,
  });
  return (
    <Layout>
      <ClosetGrid
        listing={listing}
        initialShowRetired={search.retired}
        deleted={deleted}
      />
    </Layout>
  );
}
