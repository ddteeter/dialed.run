import { createFileRoute } from "@tanstack/react-router";

import { accessConfirmSearch } from "../../modules/account/client";
import { AccessConfirm } from "../../modules/account/access/components/AccessConfirm";
import { confirmAccessFn } from "../../modules/account/functions";

/**
 * `/account/confirm-access?token=` (owner, 2026-11-21): the link an access
 * request's email carries. Opening it changes nothing; the landing's one
 * button confirms the ask.
 */
export const Route = createFileRoute("/account/confirm-access")({
  validateSearch: accessConfirmSearch,
  component: ConfirmAccessPage,
});

function ConfirmAccessPage() {
  const { token } = Route.useSearch();
  return <AccessConfirm token={token} confirm={confirmAccessFn} />;
}
