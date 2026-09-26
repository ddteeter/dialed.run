import { createFileRoute } from "@tanstack/react-router";

import { backToUpload } from "../../modules/runs/not-found";

/**
 * The import status page is gone (round 22: *"`/runs/import/$id` goes. A1
 * never navigates while parsing"*) — every outcome renders in A1, in
 * place. The URL still resolves, for a bookmark or an old tab, and lands
 * on A1.
 */
export const Route = createFileRoute("/runs/import/$importId")({
  beforeLoad: backToUpload,
});
