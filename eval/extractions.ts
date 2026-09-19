import type { ExtractedProduct, FabricComposition } from "../src/lib/contracts";
import { runLadder } from "../src/modules/enrichment/ladder";
import {
  createChatCompletionsModel,
  OPENROUTER_ENDPOINT,
} from "../src/modules/enrichment/model/chat-completions";
import { pageTextFor } from "../src/modules/enrichment/model/page-text";

/**
 * One page, extracted every way we know, so the ways can be compared.
 *
 * The deterministic ladder is the thing under test. The models are the
 * second opinion — not an oracle, which is why disagreement is *reported*
 * rather than scored, and why more than one is run: two models agreeing
 * against the deterministic pass is evidence; one model differing is a
 * question.
 */

export interface Candidate {
  /**
  `deterministic`, or the model id.
  */
  by: string;
  composition: FabricComposition | undefined;
  name: string | undefined;
  error: string | undefined;
}

export interface PageExtractions {
  url: string;
  brand: string;
  category: string;
  /**
  Which deterministic rung answered, so a miss can be traced to a rung.
  */
  rung: string;
  candidates: Candidate[];
}

export interface ModelChoice {
  id: string;
  provider: string;
}

export async function extractEveryWay(
  page: { url: string; brand: string; category: string; html: string },
  models: readonly ModelChoice[],
  apiKey: string,
): Promise<PageExtractions> {
  const ladder = runLadder(new URL(page.url), page.html);
  const candidates: Candidate[] = [
    {
      by: "deterministic",
      composition: ladder.extracted.fabricComposition,
      name: ladder.extracted.name,
      error: undefined,
    },
  ];

  const text = pageTextFor(page.html);
  for (const choice of models) {
    candidates.push(await askOne(choice, apiKey, text, page.url));
  }

  return {
    url: page.url,
    brand: page.brand,
    category: page.category,
    rung: ladder.rung,
    candidates,
  };
}

/**
 * One model's answer, or the reason there is none.
 *
 * A model that fails is a row in the table rather than the end of the run:
 * an eval that aborts on the first upstream hiccup measures nothing, and a
 * model that fails *often* is itself a finding about that model.
 */
async function askOne(
  choice: ModelChoice,
  apiKey: string,
  text: string,
  url: string,
): Promise<Candidate> {
  // Through OpenRouter, where production goes to OpenAI directly: the
  // eval compares several vendors' models on one key, which is the one
  // thing the router is still for.
  const model = createChatCompletionsModel(apiKey, {
    endpoint: OPENROUTER_ENDPOINT,
    model: choice.id,
    provider: choice.provider,
    // Generous on purpose — see `OpenRouterOptions.timeoutMs`. The eval
    // asks whether a model can extract, not whether it fits production's
    // bound; the first run answered the second question and reported it as
    // the first.
    timeoutMs: 120_000,
  });
  try {
    const found: ExtractedProduct = await model.extract(text, { url });
    return {
      by: choice.id,
      composition: found.fabricComposition,
      name: found.name,
      error: undefined,
    };
  } catch (error: unknown) {
    return {
      by: choice.id,
      composition: undefined,
      name: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
