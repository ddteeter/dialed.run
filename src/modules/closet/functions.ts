/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps ./index.ts loadable in the vitest workers pool with no
 * TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { requireUserId } from "../auth";
import {
  closetFiltersInput,
  itemIdInput,
  newItemInput,
  requireFormData,
  updateItemInput,
} from "./inputs";
import { uploadPhotoFromForm } from "./photos";
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

export const listItemsFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => closetFiltersInput.parse(data ?? {}))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return listItems(db(), userId, data);
  });

export const getItemFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => itemIdInput.parse(data))
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

export const updateItemFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateItemInput.parse(data))
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
  .validator((data: unknown) => itemIdInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return retireItem(db(), userId, data.itemId);
  });

export const unretireItemFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => itemIdInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return unretireItem(db(), userId, data.itemId);
  });

export const deleteItemFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => itemIdInput.parse(data))
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

export const uploadPhotoFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => requireFormData(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return uploadPhotoFromForm(db(), userId, data);
  });
