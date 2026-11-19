import { createFileRoute } from "@tanstack/react-router";

import { cspReportDepsFromEnv, receiveCspReport } from "../../modules/ops/edge";

export const Route = createFileRoute("/api/csp-report")({
  server: {
    handlers: {
      POST: ({ request }) => receiveCspReport(request, cspReportDepsFromEnv()),
    },
  },
});
