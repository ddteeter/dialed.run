import { describe, expect, it } from "vitest";

import { requesterKey } from "../../src/modules/safety/requester-key";

/**
 * Design 137: two addresses that reach one inbox are one requester.
 */
describe("requesterKey", () => {
  it("reads Gmail's dots, tags and googlemail as one inbox", () => {
    for (const address of [
      "me@gmail.com",
      "M.E@gmail.com",
      "me+1@gmail.com",
      "m.e+takedown@googlemail.com",
    ]) {
      expect(requesterKey(address)).toBe("me@gmail.com");
    }
  });

  it("drops the tag Outlook, iCloud and Yahoo use", () => {
    expect(requesterKey("me+x@outlook.com")).toBe("me@outlook.com");
    expect(requesterKey("me+x@icloud.com")).toBe("me@icloud.com");
    expect(requesterKey("me-x@yahoo.com")).toBe("me@yahoo.com");
  });

  it("drops a +tag on any other domain, and keeps its dots", () => {
    expect(requesterKey("first.last+abc@example.org")).toBe(
      "first.last@example.org",
    );
  });

  it("lowercases and trims, and leaves a plain address alone", () => {
    expect(requesterKey("  Sam@Example.com ")).toBe("sam@example.com");
    expect(requesterKey("sam@example.com")).toBe("sam@example.com");
  });

  it("keys an address validator will not read by its lowercase", () => {
    // `normalizeEmail` answers false for what is not an address; the form
    // never sends one, and the key still has to be something.
    expect(requesterKey("Not An Address")).toBe("not an address");
  });

  it("keeps an address Gmail's rules would empty, minus its tag", () => {
    // validator answers false for "+x@gmail.com": nothing before the @.
    expect(requesterKey("+x@gmail.com")).toBe("@gmail.com");
    expect(requesterKey("A.B+x@Example.com")).toBe("a.b@example.com");
  });
});
