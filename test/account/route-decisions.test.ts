import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetSession,
  isRememberedForSession,
} from "../../src/lib/session-memo";

import { takenMessage } from "../../src/modules/account/handle-copy";
import {
  gateOnHandle,
  startHandleIfNeeded,
} from "../../src/modules/account/route-decisions";
import type { HandleGate } from "../../src/modules/account/username";

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

  it("lets them stay on O0 itself, on the auth pages and on the pages an email link opens", () => {
    expect(gateAt(true, "/onboarding/handle")).toBeUndefined();
    expect(gateAt(true, "/auth/login")).toBeUndefined();
    for (const pathname of [
      "/account/check-email",
      "/account/verify",
      "/account/reset",
      "/account/unsubscribe",
    ]) {
      expect(gateAt(true, pathname), pathname).toBeUndefined();
    }
    // Settings › Username is an account page, and it is behind O0.
    expect(isRedirect(gateAt(true, "/account/username"))).toBe(true);
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
      /beforeLoad: async \(\{ location \}\) => \{\s*await gateOnHandle\(\{\s*ask: handleGateQuery,\s*pathname: location\.pathname,\s*isInBrowser: typeof document !== "undefined",\s*\}\);/u,
    );
  });
});

/**
 * What `gateOnHandle` threw, or `undefined`, with the server's answer
 * counted.
 */
async function gateOnce(
  answer: HandleGate,
  isInBrowser: boolean,
  pathname = "/closet",
): Promise<{ thrown: unknown; asked: number }> {
  const ask = vi.fn(() => Promise.resolve(answer));
  try {
    await gateOnHandle({ ask, pathname, isInBrowser });
  } catch (error: unknown) {
    return { thrown: error, asked: ask.mock.calls.length };
  }
  return { thrown: undefined, asked: ask.mock.calls.length };
}

describe("gateOnHandle (the root's O0 gate, memoised)", () => {
  beforeEach(() => {
    forgetSession();
  });

  it("sends a runner with no handle to O0, and lets the others through", async () => {
    const needs = await gateOnce("needs-handle", true);
    expect(isRedirect(needs.thrown)).toBe(true);
    const has = await gateOnce("has-handle", true);
    expect(has.thrown).toBeUndefined();
    const signedOut = await gateOnce("signed-out", false);
    expect(signedOut.thrown).toBeUndefined();
    // O0 itself is never a redirect to O0.
    const onO0 = await gateOnce("needs-handle", true, "/onboarding/handle");
    expect(onO0.thrown).toBeUndefined();
  });

  it("asks once a session in the browser once the runner has a handle", async () => {
    const first = await gateOnce("has-handle", true);
    expect(first.asked).toBe(1);
    expect(isRememberedForSession("has-handle")).toBe(true);
    // The next navigation does not ask at all — even an answer that would
    // have redirected is never heard.
    const next = await gateOnce("needs-handle", true);
    expect(next.asked).toBe(0);
    expect(next.thrown).toBeUndefined();
  });

  it("keeps asking while the answer can still change", async () => {
    await gateOnce("signed-out", true);
    expect(isRememberedForSession("has-handle")).toBe(false);
    await gateOnce("needs-handle", true);
    expect(isRememberedForSession("has-handle")).toBe(false);
    const again = await gateOnce("needs-handle", true);
    expect(again.asked).toBe(1);
  });

  it("remembers nothing on the server, where every request shares the module", async () => {
    await gateOnce("has-handle", false);
    expect(isRememberedForSession("has-handle")).toBe(false);
    // …and does not trust a memo there either, if one somehow existed.
    await gateOnce("has-handle", true);
    const onServer = await gateOnce("has-handle", false);
    expect(onServer.asked).toBe(1);
  });

  it("asks afresh after the session is forgotten (sign-in, sign-out)", async () => {
    await gateOnce("has-handle", true);
    forgetSession();
    const after = await gateOnce("needs-handle", true);
    expect(after.asked).toBe(1);
    expect(isRedirect(after.thrown)).toBe(true);
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
