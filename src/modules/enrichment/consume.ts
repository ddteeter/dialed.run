import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { dlqBatchHandler, gaveUpClear, gaveUpUpsert } from "../../db/gave-up";
import { products, productSnapshots } from "../../db/schema-core";
import { firstColumnWhere, firstRowWhere } from "../../lib/sql/keyed-read";
import { consumeEach } from "../../lib/sql/queue-batch";
import type { ExtractionModel } from "../../lib/contracts";
import { applyExtraction, type ApplyReport } from "../products";
import { abandonedBefore } from "./abandon";
import { PageFetchError, pageFailureReason } from "./bounds";
import { fetchProductPage } from "./fetch-page";
import { copyProductImage } from "./image";
import { runLadder, type LadderResult } from "./ladder";
import { modelPass } from "./model/rung";
import { enrichJobSchema } from "./queue-messages";
import { putSnapshot, readSnapshot, recordSnapshot } from "./snapshot";

/**
 * The concrete handle `drizzle(env.DIALED_CORE)` returns, spelled out:
 * `lib/sql/keyed-read` takes the un-parameterised `DrizzleD1Database`, and the
 * generic `ReturnType<typeof drizzle>` other modules use is wider than it —
 * so this names the one type both sides accept.
 */
type Db = DrizzleD1Database & { $client: D1Database };

/**
 * The `dialed-enrichment` consumer: fetch → snapshot → ladder → write-back,
 * once per product, and safely more than once.
 *
 * **What a redelivery must not do is fetch again.** Fetching is the step
 * with a bill and a blocklist behind it, so a job that got as far as
 * storing the page and then failed — a D1 hiccup on the write-back, say —
 * must resume from the snapshot it already has. A snapshot fetched inside
 * `REUSE_WINDOW_MS` is therefore reused rather than refetched, which is the
 * idempotency the packet asks for ("dedupe on productId + snapshot") and
 * also what makes a duplicate message from the sweep cost nothing.
 *
 * **Only a `pending` row is work.** `requestEnrichment` flips the row to
 * `pending` before sending, so `pending` is the claim: a message for a
 * `done` product is a redelivery after success, and a message for a `none`
 * one was sent without the row having flipped. Both are acked and ignored.
 *
 * **Which errors are terminal is the one judgement here.** A
 * `PageFetchError` is the page itself refusing — a 403 with no proxy, a
 * private host, an oversized body, a 404 — and no retry changes that, so
 * the row goes to `failed` and the message is acked (law 6: the failure is
 * on the row, where the closet can show it). Anything else — a network
 * throw, a timeout, a write-back conflict — is thrown, so the queue's own
 * retry machinery owns it (law 3) and the DLQ handler below marks the row
 * when it gives up.
 */

const REUSE_WINDOW_MS = 60 * 60 * 1000;

export interface EnrichmentDeps {
  db: Db;
  captureException: (error: unknown, context: Record<string, string>) => void;
  /**
  Injected so the workers pool can hand the consumer a page without a
  network; production passes nothing and gets `fetch`.
  */
  fetchImpl?: typeof fetch | undefined;
  /**
  `FIRECRAWL_API_KEY`, read from `env` by the caller. Absent means a refused
  page is a failed fetch.
  */
  proxyApiKey?: string | undefined;
  /**
  The LLM rung, built by the caller from `OPENAI_API_KEY` and the owner's
  model choice (D-32). Absent means the declared rungs are the answer.
  */
  model?: ExtractionModel | undefined;
}

/**
 * A page that refused us: the row goes to `failed`, and what the Desk's
 * Gave up will need is kept (R-119). One try, because a terminal failure
 * is not retried by the queue; the sweep's re-drives each add one more.
 *
 * **Listed only once the system stops retrying** (Operator Screens D6).
 * Inside its first day the sweep re-drives a failed product every hour,
 * so the failure is parked on the product (`extraction_error`, a try on
 * `extraction_tries`) and the sweep lists it when the day runs out
 * (`listAbandonedEnrichments`). Past the day — a fresh paste, an
 * operator's Retry — nothing will retry it, so it is listed now, in the
 * batch that fails it.
 */
