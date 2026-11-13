import { describe, expect, it } from "vitest";

import { counted } from "../../src/modules/safety/components/counted";

describe("counted", () => {
  it("says one in the singular and every other count in the plural", () => {
    expect(counted(1, "runner")).toBe("1 runner");
    expect(counted(0, "report")).toBe("0 reports");
    expect(counted(14, "run")).toBe("14 runs");
  });
});
