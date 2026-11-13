import { createFileRoute, useLocation } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { ClosetGrid } from "../../modules/closet/components/ClosetGrid";
import { listItemsFn } from "../../modules/closet/functions";
import { closetSearch } from "../../modules/closet/inputs";
import { viewerUnitsQuery } from "../../modules/feed/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";

export const Route = createFileRoute("/closet/")({
  staticData: { title: "Closet" },
  // `?retired=true` after a retire, optional so every other link to
  // /closet omits it, and the rail's filters (R-94). A delete's landing
  // rides history state instead.
  validateSearch: closetSearch,
  loader: async ({ location }) => {
    await requireSession(location);
    const [listing, units, bell] = await Promise.all([
      listItemsFn({ data: { includeRetired: true } }),
      viewerUnitsQuery(),
      bellStateFn(),
    ]);
    return { listing, units, bell };
  },
  component: ClosetPage,
});

function ClosetPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { listing, units, bell } = Route.useLoaderData();
  // Round 26 #3's "{name} deleted.", from the navigation the delete made:
  // history state, which a link cannot carry (task 128, PR #129 review).
  const deleted = useLocation({
    select: (location) => location.state.deletedGarment,
  });
  return (
    <BelledLayout {...bell}>
      <ClosetGrid
        listing={listing}
        tempUnit={units.temp}
        distanceUnit={units.distance}
        initialShowRetired={search.retired}
        search={search}
        // The rail once hydrated: its whole next search.
        onSearch={(next) => {
          void navigate({ search: next });
        }}
        deleted={deleted}
      />
    </BelledLayout>
  );
}
