import { describe, expect, it } from "vitest";

import {
  AGE_CODES,
  AGE_COPY,
  AGE_LINE,
  AGE_REFUSED_COOKIE,
  AGE_REFUSED_SECONDS,
  BIRTH_DATE_HEADER,
  MINIMUM_AGE,
  birthDateField,
  isOldEnough,
  isoDayOf,
} from "../../src/lib/contracts/age";
import { nowSeconds } from "../../src/lib/now";

/**
The age gate's contract (design 134, D-114).
*/
describe("the cut-off", () => {
  it("is 18", () => {
    expect(MINIMUM_AGE).toBe(18);
  });

  it("passes on the eighteenth birthday and not the day before", () => {
    expect(isOldEnough("2008-10-09", "2026-10-09")).toBe(true);
    expect(isOldEnough("2008-10-08", "2026-10-09")).toBe(true);
    expect(isOldEnough("2008-10-10", "2026-10-09")).toBe(false);
    expect(isOldEnough("2009-10-09", "2026-10-09")).toBe(false);
    expect(isOldEnough("2007-10-10", "2026-10-09")).toBe(true);
  });

  it("passes a 29 February birth on 1 March in a year with no 29th", () => {
    expect(isOldEnough("2008-02-29", "2026-02-28")).toBe(false);
    expect(isOldEnough("2008-02-29", "2026-03-01")).toBe(true);
  });
});

describe("today's date", () => {
  it("is the UTC day of an epoch second", () => {
    expect(isoDayOf(0)).toBe("1970-01-01");
    expect(isoDayOf(86_399)).toBe("1970-01-01");
    expect(isoDayOf(86_400)).toBe("1970-01-02");
  });
});

function messages(typed: string): string[] | undefined {
  return birthDateField
    .safeParse(typed)
    .error?.issues.map((issue) => issue.message);
}

describe("the date field", () => {
  it("asks for a date when there is none", () => {
    expect(messages("")).toEqual([AGE_COPY.missing]);
  });

  it("refuses something that is not a calendar date", () => {
    expect(messages("1990-02-30")).toEqual([AGE_COPY.invalid]);
    expect(messages("21/04/1990")).toEqual([AGE_COPY.invalid]);
  });

  it("takes 1900 to today, and checks the year either side", () => {
    expect(birthDateField.parse("1900-01-01")).toBe("1900-01-01");
    expect(messages("1899-12-31")).toEqual([AGE_COPY.year]);
    const today = isoDayOf(nowSeconds());
    expect(birthDateField.parse(today)).toBe(today);
    const tomorrow = isoDayOf(nowSeconds() + 86_400);
    expect(messages(tomorrow)).toEqual([AGE_COPY.year]);
  });

  it("does not check the age, which is the server's to decide", () => {
    const today = isoDayOf(nowSeconds());
    expect(birthDateField.safeParse(today).success).toBe(true);
  });
});

describe("the words and the wire", () => {
  it("says the cut-off under Au2 in the refusal's own sentence (D-71's line)", () => {
    expect(AGE_LINE).toBe("dialed.run is for runners 18 and over.");
    expect(AGE_COPY.refused).toBe(AGE_LINE);
  });

  it("says each refusal in one sentence that names the fix", () => {
    expect(AGE_COPY).toEqual({
      missing: "Enter your date of birth.",
      invalid: "Enter a real date.",
      year: "Check the year.",
      refused: "dialed.run is for runners 18 and over.",
    });
  });

  it("names the header, the codes and a day-long cookie", () => {
    expect(BIRTH_DATE_HEADER).toBe("x-birth-date");
    expect(AGE_CODES).toEqual({
      missing: "AGE_MISSING",
      refused: "AGE_REFUSED",
    });
    expect(AGE_REFUSED_COOKIE).toBe("dialed_age_refused");
    expect(AGE_REFUSED_SECONDS).toBe(86_400);
  });
});
