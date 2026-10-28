import { describe, expect, it } from "vitest";

import {
  GARMIN_PERSONAL_ORIGIN,
  GarminUnavailable,
  createGarminApi,
} from "../../src/modules/runs/garmin/api";
import { urlOf } from "./request-url";
import { zipOf } from "./zip-file";

/**
 * The Personal API client against a stubbed `fetch`. Every payload here is
 * synthetic, shaped like the spike's answers (plan 160); nothing recorded
 * from a real account is committed.
 */

const ORIGIN = "https://garmin.test";
const TOKEN = "aaa.bbb.ccc";

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  signal: AbortSignal | null | undefined;
}

function stubFetch(
  answers: Record<string, () => Response | Promise<Response>>,
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = urlOf(input).href;
    calls.push({
      url,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
      signal: init?.signal,
    });
    const path = new URL(url).pathname;
    const answer = Object.entries(answers).find(([prefix]) =>
      path.startsWith(prefix),
    );
    if (answer === undefined) return new Response("no stub", { status: 599 });
    return answer[1]();
  };
  return { fetchImpl, calls };
}

const tokenAnswer = () => new Response(`${TOKEN}\n`);

const summary = (overrides: Record<string, unknown> = {}) => ({
  activityId: 20_123_456_789,
  activityName: "Synthetic Run",
  startTimeGMT: "2026-10-23 12:34:56",
  distance: 7012.5,
  duration: 2400.4,
  averageHR: 140,
  ...overrides,
});

async function unavailable(
  promise: Promise<unknown>,
): Promise<GarminUnavailable> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GarminUnavailable) return error;
    throw error;
  }
  throw new Error("expected GarminUnavailable");
}

describe("recentRuns", () => {
  it("asks for running with the key's token and reads what the picker needs", async () => {
    const { fetchImpl, calls } = stubFetch({
      "/personalapitoken-service": tokenAnswer,
      "/activitylist-service": () => Response.json([summary()]),
    });
    const api = createGarminApi("the-key", ORIGIN, fetchImpl);

    expect(await api.recentRuns(10)).toEqual([
      {
        activityId: "20123456789",
        startedAt: Date.UTC(2026, 9, 23, 12, 34, 56) / 1000,
        distanceM: 7012.5,
        durationS: 2400,
      },
    ]);

    expect(calls[0]).toMatchObject({
      url: `${ORIGIN}/personalapitoken-service/personal-api/personal-api-key/token`,
      method: "POST",
      authorization: "ApiKey the-key",
    });
    const list = new URL(calls[1]?.url ?? "");
    expect(list.pathname).toBe(
      "/activitylist-service/activities/search/activities",
    );
    expect(Object.fromEntries(list.searchParams)).toEqual({
      start: "0",
      limit: "10",
      activityType: "running",
    });
    expect(calls[1]?.authorization).toBe(`Bearer ${TOKEN}`);
    for (const call of calls) expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["Op4que_~+/-.token==", "x"])(
    "sends the token %s as it came: its form is Garmin's business",
    async (token) => {
      const { fetchImpl, calls } = stubFetch({
        "/personalapitoken-service": () => new Response(token),
        "/activitylist-service": () => Response.json([]),
      });
      await createGarminApi("key", ORIGIN, fetchImpl).recentRuns(10);
      expect(calls[1]?.authorization).toBe(`Bearer ${token}`);
    },
  );

  it("calls Garmin's own origin by default", async () => {
    const { fetchImpl, calls } = stubFetch({
      "/personalapitoken-service": tokenAnswer,
      "/activitylist-service": () => Response.json([]),
    });
    await createGarminApi("key", undefined, fetchImpl).recentRuns(10);
    expect(calls[0]?.url.startsWith(`${GARMIN_PERSONAL_ORIGIN}/`)).toBe(true);
  });

  it.each([
    [
      "the token is refused",
      { "/personalapitoken-service": () => new Response("", { status: 401 }) },
      "token: HTTP 401",
    ],
    [
      "the token is not a token",
      { "/personalapitoken-service": () => new Response("<html>") },
      "token: not a token",
    ],
    [
      "the token has something before it",
      { "/personalapitoken-service": () => new Response("x aaa.bbb.ccc") },
      "token: not a token",
    ],
    [
      "the token has something after it",
      { "/personalapitoken-service": () => new Response("aaa.bbb.ccc <p>") },
      "token: not a token",
    ],
    [
      "the token has padding mid-way",
      { "/personalapitoken-service": () => new Response("aaa=bbb") },
      "token: not a token",
    ],
    [
      "a start time has something before it",
      {
        "/personalapitoken-service": tokenAnswer,
        "/activitylist-service": () =>
          Response.json([summary({ startTimeGMT: "x2026-10-23 12:34:56" })]),
      },
      "list: unexpected shape",
    ],
    [
      "a start time has something after it",
      {
        "/personalapitoken-service": tokenAnswer,
        "/activitylist-service": () =>
          Response.json([summary({ startTimeGMT: "2026-10-23 12:34:56Z" })]),
      },
      "list: unexpected shape",
    ],
    [
      "the list fails",
      {
        "/personalapitoken-service": tokenAnswer,
        "/activitylist-service": () => new Response("", { status: 503 }),
      },
      "list: HTTP 503",
    ],
    [
      "the list is not JSON",
      {
        "/personalapitoken-service": tokenAnswer,
        "/activitylist-service": () => new Response("nope"),
      },
      "list: not JSON",
    ],
    [
      "the list has another shape",
      {
        "/personalapitoken-service": tokenAnswer,
        "/activitylist-service": () => Response.json({ activities: [] }),
      },
      "list: unexpected shape",
    ],
    [
      "a summary has no start time",
      {
        "/personalapitoken-service": tokenAnswer,
        "/activitylist-service": () =>
          Response.json([summary({ startTimeGMT: "2026-10-23T12:34:56Z" })]),
      },
      "list: unexpected shape",
    ],
  ] as const)("is unavailable when %s", async (_, answers, reason) => {
    const { fetchImpl } = stubFetch(answers);
    const failure = await unavailable(
      createGarminApi("key", ORIGIN, fetchImpl).recentRuns(10),
    );
    expect(failure.reason).toBe(reason);
    expect(failure.message).toBe("Garmin didn't answer.");
    expect(failure.name).toBe("GarminUnavailable");
  });

  it("is unavailable when Garmin cannot be reached, and keeps no token in the reason", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.reject(new TypeError("network"));
    const failure = await unavailable(
      createGarminApi("secret-key", ORIGIN, fetchImpl).recentRuns(10),
    );
    expect(failure.reason).toBe("token: unreachable");
    expect(failure.cause).toBeInstanceOf(TypeError);
    expect(failure.reason).not.toContain("secret-key");
  });
});

