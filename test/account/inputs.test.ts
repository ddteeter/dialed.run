import { describe, expect, it } from "vitest";

import {
  deskRowInput,
  newInviteInput,
  newInviteSchema,
  requestAccessInput,
  resendInput,
} from "../../src/modules/account/inputs";

/**
 * Au4's Resend: parsed loosely, since an address that is not one simply has
 * no account and the answer is the same either way.
 */
describe("resendInput", () => {
  it("parses a short, ordinary address, keeping the field", () => {
    expect(resendInput.parse({ email: "a@b.com" })).toStrictEqual({
      email: "a@b.com",
    });
  });
});

describe("requestAccessInput", () => {
  it("keeps the turnstile token alongside the request's own fields", () => {
    expect(
      requestAccessInput.parse({
        email: "a@b.com",
        note: "",
        turnstileToken: "tok",
      }),
    ).toStrictEqual({ email: "a@b.com", note: "", turnstileToken: "tok" });
  });

  it("is optional, and accepts a token far short of the 2048 cap", () => {
    const parsed = requestAccessInput.parse({ email: "a@b.com", note: "" });
    expect(parsed.turnstileToken).toBeUndefined();
    expect(
      requestAccessInput.safeParse({
        email: "a@b.com",
        note: "",
        turnstileToken: "short-token",
      }).success,
    ).toBe(true);
  });
});

describe("newInviteSchema", () => {
  it("refuses a label over 60 characters with its own sentence", () => {
    const result = newInviteSchema.safeParse({
      label: "x".repeat(61),
      maxUses: 1,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Keep the label under 60 characters.",
    );
  });
});

describe("newInviteInput", () => {
  const base = { label: "Group", maxUses: 5 };

  it("keeps a key of ordinary length, in the parsed output", () => {
    const key = "k".repeat(30);
    const parsed = newInviteInput.parse({ ...base, idempotencyKey: key });
    expect(parsed.idempotencyKey).toBe(key);
  });

  it("accepts the key's exact bounds and refuses past them", () => {
    expect(
      newInviteInput.safeParse({ ...base, idempotencyKey: "k" }).success,
    ).toBe(true);
    expect(
      newInviteInput.safeParse({ ...base, idempotencyKey: "k".repeat(64) })
        .success,
    ).toBe(true);
    expect(
      newInviteInput.safeParse({ ...base, idempotencyKey: "" }).success,
    ).toBe(false);
    expect(
      newInviteInput.safeParse({ ...base, idempotencyKey: "k".repeat(65) })
        .success,
    ).toBe(false);
  });
});

describe("deskRowInput", () => {
  it("keeps an id of ordinary length, in the parsed output", () => {
    const id = "r".repeat(30);
    expect(deskRowInput.parse({ id })).toStrictEqual({ id });
  });

  it("accepts the id's exact bounds and refuses past them", () => {
    expect(deskRowInput.safeParse({ id: "r" }).success).toBe(true);
    expect(deskRowInput.safeParse({ id: "r".repeat(64) }).success).toBe(true);
    expect(deskRowInput.safeParse({ id: "" }).success).toBe(false);
    expect(deskRowInput.safeParse({ id: "r".repeat(65) }).success).toBe(
      false,
    );
  });
});
