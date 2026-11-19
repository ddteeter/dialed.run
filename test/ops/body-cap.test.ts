import { describe, expect, it } from "vitest";

import serverSource from "../../src/server.ts?raw";
import { maxPhotoBytes } from "../../src/lib/photo-constraints";
import {
  MULTIPART_BODY_LIMIT,
  OTHER_BODY_LIMIT,
  bodyLimitFor,
  boundedRequest,
} from "../../src/modules/ops/edge/body-cap";
import { MAX_IMPORT_BYTES } from "../../src/modules/runs";
import { withoutComments } from "../architecture/source-text";

/**
 * SA-L05: the Worker bounds a request body before the framework reads it.
 */

const URL_ = "https://dialed.test/_serverFn/x";

function posting(
  body: BodyInit | null,
  headers: Record<string, string> = {},
): Request {
  return new Request(URL_, { method: "POST", body, headers });
}

/**
 * A body the size of `bytes`, sent as a stream so it carries no length.
 */
function streamOf(bytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(64 * 1024);
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunk.byteLength, bytes - sent);
      controller.enqueue(chunk.subarray(0, size));
      sent += size;
    },
  });
}

function asRequest(answer: Request | Response): Request {
  if (answer instanceof Request) return answer;
  throw new Error(`expected a request, got ${String(answer.status)}`);
}

describe("the ceilings", () => {
  it("gives a multipart upload room for the largest file, and anything else a megabyte", () => {
    expect(MULTIPART_BODY_LIMIT).toBe(
      Math.max(MAX_IMPORT_BYTES, maxPhotoBytes) + 1024 * 1024,
    );
    expect(MULTIPART_BODY_LIMIT).toBe(26 * 1024 * 1024);
    expect(OTHER_BODY_LIMIT).toBe(1024 * 1024);
  });

  it("chooses by content type, in any case", () => {
    const multipart = "multipart/form-data; boundary=x";
    const limitAs = (type: string) =>
      bodyLimitFor(posting("", { "content-type": type }));
    expect(limitAs(multipart)).toBe(MULTIPART_BODY_LIMIT);
    expect(limitAs(multipart.toUpperCase())).toBe(MULTIPART_BODY_LIMIT);
    expect(limitAs("application/json")).toBe(OTHER_BODY_LIMIT);
    expect(bodyLimitFor(new Request(URL_))).toBe(OTHER_BODY_LIMIT);
  });
});

async function answerTo(request: Request): Promise<Request | Response> {
  return boundedRequest(request);
}

async function refusal(request: Request): Promise<Response> {
  const answer = await answerTo(request);
  if (answer instanceof Response) return answer;
  throw new Error("expected a 413");
}

async function passed(request: Request): Promise<Request> {
  return asRequest(await answerTo(request));
}

describe("boundedRequest", () => {
  it("passes a request with no body as it is", async () => {
    const get = new Request(URL_);
    expect(await answerTo(get)).toBe(get);
  });

  it("answers 413 to a body that declares more than its ceiling", async () => {
    const response = await refusal(
      posting("x", { "content-length": String(OTHER_BODY_LIMIT + 1) }),
    );
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Request body too large");
  });

  it("answers 413 to a body that passes its ceiling as it is read", async () => {
    const response = await refusal(posting(streamOf(OTHER_BODY_LIMIT + 1)));
    expect(response.status).toBe(413);
  });

  it("passes a body at its ceiling in full, as it was sent", async () => {
    const request = await passed(posting(streamOf(OTHER_BODY_LIMIT)));
    expect(request.method).toBe("POST");
    expect(request.url).toBe(URL_);
    const body = await request.arrayBuffer();
    expect(body.byteLength).toBe(OTHER_BODY_LIMIT);

    const json = await passed(
      posting('{"a":1}', { "content-type": "application/json" }),
    );
    expect(json.headers.get("content-type")).toBe("application/json");
    expect(await json.json()).toStrictEqual({ a: 1 });
  });

  it("lets a multipart body run to its own ceiling", async () => {
    const sent = posting(streamOf(OTHER_BODY_LIMIT + 1), {
      "content-type": "multipart/form-data; boundary=x",
    });
    const request = await passed(sent);
    const body = await request.arrayBuffer();
    expect(body.byteLength).toBe(OTHER_BODY_LIMIT + 1);
  });

  it("does not turn another failure into a 413", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError("the connection dropped"));
      },
    });
    await expect(answerTo(posting(broken))).rejects.toStrictEqual(
      new TypeError("the connection dropped"),
    );
  });

  it("is what the Worker entry hands the app, before anything reads the body", () => {
    const code = withoutComments(serverSource);
    const bounded = code.indexOf(
      "const bounded = await boundedRequest(request);",
    );
    expect(bounded).toBeGreaterThan(0);
    expect(code.indexOf("startFetch(bounded")).toBeGreaterThan(bounded);
    expect(code).not.toContain("startFetch(request");
  });
});
