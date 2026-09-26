import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { takenMessage } from "../../src/modules/account/handle-copy";
import { startHandleIfNeeded } from "../../src/modules/account/route-decisions";

describe("startHandleIfNeeded (round 26 #7)", () => {
  it("sends a runner with no handle to O0", () => {
    let thrown: unknown;
    try {
      startHandleIfNeeded(true);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({ options: { to: "/onboarding/handle" } });
  });

  it("lets everyone else through", () => {
    expect(() => {
      startHandleIfNeeded(false);
    }).not.toThrow();
  });
});

describe("takenMessage", () => {
  it("is the board's sentence, with one suggestion or none", () => {
    expect(takenMessage("maya_runs", "maya_runs_pdx")).toBe(
      "@maya_runs is taken. Try another, like @maya_runs_pdx.",
    );
    expect(takenMessage("admin", undefined)).toBe(
      "@admin is taken. Try another.",
    );
  });
});
