import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AUTH_REQUIRED_CODE,
  EMAIL_UNCONFIRMED_CODE,
  isAuthRequired,
  isTermsRefusal,
  isUnconfirmedRefusal,
  signalAdapter,
  TERMS_NOT_ACCEPTED_CODE,
} from "../../src/lib/auth-signal";

/**
 * The auth signals' trip across a server function's response (design
 * 133). TanStack Start serializes a thrown `Error` as its message alone;
 * `signalAdapter`, registered in `src/start.ts`, carries the code too, for
 * the signals the client answers and nothing else.
 */
function signal(code: string, message = "Refused."): Error {
  return Object.assign(new Error(message), { code });
}

describe("signalAdapter", () => {
  it.each([
    AUTH_REQUIRED_CODE,
    TERMS_NOT_ACCEPTED_CODE,
    EMAIL_UNCONFIRMED_CODE,
  ])("takes an Error carrying %s", (code) => {
    expect(signalAdapter.test(signal(code))).toBe(true);
  });

  it("keeps its wire key: a tab from the last deploy reads this one's answers", () => {
    expect(signalAdapter.key).toBe("auth-signal");
  });

  it("leaves every other error to the framework", () => {
    expect(signalAdapter.test(new Error("D1 down"))).toBe(false);
    expect(signalAdapter.test(signal("ACCOUNT_BANNED"))).toBe(false);
    // The code alone is not enough: only a thrown Error is a refusal.
    expect(
      signalAdapter.test({ code: EMAIL_UNCONFIRMED_CODE, message: "x" }),
    ).toBe(false);
    expect(signalAdapter.test(undefined)).toBe(false);
  });

  it("sends the code and the sentence, and nothing else", () => {
    const error = Object.assign(signal(EMAIL_UNCONFIRMED_CODE, "Confirm."), {
      secret: "never on the wire",
    });
    if (!signalAdapter.test(error)) throw new Error("not a signal");
    expect(signalAdapter.toSerializable(error)).toStrictEqual({
      code: EMAIL_UNCONFIRMED_CODE,
      message: "Confirm.",
    });
  });

  it("arrives as an Error the client's guards read", () => {
    const arrived = signalAdapter.fromSerializable({
      code: EMAIL_UNCONFIRMED_CODE,
      message: "Confirm your email first.",
    });
    expect(arrived).toBeInstanceOf(Error);
    expect(arrived.message).toBe("Confirm your email first.");
    expect(isUnconfirmedRefusal(arrived)).toBe(true);

    expect(
      isAuthRequired(
        signalAdapter.fromSerializable({
          code: AUTH_REQUIRED_CODE,
          message: "Sign in required.",
        }),
      ),
    ).toBe(true);
    expect(
      isTermsRefusal(
        signalAdapter.fromSerializable({
          code: TERMS_NOT_ACCEPTED_CODE,
          message: "Accept the current terms first.",
        }),
      ),
    ).toBe(true);
  });
});

/**
 * A value as the deserializer hands it over: any shape, typed as the wire
 * shape only because that is the adapter's parameter.
 */
function arriving(
  value: unknown,
): Parameters<typeof signalAdapter.fromSerializable>[0] {
  return z
    .custom<Parameters<typeof signalAdapter.fromSerializable>[0]>(() => true)
    .parse(value);
}

/**
 * SA-L13 (design 230): what arrives is parsed through the schema before an
 * `Error` is made of it, because on the server it is a caller's payload.
 */
describe("signalAdapter on the way in", () => {
  it("keeps only the schema's keys, and an Error's own prototype", () => {
    // JSON.parse makes `__proto__` an own key, as the deserializer does.
    const wire: unknown = JSON.parse(
      `{"code":"${AUTH_REQUIRED_CODE}","message":"x","extra":1,"__proto__":{"on":1}}`,
    );
    const error = signalAdapter.fromSerializable(arriving(wire));
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
    expect(error).not.toHaveProperty("extra");
    expect(error).not.toHaveProperty("on");
    expect(error.message).toBe("x");
    expect(isAuthRequired(error)).toBe(true);
  });

  it.each([
    ["no code", { message: "x" }],
    ["a code it does not send", { code: "ACCOUNT_BANNED", message: "x" }],
    [
      "a message that is not a string",
      { code: AUTH_REQUIRED_CODE, message: {} },
    ],
    ["nothing", undefined],
    ["a string", "x"],
  ])("refuses %s", (_name, value) => {
    expect(() => signalAdapter.fromSerializable(arriving(value))).toThrow(
      z.ZodError,
    );
  });
});
