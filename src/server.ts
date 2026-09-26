/**
 * Custom Worker entry (000 §10): TanStack Start's fetch handler plus the
 * queue and cron entries the platform needs. wrangler.jsonc `main` points
 * here instead of the framework's default entry.
 */
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";

import {
  captureException,
  handleQueueBatch,
  handleScheduled,
  secureResponse,
} from "./modules/ops";

const startFetch = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request): Promise<Response> {
    try {
      // OPS-8: every response the Worker generates leaves with the
      // security headers, set here so no route can forget them. Static
      // assets never reach this; public/_headers covers them. A thrown
      // error gets none: the platform answers it with its own error page.
      return secureResponse(await startFetch(request));
    } catch (error) {
      captureException(error, { surface: "fetch" });
      throw error;
    }
  },
  async queue(batch): Promise<void> {
    try {
      await handleQueueBatch(batch);
    } catch (error) {
      captureException(error, { surface: "queue", queue: batch.queue });
      throw error; // rethrow so queue retry machinery owns it (law 3)
    }
  },
  async scheduled(controller): Promise<void> {
    try {
      await handleScheduled(controller);
    } catch (error) {
      captureException(error, { surface: "scheduled", cron: controller.cron });
      throw error;
    }
  },
} satisfies ExportedHandler;
