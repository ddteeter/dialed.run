import { describe, expect, it } from "vitest";

import {
  NEVER_SENT,
  refuseServerFnArgument,
  SERVER_FN_ARGUMENT_KEY,
  ServerFnArgumentRefused,
} from "../../src/lib/refuse-server-fn-argument";

/**
 * A payload carries data, never a server function (SA-M25, design 230):
 * the adapter `src/start.ts` lists ahead of TanStack Start's own, under
 * the same key.
 */
describe("refuseServerFnArgument", () => {
  it("takes the framework's key, so it decodes the node in its place", () => {
    expect(refuseServerFnArgument.key).toBe("$TSS/serverfn");
    expect(SERVER_FN_ARGUMENT_KEY).toBe(refuseServerFnArgument.key);
  });

  it.each([
    () => "a function",
    Object.assign(() => "a server function", { functionId: "x" }),
    { functionId: "x" },
    new Error("x"),
    undefined,
    NaN,
  ])("matches nothing on the way out (%#)", (value) => {
    expect(refuseServerFnArgument.test(value)).toBe(false);
  });

  it("throws on the way in", () => {
    expect(() => refuseServerFnArgument.fromSerializable()).toThrow(
      ServerFnArgumentRefused,
    );
    expect(() => refuseServerFnArgument.fromSerializable()).toThrow(
      "a server function is not accepted as an argument",
    );
  });

  it("matches only a value the app never sends", () => {
    expect(refuseServerFnArgument.test(NEVER_SENT)).toBe(true);
  });

  it("has nothing to send, were it ever asked", () => {
    expect(() => refuseServerFnArgument.toSerializable()).toThrow(
      ServerFnArgumentRefused,
    );
  });

  it("names its refusal", () => {
    expect(new ServerFnArgumentRefused().name).toBe("ServerFnArgumentRefused");
  });
});
