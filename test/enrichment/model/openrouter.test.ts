import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { garmentCategories } from "../../../src/lib/contracts";
import { knownFibres } from "../../../src/modules/enrichment/fibres";

import {
  createOpenRouterModel,
  ModelUnavailableError,
} from "../../../src/modules/enrichment/model/openrouter";

/**
 * The LLM rung as a network boundary. A model is a non-deterministic
 * upstream, so every failure here is retryable — the packet's wording is
 * "a malformed model response is a retryable failure, not a crash" — and
 * the cases below are the shapes that failure actually takes: a provider
 * rejecting the request, prose where JSON was asked for, JSON of the wrong
 * shape, and an answer that is well-formed but not a valid extraction.
 */

const KEY = "or-test-key";
const OPTIONS = { model: "test/model", provider: "TestProvider" };
const PAGE_TEXT = "Rover Tee\n100% merino wool";
const HINT = { url: "https://shop.example.com/products/tee" };

function answering(content: string) {
  const impl: typeof fetch = () =>
    Promise.resolve(Response.json({ choices: [{ message: { content } }] }));
  return vi.fn(impl);
}

function raw(body: string, status = 200) {
  const impl: typeof fetch = () => Promise.resolve(new Response(body, { status }));
  return vi.fn(impl);
}

function modelWith(fetchImpl: typeof fetch) {
  return createOpenRouterModel(KEY, { ...OPTIONS, fetchImpl });
}

/**
 * The request body, parsed rather than cast — the repo's own trust-boundary
 * rule, and it earns its keep here: the assertions below read typed fields
 * instead of indexing an `unknown`, and a request that stops carrying one
 * fails at the parse with the whole shape in view.
 */
const providerSchema = z.object({
  order: z.array(z.string()),
  allow_fallbacks: z.boolean(),
});
const requiredKeysSchema = z.object({ required: z.array(z.string()) });
const jsonSchemaSchema = z.object({
  name: z.string(),
  strict: z.boolean(),
  schema: requiredKeysSchema,
});
const responseFormatSchema = z.object({
  type: z.string(),
  json_schema: jsonSchemaSchema,
});
const messageSchema = z.object({ role: z.string(), content: z.string() });
const requestSchema = z.object({
  model: z.string(),
  provider: providerSchema,
  temperature: z.number(),
  response_format: responseFormatSchema,
  messages: z.array(messageSchema),
});

function sentBody(fetchImpl: ReturnType<typeof answering>) {
  const body = fetchImpl.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new TypeError("body was not a string");
  return requestSchema.parse(JSON.parse(body));
}

/**
 * A model's answer, as the JSON it arrives as. Written as text rather than
 * an object because that is what a completion is — and because `null` is
 * how the request asks the model to say "not stated", which the repo does
 * not write as a literal.
 */
const FOUND = `{
    "name": "Rover Tee",
    "brand": "Janji",
    "categoryHint": "top",
    "fabricComposition": {
      "verbatim": "100% merino wool",
      "parts": [{ "part": null, "materials": [{ "material": "merino wool", "pct": 100 }] }]
    },
    "weight": null,
    "fabric": "merino",
    "windResistant": null,
    "waterResistant": null,
    "imageUrl": null
  }`;


