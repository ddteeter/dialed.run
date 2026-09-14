import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  extractionModelFor,
  extractionModelFromEnv,
} from "../../../src/modules/enrichment/model/from-env";

/**
 * Whether there is a model at all. Unconfigured is the default and a
 * supported state — the ladder already answers seven of the eight sampled
 * pages without one — so "no key, no model" is the behaviour under test
 * rather than a degradation to apologise for.
 */

describe("extractionModelFor", () => {
  it("builds a model when there is a key", () => {
    expect(extractionModelFor("or-key")).toBeDefined();
  });

  it("builds nothing when there is no key", () => {
    expect(extractionModelFor(undefined)).toBeUndefined();
  });

  it("builds nothing for an empty key, which is how an unset secret arrives", () => {
    // The same trap `modules/ops/sentry.ts` records for the Sentry DSN: an
    // empty value is not a value, and treating it as one made the reporter
    // throw on construction.
    expect(extractionModelFor("")).toBeUndefined();
  });
});

const providerSchema = z.object({ order: z.array(z.string()) });
const requestSchema = z.object({
  model: z.string(),
  provider: providerSchema,
});

function sentBody(fetchImpl: ReturnType<typeof answering>) {
  const body = fetchImpl.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new TypeError("body was not a string");
  return requestSchema.parse(JSON.parse(body));
}

/**
An empty but well-formed completion — enough to reach the request.
*/
const emptyCompletion: typeof fetch = () =>
  Promise.resolve(Response.json({ choices: [{ message: { content: "{}" } }] }));

function answering() {
  return vi.fn(emptyCompletion);
}

describe("the choice the eval makes (D-32)", () => {
  it("names the model and pins its provider", async () => {
    // The owner's decision lives here as two constants rather than in an
    // environment nobody diffs: they are not secrets and not per-request,
    // and they carry accuracy and cost behind them.
    const fetchImpl = answering();
    await extractionModelFor("or-key", fetchImpl)?.extract("100% merino", {
      url: "https://shop.example.com/p",
    });

    const body = sentBody(fetchImpl);
    expect(body.model).toBe("openai/gpt-5.6-luna");
    // Pinned because structured output is a property of the *endpoint*: of
    // the seven serving this model, Amazon Bedrock's reports
    // `structured_outputs: false`.
    expect(body.provider.order).toStrictEqual(["OpenAI"]);
  });
});

describe("extractionModelFromEnv", () => {
  it("builds one from this Worker's secret", () => {
    // The stand-in key in `test/wrangler.test.jsonc`: a secret cannot be
    // set from inside the isolate, so without it this shell is unreachable.
    const model = extractionModelFromEnv();
    expect(model).toBeDefined();
  });
});
