import { createFileRoute } from "@tanstack/react-router";

import { operatorOrNotFound } from "../../modules/ops/desk-gate";
import { deskAccessQuery, deskTodayQuery } from "../../modules/ops/functions";

/**
 * The Desk (decision D-35; Operator Screens D0): the door and the data
 * every page under it shares. `beforeLoad` runs before any child's
 * loader, so every page 125, 126 and 128 put under `/desk` is behind the
 * same not-found for anyone who is not an operator. Each page renders
 * `DeskShell` itself, naming which rail entry it is.
 */
export const Route = createFileRoute("/desk")({
  beforeLoad: async () => {
    operatorOrNotFound(await deskAccessQuery());
  },
  loader: async () => deskTodayQuery(),
  head: () => ({ meta: [{ title: "[desk]" }] }),
});