describe("createOpenRouterModel: the request", () => {
  it("asks the pinned provider, with fallbacks off", async () => {
    // Structured output is per *endpoint*, not per model: measured, seven
    // endpoints serve `openai/gpt-5.6-luna` and the Amazon Bedrock one does
    // not support it. Unpinned, a request can be routed to an endpoint that
    // ignores `response_format` and answers with prose — a success nobody
    // can parse, not an error.
    const fetchImpl = answering(FOUND);
    await modelWith(fetchImpl).extract(PAGE_TEXT, HINT);

    const body = sentBody(fetchImpl);
    expect(body.provider).toStrictEqual({
      order: ["TestProvider"],
      allow_fallbacks: false,
    });
    expect(body.model).toBe("test/model");
  });

  it("asks for strict structured output against the derived schema", async () => {
    const fetchImpl = answering(FOUND);
    await modelWith(fetchImpl).extract(PAGE_TEXT, HINT);

    const format = sentBody(fetchImpl).response_format;
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.required).toContain("fabricComposition");
    expect(format.json_schema.schema.required).not.toContain("extras");
  });

  it("sends the page and its URL, and asks for nothing creative", async () => {
    const fetchImpl = answering(FOUND);
    await modelWith(fetchImpl).extract(PAGE_TEXT, HINT);

    const { temperature, messages } = sentBody(fetchImpl);
    expect(temperature).toBe(0);
    expect(messages[0]?.role).toBe("system");
    // The page is the *user* turn. Sent as anything else, a provider either
    // rejects it or folds it into the instructions, where page text becomes
    // something the model takes orders from.
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain(HINT.url);
    expect(messages[1]?.content).toContain("100% merino wool");
  });

  it("carries the key as a bearer token and a timeout", async () => {
    const fetchImpl = answering(FOUND);
    await modelWith(fetchImpl).extract(PAGE_TEXT, HINT);
    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  it("falls back to a real default timeout, never to no timeout at all", async () => {
    // The bound is optional so the eval can be patient (a slow provider is
    // not an incapable one), and the hazard of an optional bound is that a
    // missing one degrades to zero rather than to the default — which
    // aborts every request instantly. Observed by letting the clock run a
    // beat and asking the signal, since a 30-second signal and a
    // 90-second one look identical from outside.
    let abortedAfterATick: boolean | undefined;
    const watching: typeof fetch = async (_input, init) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      abortedAfterATick = init?.signal?.aborted;
      return Response.json({ choices: [{ message: { content: FOUND } }] });
    };

    await modelWith(watching).extract(PAGE_TEXT, HINT);

    expect(abortedAfterATick).toBe(false);
  });

  it("names the schema, because a provider matches the answer to it", async () => {
    const fetchImpl = answering(FOUND);
    await modelWith(fetchImpl).extract(PAGE_TEXT, HINT);
    expect(sentBody(fetchImpl).response_format.json_schema.name).toBe(
      "extracted_product",
    );
  });

  it("tells the model to report, not to infer", async () => {
    // Each of these was chosen against observed behaviour rather than
    // taste, so each is pinned. A model that knows the brand will tell you
    // a Janji tee is merino when the page never said so; "null" is how the
    // strict schema says "not on the page"; and `verbatim` is evidence for
    // a later, better parser (D-31), which a paraphrase would destroy.
    const fetchImpl = answering(FOUND);
    await modelWith(fetchImpl).extract(PAGE_TEXT, HINT);
    const system = sentBody(fetchImpl).messages[0]?.content ?? "";

    // Read as sentences, not run together: the instructions are joined,
    // and a prompt reading "page states.Never infer" is one a model parses
    // worse for no reason.
    expect(system).toContain("only what the page states. Never infer");
    expect(system).toContain("return null");
    expect(system).toContain("copied from the page exactly");
  });

  it("teaches the model what a fibre is, from the vocabulary", async () => {
    // **Where `fibres.ts` went when it stopped being a gate**
    // (2026-09-14). The eval measured the need: models called
    // `Coreloft™ 80`, `Arato™ 15`, `2:09 Mesh` and `decoration` materials.
    // And the hint is examples, never an allow-list — a shop may state
    // `100% Primeflex`, and dropping it for not being on our list was the
    // gate's mistake, which the prompt must not inherit.
    const fetchImpl = answering(FOUND);
    await modelWith(fetchImpl).extract(PAGE_TEXT, HINT);
    const system = sentBody(fetchImpl).messages[0]?.content ?? "";

    expect(system).toContain(
      `A material is a fibre, such as: ${knownFibres().join(", ")}.`,
    );
    expect(system).toContain("trade name is not a material");
    // And where to put it instead — a trade name is a *part label*, which
    // is how `Coreloft™ 80` and `PacerWeave body` reach the row without
    // being claimed as fibres.
    expect(system).toContain("part label where the page puts it");
    expect(system).toContain("not in that list, report it as written");
  });

  it("names the category vocabulary from the contract, not from memory", async () => {
    // Derived: the eight words are the garment category enum, and a copy
    // typed out here would be a rival truth the compiler cannot check.
    const fetchImpl = answering(FOUND);
    await modelWith(fetchImpl).extract(PAGE_TEXT, HINT);
    const system = sentBody(fetchImpl).messages[0]?.content ?? "";

    expect(system).toContain(`categoryHint must be one of: ${garmentCategories.join(", ")}.`);
    for (const category of garmentCategories) {
      expect(system, category).toContain(category);
    }
  });
});

