import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import { classifierFromEnv } from "../../src/modules/safety";
import {
  classifyImage,
  MODERATION_MODEL,
  ModerationError,
} from "../../src/modules/safety/classifier/moderation";
import type { ModerationResult } from "../../src/modules/safety/classifier/moderation";

/**
 * The call itself: what we send, what we accept back, and what we do when
 * the far side misbehaves.
 *
 * This is the one piece of the screening path that talks to somebody
 * else, so every one of law 4's requirements — a timeout, a zod parse — is
 * a property worth pinning rather than trusting.
 */

const BYTES = new Uint8Array([1, 2, 3]);
const ORIGINAL_KEY = env.OPENAI_API_KEY;

function respondWith(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue(Response.json(body, { status }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) {
    Reflect.deleteProperty(env, "OPENAI_API_KEY");
  } else {
    Reflect.set(env, "OPENAI_API_KEY", ORIGINAL_KEY);
  }
});

/**
 * Typed reads of what the stubbed fetch was called with. Destructuring the
 * mock's calls directly yields `any`, which the lint rules reject — and
 * which would let a wrong call shape pass unnoticed.
 */
type FetchSpy = ReturnType<typeof vi.fn>;

function initOf(spy: FetchSpy): RequestInit {
  const [, init] = (spy.mock.calls[0] ?? []) as [unknown, RequestInit];
  return init;
}
function urlOf(spy: FetchSpy): string {
  const [url] = (spy.mock.calls[0] ?? []) as [string];
  return url;
}
function headersOf(spy: FetchSpy): Record<string, string> {
  return initOf(spy).headers as Record<string, string>;
}
function bodyOf(spy: FetchSpy): string {
  const { body } = initOf(spy);
  return typeof body === "string" ? body : "";
}

const CLEAN_RESPONSE = {
  results: [{ flagged: false, category_scores: { sexual: 0.01 } }],
};

describe("the request", () => {
  it("names the model and carries the key", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json(CLEAN_RESPONSE));
    vi.stubGlobal("fetch", fetchSpy);

    await classifyImage({
      bytes: BYTES,
      contentType: "image/jpeg",
      apiKey: "sk-test",
    });

    expect(urlOf(fetchSpy)).toBe("https://api.openai.com/v1/moderations");
    expect(headersOf(fetchSpy).authorization).toBe("Bearer sk-test");
    // The literal, not the constant: `toContain(MODERATION_MODEL)` is
    // satisfied by any value the constant happens to hold, including an
    // empty string. The model name is a contract with OpenAI.
    expect(MODERATION_MODEL).toBe("omni-moderation-latest");
    expect(bodyOf(fetchSpy)).toContain("omni-moderation-latest");
  });

  it("posts JSON, which is the only shape the endpoint reads", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json(CLEAN_RESPONSE));
    vi.stubGlobal("fetch", fetchSpy);

    await classifyImage({
      bytes: BYTES,
      contentType: "image/jpeg",
      apiKey: "sk-test",
    });

    // A GET, or a body sent without the content type, reaches the same
    // endpoint and fails there — an outage this app would report as "we
    // could not check this photo" for every photo, forever.
    expect(initOf(fetchSpy).method).toBe("POST");
    expect(headersOf(fetchSpy)["content-type"]).toBe("application/json");
    expect(bodyOf(fetchSpy)).toContain('"type":"image_url"');
  });

  it("sends the image as a data URL, not a link", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json(CLEAN_RESPONSE));
    vi.stubGlobal("fetch", fetchSpy);

    await classifyImage({
      bytes: BYTES,
      contentType: "image/png",
      apiKey: "sk-test",
    });

    // In production the photos are R2 objects behind an authenticated
    // route, so a URL OpenAI could fetch is not a thing this app has.
    const body = bodyOf(fetchSpy);
    expect(body).toContain("data:image/png;base64,");
    expect(body).not.toContain("://");
  });

  it("encodes an image bigger than one chunk correctly", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json(CLEAN_RESPONSE));
    vi.stubGlobal("fetch", fetchSpy);

    // Over 32768 bytes, so the base64 loop runs more than once. The
    // chunking exists because spreading a multi-megabyte array into one
    // String.fromCodePoint call overflows the stack — and a loop that
    // stepped wrongly would silently corrupt or truncate the photo the
    // classifier is asked about.
    const big = new Uint8Array(70_000).fill(65);

    await classifyImage({ bytes: big, contentType: "image/jpeg", apiKey: "k" });

    const body = bodyOf(fetchSpy);
    const encoded = /base64,([^"]+)/.exec(body)?.[1] ?? "";
    expect(atob(encoded)).toHaveLength(big.length);
    expect(atob(encoded)).toBe("A".repeat(70_000));
  });

  it("carries a timeout, because law 4 says every outbound fetch does", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json(CLEAN_RESPONSE));
    vi.stubGlobal("fetch", fetchSpy);

    await classifyImage({
      bytes: BYTES,
      contentType: "image/jpeg",
      apiKey: "k",
    });

    // A slow upstream must never wedge a photo upload or a cron sweep.
    expect(initOf(fetchSpy).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the response", () => {
  it("reads the scores for the image-capable categories", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        results: [
          {
            flagged: true,
            category_scores: { sexual: 0.9, violence: 0.2 },
          },
        ],
      }),
    );

    const result = await classifyImage({
      bytes: BYTES,
      contentType: "image/jpeg",
      apiKey: "k",
    });

    expect(result.flagged).toBe(true);
    expect(result.scores.sexual).toBeCloseTo(0.9);
    expect(result.scores.violence).toBeCloseTo(0.2);
  });

  it("defaults a category the response omits to zero", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ results: [{ flagged: false, category_scores: {} }] }),
    );

    const result = await classifyImage({
      bytes: BYTES,
      contentType: "image/jpeg",
      apiKey: "k",
    });

    // OpenAI adds categories over time and drops none, so a missing key
    // is far likelier to be a shape change than a signal — and losing a
    // whole photo's score over one would be the wrong trade.
    expect(result.scores["self-harm"]).toBe(0);
  });
});

