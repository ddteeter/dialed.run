import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openCheckIn,
  reportException,
  sentryEnvironmentFor,
  workerTarget,
} from "../../src/modules/ops/sentry";

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
const TARGET = { dsn: DSN, environment: "development" } as const;

/**
 * A keep-alive that holds nothing, for tests that do not ask about it.
 */
function keep(): void {
  /*
   * Deliberately empty.
   */
}

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

    reportException(
      { dsn: undefined, environment: "development" },
      keep,
      boom,
      {
        context: { runId: "r1" },
        tags: {},
      },
    );

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

    reportException(
      { dsn: "", environment: "development" },
      keep,
      new Error("boom"),
      {
        context: { runId: "r2" },
        tags: {},
      },
    );

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

    reportException(TARGET, keep, new Error("boom"), {
      context: { runId: "r3" },
      tags: {},
    });
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

    reportException(TARGET, keep, new Error("boom"), {
      context: { runId: "r4", surface: "import" },
      tags: {},
    });
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

/**
 * Every JSON line of every envelope the fetch spy was handed.
 */
function sentItems(fetchSpy: { mock: { calls: unknown[][] } }): unknown[] {
  return fetchSpy.mock.calls.flatMap((call) => {
    const init = call[1];
    const body =
      typeof init === "object" && init !== null && "body" in init
        ? init.body
        : undefined;
    const text = typeof body === "string" ? body : "";
    return text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line): unknown => JSON.parse(line));
  });
}

function checkInIdOf(item: unknown): unknown {
  return typeof item === "object" && item !== null && "check_in_id" in item
    ? item.check_in_id
    : undefined;
}

describe("the send outlives the invocation (audit finding 0.4)", () => {
  it("hands the in-flight send to waitUntil, rather than merely starting it", async () => {
    // Toucan only registers its fetch with the runtime when given a
    // context. Without this, a Worker that reports and then returns lets
    // the runtime cancel the send: the event is "reported" and never
    // arrives. What waitUntil holds must therefore be the send itself —
    // still pending while the fetch is, and settled only when it is —
    // which is what separates "registered" from "a function was called".
    const upstream = Promise.withResolvers<Response>();
    vi.spyOn(globalThis, "fetch").mockReturnValue(upstream.promise);
    const kept: Promise<unknown>[] = [];

    reportException(
      TARGET,
      (promise) => {
        kept.push(promise);
      },
      new Error("boom"),
      { context: { surface: "scheduled" }, tags: {} },
    );
    await vi.waitFor(() => {
      expect(kept).toHaveLength(1);
    });
    const [held] = kept;
    let isSettled = false;
    void held?.then(() => {
      isSettled = true;
    });
    await Promise.resolve();
    expect(isSettled).toBe(false);

    upstream.resolve(new Response("{}", { status: 200 }));

    await expect(held).resolves.toMatchObject({ statusCode: 200 });
  });

  it("never asks waitUntil for anything when there is no DSN", () => {
    vi.spyOn(console, "error").mockImplementation(nothing);
    const keepAlive = vi.fn();

    reportException(
      { dsn: undefined, environment: "development" },
      keepAlive,
      new Error("boom"),
      {
        context: {},
        tags: {},
      },
    );

    expect(keepAlive).not.toHaveBeenCalled();
  });
});

describe("grouping and tags (OPS-2)", () => {
  it("carries the fingerprint and the tags it was given", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));

    reportException(TARGET, keep, new Error("digest"), {
      context: { kind: "outbox" },
      tags: { digest: "daily", digest_kind: "outbox" },
      fingerprint: ["daily-digest", "outbox", "2026-09-25"],
    });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    expect(sentItems(fetchSpy)).toContainEqual(
      expect.objectContaining({
        fingerprint: ["daily-digest", "outbox", "2026-09-25"],
        tags: { digest: "daily", digest_kind: "outbox" },
      }),
    );
  });

  it("leaves grouping to Sentry when no fingerprint is given", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));

    reportException(TARGET, keep, new Error("ordinary"), {
      context: { runId: "r5" },
      tags: {},
    });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    const event = sentItems(fetchSpy).find(
      (item) => typeof item === "object" && item !== null && "contexts" in item,
    );
    expect(event).toBeDefined();
    expect(event).not.toHaveProperty("fingerprint");
  });
});

