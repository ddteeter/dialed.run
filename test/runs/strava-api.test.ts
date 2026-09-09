import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStravaApi,
  isTerminalStravaError,
  stravaConfigFrom,
  StravaApiError,
} from "../../src/modules/runs/strava/api";
import { stravaApiFromEnv } from "../../src/modules/runs/strava/api-from-env";

/**
 * The Strava HTTP seam, which nothing exercised — credentials do not exist
 * yet, so `oauth.ts` is tested against a hand-rolled fake and this file
 * was never called. Fifty-eight mutants with no coverage, in the one place
 * that decides whether a failure means "reconnect your account" or "try
 * again later".
 *
 * That distinction is the whole point of `isTerminal`. Getting it wrong in
 * one direction tells a runner their connection is broken when Strava was
 * merely down; in the other it retries a revoked grant forever.
 */

const CONFIG = { clientId: "id", clientSecret: "secret" } as const;

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
The URL a fetch was called with, whatever shape the caller passed it in.
*/
function urlOf(input: RequestInfo | URL | undefined): URL {
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  return new URL(input ?? "https://example.invalid");
}

/**
The form body a fetch was posted with.
*/
function formOf(init: RequestInit | undefined): URLSearchParams {
  const body = init?.body;
  return new URLSearchParams(body instanceof URLSearchParams ? body : "");
}

/**
The message of a thrown Error, or "" for anything else.
*/
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/**
The error a call rejected with, or a failure if it did not reject.
*/
async function rejectionFrom(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

const EXCHANGE_BODY = {
  access_token: "access",
  refresh_token: "refresh",
  expires_at: 1_768_485_600,
  athlete: { id: 12_345 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exchangeCode", () => {
  it("posts the grant and reads the tokens back", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(EXCHANGE_BODY));

    const tokens = await createStravaApi(CONFIG).exchangeCode("the-code");

    expect(tokens).toStrictEqual({
      athleteId: "12345",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 1_768_485_600,
    });

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(urlOf(url).href).toBe("https://www.strava.com/oauth/token");
    expect(init?.method).toBe("POST");
    // Law 4: every outbound fetch is bounded.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // Strava's token endpoint takes a form, not JSON, and says so.
    expect(init?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
    });
    const form = formOf(init);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("client_id")).toBe("id");
    expect(form.get("client_secret")).toBe("secret");
  });

  it("treats a rejected grant as terminal", async () => {
    // 400 and 401 on a token exchange are what a revoked grant looks like:
    // the connection is gone and retrying will not bring it back.
    for (const status of [400, 401]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({ message: "no" }, status),
      );

      const error = await rejectionFrom(createStravaApi(CONFIG).exchangeCode("code"));

      expect(isTerminalStravaError(error), String(status)).toBe(true);
      expect(messageOf(error)).toContain(String(status));
    }
  });

  it("treats anything else as transient", async () => {
    // A 500 or a 429 is Strava having a bad day. Telling the runner to
    // reconnect would be wrong and would lose their connection for them.
    for (const status of [429, 500, 503]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({ message: "later" }, status),
      );

      const error = await rejectionFrom(createStravaApi(CONFIG).exchangeCode("code"));

      expect(error).toBeInstanceOf(StravaApiError);
      expect(isTerminalStravaError(error), String(status)).toBe(false);
    }
  });

  it("treats a shape it cannot parse as transient, not as a revoked grant", async () => {
    // A response we cannot read is a bug or a Strava change. Neither is
    // the user's connection being gone.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ access_token: "access" }),
    );

    const error = await rejectionFrom(createStravaApi(CONFIG).exchangeCode("code"));

    expect(error).toBeInstanceOf(StravaApiError);
    expect(isTerminalStravaError(error)).toBe(false);
    expect(messageOf(error)).toMatch(/Malformed/);
  });

  it("refuses a response missing any token it needs", async () => {
    const partials = [
      { ...EXCHANGE_BODY, access_token: "" },
      { ...EXCHANGE_BODY, refresh_token: undefined },
      { ...EXCHANGE_BODY, expires_at: -1 },
      { ...EXCHANGE_BODY, athlete: undefined },
    ];

    for (const body of partials) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(body));
      await expect(
        createStravaApi(CONFIG).exchangeCode("code"),
      ).rejects.toBeInstanceOf(StravaApiError);
    }
  });
});

