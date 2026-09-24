import { describe, expect, it } from "vitest";

import {
  AUTH_COPY,
  AUTH_KICKER,
  AuthRejected,
  authFailureMessage,
  authStatus,
} from "../../src/modules/auth/auth-copy";

/**
 * The Auth board's failure sentences (round 22, Au3–Au6), and the two
 * words that open them.
 */
describe("authFailureMessage", () => {
  it("has nothing to say when nothing failed", () => {
    expect(authFailureMessage(undefined, new AuthRejected(429))).toBeUndefined();
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
        bandMessage: undefined,
        googleFailed: false,
      }),
    ).toBe("Not signed in. One field needs a fix.");
  });

  it("leaves any other sentence as it is", () => {
    expect(
      authStatus({ status: "Signed in.", bandMessage: undefined, googleFailed: false }),
    ).toBe("Signed in.");
    // Only an opener is replaced, never the words mid-sentence.
    expect(
      authStatus({
        status: "Done. Nothing saved.",
        bandMessage: undefined,
        googleFailed: false,
      }),
    ).toBe("Done. Nothing saved.");
  });

  it("says the band's sentence when there is a band, before Google's", () => {
    expect(
      authStatus({
        status: "Nothing saved. Our end failed. Nothing changed.",
        bandMessage: AUTH_COPY.server,
        googleFailed: true,
      }),
    ).toBe(`${AUTH_KICKER}. ${AUTH_COPY.server}`);
  });

  it("says Google's when only Google failed", () => {
    expect(
      authStatus({ status: "", bandMessage: undefined, googleFailed: true }),
    ).toBe("Not signed in. Google didn't answer. Try again, or use your email.");
  });

  it("keeps the rejection's status on the error it throws", () => {
    const rejected = new AuthRejected(503);
    expect(rejected).toBeInstanceOf(Error);
    expect(rejected.name).toBe("AuthRejected");
    expect(rejected.message).toBe("auth rejected with status 503");
  });
});
