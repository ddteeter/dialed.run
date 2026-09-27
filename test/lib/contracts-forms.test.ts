import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  changeEmailSchema,
  changePasswordSchema,
  newPasswordSchema,
  PASSWORD_MIN_LENGTH,
  resetRequestSchema,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  normalizeUsername,
  runDraftSchema,
  signInSchema,
  signUpSchema,
  usernameInput,
  usernameSchema,
} from "../../src/lib/contracts";

/**
 * The three form contracts, pinned message by message.
 *
 * These schemas are the *only* validation in front of sign-in, sign-up and
 * manual run entry — Better Auth owns two of those endpoints, so nothing
 * server-side re-checks the shape. Their error copy is a product surface
 * (§Forms & failure, "Error copy lives in the schema"): the sentence a user
 * reads is written here and read nowhere else.
 *
 * Mutation testing found all sixteen of them free: every message could be
 * emptied and every `min` flipped to `max` with the suite green, because a
 * test that only asserts `success: false` cannot tell "rejected for the
 * stated reason" from "rejected at all". So these assert the *message*, and
 * assert at each bound rather than near it.
 */

/**
Every message zod raised for `field`, in issue order.
*/
function messagesFor(
  schema: z.ZodType,
  value: unknown,
  field: string,
): string[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
}

const signIn = { email: "runner@example.com", password: "hunter22" };

describe("signInSchema", () => {
  it("takes a well-formed credential pair", () => {
    expect(signInSchema.safeParse(signIn).success).toBe(true);
  });

  it("requires both fields — an empty object is not a sign-in", () => {
    // The object literal itself: `z.object({})` accepts anything, and a
    // sign-in form that validates nothing posts empty credentials.
    expect(signInSchema.safeParse({}).success).toBe(false);
    expect(signInSchema.safeParse({ email: signIn.email }).success).toBe(false);
    expect(signInSchema.safeParse({ password: signIn.password }).success).toBe(
      false,
    );
  });

  it("names the fix when the email is missing or malformed", () => {
    expect(
      messagesFor(signInSchema, { ...signIn, email: "" }, "email"),
    ).toContain("Enter your email address.");
    expect(
      messagesFor(signInSchema, { ...signIn, email: "runner@" }, "email"),
    ).toContain("That does not look like an email address.");
  });

  it("names the fix when the password is missing", () => {
    expect(
      messagesFor(signInSchema, { ...signIn, password: "" }, "password"),
    ).toStrictEqual(["Enter your password."]);
  });
});

const signUp = { ...signIn, password: "hunter22hunter22" };

describe("signUpSchema", () => {
  it("takes a well-formed registration", () => {
    expect(signUpSchema.safeParse(signUp).success).toBe(true);
  });

  it("asks for email and password only — the handle is O0's (round 26 #7)", () => {
    expect(signUpSchema.safeParse({}).success).toBe(false);
    expect(Object.keys(signUpSchema.shape)).toStrictEqual([
      "email",
      "password",
    ]);
    expect(signUpSchema.parse({ ...signUp, name: "Dee" })).toStrictEqual(
      signUp,
    );
  });

  it("refuses a nine-character password and takes a ten (owner, 2026-09-24)", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(
      messagesFor(
        signUpSchema,
        { ...signUp, password: "a".repeat(9) },
        "password",
      ),
    ).toStrictEqual(["Use at least 10 characters."]);
    expect(
      signUpSchema.safeParse({ ...signUp, password: "a".repeat(10) }).success,
    ).toBe(true);
  });
});

describe("the account forms (ACC-4, ACC-7, ACC-8)", () => {
  it("ask for an address the way sign-in does", () => {
    for (const schema of [resetRequestSchema, changeEmailSchema]) {
      expect(messagesFor(schema, { email: "" }, "email")).toContain(
        "Enter your email address.",
      );
      expect(messagesFor(schema, { email: "dee" }, "email")).toStrictEqual([
        "That does not look like an email address.",
      ]);
      expect(schema.parse({ email: "dee@example.com" })).toStrictEqual({
        email: "dee@example.com",
      });
    }
  });

  it("hold a new password to sign-up's floor", () => {
    expect(
      messagesFor(newPasswordSchema, { password: "a".repeat(9) }, "password"),
    ).toStrictEqual(["Use at least 10 characters."]);
    expect(
      newPasswordSchema.safeParse({ password: "a".repeat(10) }).success,
    ).toBe(true);
  });

  it("ask for the current password before a new one", () => {
    expect(
      messagesFor(
        changePasswordSchema,
        { currentPassword: "", password: "a".repeat(10) },
        "currentPassword",
      ),
    ).toStrictEqual(["Enter your current password."]);
    expect(
      messagesFor(
        changePasswordSchema,
        { currentPassword: "x", password: "a".repeat(9) },
        "password",
      ),
    ).toStrictEqual(["Use at least 10 characters."]);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "x",
        password: "a".repeat(10),
      }).success,
    ).toBe(true);
  });
});