async function markFailed(
  db: Db,
  product: { id: string; createdAt: number },
  error: PageFetchError,
): Promise<void> {
  const failed = eq(products.id, product.id);
  if (product.createdAt > abandonedBefore()) {
    await db
      .update(products)
      .set({
        extractionStatus: "failed",
        extractionError: error.message,
        extractionTries: sql`coalesce(${products.extractionTries}, 0) + 1`,
      })
      .where(failed);
    return;
  }
  await db.batch([
    db.update(products).set({ extractionStatus: "failed" }).where(failed),
    gaveUpUpsert(db, {
      kind: "enrichment",
      subjectId: product.id,
      reason: pageFailureReason(error.message),
      rawError: error.message,
      tries: 1,
    }),
  ]);
}

/**
The newest snapshot of a product fetched after `since` (epoch ms), if any.
*/
async function latestSnapshot(db: Db, productId: string, since: number) {
  const [row] = await db
    .select()
    .from(productSnapshots)
    .where(
      and(
        eq(productSnapshots.productId, productId),
        gt(productSnapshots.fetchedAt, since),
      ),
    )
    .orderBy(desc(productSnapshots.fetchedAt))
    .limit(1);
  return row;
}

/**
 * Copy the primary image, once.
 *
 * **Fill-only-what-is-blank, and here that is the right rule** — the
 * opposite of the ledger `applyExtraction` needs. That ledger exists
 * because a person edits a composition and must not have it overwritten;
 * nobody edits an R2 key, so there is no human intent to protect. What is
 * left is "have we already paid for this image", and a non-null key
 * answers it.
 *
 * A later run finding a *different* image therefore does not replace the
 * stored one. That is deliberate and recorded (R-123): refreshing a product
 * image needs a rule about the old object and anything holding its URL, and
 * inventing one here would be guessing.
 *
 * Never throws. A product whose image 404s is still a product with a
 * composition, and the page is already stored — failing the job over the
 * picture would throw away the text (law 5).
 */
async function copyImageOnce(
  deps: EnrichmentDeps,
  productId: string,
  imageUrl: string | undefined,
  fetchedAt: number,
): Promise<void> {
  if (imageUrl === undefined) return;
  // Asked in SQL — "does this product already have an image" — rather than
  // by reading the row and testing the column. A row read would have to
  // answer for a product that is not there, which cannot happen here
  // (`applyExtraction` has just written to it) and so would be a branch no
  // test could reach.
  const already = await firstColumnWhere(
    deps.db,
    products,
    products.id,
    and(eq(products.id, productId), isNotNull(products.imageKey)),
  );
  if (already !== undefined) return;
  try {
    const imageKey = await copyProductImage(
      productId,
      imageUrl,
      deps.fetchImpl ?? fetch,
      fetchedAt,
    );
    await deps.db
      .update(products)
      .set({ imageKey })
      .where(eq(products.id, productId));
  } catch (error) {
    deps.captureException(error, { surface: "enrichment-image", productId });
  }
}

/**
 * Run the ladder over a stored page and write the result back, updating
 * the snapshot's rung to what this run found — the column's job is to say
 * whether re-running would help, and after a re-run that is a new answer.
 */
async function extractStored(
  deps: EnrichmentDeps,
  productId: string,
  snapshot: { id: string; url: string },
  html: string,
): Promise<ApplyReport> {
  return extractFrom(
    deps,
    productId,
    snapshot,
    html,
    runLadder(new URL(snapshot.url), html),
  );
}

/**
 * Everything after the ladder: the model's turn, the recorded rung, the
 * write-back.
 *
 * Takes the ladder's result rather than the page alone, because the fetch
 * path already has one — and running the ladder twice over the same
 * megabytes to avoid passing it would be a strange saving.
 */
