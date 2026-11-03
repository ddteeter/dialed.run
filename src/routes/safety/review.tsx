import { createFileRoute } from "@tanstack/react-router";

import { redirectTo } from "../../modules/feed/redirect";

/**
 * Review's old address (task 106), before it moved into the Desk
 * (R-173). Kept as a redirect so a bookmark, or an "Open Review" email
 * sent before the move, still lands. Who may see Review is `/desk`'s
 * door and `requireAdmin`, not this.
 */
export const Route = createFileRoute("/safety/review")({
  beforeLoad: () => {
    redirectTo({ to: "/desk/review" });
  },
});
