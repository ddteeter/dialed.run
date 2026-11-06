import { describe, expect, it } from "vitest";

import {
  FIELD_REFUSAL_CODE,
  fieldRefusalAdapter,
} from "../../src/lib/field-refusal";
import { DeniedLinkError } from "../../src/modules/closet/service";
import { DENIED_LINK } from "../../src/modules/closet/link-copy";

/**
 * A field refusal's trip across a server function's response (R-176,
 * design 171). TanStack Start sends a thrown `Error` as its message alone;
 * `fieldRefusalAdapter`, registered in `src/start.ts`, carries the issues
 * `useFormSubmit` lands on a field, for an error that opts in by its code.
 */
function refusal(issues: unknown, code: string = FIELD_REFUSAL_CODE): Error {
  return Object.assign(new Error("Not that."), { code, issues });
}

const LINK_ISSUE = [{ path: ["productUrl"], message: "Not that link." }];

describe("fieldRefusalAdapter", () => {
  it("keeps its wire key: a tab from the last deploy reads this one's answers", () => {
    expect(fieldRefusalAdapter.key).toBe("field-refusal");
  });

  it("keeps its code: it is on the wire too, and the client's read is by it", () => {
    expect(FIELD_REFUSAL_CODE).toBe("FIELD_REFUSAL");
  });

  it("takes an Error with the code and issues, and a denied link's refusal", () => {
    expect(fieldRefusalAdapter.test(refusal(LINK_ISSUE))).toBe(true);
    expect(fieldRefusalAdapter.test(refusal([]))).toBe(true);
    expect(fieldRefusalAdapter.test(new DeniedLinkError())).toBe(true);
  });

  it("leaves every other error to the framework", () => {
    expect(fieldRefusalAdapter.test(new Error("D1 down"))).toBe(false);
    // Issues without the code: a ZodError or anything else that happens
    // to carry them stays message-only.
    const issuesOnly = Object.assign(new Error("x"), { issues: [] });
    expect(fieldRefusalAdapter.test(issuesOnly)).toBe(false);
    expect(fieldRefusalAdapter.test(refusal(LINK_ISSUE, "OTHER"))).toBe(false);
    expect(fieldRefusalAdapter.test(refusal("productUrl"))).toBe(false);
    expect(
      fieldRefusalAdapter.test(refusal([{ path: "productUrl", message: "x" }])),
    ).toBe(false);
    // Only a thrown Error is a refusal.
    expect(
      fieldRefusalAdapter.test({
        code: FIELD_REFUSAL_CODE,
        message: "x",
        issues: [],
      }),
    ).toBe(false);
    expect(fieldRefusalAdapter.test(undefined)).toBe(false);
  });

  it("sends the code, the sentence and each issue's path and message, and nothing else", () => {
    const error = Object.assign(
      refusal([{ path: ["productUrl"], message: "Not that link.", why: "x" }]),
      { secret: "never on the wire" },
    );
    if (!fieldRefusalAdapter.test(error)) throw new Error("not a refusal");
    expect(fieldRefusalAdapter.toSerializable(error)).toStrictEqual({
      code: FIELD_REFUSAL_CODE,
      message: "Not that.",
      issues: LINK_ISSUE,
    });
  });

  it("arrives as an Error carrying the denied link's field issue", () => {
    const sent = fieldRefusalAdapter.toSerializable(new DeniedLinkError());
    const arrived = fieldRefusalAdapter.fromSerializable(sent);
    expect(arrived).toBeInstanceOf(Error);
    expect(arrived.message).toBe(DENIED_LINK);
    expect(arrived.code).toBe(FIELD_REFUSAL_CODE);
    expect(arrived.issues).toStrictEqual([
      { path: ["productUrl"], message: DENIED_LINK },
    ]);
  });
});
