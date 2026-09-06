/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps ./index.ts loadable in the vitest workers pool with no
 * TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { garmentSchema } from "../../lib/contracts";
import { ulidSchema } from "../../lib/ids";
import { env } from "../../env";
import { auth } from "../auth";
import {
  uploadItemPhoto,
  validatePhoto,
  type PhotoUploadResult,
} from "./photos";
import {
  createItem,
  deleteOrRetireItem,
  getItemDetail,
  getItemsByIds,
  listItems,
  retireItem,
  unretireItem,
  updateItem,
} from "./service";
import { addFromTapList, tapListSelectionSchema } from "./tap-list";

function db() {
  return drizzle(env.DIALED_CORE);
}

/**
Every closet.* function is scoped to the signed-in user (packet §7).
*/
async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  if (!session) throw new Error("Sign in required.");
  return session.user.id;
}

const filtersSchema = z.object({
  category: z
    .enum([
      "top",
      "bottom",
      "headwear",
      "neckwear",
      "gloves",
      "socks",
      "shoes",
      "accessory",
    ])
    .optional(),
  minTempC: z.number().optional(),
  maxTempC: z.number().optional(),
  windResistant: z.boolean().optional(),
  waterResistant: z.boolean().optional(),
  performance: z
    .enum(["most_dialed", "never_worked", "untested", "retire_candidate"])
    .optional(),
  includeRetired: z.boolean().optional(),
});

export const listItemsFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => filtersSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return listItems(db(), userId, data);
  });

const itemIdSchema = z.object({ itemId: ulidSchema });

export const getItemFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => itemIdSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const client = db();
    const detail = await getItemDetail(client, userId, data.itemId);
    const paired = await getItemsByIds(
      client,
      userId,
      detail.performance?.pairsWith ?? [],
    );
    return { ...detail, pairedItems: paired };
  });

export const createItemFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => garmentSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return createItem(db(), userId, data);
  });

const updateItemSchema = z.object({
  itemId: ulidSchema,
  garment: garmentSchema,
});

export const updateItemFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateItemSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return updateItem(db(), userId, data.itemId, data.garment);
  });

export const retireItemFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => itemIdSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return retireItem(db(), userId, data.itemId);
  });

export const unretireItemFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => itemIdSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return unretireItem(db(), userId, data.itemId);
  });

export const deleteItemFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => itemIdSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return deleteOrRetireItem(db(), userId, data.itemId);
  });

export const addFromTapListFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => tapListSelectionSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return addFromTapList(db(), userId, data);
  });

/**
 * Multipart upload: FormData carries `itemId` and `photo` (a File). Photo
 * failure never surfaces as a form-wide error — it's reported as its own
 * result field so the caller can offer a photo-specific retry while the
 * item itself (already saved by createItemFn/updateItemFn) stays intact.
 */
export type UploadPhotoResult =
  { ok: true; result: PhotoUploadResult } | { ok: false; error: string };

export const uploadPhotoFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!(data instanceof FormData))
      throw new Error("Expected multipart form data.");
    return data;
  })
  .handler(async ({ data }): Promise<UploadPhotoResult> => {
    const userId = await requireUserId();
    const itemId = ulidSchema.parse(data.get("itemId"));
    const photo = data.get("photo");
    if (!(photo instanceof File)) {
      return { ok: false, error: "No photo file provided." };
    }
    try {
      validatePhoto(photo.type, photo.size);
      const bytes = new Uint8Array(await photo.arrayBuffer());
      const result = await uploadItemPhoto(
        db(),
        userId,
        itemId,
        bytes,
        photo.type,
      );
      return { ok: true, result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Photo upload failed.",
      };
    }
  });
