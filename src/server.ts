/**
 * Custom Worker entry (000 §10): TanStack Start's fetch handler plus the
 * queue and cron entries the platform needs. wrangler.jsonc `main` points
 * here instead of the framework's default entry.
 */
import { createRouter } from "@tanstack/react-router";
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";

import { handleQueueBatch, handleScheduled } from "./modules/dispatch";
import { captureException } from "./modules/ops";
import {
  boundedRequest,
  isServerFnWithoutId,
  secureResponse,
} from "./modules/ops/edge";
import { withoutCookiesWhenPublic } from "./modules/ops/public-web";
import {
  dailySpeed,
  hourlySpeed,
  hourlySpeedDepsFromEnv,
  knownRoutes,
  requestNamer,
  speedDigestDepsFromEnv,
  timeRequest,
  timingDeps,
} from "./modules/ops/speed";
import { d1RequestDepsFromEnv, respondInD1Scope } from "./modules/auth";
import { requestContext } from "./lib/csp-nonce";
import { routeTree } from "./routeTree.gen";

const startFetch = createStartHandler(defaultStreamHandler);

/**
 * Design 165: every request logs its route id and how long it took. The
 * namer reads the route tree on the first request, not here.
 */
// Design 165: requests are named by TanStack's own matcher, on a router
// built at the first request and kept.
const timing = timingDeps(requestNamer(() => createRouter({ routeTree })));

// SA-M34: the speed checks and the rollup keep only route names this tree
// could have written, read from a router built at the first firing.
const isKnownRoute = knownRoutes(() => createRouter({ routeTree }));

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
      //
      // A public page (design 163) leaves with no cookie, since the edge
      // may store it and hand it to the next visitor, and with no nonce,
      // for the same reason: an open-web path is rendered without one,
      // and its policy names its scripts' hashes instead.
      //
      // Design 165: the response is timed by route id, logged and written
      // to VITALS. The same name labels the request's D1 query count, on
      // a dev server that counts them (design 182).
      //
      // SA-L05: a body is bounded before anything reads it (body-cap.ts).
      const url = new URL(request.url);
      const context = requestContext(url.pathname);
      // A server-function path with no id is answered here: the
      // framework reads that path before any response is built.
      if (isServerFnWithoutId(url)) {
        return await secureResponse(
          new Response("Not found", { status: 404 }),
          context.nonce,
          context.marker,
        );
      }
      const bounded = await boundedRequest(request);
      if (bounded instanceof Response) {
        return await secureResponse(bounded, context.nonce, context.marker);
      }
      const response = await timeRequest(
        bounded,
        () =>
          respondInD1Scope(
            bounded,
            () => startFetch(bounded, { context }),
            d1RequestDepsFromEnv(timing.name),
          ),
        timing,
      );
      return await secureResponse(
        withoutCookiesWhenPublic(response),
        context.nonce,
        context.marker,
      );
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
      // The other modules' jobs are the dispatch's own imports (design
      // 253). The speed checks are handed in because they read the route
      // names this tree could have written, and only this file builds the
      // router (design 165).
      await handleScheduled(controller, undefined, {
        speed: (today, anomalies) =>
          dailySpeed(today, anomalies, speedDigestDepsFromEnv(isKnownRoute)),
        speedHourly: (now, report) =>
          hourlySpeed(now, report, hourlySpeedDepsFromEnv(isKnownRoute)),
      });
    } catch (error) {
      captureException(error, { surface: "scheduled", cron: controller.cron });
      throw error;
    }
  },
} satisfies ExportedHandler;
