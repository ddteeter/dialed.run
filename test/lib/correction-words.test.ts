import { describe, expect, it } from "vitest";

import { valueWords } from "../../src/lib/correction-words";

describe("a correction's value in words", () => {
  it("reads a select's label, Yes or No, or the text itself", () => {
    expect(valueWords("weight", "mid")).toBe("Mid");
    expect(valueWords("fabric", "merino")).toBe("Merino");
    expect(valueWords("wind", "yes")).toBe("Yes");
    expect(valueWords("water", "no")).toBe("No");
    expect(valueWords("name", "Harrier")).toBe("Harrier");
    expect(valueWords("composition", "100% merino")).toBe("100% merino");
    expect(valueWords("link", "https://shop.example")).toBe(
      "https://shop.example",
    );
  });
});
