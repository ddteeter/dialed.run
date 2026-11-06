import { createFileRoute, useLocation } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { ClosetGrid } from "../../modules/closet/components/ClosetGrid";
import { listItemsFn } from "../../modules/closet/functions";
import { closetSearch } from "../../modules/closet/inputs";
import { viewerUnitsQuery } from "../../modules/feed/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/closet/")({
  // `?retired=true` after a retire, optional so every other link to
  // /closet omits it, and the rail's filters (R-94). A delete's landing
  // rides history state instead.
  validateSearch: closetSearch,
  loader: async ({ location }) => {
    await requireSession(location);
    const [listing, units] = await Promise.all([
      listItemsFn({ data: { includeRetired: true } }),
      viewerUnitsQuery(),
    ]);
    return { listing, units };
  },
  component: ClosetPage,
});

function ClosetPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { listing, units } = Route.useLoaderData();
  // Round 26 #3's "{name} deleted.", from the navigation the delete made:
  // history state, which a link cannot carry (task 128, PR #129 review).
  const deleted = useLocation({
    select: (location) => location.state.deletedGarment,
  });
  return (
    <Layout>
      <ClosetGrid
        listing={listing}
        tempUnit={units.temp}
        initialShowRetired={search.retired}
        search={search}
        // WORKS AT once hydrated: the asked ends, in Celsius, replace the
        // old ones and keep every other filter.
        onWorksAt={(range) => {
          void navigate({
            search: (previous) => ({
              ...previous,
              from: range.from,
              to: range.to,
            }),
          });
        }}
        deleted={deleted}
      />
    </Layout>
  );
}
