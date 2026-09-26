import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStravaApi,
  stravaConfigFrom,
  StravaApiError,
} from "../../src/modules/runs/strava/api";
import { stravaApiFromEnv } from "../../src/modules/runs/strava/api-from-env";

/**
 * The Strava HTTP seam, which nothing exercised — credentials do not exist
 * yet, so `oauth.ts` is tested against a hand-rolled fake and this file
 * was never called. What matters most here now is what a refusal keeps:
 * the status and Strava's own message are what tell the eleventh athlete
 * the app is full (STR-6), and the revoke is what makes a disconnect true
 * on Strava's side (STR-5).
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

  it("keeps the status and Strava's own message when it refuses", async () => {
    // What STR-6 keys on: the eleventh athlete's exchange is a 403 whose
    // message names the limit. Both halves have to survive the throw.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ message: "Limit of connected athletes exceeded" }, 403),
    );

    const error = await rejectionFrom(
      createStravaApi(CONFIG).exchangeCode("code"),
    );

    expect(error).toBeInstanceOf(StravaApiError);
    expect(error).toMatchObject({
      name: "StravaApiError",
      status: 403,
      refusal: "Limit of connected athletes exceeded",
    });
    expect(messageOf(error)).toBe("Strava responded 403");
  });

  it("keeps the status of a refusal whose body is not JSON, with no message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>Bad gateway</html>", { status: 502 }),
    );

    const error = await rejectionFrom(
      createStravaApi(CONFIG).exchangeCode("code"),
    );

    expect(error).toMatchObject({ status: 502, refusal: undefined });
  });

  it("keeps no message from a JSON refusal that carries none", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ errors: [] }, 400),
    );

    const error = await rejectionFrom(
      createStravaApi(CONFIG).exchangeCode("code"),
    );

    expect(error).toMatchObject({ status: 400, refusal: undefined });
  });

  it("names a shape it cannot parse as ours, with no status", async () => {
    // A response we cannot read is a bug or a Strava change, and Strava
    // did not refuse anything.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ access_token: "access" }),
    );

    const error = await rejectionFrom(
      createStravaApi(CONFIG).exchangeCode("code"),
    );

    expect(error).toBeInstanceOf(StravaApiError);
    expect(error).toMatchObject({ status: undefined, refusal: undefined });
    expect(messageOf(error)).toBe("Malformed token-exchange response.");
  });

  it("refuses a success whose body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json", { status: 200 }),
    );

    const error = await rejectionFrom(
      createStravaApi(CONFIG).exchangeCode("code"),
    );

    expect(error).toBeInstanceOf(SyntaxError);
  });

  it("refuses a response missing any token it needs", async () => {
    const partials = [
      { ...EXCHANGE_BODY, access_token: "" },
      { ...EXCHANGE_BODY, refresh_token: "" },
      { ...EXCHANGE_BODY, refresh_token: undefined },
      { ...EXCHANGE_BODY, expires_at: -1 },
      { ...EXCHANGE_BODY, expires_at: 1.5 },
      { ...EXCHANGE_BODY, athlete: undefined },
      { ...EXCHANGE_BODY, athlete: { id: 1.5 } },
    ];

    for (const body of partials) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(body));
      await expect(
        createStravaApi(CONFIG).exchangeCode("code"),
      ).rejects.toBeInstanceOf(StravaApiError);
    }
  });
});

describe("revoke (STR-5: POST /oauth/revoke)", () => {
  it("posts the token and its kind, authenticated as the app", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(undefined, { status: 200 }));

    await createStravaApi(CONFIG).revoke({
      token: "tok en/+&",
      kind: "refresh_token",
    });

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(urlOf(url).href).toBe("https://www.strava.com/oauth/revoke");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // HTTP Basic with client_id:client_secret — "aWQ6c2VjcmV0" is
    // base64("id:secret").
    expect(init?.headers).toStrictEqual({
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic aWQ6c2VjcmV0",
    });
    const form = formOf(init);
    // In the body, where a token belongs — never the query string, which
    // is where `/oauth/deauthorize` took it and where it ends up in logs.
    expect(form.get("token")).toBe("tok en/+&");
    expect(form.get("token_type_hint")).toBe("refresh_token");
    expect(form.toString()).toBe(
      "token=tok+en%2F%2B%26&token_type_hint=refresh_token",
    );
    expect(urlOf(url).search).toBe("");
  });

  it("says nothing on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(undefined, { status: 200 }),
    );

    await expect(
      createStravaApi(CONFIG).revoke({ token: "t", kind: "access_token" }),
    ).resolves.toBeUndefined();
  });

  it("throws on a refusal, so the queue retries it", async () => {
    // 503 is Strava's "internal error during revocation — safe to retry";
    // 401 is our client credentials being wrong, which the DLQ surfaces.
    for (const status of [401, 503]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        // No body at all, so no content-type: the refusal is still read.
        new Response(undefined, { status }),
      );

      const error = await rejectionFrom(
        createStravaApi(CONFIG).revoke({ token: "t", kind: "access_token" }),
      );
      expect(error).toMatchObject({ status, refusal: undefined });
    }
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
