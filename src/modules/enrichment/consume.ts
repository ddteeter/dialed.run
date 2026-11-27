import { and, desc, eq, exists, gt, gte, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  dlqBatchHandler,
  gaveUpClear,
  gaveUpUpsert,
  shortRawError,
} from "../ops/gave-up";
import { products, productSnapshots } from "../../db/schema-core";
import { nowSeconds } from "../../lib/now";
import { firstRowWhere } from "../../lib/sql/keyed-read";
import { withoutBoundValues } from "../../lib/statement-error";
import { consumeEach } from "../../lib/sql/queue-batch";
import type { ExtractionModel } from "../../lib/contracts";
import { applyExtraction, type ApplyReport } from "../products";
import { abandonedBefore } from "./abandon";
import { PageFetchError, pageFailureReason } from "./bounds";
import { fetchProductPage } from "./fetch-page";
import { runLadder, type LadderResult } from "./ladder";
import { UnreadableAnswerError } from "./model/chat-completions";
import { modelPass } from "./model/rung";
import { enrichJobSchema, type EnrichJob } from "./queue-messages";
import { putSnapshot, readSnapshot, recordSnapshot } from "./snapshot";
import {
  canSpendModelCall,
  canSpendPageFetch,
  canSpendProductProxyCall,
  canSpendProxyCall,
  forgetProductProxyCall,
} from "./spend-limit";

/**
 * The concrete handle `coreDb()` returns, spelled out:
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
 * also what makes a duplicate message from the sweep cost nothing. A
 * snapshot whose `rung` is still `none` is reused whatever its age: stored
 * and not yet read to a write-back, or read with nothing found. So a job
 * put off with its page stored reads that page when it next runs, however
 * long it waited.
 *
 * **A person's ask is the exception.** A paste or the Desk's Retry sends
 * `askedAt`, and that job reuses only a page stored since: one its own
 * earlier delivery stored. Anything older is fetched fresh.
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
 * on the row, where the closet can show it). So is an
 * `UnreadableAnswerError`: no model answer to read (not an object, no
 * content, or none in time), one try on the product, and the hourly
 * sweep's re-drive is the next one. So is anything thrown while the page
 * is fetched and stored — a network throw, a timeout, a D1 or R2 error
 * there — which `beforeStored` makes a `PageFetchError`, so each try is
 * one counted fetch. A D1 error in the reads before the fetch (the
 * product, its stored page, the counts) is thrown as itself, as is
 * anything else — a write-back conflict, a model HTTP or network error —
 * so the queue's own retry machinery owns it (law 3) and the DLQ handler
 * below marks the row when it gives up.
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
  /**
   * Safety's `isDeniedOnLanding`: records where a link landed and answers
   * whether it is denied, by its own domain or the landing's (R-176,
   * design 171). Passed in because enrichment importing safety would close
   * a cycle through ops, and required because a consumer without it would
   * read denied pages again.
   */
  isLandingDenied: (link: string, landedUrl: string) => Promise<boolean>;
  /**
  The ladder a fetched page is read by, so a test can stand in one that
  fails part-way; production passes nothing and gets `runLadder`.
  */
  ladder?: typeof runLadder | undefined;
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
  error: PageFetchError | UnreadableAnswerError,
): Promise<void> {
  const failed = stillPending(product.id);
  if (product.createdAt > abandonedBefore()) {
    await db
      .update(products)
      .set({
        extractionStatus: "failed",
        extractionError: shortRawError(error.message),
        extractionTries: sql`coalesce(${products.extractionTries}, 0) + 1`,
      })
      .where(failed);
    return;
  }
  // The row first, so its condition reads the product before the update
  // fails it.
  await db.batch([
    gaveUpUpsert(
      db,
      {
        kind: "enrichment",
        subjectId: product.id,
        reason: pageFailureReason(error.message),
        rawError: error.message,
        tries: 1,
      },
      nowSeconds(),
      whilePending(db, product.id),
    ),
    db.update(products).set({ extractionStatus: "failed" }).where(failed),
  ]);
}

/**
 * The product, while it is still `pending`: a failure decided from a read
 * lands only if no other message for it finished in between.
 */
function stillPending(productId: string): SQL | undefined {
  return and(
    eq(products.id, productId),
    eq(products.extractionStatus, "pending"),
  );
}

