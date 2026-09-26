import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import {
  reportIfOurs,
  turnstileSiteKey,
  verifyTurnstile,
  verifyTurnstileToken,
  type TurnstileVerdict,
} from "../../src/modules/ops/turnstile";

/**
 * Turnstile's server half (OPS-5). Every way a token can be refused, and
 * the one way it is accepted. It fails closed: nothing here may answer
 * "ok" because something broke.
 */

const SECRET = "0x-test-secret";

function answering(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(body, { status })),
  );
}

/**
What the fetch was asked to send, as form fields.
*/
function sentFields(fetchImpl: ReturnType<typeof answering>): URLSearchParams {
  const init = fetchImpl.mock.calls[0]?.[1];
  const body = init?.body;
  if (!(body instanceof URLSearchParams)) throw new Error("no form body");
  return body;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyTurnstile", () => {
  it("accepts a token Cloudflare says is good", async () => {
    const fetchImpl = answering({ success: true, "error-codes": [] });

    const verdict = await verifyTurnstile(
      SECRET,
      "tok",
      "203.0.113.9",
      fetchImpl,
    );

    expect(verdict).toStrictEqual({ ok: true });
  });

  it("asks siteverify once, by POST, with the secret, the token and the visitor's address", async () => {
    const fetchImpl = answering({ success: true });

    await verifyTurnstile(SECRET, "tok", "203.0.113.9", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(init?.method).toBe("POST");
    // Law 4: bounded.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const fields = sentFields(fetchImpl);
    expect(fields.get("secret")).toBe(SECRET);
    expect(fields.get("response")).toBe("tok");
    expect(fields.get("remoteip")).toBe("203.0.113.9");
  });

  it("sends no address when it has none", async () => {
    const fetchImpl = answering({ success: true });

    await verifyTurnstile(SECRET, "tok", undefined, fetchImpl);

    expect(sentFields(fetchImpl).has("remoteip")).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["longer than any token", "x".repeat(2049)],
  ])("refuses a %s token without asking anyone", async (_label, token) => {
    const fetchImpl = answering({ success: true });

    const verdict = await verifyTurnstile(SECRET, token, undefined, fetchImpl);

    expect(verdict).toStrictEqual({
      ok: false,
      reason: "missing-token",
      codes: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks about a token exactly as long as Cloudflare allows", async () => {
    const fetchImpl = answering({ success: true });

    const verdict = await verifyTurnstile(
      SECRET,
      "x".repeat(2048),
      undefined,
      fetchImpl,
    );

    expect(verdict).toStrictEqual({ ok: true });
  });

  it("refuses an invalid token, carrying Cloudflare's reason", async () => {
    const fetchImpl = answering({
      success: false,
      "error-codes": ["invalid-input-response"],
    });

    const verdict = await verifyTurnstile(
      SECRET,
      "forged",
      undefined,
      fetchImpl,
    );

    expect(verdict).toStrictEqual({
      ok: false,
      reason: "rejected",
      codes: ["invalid-input-response"],
    });
  });

  it("refuses an expired or already-spent token", async () => {
    const fetchImpl = answering({
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    });

    const verdict = await verifyTurnstile(
      SECRET,
      "stale",
      undefined,
      fetchImpl,
    );

    expect(verdict).toStrictEqual({
      ok: false,
      reason: "rejected",
      codes: ["timeout-or-duplicate"],
    });
  });

  it("refuses a rejection that names no reason, rather than failing to parse it", async () => {
    const verdict = await verifyTurnstile(
      SECRET,
      "tok",
      undefined,
      answering({ success: false }),
    );

    expect(verdict).toStrictEqual({ ok: false, reason: "rejected", codes: [] });
  });

  it("refuses every token when no secret is configured", async () => {
    for (const secret of [undefined, ""]) {
      const fetchImpl = answering({ success: true });

      const verdict = await verifyTurnstile(
        secret,
        "tok",
        undefined,
        fetchImpl,
      );

      expect(verdict).toStrictEqual({
        ok: false,
        reason: "missing-secret",
        codes: [],
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("refuses rather than hangs when siteverify times out", async () => {
    // What `AbortSignal.timeout` produces when it fires. The adapter must
    // hand the fetch a signal, and a fetch that honours it rejects.
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new Error("aborted", { cause: signal.reason }));
        });
      });
    });
    vi.useFakeTimers();
    try {
      const pending = verifyTurnstile(SECRET, "tok", undefined, fetchImpl);
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(pending).resolves.toStrictEqual({
        ok: false,
        reason: "unreachable",
        codes: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses when siteverify cannot be reached at all", async () => {
    const verdict = await verifyTurnstile(SECRET, "tok", undefined, () =>
      Promise.reject(new TypeError("fetch failed")),
    );

    expect(verdict).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("refuses an answer that is not JSON", async () => {
    const verdict = await verifyTurnstile(SECRET, "tok", undefined, () =>
      Promise.resolve(new Response("<html>gateway</html>")),
    );

    expect(verdict).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("refuses on an error status, whatever the body says", async () => {
    // Not read at all: an error page is not an answer, even one that
    // happens to say `success`.
    const failing = await verifyTurnstile(
      SECRET,
      "tok",
      undefined,
      answering({ success: true }, 500),
    );
    const notJson = await verifyTurnstile(SECRET, "tok", undefined, () =>
      Promise.resolve(new Response("bad gateway", { status: 502 })),
    );

    expect(failing).toMatchObject({ ok: false, reason: "upstream-status" });
    expect(notJson).toMatchObject({ ok: false, reason: "upstream-status" });
  });

  it("refuses an answer of the wrong shape", async () => {
    const verdict = await verifyTurnstile(
      SECRET,
      "tok",
      undefined,
      answering({ success: "yes" }),
    );

    expect(verdict).toMatchObject({ ok: false, reason: "malformed-answer" });
  });
});

describe("reportIfOurs", () => {
  it.each([
    "missing-secret",
    "unreachable",
    "upstream-status",
    "malformed-answer",
  ] as const)("reports %s, which a person has to fix", (reason) => {
    const report = vi.fn();

    reportIfOurs({ ok: false, reason, codes: [] }, report);

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `turnstile verification failed: ${reason}`,
      }),
      { surface: "turnstile", reason },
    );
  });

  it.each<TurnstileVerdict>([
    { ok: true },
    { ok: false, reason: "missing-token", codes: [] },
    { ok: false, reason: "rejected", codes: ["timeout-or-duplicate"] },
  ])("stays quiet about a visitor's own refusal: %o", (verdict) => {
    const report = vi.fn();

    reportIfOurs(verdict, report);

    expect(report).not.toHaveBeenCalled();
  });
});

describe("against the deployed configuration", () => {
  const ORIGINAL_SECRET: unknown = env.TURNSTILE_SECRET_KEY;
  const ORIGINAL_SITE_KEY: unknown = env.TURNSTILE_SITE_KEY;

  afterEach(() => {
    Reflect.set(env, "TURNSTILE_SECRET_KEY", ORIGINAL_SECRET);
    Reflect.set(env, "TURNSTILE_SITE_KEY", ORIGINAL_SITE_KEY);
  });

  it("verifies with the deployed secret", async () => {
    Reflect.set(env, "TURNSTILE_SECRET_KEY", "deployed-secret");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ success: true }));

    const verdict = await verifyTurnstileToken("tok", undefined);

    expect(verdict).toStrictEqual({ ok: true });
    const body = fetchSpy.mock.calls[0]?.[1]?.body;
    expect(body instanceof URLSearchParams && body.get("secret")).toBe(
      "deployed-secret",
    );
  });

  it("refuses, and says so where a person will see it, when the secret is unset", async () => {
    Reflect.deleteProperty(env, "TURNSTILE_SECRET_KEY");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {
      /*
       * Silenced: the disabled Sentry path logs here.
       */
    });

    const verdict = await verifyTurnstileToken("tok", undefined);

    expect(verdict).toMatchObject({ ok: false, reason: "missing-secret" });
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      { surface: "turnstile", reason: "missing-secret" },
      expect.any(Error),
    );
  });

  it("hands the widget the configured site key", () => {
    Reflect.set(env, "TURNSTILE_SITE_KEY", "1x00000000000000000000AA");

    expect(turnstileSiteKey()).toBe("1x00000000000000000000AA");
  });

  it("has no site key when it is unset or empty", () => {
    Reflect.set(env, "TURNSTILE_SITE_KEY", "");
    expect(turnstileSiteKey()).toBeUndefined();

    Reflect.deleteProperty(env, "TURNSTILE_SITE_KEY");
    expect(turnstileSiteKey()).toBeUndefined();
  });
});