/**
One attempt against whatever `fetch` is currently stubbed to do.
*/
function classifyJpeg(): Promise<ModerationResult> {
  return classifyImage({
    bytes: BYTES,
    contentType: "image/jpeg",
    apiKey: "k",
  });
}

describe("when the far side misbehaves", () => {
  it("throws on a non-2xx, naming the status", async () => {
    vi.stubGlobal("fetch", respondWith({ error: "nope" }, 503));

    // The status is the whole diagnostic. 401 (a bad key), 429 (rate
    // limited) and 503 (their outage) want three different responses
    // from whoever reads the log, and "moderation failed" separates
    // none of them.
    await expect(classifyJpeg()).rejects.toThrow(ModerationError);
    await expect(classifyJpeg()).rejects.toThrow(/503/u);
  });

  it("throws rather than reading a result that is not there", async () => {
    vi.stubGlobal("fetch", respondWith({ results: [] }));

    // A well-formed response with nothing in it. Treating it as "not
    // flagged" would publish a photo nobody screened — degradation that
    // produces a WRONG answer rather than none.
    await expect(
      classifyImage({ bytes: BYTES, contentType: "image/jpeg", apiKey: "k" }),
    ).rejects.toThrow(/no results/u);
  });

  it("throws rather than guessing when the body is the wrong shape", async () => {
    vi.stubGlobal("fetch", respondWith({ nothing: "useful" }));

    // Parsed, not cast (CLAUDE.md trust boundaries). The caller turns
    // this into `deferred`, which leaves the photo pending — far better
    // than inventing a verdict from a body we did not understand.
    await expect(
      classifyImage({ bytes: BYTES, contentType: "image/jpeg", apiKey: "k" }),
    ).rejects.toThrow();
  });

  it("throws when there are no results at all", async () => {
    vi.stubGlobal("fetch", respondWith({ results: [] }));

    await expect(
      classifyImage({ bytes: BYTES, contentType: "image/jpeg", apiKey: "k" }),
    ).rejects.toThrow();
  });
});

describe("assembling the classifier from the environment", () => {
  it("returns nothing when the key is unset", () => {
    Reflect.deleteProperty(env, "OPENAI_API_KEY");
    // A supported state, not an outage: photos stay pending, owners see
    // their own, and the retry cron picks up the backlog once a key
    // exists (law 5).
    expect(classifierFromEnv()).toBeUndefined();
  });

  it("returns nothing for an empty key", () => {
    Reflect.set(env, "OPENAI_API_KEY", "");
    expect(classifierFromEnv()).toBeUndefined();
  });

  it("returns nothing when the binding is not a string", () => {
    Reflect.set(env, "OPENAI_API_KEY", 42);
    expect(classifierFromEnv()).toBeUndefined();
  });

  it("returns a classifier that uses the configured key", async () => {
    Reflect.set(env, "OPENAI_API_KEY", "sk-from-env");
    const fetchSpy = vi.fn().mockResolvedValue(Response.json(CLEAN_RESPONSE));
    vi.stubGlobal("fetch", fetchSpy);

    const classify = classifierFromEnv();
    expect(classify).toBeDefined();
    await classify?.({ bytes: BYTES, contentType: "image/jpeg" });

    expect(headersOf(fetchSpy).authorization).toBe("Bearer sk-from-env");
  });
});