describe("cron check-ins (OPS-3)", () => {
  const MONITOR = { slug: "daily-digest", schedule: "0 12 * * *" };

  it("opens a firing with in_progress and the monitor's schedule", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    const kept: Promise<unknown>[] = [];

    openCheckIn(
      TARGET,
      (promise) => {
        kept.push(promise);
      },
      MONITOR,
    );
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    // The monitor config rides on the opening check-in, which is Sentry's
    // upsert: the monitor creates itself, so there is no dashboard step.
    expect(sentItems(fetchSpy)).toContainEqual(
      expect.objectContaining({
        monitor_slug: "daily-digest",
        status: "in_progress",
        monitor_config: {
          schedule: { type: "crontab", value: "0 12 * * *" },
          checkin_margin: 5,
          max_runtime: 10,
          timezone: "Etc/UTC",
        },
      }),
    );
    // A check-in is a send like any other and must outlive the firing.
    expect(kept).toHaveLength(1);
  });

  it("closes the same firing it opened, with the status it ended on", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));

    openCheckIn(TARGET, keep, MONITOR).finish("error");
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    const checkIns = sentItems(fetchSpy).filter(
      (item) =>
        typeof item === "object" && item !== null && "check_in_id" in item,
    );
    const [opened, closed] = checkIns;
    expect(opened).toMatchObject({ status: "in_progress" });
    expect(closed).toMatchObject({
      monitor_slug: "daily-digest",
      status: "error",
    });
    // Without the id, Sentry reads the close as a second, separate firing
    // and the opening one times out as a failure.
    const openedId = checkInIdOf(opened);
    expect(openedId).toMatch(/^[0-9a-f]{32}$/);
    expect(checkInIdOf(closed)).toBe(openedId);
  });

  it("does nothing at all without a DSN", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const keepAlive = vi.fn();

    openCheckIn(
      { dsn: undefined, environment: "development" },
      keepAlive,
      MONITOR,
    ).finish("ok");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(keepAlive).not.toHaveBeenCalled();
  });
});

describe("environment", () => {
  it("is production only for the production origin", () => {
    expect(sentryEnvironmentFor("https://dialed.run")).toBe("production");
    expect(sentryEnvironmentFor("http://localhost:3000")).toBe("development");
    expect(sentryEnvironmentFor("https://dialed.test")).toBe("development");
    // An unset var is a misconfigured deploy, and one that errs out of
    // alerts rather than a laptop erring into them.
    expect(sentryEnvironmentFor(undefined)).toBe("development");
  });

  it("reads this Worker's DSN and origin from its bindings", () => {
    // The test bindings carry no DSN and a non-production origin
    // (test/wrangler.test.jsonc), so this is the development target.
    expect(workerTarget()).toStrictEqual({
      dsn: undefined,
      environment: "development",
    });
  });

  it.each(["production", "development"] as const)(
    "tags an error event with %s",
    async (environment) => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("{}"));

      reportException({ dsn: DSN, environment }, keep, new Error("boom"), {
        context: { runId: "r6" },
        tags: {},
      });
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
      });

      const event = sentItems(fetchSpy).find(
        (item) =>
          typeof item === "object" && item !== null && "contexts" in item,
      );
      expect(event).toHaveProperty("environment", environment);
    },
  );

  it.each(["production", "development"] as const)(
    "tags both check-ins of a firing with %s",
    async (environment) => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("{}"));

      openCheckIn({ dsn: DSN, environment }, keep, {
        slug: "weather-retry",
        schedule: "0 * * * *",
      }).finish("ok");
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      const checkIns = sentItems(fetchSpy).filter(
        (item) =>
          typeof item === "object" && item !== null && "check_in_id" in item,
      );
      expect(checkIns).toStrictEqual([
        expect.objectContaining({ status: "in_progress", environment }),
        expect.objectContaining({ status: "ok", environment }),
      ]);
    },
  );
});
