import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { SettingsSubPage } from "../../modules/onboarding/components/SettingsSubPage";
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

export const Route = createFileRoute("/safety/blocked")({
  beforeLoad: async ({ location }) => {
    requireSignedIn(await getSession(), location);
  },
  loader: async () => {
    const [{ blocked }, bell] = await Promise.all([
      blockedRunnersQuery(),
      bellStateFn(),
    ]);
    return { blocked, bell };
  },
  component: BlockedPage,
});

/**
 * A Settings sub-page like the others reached from that index (#632 B-02):
 * the bell, so the bar keeps its shape and the title stays put, and the
 * way back to Settings.
 */
function BlockedPage() {
  const { blocked, bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <SettingsSubPage title="Blocked runners">
        <BlockedRunners blocked={blocked} unblock={unblockRunnerAction} />
      </SettingsSubPage>
    </BelledLayout>
  );
}
