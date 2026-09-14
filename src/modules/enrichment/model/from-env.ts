import type { ExtractionModel } from "../../../lib/contracts";
import { env } from "../../../env";
import { createOpenRouterModel } from "./openrouter";

/**
 * The model rung with this Worker's secret, or nothing.
 *
 * Nothing is the default and a supported state, not a degraded one: with no
 * `OPENROUTER_API_KEY` the ladder stops at `text`, which already answers
 * seven of the eight sampled pages. Law 5 — a missing optional upstream
 * must never fail the work that would have used it.
 *
 * **The model and its provider are constants here, and that is where the
 * owner's eval decision lands** (D-32). They are not secrets and not
 * per-request, so a binding would be ceremony; they are a choice with
 * accuracy and cost behind it, so they are written where the choice is
 * reviewable rather than read from an environment nobody diffs.
 */
const MODEL = "openai/gpt-5.6-luna";

/**
 * Pinned because structured output is a property of the *endpoint*: of the
 * seven serving this model, Amazon Bedrock's reports
 * `structured_outputs: false` while OpenAI's and Azure's report true. See
 * `openrouter.ts`.
 */
const PROVIDER = "OpenAI";

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
  return createOpenRouterModel(apiKey, {
    model: MODEL,
    provider: PROVIDER,
    fetchImpl,
  });
}

export function extractionModelFromEnv(): ExtractionModel | undefined {
  return extractionModelFor(env.OPENROUTER_API_KEY);
}
