import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_REQUIRED_CODE } from "../../src/lib/auth-signal";
import { classifyFailure } from "../../src/ui";

/**
 * What a user is told when a submit fails, and which of the three kinds it
 * was.
 *
 * This is the one decision in the forms contract with a *consequence*
 * beyond wording: a `session` failure routes to sign-in carrying the
 * pending payload, so misreading one strands someone on a dead form, and
 * misreading anything else as a session failure throws away what they
 * typed. It had no test at all — `classifyFailure` was private and every
 * branch of it came back uncovered when the file was first mutated.
 *
 * A DOM test because the network branch reads `navigator.onLine`.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/**
Pretend the browser is offline for one assertion. `onLine` is a getter on
the prototype, so it is spied rather than assigned.
*/
function goOffline(): void {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
}

describe("classifyFailure", () => {
  it("reads a signed-out session from its code, never its wording", () => {
    // The reference implementation matched /401|403|session/ against the
    // message text, which stops working the day an upstream rewords
    // something — silently, and on the one branch that redirects.
    const failure = classifyFailure({ code: AUTH_REQUIRED_CODE });

    expect(failure).toStrictEqual({
      kind: "session",
      message: "You were signed out.",
    });
  });

  it("does not read a session failure out of a message that says so", () => {
    // The wording is not the signal. An upstream that happens to mention a
    // session must not send someone to sign-in with their form contents
    // dropped.
    expect(classifyFailure(new Error("session expired")).kind).toBe("server");
    expect(classifyFailure({ code: "SOMETHING_ELSE" }).kind).toBe("server");
  });

  it("calls a TypeError a dropped connection", () => {
    // `fetch` rejects with a TypeError, and it rejects client-side without
    // crossing a structured clone — so the prototype is intact and
    // `instanceof` means something here, unlike for a server rejection.
    const failure = classifyFailure(new TypeError("Failed to fetch"));

    expect(failure).toStrictEqual({
      kind: "network",
      message: "Your connection dropped.",
    });
  });

  it("calls anything a dropped connection while the browser is offline", () => {
    // The second half of the same condition: offline is enough on its own,
    // whatever the error turned out to be.
    goOffline();

    expect(classifyFailure(new Error("nope")).kind).toBe("network");
  });

  it("falls back to our end failing, and says nothing changed", () => {
    // The sentence matters: it tells the user their data is intact, which
    // is the difference between retrying and re-typing.
    const failure = classifyFailure(new Error("500"));

    expect(failure).toStrictEqual({
      kind: "server",
      message: "Our end failed. Nothing changed.",
    });
  });

  it("prefers a session failure over an offline browser", () => {
    // Order matters. Offline plus a signed-out signal is still signed out,
    // and telling the user their connection dropped would send them back
    // to a form that will fail again.
    goOffline();

    expect(classifyFailure({ code: AUTH_REQUIRED_CODE }).kind).toBe("session");
  });
});
