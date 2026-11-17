import { describe, expect, it } from "vitest";

import { TURNSTILE_ACTIONS } from "../../src/lib/turnstile-actions";

describe("TURNSTILE_ACTIONS", () => {
  it("names each in-app form's action once, each its own (SA-L07)", () => {
    expect(TURNSTILE_ACTIONS).toStrictEqual({
      signUp: "sign-up",
      requestAccess: "request-access",
      takedown: "takedown",
    });
  });
});
