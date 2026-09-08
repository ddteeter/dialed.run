import { describe, expect, it } from "vitest";

import {
  AuthRequiredError,
  isAuthRequired,
} from "../src/modules/auth/auth-error";

/**
 * The point of a single error type is that a caller can act on it. These
 * tests pin the two properties that make that possible — a stable `code`,
 * and a guard that still recognises the error after it has crossed a
 * server-function boundary and lost its prototype.
 */
describe("the auth-required signal", () => {
  it("is an Error, so it still behaves like one in a catch", () => {
    const error = new AuthRequiredError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AuthRequiredError");
    expect(error.message).toBe("Sign in required.");
  });

  it("is recognised in the isolate that threw it", () => {
    expect(isAuthRequired(new AuthRequiredError())).toBe(true);
  });

  /**
   * The load-bearing case. A server function's rejection reaches the client
   * as structured-cloned data, not as a class instance, so `instanceof`
   * would report false and the client would render "something went wrong"
   * instead of sending the user to sign in.
   */
  it("survives the trip across a server-function boundary", () => {
    const thrown = new AuthRequiredError();
    const asItArrives: unknown = structuredClone({
      name: thrown.name,
      message: thrown.message,
      code: thrown.code,
    });
    expect(asItArrives).not.toBeInstanceOf(AuthRequiredError);
    expect(isAuthRequired(asItArrives)).toBe(true);
  });

  it("does not claim unrelated failures", () => {
    expect(isAuthRequired(new Error("D1_ERROR: no such table"))).toBe(false);
    expect(isAuthRequired({ code: "SQLITE_BUSY" })).toBe(false);
    expect(isAuthRequired("AUTH_REQUIRED")).toBe(false);
    // unicorn/no-null is about authoring nulls; a JSON round trip really
    // does hand you one, so the guard has to survive it.
    expect(isAuthRequired(JSON.parse("null"))).toBe(false);
    expect(isAuthRequired(undefined)).toBe(false);
  });
});
