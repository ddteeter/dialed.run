import { describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "../../src/lib/errors";
import { requireOwned, requireOwner } from "../../src/lib/owned";

/**
 * The two answers that are not "here it is" and not "we broke".
 *
 * They were three types in three modules — `feed`'s `NotFoundError`
 * defaulting its message, `closet`'s hard-coding one and taking no
 * argument, and `runs`' `RunNotFoundError` carrying the router's marker.
 * Same concept, three shapes, and nothing could handle "not found"
 * uniformly without knowing all three.
 *
 * A clone detector cannot see this in any mode: a restated *type* is not
 * copied text. It is the failure mode CLAUDE.md records for auth, and it
 * stayed invisible until someone read the three files next to each other.
 */

describe("NotFoundError", () => {
  it("carries the marker the router duck-types on", () => {
    // TanStack's own `notFound()` returns a plain options object rather
    // than an Error, and the house `only-throw-error` rule refuses to
    // throw that — so a real Error with `isNotFound` is what lets a loader
    // answer 404 instead of crashing. Two of the three old types lacked
    // it, which is why `runs` needed a fourth.
    const error = new NotFoundError("run not found");

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ isNotFound: true, message: "run not found" });
    expect(error.name).toBe("NotFoundError");
  });

  it("says something when given nothing", () => {
    expect(new NotFoundError().message).toBe("not found");
  });
});

describe("ForbiddenError", () => {
  it("is not a NotFoundError", () => {
    // The distinction is the point. "No such entry" and "someone else's
    // entry" are deliberately the same answer to a stranger, but they are
    // different facts here — a handler that cannot tell them apart cannot
    // decide which one to hide.
    const error = new ForbiddenError("not your run");

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).not.toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ message: "not your run" });
    expect(error.name).toBe("ForbiddenError");
  });

  it("says something when given nothing", () => {
    expect(new ForbiddenError().message).toBe("not allowed");
  });
});

describe("requireOwned", () => {
  const row = { id: "01ROW", userId: "01OWNER", extra: "kept" };
  const messages = { missing: "run not found", forbidden: "not your run" };

  it("hands back the row when it is the caller's", () => {
    // Returned, not just checked: every call site needs the row it read,
    // and a guard that discarded it would put the read back at each site.
    expect(requireOwned(row, "01OWNER", messages)).toBe(row);
  });

  it("distinguishes a missing row from someone else's", () => {
    // The order matters as much as the types. Checking ownership first
    // would read `undefined.userId`; collapsing them would lose the
    // difference between a 404 and a 403 at the one place it is known.
    expect(() => requireOwned(undefined, "01OWNER", messages)).toThrow(
      NotFoundError,
    );
    expect(() => requireOwned(row, "01STRANGER", messages)).toThrow(
      ForbiddenError,
    );
  });

  it("uses the caller's words for both", () => {
    // Required rather than defaulted: these throw across module
    // boundaries, where "not found" on its own tells a reader nothing
    // about which thing was not found.
    expect(() => requireOwned(undefined, "01OWNER", messages)).toThrow(
      "run not found",
    );
    expect(() => requireOwned(row, "01STRANGER", messages)).toThrow(
      "not your run",
    );
  });
});

describe("requireOwner", () => {
  const row = { id: "01ROW", userId: "01OWNER" };

  it("hands back a row the caller already knows is there", () => {
    expect(requireOwner(row, "01OWNER", "not yours")).toBe(row);
  });

  it("refuses someone else's, in the caller's words", () => {
    // The ownership half alone, for a caller inside `if (row)` — where a
    // "missing" message would be a sentence no input could produce, sitting
    // in the source looking like live copy. `attachKit` is the case: an
    // absent entry there is not an error, it is the signal to create one.
    expect(() => requireOwner(row, "01STRANGER", "not yours")).toThrow(
      ForbiddenError,
    );
    expect(() => requireOwner(row, "01STRANGER", "not yours")).toThrow(
      "not yours",
    );
  });
});
