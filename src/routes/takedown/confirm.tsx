import { createFileRoute } from "@tanstack/react-router";

import { takedownConfirmSearch } from "../../modules/safety/client";
import { TakedownConfirm } from "../../modules/safety/takedowns/components/TakedownConfirm";
import { confirmTakedownFn } from "../../modules/safety/functions";

/**
 * `/takedown/confirm?token=` (design 137): every receipt's link, which
 * proves the request's address and hides a request past the cap.
 */
export const Route = createFileRoute("/takedown/confirm")({
  validateSearch: takedownConfirmSearch,
  component: TakedownConfirmPage,
});

function TakedownConfirmPage() {
  const { token, isForAddress } = Route.useSearch();
  return (
    <TakedownConfirm
      token={token}
      isForAddress={isForAddress}
      confirm={confirmTakedownFn}
    />
  );
}