describe("what a refusal keeps for Sentry", () => {
  it.each([
    ["the list is not JSON", () => new Response("nope"), SyntaxError],
    ["the list has another shape", () => Response.json({}), Error],
  ] as const)("keeps the cause when %s", async (_, list, kind) => {
    const { fetchImpl } = stubFetch({
      "/personalapitoken-service": tokenAnswer,
      "/activitylist-service": list,
    });
    const failure = await unavailable(
      createGarminApi("key", ORIGIN, fetchImpl).recentRuns(10),
    );
    expect(failure.cause).toBeInstanceOf(kind);
  });

  it("keeps the cause when the download is not one file", async () => {
    const { fetchImpl } = stubFetch({
      "/personalapitoken-service": tokenAnswer,
      "/download-service": () => new Response("not a zip"),
    });
    const failure = await unavailable(
      createGarminApi("key", ORIGIN, fetchImpl).fitFile("1"),
    );
    expect(failure.cause).toHaveProperty("name", "UnzipError");
  });
});

describe("fitFile", () => {
  const FIT = new TextEncoder().encode(
    "synthetic fit bytes ".repeat(10),
  ).buffer;

  it("downloads the activity and returns the file inside the zip", async () => {
    const zip = await zipOf(FIT);
    const { fetchImpl, calls } = stubFetch({
      "/personalapitoken-service": tokenAnswer,
      "/download-service": () => new Response(zip),
    });

    const bytes = await createGarminApi("key", ORIGIN, fetchImpl).fitFile(
      "20123456789",
    );

    expect([...new Uint8Array(bytes)]).toEqual([...new Uint8Array(FIT)]);
    expect(calls[1]?.url).toBe(
      `${ORIGIN}/download-service/files/activity/20123456789`,
    );
    expect(calls[1]?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("keeps the activity id inside its path segment", async () => {
    const { fetchImpl, calls } = stubFetch({
      "/personalapitoken-service": tokenAnswer,
      "/download-service": async () => new Response(await zipOf(FIT)),
    });
    await createGarminApi("key", ORIGIN, fetchImpl).fitFile("1/../x");
    expect(calls[1]?.url).toBe(
      `${ORIGIN}/download-service/files/activity/1%2F..%2Fx`,
    );
  });

  it("is unavailable when the download is not one file", async () => {
    const { fetchImpl } = stubFetch({
      "/personalapitoken-service": tokenAnswer,
      "/download-service": () => new Response("not a zip"),
    });
    const failure = await unavailable(
      createGarminApi("key", ORIGIN, fetchImpl).fitFile("1"),
    );
    expect(failure.reason).toBe("download: not one file");
  });

  it("is unavailable when the download fails", async () => {
    const { fetchImpl } = stubFetch({
      "/personalapitoken-service": tokenAnswer,
      "/download-service": () => new Response("", { status: 404 }),
    });
    const failure = await unavailable(
      createGarminApi("key", ORIGIN, fetchImpl).fitFile("1"),
    );
    expect(failure.reason).toBe("download: HTTP 404");
  });
});
