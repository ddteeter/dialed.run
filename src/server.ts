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
import { exportConsumersFromEnv } from "./modules/account/export-build";
import { sweepExports } from "./modules/account/export-sweep";
import { purgeDueAccounts } from "./modules/account/purge";
import { mintNonce } from "./lib/csp-nonce";

const startFetch = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request): Promise<Response> {
    try {
      // OPS-8: every response the Worker generates leaves with the
      // security headers, set here so no route can forget them. Static
      // assets never reach this; public/_headers covers them. A thrown
      // error gets none: the platform answers it with its own error page.
      // The nonce goes to the framework as request context, where
      // router.tsx reads it onto every inline script, and to the CSP that
      // admits exactly those scripts.
      const nonce = mintNonce();
      return secureResponse(
        await startFetch(request, { context: { nonce } }),
        nonce,
      );
    } catch (error) {
      captureException(error, { surface: "fetch" });
      throw error;
    }
  },
  async queue(batch): Promise<void> {
    try {
      // The data export's consumers (task 126, ACC-10; dialed-exports),
      // handed in because `ops` cannot import `account`.
      await handleQueueBatch(batch, exportConsumersFromEnv());
    } catch (error) {
      captureException(error, { surface: "queue", queue: batch.queue });
      throw error; // rethrow so queue retry machinery owns it (law 3)
    }
  },
  async scheduled(controller): Promise<void> {
    try {
      // Account deletion's purge rides the daily firing (task 126, ACC-9),
      // and the data export's sweep the hourly `:00` one (ACC-10): handed
      // in here because `ops` cannot import either without a cycle.
      await handleScheduled(controller, undefined, {
        purgeAccounts: purgeDueAccounts,
        sweepExports,
      });
    } catch (error) {
      captureException(error, { surface: "scheduled", cron: controller.cron });
      throw error;
    }
  },
} satisfies ExportedHandler;
