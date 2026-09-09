/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps ./index.ts loadable in the vitest workers pool with no
 * TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { garmentSchema, performanceBucketSchema } from "../../lib/contracts";
import { ulidSchema } from "../../lib/ids";
import { env } from "../../env";
import { requireUserId } from "../auth";
import {
  uploadItemPhoto,
  validatePhoto,
  type PhotoUploadResult,
} from "./photos";
import {
  createItem,
  withResolvedProduct,
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
  // The same four values were a TS union in service.ts and this enum, free
  // to drift. One list in contracts now; the type derives from it.
  performance: performanceBucketSchema.optional(),
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

// The garment plus the key that identifies *this* submission of it. A
// separate wrapper rather than a field on `garmentSchema`, because the key
// is a property of the request, not of the thing being saved — putting it
// in the contract would mean every read of a garment carries it too.
const newItemInput = z.object({
  garment: garmentSchema,
  idempotencyKey: ulidSchema.optional(),
});

export const createItemFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => newItemInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    // Resolved here rather than in the browser: it is a rule about what a
    // garment *is*, so it belongs where the garment is written and not
    // somewhere a caller can forget to go.
    const client = db();
    const garment = await withResolvedProduct(client, data.garment, userId);
    return createItem(client, userId, garment, "manual", data.idempotencyKey);
  });

const updateItemSchema = z.object({
  itemId: ulidSchema,
  garment: garmentSchema,
});

export const updateItemFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateItemSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    // Same rule as create: editing a garment into a brand + model is how a
    // generic piece becomes a specific one (P2.5), and that is exactly when
    // it should gain a product and a type.
    const client = db();
    const garment = await withResolvedProduct(client, data.garment, userId);
    return updateItem(client, userId, data.itemId, garment);
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
