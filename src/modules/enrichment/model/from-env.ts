import type { ExtractionModel } from "../../../lib/contracts";
import { env } from "../../../env";
import {
  createChatCompletionsModel,
  OPENAI_ENDPOINT,
} from "./chat-completions";

/**
 * The model rung with this Worker's secret, or nothing.
 *
 * Nothing is the default and a supported state, not a degraded one: with no
 * `OPENAI_API_KEY` the ladder stops at the declared rungs and the product
 * has a name and an image but no composition, which is a state the app
 * renders and a person can correct. Law 5 — a missing optional upstream
 * must never fail the work that would have used it.
 *
 * **The model is a constant here, and that is where the owner's eval
 * decision lands** (D-32). It is not a secret and not per-request, so a
 * binding would be ceremony; it is a choice with accuracy and cost behind
 * it, so it is written where the choice is reviewable rather than read from
 * an environment nobody diffs.
 *
 * **Straight to OpenAI, not through OpenRouter** (PR #72 review). The eval
 * needed one key across several vendors' models and still has it; the
 * production choice is one OpenAI model, so the router was a hop with
 * nothing left to route. The id is OpenAI's own — no `openai/` prefix, which
 * is OpenRouter's namespace.
 */
const MODEL = "gpt-5.6-luna";

/**
 * The decision, with the key handed in rather than read.
 *
 * Split for the reason `modules/ops/sentry.ts` gives for the same split: a
 * secret comes from the Worker's bindings, which a test cannot change from
 * inside the isolate, so the configured path could never be exercised
 * through the env-reading shell. With the key as a parameter, "no key, no
 * model" and "a key builds one" are both testable.
 */
export function extractionModelFor(
  apiKey: string | undefined,
  fetchImpl?: typeof fetch,
): ExtractionModel | undefined {
  // An unset secret arrives as an empty string as often as it does
  // undefined — `modules/ops/sentry.ts` records the same trap for the DSN,
  // where an empty value made the reporter throw on construction.
  if (apiKey === undefined || apiKey === "") return undefined;
  return createChatCompletionsModel(apiKey, {
    endpoint: OPENAI_ENDPOINT,
    model: MODEL,
    fetchImpl,
  });
}

export function extractionModelFromEnv(): ExtractionModel | undefined {
  return extractionModelFor(env.OPENAI_API_KEY);
}
