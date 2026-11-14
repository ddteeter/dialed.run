import { describe, expect, it } from "vitest";

import { shortId } from "../../src/modules/safety/components/short-id";

describe("shortId (R55·197, 198)", () => {
  it("keeps the first and last four of a long id", () => {
    expect(shortId("01M791Z7C6H1RX76XNRS7GSM19")).toBe("01M7…SM19");
    expect(shortId("0123456789")).toBe("0123…6789");
  });

  it("leaves an id whole when shortening would save nothing", () => {
    expect(shortId("012345678")).toBe("012345678");
    expect(shortId("e-1")).toBe("e-1");
  });
});
