import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { RunnerSearch } from "../../modules/feed/components/RunnerSearch";
import { searchQuery } from "../../modules/feed/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { Layout } from "../../ui";

export const Route = createFileRoute("/feed/search")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  component: SearchPage,
});

function SearchPage() {
  return (
    <Layout>
      <RunnerSearch search={searchQuery} />
    </Layout>
  );
}
