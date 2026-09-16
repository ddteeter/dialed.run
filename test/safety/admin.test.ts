import { afterEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import {
  AdminRequiredError,
  adminUserIds,
  isAdmin,
  isAdminRequired,
  requireAdmin,
} from "../../src/modules/safety";

/**
 * The gate on the only privileged surface in the app.
 *
 * Its failure modes are asymmetric and that is the whole design: a queue
 * nobody can open is a nuisance, and one anybody can open is a breach. So
 * every ambiguous input has to fail CLOSED, and each of those is a test.
 */

const ORIGINAL = env.ADMIN_USER_IDS;

function configure(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(env, "ADMIN_USER_IDS");
    return;
  }
  Reflect.set(env, "ADMIN_USER_IDS", value);
}

afterEach(() => {
  configure(ORIGINAL);
});

describe("reading the configured admins", () => {
  // A trailing comma is the likeliest typo, and "" must never match a
  // user id — a signed-in user whose id somehow read as empty would
  // otherwise be an admin.
  it.each([
    ["a single id", "runner-1", ["runner-1"]],
    ["several, comma-separated", "runner-1,runner-2", ["runner-1", "runner-2"]],
    ["the spaces a human types", " runner-1 , runner-2 ", ["runner-1", "runner-2"]],
    ["a stray empty entry", "runner-1,,runner-2,", ["runner-1", "runner-2"]],
  ])("parses %s", (_label, configured, expected) => {
    configure(configured);
    expect(adminUserIds()).toEqual(expected);
  });
});

describe("when the secret is missing or wrong", () => {
  it.each([
    ["unset", undefined],
    ["an empty string", ""],
    ["a comma-only value", ",,,"],
  ])("yields no admins when the secret is %s", (_label, value) => {
    configure(value);
    expect(adminUserIds()).toEqual([]);
  });

  it("yields no admins when the binding is not a string", () => {
    Reflect.set(env, "ADMIN_USER_IDS", 42);
    // Wrangler hands over whatever is configured; a number here is a
    // misconfiguration, and reading it loosely would be worse than
    // reading nothing.
    expect(adminUserIds()).toEqual([]);
  });

  it("fails closed: a misconfiguration locks everyone out", () => {
    configure(undefined);
    // The right way round. A moderation queue nobody can open is a
    // nuisance; one anybody can open is a breach.
    expect(isAdmin("runner-1")).toBe(false);
    expect(() => requireAdmin("runner-1")).toThrow(AdminRequiredError);
  });
});

describe("the gate", () => {
  it("lets a configured admin through and hands back their id", () => {
    configure("runner-1,runner-2");
    // Returning the id is what lets a caller stamp the reviewer without
    // asking who they are twice.
    expect(requireAdmin("runner-2")).toBe("runner-2");
  });

  it("refuses anybody else", () => {
    configure("runner-1");
    expect(() => requireAdmin("runner-2")).toThrow(AdminRequiredError);
    expect(isAdmin("runner-2")).toBe(false);
  });

  it("matches ids exactly, not by prefix", () => {
    configure("runner-1");
    // Substring matching here would make "runner-10" an admin.
    expect(isAdmin("runner-10")).toBe(false);
    expect(isAdmin("runner")).toBe(false);
  });
});

describe("telling the two refusals apart", () => {
  it("recognises its own error", () => {
    expect(isAdminRequired(new AdminRequiredError())).toBe(true);
    // And says which of the two refusals it is. `AuthRequiredError`
    // means "sign in", which is an invitation; this one means "no", and
    // a log that cannot tell them apart cannot explain a redirect loop.
    expect(new AdminRequiredError().message).toBe("admin only");
  });

  it("does not claim an unrelated error", () => {
    // Distinct from AuthRequiredError on purpose: that one means "sign
    // in", which is an invitation. This one means "no", and a router
    // confusing them would offer a signed-in stranger a login page in an
    // endless loop.
    expect(isAdminRequired(new Error("something else"))).toBe(false);
    expect(isAdminRequired(undefined)).toBe(false);
  });
});
