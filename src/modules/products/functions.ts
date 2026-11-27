/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps ./index.ts loadable in the vitest workers pool with no
 * TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";

import { coreDb } from "../../env";
import { requireUserId, verifiedUserId } from "../auth";
import { requireAdmin } from "../safety/rules";
import {
  applyCorrection,
  correctionsQueue,
  declineCorrection,
} from "./correction-queue";
import { correctionContext, fileCorrection } from "./corrections";
import {
  brandSearchInput,
  correctionContextInput,
  correctionKeyInput,
  declineCorrectionInput,
  fileCorrectionInput,
} from "./inputs";
import { searchBrands } from "./service";

function db() {
  return coreDb();
}

export const searchBrandsFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => brandSearchInput.parse(data))
  .handler(async ({ data }) => {
    await requireUserId();
    const client = db();
    return searchBrands(client, data.prefix);
  });

// A product is made only where a garment is written (`closet`'s
// `withResolvedProduct`), which is where design 133 (D-113 Q1) clamps it
// for an unconfirmed runner. There was a `resolveProductFn` here that made
// a brand and a product for anyone signed in, and no route called it.

/**
 * WRONG?'s sheet (D-163, R48·129a): a correction reaches the Desk and, in
 * the end, every runner's garment, so it waits for a confirmed address.
 */
export const fileCorrectionFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => fileCorrectionInput.parse(data))
  .handler(async ({ data }) => {
    await fileCorrection(await verifiedUserId(), data);
  });

/**
 * What the sheet reads when it opens (R48·129): the product, what it says
 * now, and the runner's own waiting corrections. Their own and a shared
 * product's facts, so signed in is enough.
 */
export const correctionContextFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => correctionContextInput.parse(data))
  .handler(async ({ data }) =>
    correctionContext(await requireUserId(), data.productId),
  );

/**
 * The Desk's Corrections queue (D-163, R48·130): one row per product,
 * field and suggested value, most runners first.
 */
export const deskCorrectionsQuery = createServerFn({ method: "GET" }).handler(
  async () => {
    requireAdmin(await verifiedUserId());
    return correctionsQueue();
  },
);

/**
 * Apply: the product takes the value, and every runner who suggested it
 * hears so. A name another product of the brand has is refused with an
 * answer the row can say, not an error (no Merge, R48·130).
 */
export const applyCorrectionFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => correctionKeyInput.parse(data))
  .handler(async ({ data }) => {
    const actorId = requireAdmin(await verifiedUserId());
    return applyCorrection({ actorId, key: data });
  });

/**
 * Decline, with the optional reason every runner in the row reads.
 */
export const declineCorrectionFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => declineCorrectionInput.parse(data))
  .handler(async ({ data }) => {
    const { reason, ...key } = data;
    const actorId = requireAdmin(await verifiedUserId());
    await declineCorrection({ actorId, key, reason });
  });
