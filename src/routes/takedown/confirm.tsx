import { createFileRoute } from "@tanstack/react-router";

import { takedownConfirmSearch } from "../../modules/safety/inputs";
import { TakedownConfirm } from "../../modules/safety/components/TakedownConfirm";
import { confirmTakedownFn } from "../../modules/safety/functions";

/**
 * `/takedown/confirm?token=` (design 137): the receipt's link for a
 * request past the requester cap.
 */
export const Route = createFileRoute("/takedown/confirm")({
  validateSearch: takedownConfirmSearch,
  component: TakedownConfirmPage,
});

function TakedownConfirmPage() {
  const { token } = Route.useSearch();
  return <TakedownConfirm token={token} confirm={confirmTakedownFn} />;
}
