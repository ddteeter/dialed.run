import { describe, expect, it } from "vitest";

import {
  CORRECTION_FIELD_NOUNS,
  CORRECTION_FIELDS,
  DECLINE_REASON_LABELS,
  DECLINE_REASONS,
  declineCorrectionSchema,
  fileCorrectionSchema,
} from "../../src/lib/contracts/product-corrections";
import { newUlid } from "../../src/lib/ids";

const base = () => ({
  productId: newUlid(),
  garmentId: newUlid(),
  idempotencyKey: newUlid(),
});

function messagesFor(field: string, value: string, note?: string) {
  const parsed = fileCorrectionSchema.safeParse({
    ...base(),
    field,
    value,
    note,
  });
  return parsed.error?.issues.map((issue) => [
    issue.path.join("."),
    issue.message,
  ]);
}

describe("WRONG?'s schema (R48·129)", () => {
  it("offers the seven fields in the sheet's order", () => {
    expect(CORRECTION_FIELDS).toStrictEqual([
      "name",
      "weight",
      "fabric",
      "wind",
      "water",
      "composition",
      "link",
    ]);
    expect(Object.keys(CORRECTION_FIELD_NOUNS)).toStrictEqual([
      ...CORRECTION_FIELDS,
    ]);
  });

  it("names each field as a sentence does", () => {
    expect(CORRECTION_FIELD_NOUNS).toStrictEqual({
      name: "name",
      weight: "weight",
      fabric: "fabric",
      wind: "wind resistance",
      water: "water resistance",
      composition: "composition",
      link: "link",
    });
  });

  it("reports a wrong value as a custom issue on the value", () => {
    const parsed = fileCorrectionSchema.safeParse({
      ...base(),
      field: "name",
      value: " ",
    });
    expect(
      parsed.error?.issues.map((issue) => [issue.code, issue.path.join(".")]),
    ).toStrictEqual([["custom", "value"]]);
  });

  it("accepts a value of each field's type, trimmed", () => {
    const ok: [string, string, string][] = [
      ["name", "  AFO Middle Layer ", "AFO Middle Layer"],
      ["weight", "light", "light"],
      ["fabric", "down", "down"],
      ["wind", "yes", "yes"],
      ["water", "no", "no"],
      ["composition", "100% merino", "100% merino"],
      ["link", "https://janji.com/afo", "https://janji.com/afo"],
    ];
    for (const [field, value, stored] of ok) {
      const parsed = fileCorrectionSchema.parse({ ...base(), field, value });
      expect(parsed.value).toBe(stored);
      expect(parsed.field).toBe(field);
    }
  });

  it("marks a wrong value on the value input, in the field's own words", () => {
    expect(messagesFor("name", " ")).toStrictEqual([
      ["value", "Type the name."],
    ]);
    expect(messagesFor("name", "x".repeat(81))).toStrictEqual([
      ["value", "Keep the name to 80 characters."],
    ]);
    expect(messagesFor("name", "x".repeat(80))).toBeUndefined();
    expect(messagesFor("composition", "x".repeat(121))).toStrictEqual([
      ["value", "Keep the composition to 120 characters."],
    ]);
    expect(messagesFor("composition", "x".repeat(120))).toBeUndefined();
    expect(messagesFor("weight", "medium")?.[0]?.[0]).toBe("value");
    expect(messagesFor("wind", "maybe")?.[0]?.[0]).toBe("value");
    expect(messagesFor("link", "not a link")).toStrictEqual([
      ["value", "That isn't a link. Paste the address of the shop's page."],
    ]);
  });

  it("trims the note, and counts 280 after the trim", () => {
    const note = fileCorrectionSchema.parse({
      ...base(),
      field: "wind",
      value: "yes",
      note: `  ${"x".repeat(280)}  `,
    }).note;
    expect(note).toBe("x".repeat(280));
  });

  it("takes an optional note of up to 280", () => {
    expect(messagesFor("wind", "yes", "x".repeat(280))).toBeUndefined();
    expect(messagesFor("wind", "yes", "x".repeat(281))).toStrictEqual([
      ["note", "Keep it to 280 characters."],
    ]);
  });

  it("refuses a field it does not know", () => {
    expect(messagesFor("colour", "red")?.[0]?.[0]).toBe("field");
  });
});

describe("Decline's reasons (R48·130)", () => {
  it("are the three, with No reason given first", () => {
    expect(DECLINE_REASONS).toStrictEqual([
      "none",
      "maker_says_otherwise",
      "not_enough",
    ]);
    expect(DECLINE_REASON_LABELS).toStrictEqual({
      none: "No reason given",
      maker_says_otherwise: "The maker's page says otherwise",
      not_enough: "Not enough to go on",
    });
  });

  it("needs one of them, and a key", () => {
    const key = { productId: newUlid(), field: "weight", value: "light" };
    expect(
      declineCorrectionSchema.parse({ ...key, reason: "none" }).reason,
    ).toBe("none");
    expect(
      declineCorrectionSchema.safeParse({ ...key, reason: "other" }).success,
    ).toBe(false);
    expect(
      declineCorrectionSchema.safeParse({ ...key, value: "", reason: "none" })
        .success,
    ).toBe(false);
    expect(
      declineCorrectionSchema.safeParse({
        ...key,
        value: "x".repeat(2049),
        reason: "none",
      }).success,
    ).toBe(false);
  });
});
