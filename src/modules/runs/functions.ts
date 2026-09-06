/**
 * Server-fn glue (auth's pattern — see modules/auth/functions.ts): imported
 * directly by route files, never re-exported from index.ts, so the barrel
 * stays loadable in the vitest workers pool without pulling in TanStack
 * Start's virtual server entry.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";

import { auth } from "../auth";
import { runDraftSchema } from "../../lib/contracts";
import { coreDb } from "./core-db";
import { MAX_IMPORT_BYTES, getImportStatus, startImport } from "./imports";
import {
  createManualRun,
  didRecordManualTemp,
  getRun,
  listRuns,
} from "./service";
import { env } from "../../env";
import {
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
} from "./notifications";

class UnauthenticatedError extends Error {
  constructor() {
    super("Sign in to continue.");
  }
}

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  if (session === null) throw new UnauthenticatedError();
  return session.user.id;
}

export const submitManualRun = createServerFn({ method: "POST" })
  .validator(runDraftSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return createManualRun(coreDb(), userId, data);
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
    return startImport(coreDb(), env.PHOTOS, env.IMPORTS_QUEUE, {
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

export const listNotificationsFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const userId = await requireUserId();
    return listNotifications(coreDb(), userId);
  },
);

export const unreadNotificationCountFn = createServerFn({
  method: "GET",
}).handler(async () => {
  const userId = await requireUserId();
  return unreadNotificationCount(coreDb(), userId);
});

export const markAllNotificationsReadFn = createServerFn({
  method: "POST",
}).handler(async () => {
  const userId = await requireUserId();
  await markAllNotificationsRead(coreDb(), userId);
});
