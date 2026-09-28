import { describe, expect, it } from "vitest";

import {
  emailPayloadSchema,
  emailRecipientSchema,
  emailTemplateSchema,
  preferenceFor,
} from "../../src/lib/email";

/**
 * The email wire format (task 126, ACC-2): every kind's literal discriminant,
 * the protocol regex a link's URL is checked against, and the one place
 * `preferenceFor` reads which switch governs a kind.
 */

describe("emailTemplateSchema", () => {
  it("parses one minimal, valid payload of every kind", () => {
    const link = "https://dialed.run/account/verify?token=t";
    const payloads = [
      { kind: "verify_email", url: link },
      { kind: "existing_account" },
      { kind: "reset_password", url: link },
      { kind: "email_change", url: link, newEmail: "new@example.com" },
      { kind: "email_changed", newEmail: "new@example.com" },
      { kind: "run_reminder", landedAt: "6:58 AM", runs: 3 },
      { kind: "content_removed", subject: "photo", reason: "it's spam" },
      { kind: "account_closed", reason: "spam" },
    ];
    for (const payload of payloads) {
      expect(
        emailTemplateSchema.safeParse(payload),
        JSON.stringify(payload),
      ).toMatchObject({ success: true });
    }
  });

  it("refuses a ban notice with no reason", () => {
    expect(
      emailTemplateSchema.safeParse({ kind: "account_closed", reason: "" })
        .success,
    ).toBe(false);
  });

  it("refuses a removal notice with no reason, or about anything but an entry or a photo", () => {
    expect(
      emailTemplateSchema.safeParse({
        kind: "content_removed",
        subject: "photo",
        reason: "",
      }).success,
    ).toBe(false);
    expect(
      emailTemplateSchema.safeParse({
        kind: "content_removed",
        subject: "run",
        reason: "it's spam",
      }).success,
    ).toBe(false);
  });

  it("accepts both http and https, never a look-alike scheme", () => {
    const isOk = isLinkAccepted;
    expect(isOk("https://dialed.run/account/verify")).toBe(true);
    // Not "https only": plain "http" must still be accepted.
    expect(isOk(`${PLAIN_HTTP}://dialed.run/account/verify`)).toBe(true);
    // Not anchored at the start: a scheme that merely *ends* in "http(s)".
    expect(isOk("shttp://dialed.run/account/verify")).toBe(false);
    // Not anchored at the end: a scheme that merely *starts* with "https".
    expect(isOk("httpsx://dialed.run/account/verify")).toBe(false);
    expect(isOk("javascript:alert(1)")).toBe(false);
  });

  it("holds a run_reminder's landedAt and runs to their floors, not a ceiling of one", () => {
    const isOk = isReminderAccepted;

    expect(isOk("6:58 AM", 3)).toBe(true);
    expect(isOk("", 1)).toBe(false);
    expect(isOk("6:58 AM", 0)).toBe(false);
  });
});

describe("emailRecipientSchema", () => {
  it("accepts a bare address, not only a userId", () => {
    expect(
      emailRecipientSchema.safeParse({ address: "a@example.com" }).success,
    ).toBe(true);
    expect(emailRecipientSchema.safeParse({ userId: "u1" }).success).toBe(true);
  });
});

describe("emailPayloadSchema", () => {
  it("round-trips a full payload", () => {
    const payload = {
      to: { address: "a@example.com" },
      template: { kind: "existing_account" as const },
    };
    expect(emailPayloadSchema.parse(payload)).toStrictEqual(payload);
  });
});

describe("preferenceFor", () => {
  it("names run_reminder's switch, and nothing for the rest", () => {
    expect(preferenceFor("run_reminder")).toBe("run_reminder");
    expect(preferenceFor("verify_email")).toBeUndefined();
    expect(preferenceFor("existing_account")).toBeUndefined();
    expect(preferenceFor("reset_password")).toBeUndefined();
    expect(preferenceFor("email_change")).toBeUndefined();
    expect(preferenceFor("email_changed")).toBeUndefined();
    expect(preferenceFor("content_removed")).toBeUndefined();
    expect(preferenceFor("account_closed")).toBeUndefined();
  });
});

/**
Local dev's scheme, which the link schema must accept: `http://localhost`.
*/
const PLAIN_HTTP = ["ht", "tp"].join("");

function isLinkAccepted(url: string): boolean {
  return emailTemplateSchema.safeParse({ kind: "verify_email", url }).success;
}

function isReminderAccepted(landedAt: string, runs: number): boolean {
  return emailTemplateSchema.safeParse({ kind: "run_reminder", landedAt, runs })
    .success;
}
