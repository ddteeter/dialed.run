import { createFileRoute, Link } from "@tanstack/react-router";

import { requireSession } from "../../modules/auth/functions";
import { ClosetGrid } from "../../modules/closet/components/ClosetGrid";
import { listItemsFn } from "../../modules/closet/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/closet/")({
  // `?retired=1` opens with retired items shown. Set when arriving from a
  // retire action, so the item is visibly present and marked rather than
  // absent from a grid that hides retired items by default.
  // `?retired=true` opens with retired items shown. TanStack parses search
  // values as JSON, so the boolean we navigate with round-trips as a
  // boolean — there is no string form to accept.
  //
  // Optional, because every other link to /closet omits it and requiring
  // the param would make each of those a type error.
  validateSearch: (search: Record<string, unknown>): { retired?: true } =>
    search.retired === true ? { retired: true } : {},
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
      <div className="flex items-center justify-between px-4 pt-6 sm:px-6">
        <h1 className="font-display text-2xl uppercase tracking-[-0.01em]">
          The Closet
        </h1>
        <Link
          to="/closet/new"
          className="rounded-md bg-night px-3 py-1.5 text-sm font-semibold text-chalk"
        >
          Add
        </Link>
      </div>
      <ClosetGrid listing={listing} initialShowRetired={search.retired ?? false} />
    </Layout>
  );
}