describe("refreshToken", () => {
  it("posts the refresh grant and reads the new tokens back", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_at: 1_768_499_999,
      }),
    );

    const tokens = await createStravaApi(CONFIG).refreshToken("old-refresh");

    expect(tokens).toStrictEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 1_768_499_999,
    });
    const form = formOf(fetchSpy.mock.calls[0]?.[1]);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("old-refresh");
  });

  it("treats a rejected refresh as terminal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ message: "no" }, 401),
    );

    const error = await rejectionFrom(createStravaApi(CONFIG).refreshToken("old"));

    expect(isTerminalStravaError(error)).toBe(true);
  });

  it("treats a malformed refresh response as transient, and says so", async () => {
    // A `StravaApiError`, not whatever a missing field throws: the caller
    // counts these as transient failures, and a TypeError from reading an
    // absent property is not something it can classify.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    const error = await rejectionFrom(createStravaApi(CONFIG).refreshToken("old"));

    expect(error).toBeInstanceOf(StravaApiError);
    expect(isTerminalStravaError(error)).toBe(false);
    expect(messageOf(error)).toMatch(/Malformed/);
  });
});

describe("deauthorize", () => {
  it("posts the token to the revoke endpoint, escaped", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));

    await createStravaApi(CONFIG).deauthorize("tok en/+&");

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    const asUrl = urlOf(url);
    expect(asUrl.origin + asUrl.pathname).toBe(
      "https://www.strava.com/oauth/deauthorize",
    );
    expect(asUrl.searchParams.get("access_token")).toBe("tok en/+&");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("never reports a revoke failure as terminal", async () => {
    // Best-effort by design: the local row is already gone and the outbox
    // re-dispatches, so "the grant is dead" is not a conclusion to draw
    // from a failed revoke.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 401 }),
    );

    const error = await rejectionFrom(createStravaApi(CONFIG).deauthorize("token"));

    expect(error).toBeInstanceOf(StravaApiError);
    expect(isTerminalStravaError(error)).toBe(false);
    expect(messageOf(error)).toContain("401");
  });

  it("says nothing on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(undefined, { status: 204 }),
    );

    await expect(
      createStravaApi(CONFIG).deauthorize("token"),
    ).resolves.toBeUndefined();
  });
});

describe("isTerminalStravaError", () => {
  it("is false for anything that is not a Strava error", () => {
    // A TypeError from fetch is the most transient failure there is.
    expect(isTerminalStravaError(new TypeError("network"))).toBe(false);
    expect(isTerminalStravaError(undefined)).toBe(false);
    expect(isTerminalStravaError("revoked")).toBe(false);
  });

  it("reads the flag the error was built with", () => {
    expect(isTerminalStravaError(new StravaApiError("gone", true))).toBe(true);
    expect(isTerminalStravaError(new StravaApiError("later", false))).toBe(
      false,
    );
    expect(new StravaApiError("gone", true).name).toBe("StravaApiError");
  });
});

describe("stravaConfigFrom", () => {
  it("pairs a client id with its secret", () => {
    expect(stravaConfigFrom("id", "secret")).toStrictEqual({
      clientId: "id",
      clientSecret: "secret",
    });
  });

  it("is undefined when either half is missing", () => {
    // Half a credential is a misconfiguration that fails at the OAuth
    // redirect rather than at boot, so both directions matter.
    expect(stravaConfigFrom(undefined, "secret")).toBeUndefined();
    expect(stravaConfigFrom("id", undefined)).toBeUndefined();
    expect(stravaConfigFrom(undefined, undefined)).toBeUndefined();
  });
});

describe("stravaApiFromEnv", () => {
  it("is undefined until both secrets are set", () => {
    // Law 5: no credentials is a degraded deployment, not a broken one —
    // the connect button is simply not offered.
    expect(stravaApiFromEnv()).toBeUndefined();
  });
});
