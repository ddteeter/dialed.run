import { z } from "zod";

import { UpstreamError } from "../../../lib/errors";
import {
  extractedProductSchema,
  garmentCategories,
  type ExtractedProduct,
  type ExtractionModel,
} from "../../../lib/contracts";
import { knownFibres } from "../fibres";
import { parseJson } from "../html";
import { strictSchemaFor, withoutNulls } from "./json-schema";

/**
 * The LLM rung, behind OpenRouter (packet §5).
 *
 * **It is the last rung and should stay that way.** Everything above it is
 * a shop stating a fact; this is a model reading prose and inferring one.
 * It runs only where the deterministic rungs left a blank, its answer is
 * parsed through the same contract as every other rung, and the fibres it
 * names that we do not recognise become candidates for the vocabulary
 * rather than truths — so the deterministic path gets better and the model
 * call becomes rarer over time.
 *
 * **Structured output is per *endpoint*, not per model** (confirmed at
 * design time), so the provider is pinned and fallbacks are off. Without
 * that, a request can be routed to an endpoint that ignores
 * `response_format` and answers with prose — which is not an error, just an
 * unparseable success, and the sort of thing that shows up as a mysterious
 * accuracy drop weeks later.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 30_000;
const MAX_ERROR_CHARS = 400;

/**
 * What the model is asked for: the contract **minus `extras`**, derived
 * from it rather than restated.
 *
 * Two reasons, and the first is a hard one. `extras` is
 * `z.record(z.string(), z.unknown())`, which converts to a JSON Schema with
 * `propertyNames` — and OpenAI's strict mode refuses that outright
 * (measured: `400 invalid_json_schema`, "'propertyNames' is not
 * permitted"). The second is why that is no loss: `extras` is where the
 * deterministic rungs keep the raw payload they could not type (D-31). It
 * is a record of what a *page* published, so a model inventing entries for
 * it would be writing fiction into the one field kept for evidence.
 */
const modelOutputSchema = extractedProductSchema.omit({ extras: true });

/**
 * Thrown for any adapter failure — network, timeout, non-2xx, a body that
 * is not what the API documents, or output the contract rejects.
 *
 * **All of it is retryable**, which is the packet's wording: "a malformed
 * model response is a retryable failure, not a crash". A model is a
 * non-deterministic upstream, so the same prompt really can succeed on the
 * next delivery, and the queue is the retry mechanism (law 3).
 */
export class ModelUnavailableError extends UpstreamError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ModelUnavailableError", message, options);
  }
}

/**
 * Only what we read. The envelope carries usage, ids and provider metadata
 * we do not act on, and parsing what we do not use is how a schema starts
 * failing on a field's harmless change.
 */
const messageSchema = z.object({ content: z.string() });
const choiceSchema = z.object({ message: messageSchema });
const completionSchema = z.object({ choices: z.array(choiceSchema) });

/**
 * Every sentence here was chosen against observed behaviour, not written
 * from taste, which is why each is asserted:
 *
 * - "only what the page states" and "never infer" are the whole difference
 *   between a rung and a guess. A model that knows the brand will happily
 *   tell you a Janji tee is merino when the page does not say so.
 * - "return null" is how the strict schema says "not on the page" — every
 *   field is `required` there, so absence needs a value (`json-schema.ts`).
 * - "copied exactly" is what keeps `verbatim` evidence. D-31 exists so a
 *   better parser can re-read it later; a paraphrase is worthless for that.
 * - the category list is **derived from the contract**, never typed out.
 *   Restating those eight words here would be a rival truth the compiler
 *   cannot check, and the model's answer is parsed against the real enum
 *   anyway — so a drifted list would just produce rejected extractions.
 */
const SYSTEM_PROMPT = [
  "You read a running-apparel product page and report only what the page states.",
  "Never infer, guess, or fill a field from general knowledge about the brand.",
  "If the page does not state a field, return null for it.",
  "fabricComposition.verbatim must be copied from the page exactly, character for character.",
  `categoryHint must be one of: ${garmentCategories.join(", ")}.`,
  // The vocabulary as a *hint*, which is where it moved to when it stopped
  // being a parser gate (2026-09-14). The eval measured the need: models
  // called `Coreloft™ 80`, `Arato™ 15`, `2:09 Mesh` and `decoration`
  // materials. Those are fabric trade names and a legal disclaimer, and a
  // model that has been told what a fibre is stops offering them.
  //
  // Examples rather than an allow-list, deliberately. A shop may state a
  // proprietary fibre this list cannot contain — `100% Primeflex` — and the
  // answer there is to report it, not to drop it. That was the gate's
  // mistake and the prompt must not inherit it.
  `A material is a fibre, such as: ${knownFibres().join(", ")}.`,
  "A fabric's trade name is not a material: report the fibres it is made of,",
  "and put the trade name in the part label where the page puts it.",
  "If the page states a fibre not in that list, report it as written.",
].join(" ");

