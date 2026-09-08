/**
 * Server-fn glue (auth's pattern — see modules/auth/functions.ts): imported
 * directly by route files, never re-exported from index.ts, so the barrel
 * stays loadable in the vitest workers pool without pulling in TanStack
 * Start's virtual server entry.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  deleteCookie,
  getCookie,
  getRequestUrl,
  setCookie,
} from "@tanstack/react-start/server";
import { z } from "zod";

import { requireUserId } from "../auth";
import { runDraftSchema } from "../../lib/contracts";
import { newUlid, ulidSchema } from "../../lib/ids";
import { coreDb } from "./core-db";
import { MAX_IMPORT_BYTES, getImportStatus, startImport } from "./imports";
import {
  createManualRun,
  didRecordManualTemp,
  getRun,
  listRuns,
} from "./service";
import { env } from "../../env";
import { createStravaApi } from "./strava/api";
import type { StravaConfig } from "./strava/api";
import {
  completeStravaConnect,
  disconnectStrava,
  getStravaConnection,
  stravaAuthorizeUrl,
} from "./strava/oauth";

export const manualRunInput = runDraftSchema.extend({
  // Minted once when the form mounts, resent on every retry of that same
  // composed submission.
  idempotencyKey: ulidSchema.optional(),
});

export const submitManualRun = createServerFn({ method: "POST" })
  .validator((data: unknown) => manualRunInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const { idempotencyKey, ...draft } = data;
    return createManualRun(coreDb(), userId, draft, idempotencyKey);
  });

function isFormData(value: unknown): value is FormData {
  return value instanceof FormData;
}

export const startFileImport = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!isFormData(data)) {
      throw new Error("Expected multipart form data.");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const file = data.get("file");
    if (!(file instanceof File)) {
      throw new TypeError("No file was attached.");
    }
    if (file.size > MAX_IMPORT_BYTES) {
      throw new Error("That file is larger than 25 MB.");
    }
    const bytes = await file.arrayBuffer();
    return startImport(coreDb(), env.IMPORTS, env.IMPORTS_QUEUE, {
      userId,
      filename: file.name,
      bytes,
    });
  });

const importIdInput = z.object({ importId: z.string().min(1) });

export const getImportStatusFn = createServerFn({ method: "GET" })
  .validator(importIdInput)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return getImportStatus(coreDb(), userId, data.importId);
  });

const runIdInput = z.object({ runId: z.string().min(1) });

export const getRunFn = createServerFn({ method: "GET" })
  .validator(runIdInput)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return getRun(coreDb(), userId, data.runId);
  });

export const listRunsFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const userId = await requireUserId();
    return listRuns(coreDb(), userId);
  },
);

const manualTempInput = z.object({
  runId: z.string().min(1),
  tempC: z.number().min(-60).max(60),
});

export const recordManualTempFn = createServerFn({ method: "POST" })
  .validator(manualTempInput)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return didRecordManualTemp(coreDb(), userId, data.runId, data.tempC);
  });

// ---- Strava connect/disconnect (102 §6) ------------------------------
//
// Credentials don't exist yet (CLAUDE.md law 5): `stravaConfig()` returns
// undefined until a human sets STRAVA_CLIENT_ID/SECRET via `wrangler
// secret`, and every function below degrades cleanly when it does.

const STRAVA_STATE_COOKIE = "strava_oauth_state";

function stravaConfig(): StravaConfig | undefined {
  if (env.STRAVA_CLIENT_ID === undefined || env.STRAVA_CLIENT_SECRET === undefined) {
    return undefined;
  }
  return { clientId: env.STRAVA_CLIENT_ID, clientSecret: env.STRAVA_CLIENT_SECRET };
}

export const getStravaStatusFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const userId = await requireUserId();
    const connection = await getStravaConnection(coreDb(), userId);
    return {
      configured: stravaConfig() !== undefined,
      status: connection?.status,
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
  const config = stravaConfig();
  if (config === undefined) return;
  // CSRF guard: a short-lived state nonce, round-tripped via an httpOnly
  // cookie and checked against the callback's `state` query param.
  const state = newUlid();
  setCookie(STRAVA_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
  });
  const redirectUri = `${getRequestUrl().origin}/runs/strava-callback`;
  return stravaAuthorizeUrl(config.clientId, redirectUri, state);
});

const stravaCallbackInput = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

export const completeStravaConnectFn = createServerFn({ method: "POST" })
  .validator(stravaCallbackInput)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const expectedState = getCookie(STRAVA_STATE_COOKIE);
    deleteCookie(STRAVA_STATE_COOKIE);
    if (data.error !== undefined) {
      return { ok: false as const, reason: "Strava connection was cancelled." };
    }
    if (
      expectedState === undefined ||
      data.code === undefined ||
      data.state === undefined ||
      data.state !== expectedState
    ) {
      return { ok: false as const, reason: "That connection link expired. Try again." };
    }
    const config = stravaConfig();
    if (config === undefined) {
      return { ok: false as const, reason: "Strava isn't configured yet." };
    }
    await completeStravaConnect(coreDb(), createStravaApi(config), userId, data.code);
    return { ok: true as const };
  });

export const disconnectStravaFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const userId = await requireUserId();
    const config = stravaConfig();
    // The revoke goes on the queue, so this returns as soon as the local
    // row is gone rather than waiting on Strava.
    await disconnectStrava(
      coreDb(),
      config === undefined ? undefined : env.IMPORTS_QUEUE,
      userId,
    );
  },
);
