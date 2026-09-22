import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
// Deep-imported, NOT via `modules/safety`'s barrel. The barrel reaches
// blocks.ts -> db/schema-core -> drizzle and src/env -> cloudflare:workers,
// and a route is in the client bundle: importing it here failed the build
// outright (CLAUDE.md's worked example) and put drizzle in the browser
// chunk. Every other route deep-imports its component for the same reason.
import { BlockedRunners } from "../../modules/safety/components/BlockedRunners";
import {
  blockedRunnersQuery,
  unblockRunnerAction,
} from "../../modules/safety/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { Layout, Page } from "../../ui";

export const Route = createFileRoute("/safety/blocked")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  loader: async () => blockedRunnersQuery(),
  component: BlockedPage,
});

function BlockedPage() {
  const { blocked } = Route.useLoaderData();

  return (
    <Layout>
      <Page title="Blocked runners" width="column">
        <BlockedRunners blocked={blocked} unblock={unblockRunnerAction} />
      </Page>
    </Layout>
  );
}
