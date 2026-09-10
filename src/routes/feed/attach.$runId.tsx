import { createFileRoute } from "@tanstack/react-router";

import { getSession } from "../../modules/auth/functions";
import { AttachKit } from "../../modules/feed/components/AttachKit";
import {
  attachKitAction,
  pickerGroupsQuery,
  prefillQuery,
} from "../../modules/feed/functions";
import { requireSignedIn } from "../../modules/feed/redirect";
import { Layout } from "../../ui";

export const Route = createFileRoute("/feed/attach/$runId")({
  beforeLoad: async () => {
    requireSignedIn(await getSession());
  },
  component: AttachKitPage,
});

function AttachKitPage() {
  return (
    <Layout>
      <AttachKit
        runId={Route.useParams().runId}
        prefillFor={prefillQuery}
        pickerGroupsFor={pickerGroupsQuery}
        attachKit={attachKitAction}
      />
    </Layout>
  );
}
