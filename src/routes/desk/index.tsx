import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { DeskShell } from "../../modules/ops/components/DeskShell";
import { Today } from "../../modules/ops/components/Today";

const desk = getRouteApi("/desk");

/**
 * Today (Operator Screens D0): the digest, rendered, from the `/desk`
 * layout's loader — the same `todayCounts` the daily digest reads.
 */
export const Route = createFileRoute("/desk/")({
  component: TodayPage,
});

function TodayPage() {
  const today = desk.useLoaderData();

  return (
    <DeskShell current="today" today={today}>
      <Today today={today} />
    </DeskShell>
  );
}
