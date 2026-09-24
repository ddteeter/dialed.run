/**
 * Server-fn glue (auth's pattern — see modules/auth/functions.ts): imported
 * directly by route files, never re-exported from index.ts, so the barrel
 * stays loadable in the vitest workers pool without pulling in TanStack
 * Start's virtual server entry.
 *
 * Nothing here decides anything (D-41). A file that imports
 * `@tanstack/react-start` cannot be imported by a test, so it cannot be
 * mutation tested — which makes it the wrong place for a branch, a schema
 * or a refusal. Those live in `./inputs`, `./imports`, `./service` and
 * `./strava/*`, and this reads cookies and the request URL, calls them,
 * and returns what they say. `test/architecture/server-functions-are-glue`
 * enforces it.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  deleteCookie,
  getCookie,
  getRequestUrl,
  setCookie,
} from "@tanstack/react-start/server";

import { requireUserId } from "../auth";
import { newUlid } from "../../lib/ids";
import { attachObservation, recordManualObservation } from "../weather";
import { coreDb } from "./core-db";
import { getImportOutcome, startImport } from "./imports";
import {
  importIdInput,
  importUploadFrom,
  manualRunInput,
  retimeRunInput,
  runIdInput,
  conditionsBandInput,
  stravaCallbackInput,
} from "./inputs";
import {
  countRuns,
  createManualRun,
  didRetimeRun,
  didRetryRunWeather,
  didSetRunConditions,
  getRunSummary,
  listRunSummaries,
} from "./service";
import { env } from "../../env";
import { createStravaApi } from "./strava/api";
import { stravaConfigFromEnv } from "./strava/api-from-env";
import {
  completeStravaConnect,
  disconnectStrava,
  getStravaConnection,
  stravaAuthorizeUrl,
  stravaCallbackOutcome,
} from "./strava/oauth";

/**
The weather module's two writes, as the run rules take them.
*/
const weather = {
  attach: attachObservation,
  record: recordManualObservation,
};

export const submitManualRun = createServerFn({ method: "POST" })
  .validator((data: unknown) => manualRunInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const { idempotencyKey, ...draft } = data;
    return createManualRun(coreDb(), userId, draft, idempotencyKey);
  });

export const startFileImport = createServerFn({ method: "POST" })
  .validator(importUploadFrom)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return startImport(coreDb(), env.IMPORTS, env.IMPORTS_QUEUE, {
      userId,
      filename: data.file.name,
      bytes: await data.file.arrayBuffer(),
      idempotencyKey: data.idempotencyKey,
    });
  });

export const getImportOutcomeFn = createServerFn({ method: "GET" })
  .validator(importIdInput)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return getImportOutcome(coreDb(), userId, data.importId);
  });

export const getRunSummaryFn = createServerFn({ method: "GET" })
  .validator(runIdInput)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return getRunSummary(coreDb(), userId, data.runId);
  });

export const listRunSummariesFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const userId = await requireUserId();
    return listRunSummaries(coreDb(), userId);
  },
);

export const setRunConditionsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => conditionsBandInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return didSetRunConditions(
      coreDb(),
      weather,
      userId,
      data.runId,
      data.bandFloorC,
    );
  });

export const retryRunWeatherFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => runIdInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return didRetryRunWeather(coreDb(), weather, userId, data.runId);
  });

export const retimeRunFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => retimeRunInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return didRetimeRun(coreDb(), weather, userId, data.runId, data.shiftS);
  });
// ---- Strava connect/disconnect (102 §6) ------------------------------
//
// Credentials don't exist yet (CLAUDE.md law 5): `stravaConfigFromEnv()`
// returns undefined until a human sets STRAVA_CLIENT_ID/SECRET via
// `wrangler secret`, and every function below degrades cleanly when it does.

const STRAVA_STATE_COOKIE = "strava_oauth_state";

export const getStravaStatusFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const userId = await requireUserId();
    const connection = await getStravaConnection(coreDb(), userId);
    return {
      configured: stravaConfigFromEnv() !== undefined,
      status: connection?.status,
      runCount: await countRuns(coreDb(), userId),
    };
  },
);

/**
Undefined when Strava isn't configured — the route hides the connect CTA.
*/
export const getStravaAuthorizeUrlFn = createServerFn({
  method: "GET",
}).handler(async () => {
  await requireUserId();
  const config = stravaConfigFromEnv();
  // CSRF guard: a short-lived state nonce, round-tripped via an httpOnly
  // cookie and checked against the callback's `state` query param by
  // `stravaCallbackOutcome`.
  const state = newUlid();
  setCookie(STRAVA_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
  });
  const redirectUri = `${getRequestUrl().origin}/runs/strava-callback`;
  return config === undefined
    ? undefined
    : stravaAuthorizeUrl(config.clientId, redirectUri, state);
});

export const completeStravaConnectFn = createServerFn({ method: "POST" })
  .validator(stravaCallbackInput)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const expectedState = getCookie(STRAVA_STATE_COOKIE);
    deleteCookie(STRAVA_STATE_COOKIE);
    const outcome = stravaCallbackOutcome({ ...data, expectedState });
    const config = stravaConfigFromEnv();
    const refusal = {
      ok: false as const,
      reason: outcome.ok ? "Strava isn't configured yet." : outcome.reason,
    };
    await (config === undefined || !outcome.ok
      ? Promise.resolve()
      : completeStravaConnect(
          coreDb(),
          createStravaApi(config),
          userId,
          outcome.code,
        ));
    return config !== undefined && outcome.ok ? { ok: true as const } : refusal;
  });

export const disconnectStravaFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const userId = await requireUserId();
    // The revoke goes on the queue, so this returns as soon as the local
    // row is gone rather than waiting on Strava.
    await disconnectStrava(
      coreDb(),
      stravaConfigFromEnv() === undefined ? undefined : env.IMPORTS_QUEUE,
      userId,
    );
  },
);