async function extractFrom(
  deps: EnrichmentDeps,
  productId: string,
  snapshot: { id: string; url: string },
  html: string,
  result: LadderResult,
): Promise<ApplyReport> {
  // The model runs last and only over a blank the deterministic rungs left
  // — see `model/rung.ts`. Unconfigured, it does not run at all and the
  // deterministic answer is the answer, which is the same degradation the
  // proxy fetch makes (law 5).
  // **Always, when one is configured.** There used to be a
  // `requiresModel(result.extracted)` gate here — ask only where the
  // deterministic rungs left the composition blank — and it stopped meaning
  // anything when the last of those rungs gave the field up
  // (2026-09-14): the ladder cannot fill it, so the gate was a condition
  // no input could make false.
  const { model } = deps;
  const rung =
    model === undefined
      ? result.rung
      : await askModel(model, result, snapshot, html);
  await deps.db
    .update(productSnapshots)
    .set({ rung })
    .where(eq(productSnapshots.id, snapshot.id));
  return applyExtraction(deps.db, productId, result.extracted, rung);
}

/**
 * The model's turn, and what it does to the recorded rung.
 *
 * `llm` only when the model actually filled a blank — the column's job is
 * to say whether re-running would help, and a model that answered nothing
 * new leaves the deterministic rung as the honest deepest contributor.
 */
async function askModel(
  // Narrowed by the caller and passed in, rather than read off `deps` and
  // narrowed a second time — the second check is one no input can reach.
  model: ExtractionModel,
  result: LadderResult,
  snapshot: { url: string },
  html: string,
): Promise<LadderResult["rung"]> {
  const pass = await modelPass({ model }, result.extracted, {
    html,
    url: snapshot.url,
  });
  return pass.didContribute ? "llm" : result.rung;
}

/**
 * Fetch, store, extract, record, write back — the bytes go to R2 before
 * anything tries to understand them (D-31), and the row is written once the
 * ladder has said which rung read it. A ladder that throws between the two
 * leaves an object with no row, which is the recoverable kind of residue
 * `snapshot.ts` already accepts.
 */
async function fetchAndExtract(
  deps: EnrichmentDeps,
  productId: string,
  sourceUrl: string,
): Promise<ApplyReport> {
  const page = await fetchProductPage(sourceUrl, deps.fetchImpl ?? fetch, {
    proxyApiKey: deps.proxyApiKey,
  });
  const fetchedAt = Date.now();
  const r2Key = await putSnapshot(productId, page.html, fetchedAt);
  const result = runLadder(new URL(page.finalUrl), page.html);
  const id = await recordSnapshot(deps.db, {
    productId,
    url: page.finalUrl,
    r2Key,
    rung: result.rung,
    fetchedAt,
  });
  const report = await extractFrom(
    deps,
    productId,
    { id, url: page.finalUrl },
    page.html,
    result,
  );
  // After the write-back, so a failed apply does not leave an image copied
  // for a product whose extraction never landed.
  await copyImageOnce(deps, productId, result.extracted.imageUrl, fetchedAt);
  return report;
}

/**
 * The work for a `pending` product: the page stored within the reuse
 * window, or a fresh fetch.
 */
async function extractPending(
  deps: EnrichmentDeps,
  productId: string,
  sourceUrl: string,
): Promise<void> {
  const recent = await latestSnapshot(
    deps.db,
    productId,
    Date.now() - REUSE_WINDOW_MS,
  );
  if (recent !== undefined) {
    const stored = await readSnapshot(recent.r2Key);
    if (stored !== undefined) {
      await extractStored(deps, productId, recent, stored);
      return;
    }
  }
  await fetchAndExtract(deps, productId, sourceUrl);
}

