/**
 * The Desk's Corrections queue (D-163; round 48 #130). One row per
 * product, field and suggested value, however many runners said it; Apply
 * writes the product and decides every waiting correction to that field,
 * Decline keeps the product as it is. Every runner decided hears it on the
 * bell, and nothing is emailed (R48·129f).
 */
import { and, asc, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";

import {
  brands,
  productCorrections,
  products,
  userProfiles,
} from "../../db/schema-core";
import { coreDb, primaryCoreDb } from "../../env";
import {
  CORRECTION_FIELD_NOUNS,
  DECLINE_REASON_LABELS,
  type CorrectionField,
  type DeclineReason,
} from "../../lib/contracts/product-corrections";
import { NotFoundError } from "../../lib/errors";
import { normalizeIdentity } from "../../lib/normalize";
import { nowSeconds } from "../../lib/now";
import { orSqlNull } from "../../lib/sql/sql-null";
import { notificationInsert } from "../notifications";
import {
  currentValues,
  productFactColumns,
  productPatch,
} from "./correction-values";

type CoreDb = ReturnType<typeof coreDb>;

/**
 * A runner in a queue row, newest first: the newest and their note lead,
 * and "N more runners" opens the rest inline (R48·130).
 */
export interface CorrectionFiler {
  handle: string | null;
  createdAt: number;
  note: string | null;
}

export interface CorrectionGroup {
  productId: string;
  brandName: string;
  productName: string;
  field: CorrectionField;
  value: string;
  /**
  What the product says now, absent when it says nothing.
  */
  now: string | undefined;
  firstAt: number;
  filers: CorrectionFiler[];
}

export interface CorrectionsQueue {
  groups: CorrectionGroup[];
  /**
  `[n WAITING · m DECIDED TODAY]`, counting rows, not runners.
  */
  waiting: number;
  decidedToday: number;
}

/**
 * How many rows the queue shows, at most. A page, not a cap on the work:
 * a decision takes a row off and the next comes up.
 */
export const CORRECTIONS_PAGE = 100;

const DAY_SECONDS = 24 * 60 * 60;

function waitingGroups(db: CoreDb) {
  return db
    .select({
      productId: productCorrections.productId,
      field: productCorrections.field,
      value: productCorrections.value,
      runners: count().as("runners"),
      firstAt: sql<number>`min(${productCorrections.createdAt})`.as("first_at"),
    })
    .from(productCorrections)
    .where(eq(productCorrections.status, "waiting"))
    .groupBy(
      productCorrections.productId,
      productCorrections.field,
      productCorrections.value,
    );
}

/**
 * The rail's count, in D1's style: rows on the queue. A statement, so
 * Today's one batch carries it; it always answers one row.
 */
export function waitingCorrectionsCountOf(db: CoreDb) {
  const groups = waitingGroups(db).as("groups");
  return db.select({ rows: count() }).from(groups);
}

/**
 * Rows decided since midnight UTC, as Review's header counts its own.
 */
function decidedTodayOf(db: CoreDb, dayStart: number) {
  const decided = db
    .select({ productId: productCorrections.productId })
    .from(productCorrections)
    .where(gte(productCorrections.decidedAt, dayStart))
    .groupBy(
      productCorrections.productId,
      productCorrections.field,
      productCorrections.value,
    )
    .as("decided");
  return db.select({ rows: count() }).from(decided);
}

/**
 * The queue: most runners first, then oldest first (R48·130).
 */
export async function correctionsQueue(): Promise<CorrectionsQueue> {
  const db = coreDb();
  const now = nowSeconds();
  const groups = waitingGroups(db).as("groups");
  const [rows, waiting, decided] = await db.batch([
    db
      .select({
        productId: groups.productId,
        field: groups.field,
        value: groups.value,
        firstAt: groups.firstAt,
        // Aliased: D1 answers by column name, so an unaliased `brands.name`
        // beside `products.name` comes back as the product's.
        brandName: sql<string>`${brands.name}`.as("brand_name"),
        ...productFactColumns(),
      })
      .from(groups)
      .innerJoin(products, eq(products.id, groups.productId))
      .innerJoin(brands, eq(brands.id, products.brandId))
      .orderBy(desc(groups.runners), asc(groups.firstAt))
      .limit(CORRECTIONS_PAGE),
    waitingCorrectionsCountOf(db),
    decidedTodayOf(db, now - (now % DAY_SECONDS)),
  ]);
  const filers = await filersOf(rows.map((row) => row.productId));
  return {
    groups: rows.map((row) => ({
      productId: row.productId,
      brandName: row.brandName,
      productName: row.name,
      field: row.field,
      value: row.value,
      now: currentValues(row)[row.field],
      firstAt: row.firstAt,
      filers: filers
        .filter(
          (filer) =>
            filer.productId === row.productId &&
            filer.field === row.field &&
            filer.value === row.value,
        )
        .map(({ handle, createdAt, note }) => ({ handle, createdAt, note })),
    })),
    waiting: waiting[0]?.rows ?? 0,
    decidedToday: decided[0]?.rows ?? 0,
  };
}

/**
 * The waiting runners on the page's products, newest first, with the
 * handle they go by now. Matched to their rows in code: one read for the
 * page rather than one per row.
 */
async function filersOf(productIds: readonly string[]) {
  if (productIds.length === 0) return [];
  const distinctIds = [...new Set(productIds)];
  const waitingOnPage = and(
    eq(productCorrections.status, "waiting"),
    inArray(productCorrections.productId, distinctIds),
  );
  return coreDb()
    .select({
      productId: productCorrections.productId,
      field: productCorrections.field,
      value: productCorrections.value,
      // The handle they go by now; null for an account that is gone. Both
      // sides are named by table: drizzle prints a column bare inside a
      // subquery, and a bare `user_id = user_id` is true of every profile.
      handle: sql<
        string | null
      >`(select ${userProfiles.username} from ${userProfiles} where ${userProfiles}.${sql.identifier(userProfiles.userId.name)} = ${productCorrections}.${sql.identifier(productCorrections.userId.name)})`,
      createdAt: productCorrections.createdAt,
      note: productCorrections.note,
    })
    .from(productCorrections)
    .where(waitingOnPage)
    .orderBy(desc(productCorrections.createdAt));
}

/**
 * Which queue row a decision is about.
 */
export interface CorrectionKey {
  productId: string;
  field: CorrectionField;
  value: string;
}

/**
 * What Apply answers. A name that another of the brand's products already
 * has would break `products_brand_name`, and the Desk has no Merge
 * (R48·130: that is a Decline, and Duplicates), so it is refused with an
 * answer the row can say.
 */
export type ApplyOutcome =
  | { readonly applied: true }
  | { readonly applied: false; readonly reason: "name_taken" };

/**
 * The waiting corrections a decision resolves, and the product they are
 * about. Read from the primary: it decides what the batch writes. Apply
 * takes every value for the field (R48·130: "decides every row for that
 * field"); Decline only the row's own.
 */
async function toDecide(key: CorrectionKey, isWholeField: boolean) {
  const db = primaryCoreDb();
  const sameValue = isWholeField
    ? undefined
    : eq(productCorrections.value, key.value);
  const toResolve = and(
    eq(productCorrections.status, "waiting"),
    eq(productCorrections.productId, key.productId),
    eq(productCorrections.field, key.field),
    sameValue,
  );
  const [filers, product] = await db.batch([
    db
      .select({
        id: productCorrections.id,
        userId: productCorrections.userId,
        garmentId: productCorrections.garmentId,
      })
      .from(productCorrections)
      .where(toResolve),
    db
      .select({ name: products.name, brandId: products.brandId })
      .from(products)
      .where(eq(products.id, key.productId)),
  ]);
  const [row] = product;
  if (row === undefined) throw new NotFoundError("Product not found.");
  return { filers, product: row };
}

type Filer = Awaited<ReturnType<typeof toDecide>>["filers"][number];

/**
 * The batch's tail: the corrections marked decided, and each filer's bell
 * row, which opens the garment they filed from.
 */
function decisionWrites(
  db: CoreDb,
  filers: readonly Filer[],
  decision: {
    status: "applied" | "declined";
    actorId: string;
    reason: string | undefined;
    body: string;
  },
) {
  const kind =
    decision.status === "applied"
      ? "correction_applied"
      : "correction_declined";
  const filerIds = filers.map((filer) => filer.id);
  const stillWaiting = and(
    inArray(productCorrections.id, filerIds),
    eq(productCorrections.status, "waiting"),
  );
  return [
    db
      .update(productCorrections)
      .set({
        status: decision.status,
        reason: orSqlNull(decision.reason),
        decidedBy: decision.actorId,
        decidedAt: nowSeconds(),
      })
      .where(stillWaiting),
    ...filers.map((filer) =>
      notificationInsert(db, {
        userId: filer.userId,
        kind,
        subjectId: filer.id,
        linkId: filer.garmentId,
        body: decision.body,
      }),
    ),
  ] as const;
}

/**
 * Apply (R48·130): writes the value to the product, decides every waiting
 * correction to that field, and tells each runner, in one batch. A row
 * already decided has nobody left in it: a repeat, answered as applied.
 */
export async function applyCorrection({
  actorId,
  key,
}: Readonly<{ actorId: string; key: CorrectionKey }>): Promise<ApplyOutcome> {
  const { filers, product } = await toDecide(key, true);
  if (filers.length === 0) return { applied: true };
  const isName = key.field === "name";
  const isTaken =
    isName &&
    (await isNameTaken(
      key.productId,
      product.brandId,
      normalizeIdentity(key.value),
    ));
  if (isTaken) return { applied: false, reason: "name_taken" };
  const patch = productPatch(key.field, key.value);
  const named = isName ? key.value : product.name;
  const db = primaryCoreDb();
  await db.batch([
    db.update(products).set(patch).where(eq(products.id, key.productId)),
    ...decisionWrites(db, filers, {
      status: "applied",
      actorId,
      reason: undefined,
      body: `We fixed the ${CORRECTION_FIELD_NOUNS[key.field]} on ${named}. Thanks.`,
    }),
  ]);
  return { applied: true };
}

async function isNameTaken(
  productId: string,
  brandId: string,
  normalizedName: string,
): Promise<boolean> {
  const takenElsewhere = and(
    eq(products.brandId, brandId),
    eq(products.normalizedName, normalizedName),
    ne(products.id, productId),
  );
  const taken = await primaryCoreDb()
    .select({ id: products.id })
    .from(products)
    .where(takenElsewhere);
  return taken.length > 0;
}

/**
 * Decline (R48·130): the product is left as it is. A reason other than
 * "No reason given" is the bell row's second line (R48·129f).
 */
export async function declineCorrection({
  actorId,
  key,
  reason,
}: Readonly<{
  actorId: string;
  key: CorrectionKey;
  reason: DeclineReason;
}>): Promise<void> {
  const { filers, product } = await toDecide(key, false);
  if (filers.length === 0) return;
  const said = reason === "none" ? undefined : DECLINE_REASON_LABELS[reason];
  const kept = `We kept the ${CORRECTION_FIELD_NOUNS[key.field]} on ${product.name} as it is.`;
  const db = primaryCoreDb();
  await db.batch([
    ...decisionWrites(db, filers, {
      status: "declined",
      actorId,
      reason: said,
      body: said === undefined ? kept : `${kept}\n${said}`,
    }),
  ]);
}