describe("createOpenRouterModel: the answer", () => {
  it("parses what the model found, dropping the nulls it used for 'not stated'", async () => {
    const found = await modelWith(answering(FOUND)).extract(PAGE_TEXT, HINT);

    expect(found).toStrictEqual({
      name: "Rover Tee",
      brand: "Janji",
      categoryHint: "top",
      fabricComposition: {
        verbatim: "100% merino wool",
        parts: [{ materials: [{ material: "merino wool", pct: 100 }] }],
      },
      fabric: "merino",
    });
  });

  it("keeps a false, which is a finding and not an absence", async () => {
    const content = JSON.stringify({ windResistant: false });
    const found = await modelWith(answering(content)).extract(PAGE_TEXT, HINT);
    expect(found).toStrictEqual({ windResistant: false });
  });
});

/**
The error a call refused with. Every case below reads one.
*/
async function refuses(fetchImpl: typeof fetch): Promise<unknown> {
  try {
    await modelWith(fetchImpl).extract(PAGE_TEXT, HINT);
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to fail, and it did not");
}

/**
An envelope with no choices in it — a completion that completed nothing.
*/
const noChoices: typeof fetch = () => Promise.resolve(Response.json({ choices: [] }));

/**
The fetch itself failing, rather than the model refusing.
*/
const networkDown: typeof fetch = () =>
  Promise.reject(new TypeError("network down"));

describe("createOpenRouterModel: every way it can fail", () => {
  it("reports the provider's own complaint, not just the status", async () => {
    // The first 400 said "'propertyNames' is not permitted", which is the
    // difference between a fix and a week of guessing. A status alone is
    // not actionable.
    const body = JSON.stringify({
      error: { message: "Invalid schema for response_format" },
    });
    const error = await refuses(raw(body, 400));

    expect(error).toBeInstanceOf(ModelUnavailableError);
    // Named, because a consumer matches on it and a human reads it in a
    // DLQ report.
    expect(error).toMatchObject({ name: "ModelUnavailableError" });
    expect(String(error)).toContain("400");
    expect(String(error)).toContain("Invalid schema for response_format");
  });

  it("trims a very long error body rather than carrying it whole", async () => {
    // The provider's complaint is what makes a 400 actionable, but an
    // upstream that answers with a page of HTML should not put a page of
    // HTML in a Sentry event.
    const error = await refuses(raw("x".repeat(5000), 500));
    expect(String(error).length).toBeLessThan(600);
    expect(String(error)).toContain("500");
  });

  it("fails on a body that is not JSON at all", async () => {
    const error = await refuses(raw("<html>gateway timeout</html>"));
    expect(error).toBeInstanceOf(ModelUnavailableError);
    expect(String(error)).toContain("did not match its contract");
  });

  it("fails on an envelope with no choices in it", async () => {
    // A completion that completed nothing. Reported as its own sentence
    // rather than defaulted to an empty string, which would go on to fail
    // as "not a valid extraction" and tell a reader the wrong thing.
    const error = await refuses(vi.fn(noChoices));
    expect(error).toBeInstanceOf(ModelUnavailableError);
    expect(String(error)).toContain("no completion");
  });

  it("fails on prose where JSON was asked for", async () => {
    // The unpinned-endpoint failure, seen from the inside: a perfectly
    // successful completion that ignored `response_format`.
    const error = await refuses(answering("Sure! This tee is 100% merino."));
    expect(String(error)).toContain("output did not match the contract");
  });

  it("fails on JSON the contract rejects", async () => {
    // A model that answers the right shape with the wrong values — here a
    // weight outside the enum — is not a usable extraction.
    const error = await refuses(answering(JSON.stringify({ weight: "chunky" })));
    expect(String(error)).toContain("output did not match the contract");
  });

  it("lets a network failure through as itself", async () => {
    // Not the model refusing: the fetch failing. The consumer treats both
    // as retryable, but nothing should dress one up as the other.
    const error = await refuses(vi.fn(networkDown));
    expect(error).toBeInstanceOf(TypeError);
  });
});