/**
 * Whether the product is still `pending` as the statement runs: the
 * condition a Gave-up row for it is written under, so the Desk never lists
 * a product another message finished (`giveUpEach`).
 */
function whilePending(db: Db, productId: string): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(products)
      .where(stillPending(productId)),
  );
}

/**
 * Which of a product's snapshots a job may read: one stored at or after
 * `askedAt` (epoch ms) when a person asked, else one fetched after `since`
 * or whose rung is still `none`.
 */
function reusableSnapshot(
  since: number,
  askedAt: number | undefined,
): SQL | undefined {
  return askedAt === undefined
    ? or(
        gt(productSnapshots.fetchedAt, since),
        eq(productSnapshots.rung, "none"),
      )
    : gte(productSnapshots.fetchedAt, askedAt);
}

/**
The newest snapshot of a product `reusableSnapshot` allows, if any.
*/
async function latestSnapshot(
  db: Db,
  productId: string,
  since: number,
  askedAt?: number,
) {
  const reusable = reusableSnapshot(since, askedAt);
  const [row] = await db
    .select()
    .from(productSnapshots)
    .where(and(eq(productSnapshots.productId, productId), reusable))
    .orderBy(desc(productSnapshots.fetchedAt))
    .limit(1);
  return row;
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
 * A read that landed somewhere denied (R-176, design 171): nothing it
 * found is kept, and the product lets go of the link. Back to `none` with
 * no `source_url`, so the next runner's link becomes its source and asks
 * again — not `failed`, which the sweep would re-drive into the same
 * denied page every hour for a day.
 */
async function dropDeniedSource(db: Db, productId: string): Promise<void> {
  await db
    .update(products)
    .set({ sourceUrl: sql`NULL`, extractionStatus: "none" })
    .where(eq(products.id, productId));
}

/**
 * `work`, with whatever it throws made a `PageFetchError`: a try that
 * fails before the page is stored is a failed try, so each costs one
 * counted fetch. The new error's message and cause are the thrown one
 * without bound values (`withoutBoundValues`): a failed D1 statement is
 * named by its first words and the database's reason, and anything else
 * as it was thrown.
 */
async function beforeStored<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PageFetchError) throw error;
    const scrubbed = withoutBoundValues(error);
    throw new PageFetchError(String(scrubbed), { cause: scrubbed });
  }
}

/**
 * Fetch, store, record, extract, write back — the bytes go to R2 before
 * anything tries to understand them (D-31), and the row is written before
 * the ladder reads them (SA-M32), as `none` until `extractFrom` records
 * the rung that read it. A delivery that ends inside the ladder leaves a
 * stored page the next one reads again, rather than fetching it again.
 *
 * **Where the page landed is checked before anything is kept** (R-176): a
 * link that redirected to a denied site leaves no snapshot and no specs
 * behind, and is denied wherever it would show.
 */
async function fetchAndExtract(
  deps: EnrichmentDeps,
  productId: string,
  sourceUrl: string,
): Promise<"deferred" | undefined> {
  const stored = await beforeStored(() =>
    fetchAndStore(deps, productId, sourceUrl),
  );
  if (stored === undefined) return undefined;
  const { page, id } = stored;
  // After the page is stored, so the sweep's next try reads it again
  // rather than fetching it again: its rung is still `none`, which keeps
  // it reusable at any age.
  if (await isModelCallSpent(deps)) return "deferred";
  const ladder = deps.ladder ?? runLadder;
  const result = ladder(new URL(page.finalUrl), page.html);
  await extractFrom(
    deps,
    productId,
    { id, url: page.finalUrl },
    page.html,
    result,
  );
  return undefined;
}

/**
 * The fetch and the stored page, or nothing when the page landed
 * somewhere denied.
 */
async function fetchAndStore(
  deps: EnrichmentDeps,
  productId: string,
  sourceUrl: string,
): Promise<
  { page: Awaited<ReturnType<typeof fetchProductPage>>; id: string } | undefined