const runDraft = {
  startedAt: 1_757_000_000_000,
  durationS: 1800,
  distanceM: 5000,
  title: "Morning shakeout",
};

describe("runDraftSchema", () => {
  it("takes a well-formed manual entry, and defaults it outdoors", () => {
    const result = runDraftSchema.safeParse(runDraft);
    expect(result.success).toBe(true);
    expect(result.data?.indoor).toBe(false);
  });

  it("insists the three measurements are positive whole-ish numbers", () => {
    expect(
      messagesFor(runDraftSchema, { ...runDraft, startedAt: 0 }, "startedAt"),
    ).toStrictEqual(["Pick when the run started."]);
    expect(
      messagesFor(runDraftSchema, { ...runDraft, durationS: 0 }, "durationS"),
    ).toStrictEqual(["How many minutes did it take?"]);
    expect(
      messagesFor(runDraftSchema, { ...runDraft, distanceM: 0 }, "distanceM"),
    ).toStrictEqual(["How far did you go?"]);
    // Fractional seconds are a parser bug, not a run.
    expect(
      runDraftSchema.safeParse({ ...runDraft, durationS: 1800.5 }).success,
    ).toBe(false);
    expect(
      runDraftSchema.safeParse({ ...runDraft, startedAt: 1.5 }).success,
    ).toBe(false);
  });

  it("holds the title between 1 and 120 characters", () => {
    expect(
      messagesFor(runDraftSchema, { ...runDraft, title: "" }, "title"),
    ).toStrictEqual(["Give the run a name."]);
    expect(
      runDraftSchema.safeParse({ ...runDraft, title: "a".repeat(120) }).success,
    ).toBe(true);
    expect(
      runDraftSchema.safeParse({ ...runDraft, title: "a".repeat(121) }).success,
    ).toBe(false);
  });

  it("takes the optional fields when they are given", () => {
    expect(
      runDraftSchema.safeParse({
        ...runDraft,
        lat: 45.5,
        lng: -122.6,
        indoor: true,
        effort: "steady",
      }).success,
    ).toBe(true);
  });
});

describe("usernameSchema (round 26 #7)", () => {
  it("stores what was typed lowercased, without the @ or the spaces", () => {
    expect(normalizeUsername("  @Maya_Runs ")).toBe("maya_runs");
    expect(normalizeUsername("maya@runs")).toBe("maya@runs");
    expect(usernameSchema.parse(" @Maya_Runs")).toBe("maya_runs");
    expect(usernameInput.parse({ username: "DEE" })).toStrictEqual({
      username: "dee",
    });
  });

  it("takes 3 to 20 of a-z, 0-9 and _, at each bound", () => {
    expect(USERNAME_MIN_LENGTH).toBe(3);
    expect(USERNAME_MAX_LENGTH).toBe(20);
    expect(usernameSchema.safeParse("abc").success).toBe(true);
    expect(usernameSchema.safeParse("a".repeat(20)).success).toBe(true);
    expect(usernameSchema.safeParse("r_2_d_2").success).toBe(true);
    const shape = ["Use 3–20 letters, numbers or _."];
    expect(
      messagesFor(usernameInput, { username: "ab" }, "username"),
    ).toStrictEqual(shape);
    expect(
      messagesFor(usernameInput, { username: "a".repeat(21) }, "username"),
    ).toStrictEqual(shape);
    expect(
      messagesFor(usernameInput, { username: "" }, "username"),
    ).toStrictEqual(shape);
    expect(
      messagesFor(usernameInput, { username: "maya.runs" }, "username"),
    ).toStrictEqual(shape);
    expect(
      messagesFor(usernameInput, { username: "mayä" }, "username"),
    ).toStrictEqual(shape);
    // Anchored at both ends: a good run inside a bad handle is not enough.
    expect(
      messagesFor(usernameInput, { username: "maya runs" }, "username"),
    ).toStrictEqual(shape);
    expect(
      messagesFor(usernameInput, { username: "-maya" }, "username"),
    ).toStrictEqual(shape);
    expect(
      messagesFor(usernameInput, { username: "maya-" }, "username"),
    ).toStrictEqual(shape);
  });

  it("refuses a leading _ in its own words, and only that", () => {
    expect(
      messagesFor(usernameInput, { username: "_maya" }, "username"),
    ).toStrictEqual(["Handles can't start with _."]);
    expect(usernameSchema.safeParse("maya_").success).toBe(true);
    // A handle wrong in both ways reads the shape sentence alone.
    expect(
      messagesFor(usernameInput, { username: "_m" }, "username"),
    ).toStrictEqual(["Use 3–20 letters, numbers or _."]);
  });
});
