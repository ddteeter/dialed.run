import { createFileRoute } from "@tanstack/react-router";

import { cspReportDepsFromEnv, receiveCspReport } from "../../modules/ops";

export const Route = createFileRoute("/api/csp-report")({
  server: {
    handlers: {
      POST: ({ request }) => receiveCspReport(request, cspReportDepsFromEnv()),
    },
  },
});
