import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  runDraftSchema,
  signInSchema,
  signUpSchema,
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
    expect(messagesFor(signInSchema, { ...signIn, email: "" }, "email")).toContain(
      "Enter your email address.",
    );
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

const signUp = { name: "Dee", ...signIn };

describe("signUpSchema", () => {
  it("takes a well-formed registration", () => {
    expect(signUpSchema.safeParse(signUp).success).toBe(true);
  });

  it("requires all three fields", () => {
    expect(signUpSchema.safeParse({}).success).toBe(false);
    expect(signUpSchema.safeParse({ ...signUp, name: undefined }).success).toBe(
      false,
    );
  });

  it("holds the name between 1 and 60 characters", () => {
    expect(
      messagesFor(signUpSchema, { ...signUp, name: "" }, "name"),
    ).toStrictEqual(["Tell us what to call you."]);
    expect(signUpSchema.safeParse({ ...signUp, name: "a".repeat(60) }).success).toBe(
      true,
    );
    expect(signUpSchema.safeParse({ ...signUp, name: "a".repeat(61) }).success).toBe(
      false,
    );
  });

  it("holds Better Auth's eight-character password floor", () => {
    // Eight is Better Auth's own minimum. Stating it here is what lets the
    // form say so before the round trip; a looser copy would let the user
    // submit something the server then rejects with worse wording.
    expect(
      messagesFor(signUpSchema, { ...signUp, password: "a".repeat(7) }, "password"),
    ).toStrictEqual(["Use at least 8 characters."]);
    expect(
      signUpSchema.safeParse({ ...signUp, password: "a".repeat(8) }).success,
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
    expect(runDraftSchema.safeParse({ ...runDraft, durationS: 1800.5 }).success).toBe(
      false,
    );
    expect(runDraftSchema.safeParse({ ...runDraft, startedAt: 1.5 }).success).toBe(
      false,
    );
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
