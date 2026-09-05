import { createFileRoute } from "@tanstack/react-router";

import { checkHealth } from "../../modules/ops";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const report = await checkHealth();
        return Response.json(report, { status: report.ok ? 200 : 503 });
      },
    },
  },
});
