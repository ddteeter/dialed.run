import { describe, expect, it, vi } from "vitest";

import {
  breachVerdict,
  newPasswordIn,
} from "../../src/modules/auth/breached-password";

/**
 * The range-API breach screen (NIST SP 800-63B §3.1.1.2): k-anonymity on
 * the way out, a timeout and a parse on the way in, and "unknown" — never
 * a refusal — when the answer cannot be read.
 */

/**
 * SHA-1 of "password": 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
 */
const PASSWORD = "password";
const PREFIX = "5BAA6";
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";
const OTHER = "0000000000000000000000000000000000A";

function answering(text: string, status = 200) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(text, { status })),
  );
}

describe("breachVerdict", () => {
  it("sends only the first five characters of the hash, padded, with a timeout", async () => {
    const fetchImpl = answering(`${OTHER}:3\n`);
    await breachVerdict(PASSWORD, fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(url).not.toContain(SUFFIX);
    expect(init?.headers).toEqual({ "Add-Padding": "true" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("finds a password whose suffix is listed with a count", async () => {
    expect(
      await breachVerdict(
        PASSWORD,
        answering(`${OTHER}:3\r\n${SUFFIX}:9545824\r\n`),
      ),
    ).toBe("breached");
  });

  it("is clean when the suffix is absent", async () => {
    expect(await breachVerdict(PASSWORD, answering(`${OTHER}:3\n`))).toBe(
      "clean",
    );
  });

  it("never counts a padding row, whose count is zero", async () => {
    expect(await breachVerdict(PASSWORD, answering(`${SUFFIX}:0\n`))).toBe(
      "clean",
    );
  });

  it("cannot answer when the API refuses", async () => {
    expect(await breachVerdict(PASSWORD, answering("", 503))).toBe("unknown");
  });

  it("cannot answer when the request times out or never arrives", async () => {
    const down = vi.fn<typeof fetch>(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );
    expect(await breachVerdict(PASSWORD, down)).toBe("unknown");
  });

  it("cannot answer when the body is not the range format", async () => {
    expect(await breachVerdict(PASSWORD, answering("<html>busy</html>"))).toBe(
      "unknown",
    );
    const lowercase = answering(`${SUFFIX.toLowerCase()}:4`);
    expect(await breachVerdict(PASSWORD, lowercase)).toBe("unknown");
    // A row is anchored at both ends: a match with anything before or
    // after it is not the format, and not a verdict.
    expect(await breachVerdict(PASSWORD, answering(`X${SUFFIX}:4`))).toBe(
      "unknown",
    );
    expect(await breachVerdict(PASSWORD, answering(`${SUFFIX}:4 extra`))).toBe(
      "unknown",
    );
  });
});

describe("newPasswordIn", () => {
  it("reads the new password on sign-up and on a password change", () => {
    expect(newPasswordIn("/sign-up/email", { password: "a" })).toBe("a");
    expect(newPasswordIn("/change-password", { newPassword: "b" })).toBe("b");
  });

  it("reads nothing on any other path, or from a body without it", () => {
    expect(newPasswordIn("/sign-in/email", { password: "a" })).toBeUndefined();
    expect(newPasswordIn(undefined, { password: "a" })).toBeUndefined();
    expect(
      newPasswordIn("/sign-up/email", { newPassword: "a" }),
    ).toBeUndefined();
    expect(newPasswordIn("/sign-up/email", { password: 42 })).toBeUndefined();
    expect(newPasswordIn("/sign-up/email", "password")).toBeUndefined();
  });
});
