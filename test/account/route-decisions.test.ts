import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { takenMessage } from "../../src/modules/account/handle-copy";
import { startHandleIfNeeded } from "../../src/modules/account/route-decisions";

/**
 * What `startHandleIfNeeded` threw for `pathname`, or `undefined`.
 */
function gateAt(requiresHandle: boolean, pathname: string): unknown {
  try {
    startHandleIfNeeded(requiresHandle, pathname);
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

const rootRoute: Record<string, string> = import.meta.glob(
  "../../src/routes/__root.tsx",
  { query: "?raw", import: "default", eager: true },
);

describe("startHandleIfNeeded (round 26 #7)", () => {
  it("sends a runner with no handle to O0 from any page, a sign-in's redirect target included", () => {
    for (const pathname of ["/", "/closet", "/feed/search", "/runs/r1"]) {
      const thrown = gateAt(true, pathname);
      expect(isRedirect(thrown)).toBe(true);
      expect(thrown).toMatchObject({ options: { to: "/onboarding/handle" } });
    }
  });

  it("lets them stay on O0 itself and on the auth pages", () => {
    expect(gateAt(true, "/onboarding/handle")).toBeUndefined();
    expect(gateAt(true, "/auth/login")).toBeUndefined();
    // A prefix of O0's path is not O0.
    expect(isRedirect(gateAt(true, "/onboarding/handles"))).toBe(true);
    expect(isRedirect(gateAt(true, "/authx"))).toBe(true);
  });

  it("lets everyone else through", () => {
    expect(gateAt(false, "/closet")).toBeUndefined();
  });

  it("is asked by the root route on every navigation, with the page being entered", () => {
    // A route file cannot be imported by a test, so the wiring is read:
    // the root's `beforeLoad` is the one road every page, and every
    // sign-in's `?redirect=`, passes through.
    const [source] = Object.values(rootRoute);
    expect(source).toMatch(
      /beforeLoad: async \(\{ location \}\) => \{\s*startHandleIfNeeded\(await handleGateQuery\(\), location\.pathname\);/u,
    );
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
