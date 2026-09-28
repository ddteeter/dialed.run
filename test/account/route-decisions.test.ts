import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetSession,
  isRememberedForSession,
  noteSessionOwner,
} from "../../src/lib/session-memo";

import { takenMessage } from "../../src/modules/account/handle-copy";
import {
  ACCOUNT_SECTION_TITLES,
  accountSectionOrNotFound,
  checkEmailSearch,
  checkEmailView,
  gateOnHandle,
  startHandleIfNeeded,
  startOverIfNoAddress,
  tokenSearch,
  unsubscribeSearch,
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
  gate: HandleGate,
  isInBrowser: boolean,
  pathname = "/closet",
  userId = "u1",
): Promise<{ thrown: unknown; asked: number }> {
  const ask = vi.fn(() =>
    Promise.resolve(
      gate === "signed-out" ? { gate, userId: undefined } : { gate, userId },
    ),
  );
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

  it("keys what it remembers to the runner the server named", async () => {
    await gateOnce("has-handle", true, "/closet", "u1");
    expect(isRememberedForSession("has-handle")).toBe(true);
    // Somebody else signs in from another tab, which names them as the
    // browser's runner: the first runner's memo is not theirs.
    noteSessionOwner("u2");
    const other = await gateOnce("needs-handle", true, "/closet", "u2");
    expect(other.asked).toBe(1);
    expect(isRedirect(other.thrown)).toBe(true);
    expect(isRememberedForSession("has-handle")).toBe(false);
    const again = await gateOnce("needs-handle", true, "/closet", "u2");
    expect(again.asked).toBe(1);
    // The first runner back: what was true of them still is.
    noteSessionOwner("u1");
    expect(isRememberedForSession("has-handle")).toBe(true);
  });

  it("drops the memo when the server says nobody is signed in", async () => {
    await gateOnce("has-handle", true);
    noteSessionOwner(undefined);
    expect(isRememberedForSession("has-handle")).toBe(false);
    const next = await gateOnce("has-handle", true);
    expect(next.asked).toBe(1);
  });

  it("asks afresh after the session is forgotten (sign-in, sign-out)", async () => {
    await gateOnce("has-handle", true);
    forgetSession();
    const after = await gateOnce("needs-handle", true);
    expect(after.asked).toBe(1);
    expect(isRedirect(after.thrown)).toBe(true);
  });

  it("never writes the owner from the server, even when the answer names somebody else", async () => {
    // A "has-handle" answer would also write the owner via
    // `rememberForSession` itself, which would hide a broken `isInBrowser`
    // guard on `noteSessionOwner`. This isolates it: the only call able to
    // touch the owner here is the one the server must skip.
    await gateOnce("has-handle", true, "/closet", "u1");
    expect(isRememberedForSession("has-handle")).toBe(true);
    await gateOnce("signed-out", false);
    // Still u1's memo: a server request — which every other request
    // shares the module with — must not touch the browser's owner.
    expect(isRememberedForSession("has-handle")).toBe(true);
  });

  it("takes the owner from what the browser hears, even on an answer it does not remember", async () => {
    await gateOnce("has-handle", true, "/closet", "u1");
    // Another tab signed someone else in, so this tab asks again…
    noteSessionOwner("u2");
    expect(isRememberedForSession("has-handle")).toBe(false);
    // …and the server says it is u1 after all. The answer is not one the
    // memo keeps, so only the owner it names can bring u1's facts back.
    const back = await gateOnce("needs-handle", true, "/onboarding/handle");
    expect(back.asked).toBe(1);
    expect(isRememberedForSession("has-handle")).toBe(true);
  });

  it("takes nothing from what the server hears", async () => {
    await gateOnce("has-handle", true, "/closet", "u1");
    noteSessionOwner("u2");
    await gateOnce("needs-handle", false, "/onboarding/handle");
    expect(isRememberedForSession("has-handle")).toBe(false);
  });
});

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe("Au4's decisions", () => {
  it("is about the signed-in runner's own address, or else the one sign-up sent to", () => {
    expect(
      checkEmailView({ email: "me@example.com" }, "typed@example.com"),
    ).toStrictEqual({ email: "me@example.com", isSignedIn: true });
    expect(checkEmailView(undefined, "typed@example.com")).toStrictEqual({
      email: "typed@example.com",
      isSignedIn: false,
    });
  });

  it("sends a visitor with neither back to sign-up", () => {
    for (const searchEmail of [undefined, ""]) {
      const thrown = thrownBy(() => {
        startOverIfNoAddress(undefined, searchEmail);
      });
      expect(isRedirect(thrown)).toBe(true);
      expect(thrown).toMatchObject({ options: { to: "/auth/signup" } });
    }
    expect(
      thrownBy(() => {
        startOverIfNoAddress(undefined, "typed@example.com");
      }),
    ).toBeUndefined();
    expect(
      thrownBy(() => {
        startOverIfNoAddress({ email: "me@example.com" }, undefined);
      }),
    ).toBeUndefined();
  });
});

describe("the link searches", () => {
  it("keep a string and drop anything else, so a mangled link still lands", () => {
    expect(checkEmailSearch.parse({ email: "a@b.c" })).toStrictEqual({
      email: "a@b.c",
    });
    expect(checkEmailSearch.parse({ email: ["a", "b"] }).email).toBeUndefined();
    expect(tokenSearch.parse({ token: "verify.u.s" })).toStrictEqual({
      token: "verify.u.s",
    });
    expect(tokenSearch.parse({ token: 7 }).token).toBeUndefined();
    expect(
      unsubscribeSearch.parse({ u: "u1", k: "run_reminder", s: "sig", x: 1 }),
    ).toStrictEqual({ u: "u1", k: "run_reminder", s: "sig" });
    expect(unsubscribeSearch.parse({})).toStrictEqual({});
  });
});

describe("the account's sections (ACC-7, ACC-8, ACC-11)", () => {
  it("are four, each with its heading, and anything else is X1", () => {
    for (const section of ["sign-in", "email", "password", "notifications"]) {
      expect(accountSectionOrNotFound(section)).toBe(section);
    }
    expect(ACCOUNT_SECTION_TITLES).toStrictEqual({
      "sign-in": "Account",
      email: "Email",
      password: "Password",
      notifications: "Notifications",
    });
    let thrown: unknown;
    try {
      accountSectionOrNotFound("export");
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      isNotFound: true,
      message: 'no account section "export"',
    });
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