> {
  const page = await fetchProductPage(sourceUrl, deps.fetchImpl ?? fetch, {
    proxyApiKey: deps.proxyApiKey,
    claimProxy: () => canSpendProxyFor(deps.db, productId),
  });
  if (await deps.isLandingDenied(sourceUrl, page.finalUrl)) {
    await dropDeniedSource(deps.db, productId);
    return;
  }
  const fetchedAt = Date.now();
  const r2Key = await putSnapshot(productId, page.html, fetchedAt);
  const id = await recordSnapshot(deps.db, {
    productId,
    url: page.finalUrl,
    r2Key,
    rung: "none",
    fetchedAt,
  });
  return { page, id };
}

/**
 * Whether the consumer may not ask the model now: one is configured and
 * the hour's model calls are spent (`spend-limit.ts`). Asked before the
 * ladder reads the page, and over it nothing is written to the product: it
 * stays `pending` for the hourly sweep. Writing the deterministic answer alone would mark
 * the product `done`, which is never claimed again. The Desk's re-run is
 * the operator's own press and does not ask (owner, 2026-11-21).
 */
async function isModelCallSpent(deps: EnrichmentDeps): Promise<boolean> {
  return deps.model !== undefined && !(await canSpendModelCall(deps.db));
}

/**
 * One proxy call for this product: the product's own count for the day
 * first, so a product that has had its call spends nothing shared, then
 * the day's count across everyone. When the day's count refuses, the
 * product's count is forgotten, so the product has its call still when
 * the day's count has room again.
 */
async function canSpendProxyFor(db: Db, productId: string): Promise<boolean> {
  if (!(await canSpendProductProxyCall(db, productId))) return false;
  if (await canSpendProxyCall(db)) return true;
  await forgetProductProxyCall(db, productId);
  return false;
}

/**
 * The work for a `pending` product: a stored page `latestSnapshot` allows,
 * or a fresh fetch — `deferred` when the hour's fetches or model calls are
 * spent (`spend-limit.ts`), and the row stays `pending` for the hourly
 * sweep.
 */
async function extractPending(
  deps: EnrichmentDeps,
  job: EnrichJob,
  sourceUrl: string,
): Promise<"deferred" | undefined> {
  const { productId } = job;
  const recent = await latestSnapshot(
    deps.db,
    productId,
    Date.now() - REUSE_WINDOW_MS,
    job.askedAt,
  );
  if (recent !== undefined) {
    const stored = await readSnapshot(recent.r2Key);
    if (stored !== undefined) {
      if (await isModelCallSpent(deps)) return "deferred";
      await extractStored(deps, productId, recent, stored);
      return undefined;
    }
  }
  return (await canSpendPageFetch(deps.db))
    ? fetchAndExtract(deps, productId, sourceUrl)
    : "deferred";
}

async function processEnrichJob(
  deps: EnrichmentDeps,
  job: EnrichJob,
): Promise<void> {
  const { productId } = job;
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
    const outcome = await extractPending(deps, job, String(row.sourceUrl));
    if (outcome === "deferred") return;
  } catch (error) {
    if (
      !(error instanceof PageFetchError) &&
      !(error instanceof UnreadableAnswerError)
    )
      throw error;
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
    process: (job) => processEnrichJob(deps, job),
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
          .where(stillPending(productId));
        return;
      }
      return {
        subject: { kind: "enrichment", subjectId: productId },
        onlyIf: whilePending(deps.db, productId),
        writes: [
          deps.db
            .update(products)
            .set({ extractionStatus: "failed" })
            .where(stillPending(productId)),
        ],
      };
    },
  );
}

/**
 * Re-run the ladder over the latest stored page without refetching — the
 * mechanism that makes a better parser or a promoted fibre retroactive
 * (D-31, packet §6). Nothing when the product has never been snapshotted,
 * when the snapshot row points at an object that is not there, or when
 * the stored page is one the ladder refuses to read (a `PageFetchError`).
 *
 * The operator's own press, so its model call is not counted against the
 * hour's (owner, 2026-11-21).
 */
export async function reextract(
  deps: EnrichmentDeps,
  productId: string,
): Promise<ApplyReport | undefined> {
  const latest = await latestSnapshot(deps.db, productId, 0);
  if (latest === undefined) return undefined;
  const html = await readSnapshot(latest.r2Key);
  if (html === undefined) return undefined;
  try {
    return await extractStored(deps, productId, latest, html);
  } catch (error) {
    if (error instanceof PageFetchError) return undefined;
    throw error;
  }
}
