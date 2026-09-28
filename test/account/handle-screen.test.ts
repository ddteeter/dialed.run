import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import {
  handleScreenFromEnv,
  screenHandle,
} from "../../src/modules/account/handle-screen";
import { MODERATION_MODEL } from "../../src/modules/safety";

/**
 * OpenAI's moderation of a handle at claim time (task 126; owner,
 * 2026-09-27): asked once, and open to the list whenever it cannot answer.
 */
function answering(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(body, { status })),
  );
}

function reporter() {
  const reports: { error: unknown; context: Record<string, string> }[] = [];
  return {
    reports,
    report: (error: unknown, context: Record<string, string>) => {
      reports.push({ error, context });
    },
  };
}

describe("screenHandle", () => {
  it("asks about the handle as words, with the key, on safety's model", async () => {
    const fetchImpl = answering({ results: [{ flagged: false }] });
    const { report, reports } = reporter();
    expect(
      await screenHandle("quiet_mile", { apiKey: "sk-test", fetchImpl, report }),
    ).toBe("clear");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/moderations");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toStrictEqual({
      authorization: "Bearer sk-test",
      "content-type": "application/json",
    });
    const body = init?.body;
    if (typeof body !== "string") throw new Error("expected a JSON string body");
    expect(JSON.parse(body)).toStrictEqual({
      model: MODERATION_MODEL,
      input: "quiet mile",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(reports).toStrictEqual([]);
  });

  it("is flagged when any result is", async () => {
    const fetchImpl = answering({
      results: [{ flagged: false }, { flagged: true }],
    });
    expect(
      await screenHandle("x", { apiKey: "k", fetchImpl, report: vi.fn() }),
    ).toBe("flagged");
  });

  it("is unknown, without a call or a report, when there is no key", async () => {
    const fetchImpl = answering({ results: [{ flagged: true }] });
    const report = vi.fn();
    for (const apiKey of [undefined, ""]) {
      expect(await screenHandle("x", { apiKey, fetchImpl, report })).toBe(
        "unknown",
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    ["an error status", answering({ results: [{ flagged: true }] }, 500)],
    ["an answer that does not parse", answering({ results: [{}] })],
    ["an answer with no results", answering({ results: [] })],
    [
      "a call that throws",
      vi.fn<typeof fetch>(() => Promise.reject(new Error("timeout"))),
    ],
  ])("fails open to the list on %s, and reports it without the handle", async (_, fetchImpl) => {
    const { report, reports } = reporter();
    expect(
      await screenHandle("secret_handle", { apiKey: "k", fetchImpl, report }),
    ).toBe("unknown");
    expect(reports).toHaveLength(1);
    expect(reports[0]?.context).toStrictEqual({ surface: "handle-screen" });
    expect(JSON.stringify(reports)).not.toContain("secret_handle");
  });

  it("names the status it was refused with", async () => {
    const { report, reports } = reporter();
    await screenHandle("x", {
      apiKey: "k",
      fetchImpl: answering({}, 503),
      report,
    });
    expect(reports[0]?.error).toMatchObject({ message: "moderation 503" });
  });
});

describe("handleScreenFromEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("screens against the deployment's key", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ results: [{ flagged: true }] }));
    const report = vi.fn();
    expect(await handleScreenFromEnv(report)("anything")).toBe("flagged");
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      authorization: `Bearer ${String(env.OPENAI_API_KEY)}`,
    });
    expect(report).not.toHaveBeenCalled();
  });

  it("reports through the reporter it was given", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const report = vi.fn();
    expect(await handleScreenFromEnv(report)("anything")).toBe("unknown");
    expect(report).toHaveBeenCalledTimes(1);
  });
});
