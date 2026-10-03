import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { IS_INVITE_ONLY } from "../../src/lib/contracts/access";
import {
  accountDeletionInput,
  requestAccessSchema,
  signUpSchemaFor,
  changeEmailSchema,
  CURRENT_PASSWORD_WRONG,
  currentPasswordLimited,
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

const signUp = {
  inviteCode: "DIAL-7K3P",
  ...signIn,
  password: "hunter22hunter22",
};

describe("signUpSchemaFor (the invite-only flag)", () => {
  it("needs a code of the right shape while invite-only is on, in the board's words", () => {
    const withCode = signUpSchemaFor(true);
    expect(
      messagesFor(withCode, { ...signUp, inviteCode: "" }, "inviteCode"),
    ).toStrictEqual(["Enter your invite code."]);
    expect(
      messagesFor(
        withCode,
        { ...signUp, inviteCode: "DIAL-0000" },
        "inviteCode",
      ),
    ).toStrictEqual([
      "That code doesn't work. Check it against the email or message it came in.",
    ]);
    expect(
      withCode.parse({ ...signUp, inviteCode: " dial-7k3p " }),
    ).toMatchObject({ inviteCode: "DIAL-7K3P" });
  });

  it("asks for no code when invite-only is off, and ignores one that comes", () => {
    const open = signUpSchemaFor(false);
    const { email, password } = signUp;
    expect(open.safeParse({ email, password }).success).toBe(true);
    expect(open.parse({ ...signUp, inviteCode: "anything" })).toMatchObject({
      inviteCode: "anything",
    });
  });

  it("is invite-only today (D-39)", () => {
    expect(IS_INVITE_ONLY).toBe(true);
    expect(signUpSchema.safeParse({ ...signUp, inviteCode: "" }).success).toBe(
      false,
    );
  });
});

describe("requestAccessSchema (Au5)", () => {
  it("takes an address and a note of up to 280 characters", () => {
    expect(
      requestAccessSchema.parse({ email: "sam@example.com", note: "" }),
    ).toStrictEqual({ email: "sam@example.com", note: "" });
    expect(
      messagesFor(
        requestAccessSchema,
        { email: "sam@example.com", note: "a".repeat(281) },
        "note",
      ),
    ).toStrictEqual(["Keep the note under 280 characters."]);
    expect(
      requestAccessSchema.safeParse({
        email: "sam@example.com",
        note: "a".repeat(280),
      }).success,
    ).toBe(true);
    expect(
      messagesFor(requestAccessSchema, { email: "", note: "" }, "email"),
    ).toContain("Enter your email address.");
  });
});

describe("signUpSchema", () => {
  it("takes a well-formed registration", () => {
    expect(signUpSchema.safeParse(signUp).success).toBe(true);
  });

  it("asks for the invite code, email and password only — the handle is O0's (round 26 #7, #20)", () => {
    expect(signUpSchema.safeParse({}).success).toBe(false);
    expect(Object.keys(signUpSchema.shape)).toStrictEqual([
      "inviteCode",
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
    const withPassword = { currentPassword: "x" };
    for (const schema of [resetRequestSchema, changeEmailSchema]) {
      expect(
        messagesFor(schema, { email: "", ...withPassword }, "email"),
      ).toContain("Enter your email address.");
      expect(
        messagesFor(schema, { email: "dee", ...withPassword }, "email"),
      ).toStrictEqual(["That does not look like an email address."]);
    }
    expect(
      resetRequestSchema.parse({ email: "dee@example.com" }),
    ).toStrictEqual({ email: "dee@example.com" });
  });

  it("ask for the current password before an email change (ACC-8)", () => {
    expect(
      messagesFor(
        changeEmailSchema,
        { email: "dee@example.com", currentPassword: "" },
        "currentPassword",
      ),
    ).toStrictEqual(["Enter your current password."]);
    expect(
      changeEmailSchema.parse({
        email: "dee@example.com",
        currentPassword: "x",
      }),
    ).toStrictEqual({ email: "dee@example.com", currentPassword: "x" });
    expect(CURRENT_PASSWORD_WRONG).toBe("That's not your current password.");
  });

  it("say round 28 #10's lockout, with the limiter's own count", () => {
    expect(currentPasswordLimited("7:42 PM")).toBe(
      "That's 5 wrong tries. You can try again at 7:42 PM.",
    );
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

describe("accountDeletionInput", () => {
  it("takes the password an account has, or none from one that has none", () => {
    expect(
      accountDeletionInput.safeParse({ currentPassword: "pw-1" }),
    ).toStrictEqual({ success: true, data: { currentPassword: "pw-1" } });
    expect(accountDeletionInput.safeParse({})).toStrictEqual({
      success: true,
      data: {},
    });
  });

  it("holds the password to a ceiling of 1024 characters, not a floor", () => {
    expect(
      accountDeletionInput.safeParse({ currentPassword: "a".repeat(1024) })
        .success,
    ).toBe(true);
    expect(
      accountDeletionInput.safeParse({ currentPassword: "a".repeat(1025) })
        .success,
    ).toBe(false);
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
