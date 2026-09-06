import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { ClosetGrid } from "../../modules/closet/components/ClosetGrid";
import { listItemsFn } from "../../modules/closet/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/closet/")({
  loader: async () => {
    const session = await getSession();
    if (!session) {
      redirect({ to: "/auth/login", throw: true });
    }
    const listing = await listItemsFn({ data: { includeRetired: true } });
    return { listing };
  },
  component: ClosetPage,
});

function ClosetPage() {
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
      <ClosetGrid listing={listing} />
    </Layout>
  );
}