export interface OpenRouterOptions {
  /**
  The model id, and the provider its structured-output endpoint lives on.
  Both are the owner's call on the eval table (D-32), so both are inputs.
  */
  model: string;
  provider: string;
  fetchImpl?: typeof fetch | undefined;
  /**
   * Overrides the default bound, and exists for the eval rather than for
   * production.
   *
   * The default is a *resilience* limit (law 4) — a slow upstream must not
   * wedge a consumer — and 30 seconds is right for work a queue is waiting
   * on. The eval is asking a different question: whether a model *can*
   * extract, not whether it can do so inside our budget. Scoring a slow
   * provider as incapable conflates the two, which is exactly what happened
   * the first time round: two models were recorded as answering 9 and 5
   * pages of 22, and every failure was a timeout or a rate limit rather
   * than a bad extraction.
   */
  timeoutMs?: number;
}

export function createOpenRouterModel(
  apiKey: string,
  options: OpenRouterOptions,
): ExtractionModel {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    extract: async (pageText, hint) =>
      askModel(apiKey, options, fetchImpl, pageText, hint.url),
  };
}

async function askModel(
  apiKey: string,
  options: OpenRouterOptions,
  fetchImpl: typeof fetch,
  pageText: string,
  url: string,
): Promise<ExtractedProduct> {
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      // Pinned, and fallbacks off — see the note above on per-endpoint
      // structured output.
      provider: { order: [options.provider], allow_fallbacks: false },
      // Nothing creative is wanted: the task is transcription, and the same
      // page should give the same answer twice.
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extracted_product",
          strict: true,
          schema: strictSchemaFor(modelOutputSchema),
        },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Page URL: ${url}\n\n${pageText}` },
      ],
    }),
  });
  if (!response.ok) {
    // The body, trimmed, because the status alone is not actionable: a 400
    // from here is the *provider's* complaint relayed through OpenRouter,
    // and the first one said "'propertyNames' is not permitted" — which is
    // the difference between a fix and a week of guessing. It carries no
    // secret; the key is a request header, never echoed.
    const complaint = await response.text();
    const detail = complaint.slice(0, MAX_ERROR_CHARS);
    throw new ModelUnavailableError(
      `Model returned ${String(response.status)}: ${detail}`,
    );
  }

  const body = await response.text();
  // `parseJson` rather than a second copy of it: a body that is not JSON
  // and a body of the wrong shape are the same failure to the caller, which
  // is exactly what that helper already exists to say (`html.ts`).
  const envelope = completionSchema.safeParse(parseJson(body));
  if (!envelope.success) {
    throw new ModelUnavailableError("Model response did not match its contract");
  }
  // Checked rather than defaulted. `.min(1)` on the schema would make the
  // index safe and this line unreachable — a default nothing can observe —
  // where a completion with no choices is a real answer a real provider
  // gives, and one the caller should retry.
  const content = envelope.data.choices[0]?.message.content;
  if (content === undefined) {
    throw new ModelUnavailableError("Model returned no completion");
  }

  const answer = withoutNulls(parseJson(content));
  const extracted = modelOutputSchema.safeParse(answer);
  if (!extracted.success) {
    throw new ModelUnavailableError("Model output did not match the contract");
  }
  return withoutSaidNull(extracted.data);
}

/**
 * A composition whose verbatim is the *word* "null", dropped.
 *
 * **Observed, not imagined**: asked for a page that states no composition,
 * a model returned `{"verbatim": "null"}` — the string, not the JSON value.
 * The schema accepts it, because a string is what the field wants, so it
 * reached the eval as a page where a composition had been found. In
 * production it would reach `products.fabric_composition`, and a runner
 * would be shown the word "null" as their garment's fabric.
 *
 * `withoutNulls` cannot catch this: that one removes real JSON nulls, which
 * is how the prompt asks for "not stated". This is the same intent spelled
 * as prose by a model that did not follow it.
 *
 * Whitespace-trimmed and case-folded, and "none" and "n/a" join it, because
 * they are the same mistake in the same place. Anything else is left alone
 * — a shop could write something odd and mean it.
 */
const SAID_NULL = new Set(["null", "none", "n/a", "na", "undefined"]);

function withoutSaidNull(found: ExtractedProduct): ExtractedProduct {
  // Narrowed in two steps rather than one optional chain: `has(undefined)`
  // on a `Set<string>` is already false, so a single combined guard has a
  // branch no input can distinguish.
  const composition = found.fabricComposition;
  if (composition === undefined) return found;
  if (!SAID_NULL.has(composition.verbatim.trim().toLowerCase())) return found;
  // Rebuilt without the field rather than destructured around it: an
  // unused binding is what the rest-spread form leaves behind, and the
  // lint rule is right that it reads as a mistake.
  const kept: ExtractedProduct = { ...found };
  delete kept.fabricComposition;
  return kept;
}
