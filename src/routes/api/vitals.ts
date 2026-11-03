import { createFileRoute } from "@tanstack/react-router";

import { receiveVitals, vitalsDepsFromEnv } from "../../modules/ops";

export const Route = createFileRoute("/api/vitals")({
  server: {
    handlers: {
      POST: ({ request }) => receiveVitals(request, vitalsDepsFromEnv()),
    },
  },
});
