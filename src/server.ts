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
import { forgetAnsweredRequests } from "./modules/account/answered-requests";
import { exportConsumersFromEnv } from "./modules/account/export-build";
import { d1RequestDepsFromEnv, respondInD1Scope } from "./modules/auth";
import { sweepExpiredAuthRows } from "./modules/auth/expired-rows";
import { rescreenHandlesFromEnv } from "./modules/account/handle-rescreen";
import { sweepExports } from "./modules/account/export-sweep";
import { purgeDueAccounts } from "./modules/account/purge";
import { linkTypedGarments } from "./modules/closet";
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
      //
      // Design 143: the request is one D1 scope, so its reads share a
      // session that may be a read replica, started from the device's and
      // the runner's bookmarks; the newest one goes back in the `d1b`
      // cookie.
      const nonce = mintNonce();
      return secureResponse(
        await respondInD1Scope(
          request,
          () => startFetch(request, { context: { nonce } }),
          d1RequestDepsFromEnv(),
        ),
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
      // in here because `ops` cannot import either without a cycle. So
      // does the handle re-ask, on the `:15` one (task 126 PR B), and the
      // product link a confirmation owes (design 133, D-113 Q1), which is
      // `closet`'s, on the `:00` one and the daily drain. And the daily
      // sweep of expired sessions and password-try counts, `auth`'s, and
      // of answered access requests, `account`'s.
      await handleScheduled(controller, undefined, {
        purgeAccounts: purgeDueAccounts,
        sweepExports,
        rescreenHandles: rescreenHandlesFromEnv,
        linkProducts: linkTypedGarments,
        sweepAuthRows: sweepExpiredAuthRows,
        forgetAnsweredRequests,
      });
    } catch (error) {
      captureException(error, { surface: "scheduled", cron: controller.cron });
      throw error;
    }
  },
} satisfies ExportedHandler;
