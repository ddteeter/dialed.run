import { describe, expect, it } from "vitest";

import { resendInput } from "../../src/modules/account/inputs";

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
