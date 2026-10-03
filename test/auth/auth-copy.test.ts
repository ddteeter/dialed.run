import { describe, expect, it } from "vitest";

import { TURNSTILE_REFUSED } from "../../src/lib/contracts/access";
import {
  AUTH_COPY,
  AUTH_KICKER,
  AccessRefused,
  AuthRejected,
  NOT_SENT,
  authFailure,
  authStatus,
  turnstileRefused,
} from "../../src/modules/auth/auth-copy";

/**
The band's sentence alone, as the old tests read it.
*/
function authFailureMessage(
  failure: Parameters<typeof authFailure>[0],
  cause: unknown,
): string | undefined {
  return authFailure(failure, cause)?.message;
}

/**
 * The Auth board's failure sentences (round 22, Au3–Au6), and the two
 * words that open them.
 */
describe("authFailure", () => {
  it("opens every band of its own with Auth's words", () => {
    expect(
      authFailure({ kind: "server", message: "x" }, new AuthRejected(500)),
    ).toStrictEqual({ kicker: AUTH_KICKER, message: AUTH_COPY.server });
  });

  it("lets a refusal of the way in say its own kicker and words", () => {
    expect(
      authFailure({ kind: "server", message: "x" }, turnstileRefused()),
    ).toMatchObject({ kicker: NOT_SENT, message: TURNSTILE_REFUSED });
    expect(NOT_SENT).toBe("Not sent");
  });

  it("builds a refusal that is an error with a kicker", () => {
    const refusal = new AccessRefused({ kicker: "Kicker", message: "Words." });
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.name).toBe("AccessRefused");
    expect(refusal).toMatchObject({ kicker: "Kicker", message: "Words." });
    expect(refusal.retry).toBeUndefined();
    expect(refusal.link).toBeUndefined();
    expect(
      new AccessRefused({
        kicker: "Kicker",
        message: "Words.",
        retry: false,
        link: "create-account",
      }),
    ).toMatchObject({ retry: false, link: "create-account" });
  });

  it("has nothing to say when nothing failed", () => {
    expect(
      authFailureMessage(undefined, new AuthRejected(429)),
    ).toBeUndefined();
  });

  it("says the connection dropped, whatever else is known", () => {
    expect(
      authFailureMessage(
        { kind: "network", message: "Your connection dropped." },
        new AuthRejected(429),
      ),
    ).toBe(AUTH_COPY.network);
  });

  it("names a rate limit, and only a 429 is one", () => {
    const server = { kind: "server", message: "x" } as const;
    expect(authFailureMessage(server, new AuthRejected(429))).toBe(
      AUTH_COPY.rateLimited,
    );
    expect(authFailureMessage(server, new AuthRejected(500))).toBe(
      AUTH_COPY.server,
    );
    // A status on something that is not Better Auth's refusal is not one.
    expect(authFailureMessage(server, { status: 429 })).toBe(AUTH_COPY.server);
  });
});

describe("authStatus", () => {
  it("opens with Auth's words where the contract says Nothing saved", () => {
    expect(
      authStatus({
        status: "Nothing saved. One field needs a fix.",
        band: undefined,
        google: undefined,
      }),
    ).toBe("Not signed in. One field needs a fix.");
  });

  it("leaves any other sentence as it is", () => {
    expect(
      authStatus({
        status: "Signed in.",
        band: undefined,
        google: undefined,
      }),
    ).toBe("Signed in.");
    // Only an opener is replaced, never the words mid-sentence.
    expect(
      authStatus({
        status: "Done. Nothing saved.",
        band: undefined,
        google: undefined,
      }),
    ).toBe("Done. Nothing saved.");
  });

  it("says the band's sentence when there is a band, before Google's", () => {
    expect(
      authStatus({
        status: "Nothing saved. Our end failed. Nothing changed.",
        band: { kicker: AUTH_KICKER, message: AUTH_COPY.server },
        google: { kicker: AUTH_KICKER, message: AUTH_COPY.google },
      }),
    ).toBe(`${AUTH_KICKER}. ${AUTH_COPY.server}`);
  });

  it("says Google's when only Google failed", () => {
    expect(
      authStatus({
        status: "",
        band: undefined,
        google: { kicker: AUTH_KICKER, message: AUTH_COPY.google },
      }),
    ).toBe(
      "Not signed in. Google didn't answer. Try again, or use your email.",
    );
  });

  it("says a band's own kicker", () => {
    expect(
      authStatus({
        status: "",
        band: { kicker: NOT_SENT, message: TURNSTILE_REFUSED },
        google: undefined,
      }),
    ).toBe(`Not sent. ${TURNSTILE_REFUSED}`);
  });

  it("keeps the rejection's status on the error it throws", () => {
    const rejected = new AuthRejected(503);
    expect(rejected).toBeInstanceOf(Error);
    expect(rejected.name).toBe("AuthRejected");
    expect(rejected.message).toBe("auth rejected with status 503");
  });
});