async function processEnrichJob(
  deps: EnrichmentDeps,
  productId: string,
): Promise<void> {
  const row = await firstRowWhere(
    deps.db,
    products,
    eq(products.id, productId),
  );
  if (row?.extractionStatus !== "pending") return;

  try {
    // `String(null)` is "null", which is not a URL. A pending row with no
    // URL cannot come from `requestEnrichment`, which requires one to flip
    // the row; a hand-edited one goes through the same door as any other
    // bad URL — a terminal `PageFetchError`, reported, and the row failed —
    // rather than a private branch that fails it silently.
    await extractPending(deps, productId, String(row.sourceUrl));
  } catch (error) {
    if (!(error instanceof PageFetchError)) throw error;
    deps.captureException(error, { surface: "enrichment-fetch", productId });
    await markFailed(deps.db, row, error);
    return;
  }
  // A product the Desk listed as given up is off it, and one with a
  // failure parked for listing has nothing left to list: the sweep's
  // re-drive, or the queue's own retry, got there (R-119). After the
  // write-back rather than in its batch, because `applyExtraction` is the
  // products module's own write; a clear that fails throws, and the
  // redelivery finds the product `done` and stops — leaving a row whose
  // Retry finds nothing to claim and goes, which is the operator's to press.
  await deps.db.batch([
    gaveUpClear(deps.db, "enrichment", productId),
    deps.db
      .update(products)
      .set({ extractionError: sql`NULL`, extractionTries: sql`NULL` })
      .where(eq(products.id, productId)),
  ]);
}

export async function handleEnrichmentBatch(
  batch: MessageBatch,
  deps: EnrichmentDeps,
): Promise<void> {
  await consumeEach(batch, enrichJobSchema, {
    process: (job) => processEnrichJob(deps, job.productId),
    invalidMessage: "invalid enrichment queue message",
    context: (job) => ({ productId: job.productId }),
    captureException: deps.captureException,
  });
}

/**
 * Law 6: a job that exhausted its retries lands on the row, where the
 * closet can show that enrichment gave up, in Sentry, and — once the
 * system stops retrying it — on the Desk's Gave up. Only a row still
 * `pending` is marked — a retry that finally succeeded before the DLQ
 * caught up must not be un-succeeded, nor listed as a failure. The read
 * decides; the update re-checks, in case the product finished in between.
 *
 * Inside the product's first day the sweep will re-drive it, so the dead
 * letter is parked like `markFailed`'s refusal — its tries counted, no
 * error, since the DLQ is not handed one — and listed when the day runs
 * out. Past it, it is listed in the batch that fails it.
 */
export async function handleEnrichmentDlqBatch(
  batch: MessageBatch,
  deps: EnrichmentDeps,
  tries: number,
): Promise<void> {
  await dlqBatchHandler(
    batch,
    enrichJobSchema,
    deps,
    tries,
    `dead-lettered job on ${batch.queue}`,
    async ({ productId }) => {
      const row = await firstRowWhere(
        deps.db,
        products,
        eq(products.id, productId),
      );
      if (row?.extractionStatus !== "pending") return;
      const stillPending = and(
        eq(products.id, productId),
        eq(products.extractionStatus, "pending"),
      );
      // Parked here and nothing returned: one statement, so no batch to
      // join, and no row to write yet.
      if (row.createdAt > abandonedBefore()) {
        await deps.db
          .update(products)
          .set({
            extractionStatus: "failed",
            extractionError: sql`NULL`,
            extractionTries: sql`coalesce(${products.extractionTries}, 0) + ${tries}`,
          })
          .where(stillPending);
        return;
      }
      return {
        subject: { kind: "enrichment", subjectId: productId },
        writes: [
          deps.db
            .update(products)
            .set({ extractionStatus: "failed" })
            .where(stillPending),
        ],
      };
    },
  );
}

/**
 * Re-run the ladder over the latest stored page without refetching — the
 * mechanism that makes a better parser or a promoted fibre retroactive
 * (D-31, packet §6). Nothing when the product has never been snapshotted,
 * or when the snapshot row points at an object that is not there.
 */
export async function reextract(
  deps: EnrichmentDeps,
  productId: string,
): Promise<ApplyReport | undefined> {
  const latest = await latestSnapshot(deps.db, productId, 0);
  if (latest === undefined) return undefined;
  const html = await readSnapshot(latest.r2Key);
  if (html === undefined) return undefined;
  return extractStored(deps, productId, latest, html);
}
