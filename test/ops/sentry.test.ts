import { afterEach, describe, expect, it, vi } from "vitest";

import { reportException } from "../../src/modules/ops/sentry";

/**
 * The error reporter, which is the one thing that must not fail.
 *
 * Half of it had no coverage at all: `SENTRY_DSN` is unset in the test
 * bindings, so every test took the disabled path and the Toucan branch was
 * never entered. Six mutants sat in there, including one that deletes the
 * `captureException` call outright — a reporter that silently reports
 * nothing, which is indistinguishable from a quiet system.
 */

const DSN = "https://abc123@o1.ingest.sentry.io/42";

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("with no DSN configured", () => {
  it("logs to the console instead, carrying the context and the error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const boom = new Error("boom");

    reportException(undefined, boom, { runId: "r1" });

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      { runId: "r1" },
      boom,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats an empty DSN the same as an unset one", () => {
    // An unset wrangler secret reads back as "" as often as undefined, and
    // Toucan throws on an empty DSN — which would turn "no reporter" into
    // a crash inside the error path itself.
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    reportException("", new Error("boom"), { runId: "r2" });

    expect(error).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("with a DSN configured", () => {
  it("sends the event to that DSN's ingest endpoint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    const error = vi.spyOn(console, "error").mockImplementation(nothing);

    reportException(DSN, new Error("boom"), { runId: "r3" });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    const [input] = fetchSpy.mock.calls[0] ?? [];
    const url = input instanceof Request ? input.url : String(input);
    expect(url).toContain("o1.ingest.sentry.io/api/42/envelope/");
    // Never both: the console line exists because Sentry is not there.
    expect(error).not.toHaveBeenCalled();
  });

  it("attaches the context to the event it sends", async () => {
    // Law 7: context enough to act on. An event with no `dialed` context
    // is an error with no entity attached to it.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));

    reportException(DSN, new Error("boom"), { runId: "r4", surface: "import" });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = init?.body;
    const envelope = typeof body === "string" ? body : "";
    // The envelope is newline-delimited JSON; the event is its last line.
    // Asserting the *key* matters as much as the values: an unnamed
    // context still carries the ids, but nothing in Sentry knows to look
    // under it.
    expect(contextsOf(envelope)).toMatchObject({
      dialed: { runId: "r4", surface: "import" },
    });
  });
});

/**
The `contexts` object of the event carried in a Sentry envelope body.
*/
function contextsOf(envelope: string): unknown {
  let contexts: unknown;
  for (const line of envelope.split("\n")) {
    if (line.length === 0) continue;
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null && "contexts" in parsed) {
      contexts = parsed.contexts;
    }
  }
  if (contexts === undefined) {
    throw new Error(`no event with contexts in envelope: ${envelope}`);
  }
  return contexts;
}
