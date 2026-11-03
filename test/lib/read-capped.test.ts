import { describe, expect, it } from "vitest";

import { readCappedText } from "../../src/lib/read-capped";

/**
 * A body delivered in these chunks, recording whether the reader was
 * cancelled, which is how a stream too long to finish is let go of.
 */
function streamed(chunks: readonly Uint8Array[]): {
  response: Response;
  wasCancelled: () => boolean;
} {
  let isCancelled = false;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() {
      isCancelled = true;
    },
  });
  return { response: new Response(body), wasCancelled: () => isCancelled };
}

const tooLarge = (detail: string) => new Error(detail);

const bytes = (text: string) => new TextEncoder().encode(text);

describe("readCappedText", () => {
  it("reads a body up to and including the limit", async () => {
    await expect(
      readCappedText(new Response("abcd"), 4, tooLarge),
    ).resolves.toBe("abcd");
  });

  it("refuses a body that declares more than the limit, before reading it", async () => {
    const { response, wasCancelled } = streamed([bytes("ab")]);
    response.headers.set("content-length", "5");
    await expect(readCappedText(response, 4, tooLarge)).rejects.toThrow(
      /^declares 5 bytes$/u,
    );
    expect(wasCancelled()).toBe(false);
    expect(response.bodyUsed).toBe(false);
  });

  it("stops reading a body that goes past the limit, and lets it go", async () => {
    const { response, wasCancelled } = streamed([
      bytes("abc"),
      bytes("de"),
      bytes("never read"),
    ]);
    await expect(readCappedText(response, 4, tooLarge)).rejects.toThrow(
      /^exceeded 4 bytes$/u,
    );
    expect(wasCancelled()).toBe(true);
  });

  it("counts bytes across chunks, not per chunk", async () => {
    const { response } = streamed([bytes("ab"), bytes("cd"), bytes("e")]);
    await expect(readCappedText(response, 4, tooLarge)).rejects.toThrow(
      /exceeded/u,
    );
  });

  it("decodes a character split between two chunks", async () => {
    const encoded = bytes("é");
    const { response } = streamed([encoded.slice(0, 1), encoded.slice(1)]);
    await expect(readCappedText(response, 4, tooLarge)).resolves.toBe("é");
  });

  it("reads a request's body as well as a response's", async () => {
    const request = new Request("https://dialed.test/", {
      method: "POST",
      body: "hi",
    });
    await expect(readCappedText(request, 4, tooLarge)).resolves.toBe("hi");
  });

  it("reads a message with no body as nothing", async () => {
    await expect(
      readCappedText(new Request("https://dialed.test/"), 4, tooLarge),
    ).resolves.toBe("");
  });
});
