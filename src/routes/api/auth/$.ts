import { createFileRoute } from "@tanstack/react-router";

import { authRequest } from "../../../modules/auth";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => authRequest(request),
      POST: ({ request }) => authRequest(request),
    },
  },
});
