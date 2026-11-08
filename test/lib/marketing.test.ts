import { describe, expect, it } from "vitest";

import {
  MARKETING_HOST,
  MARKETING_INVITE_URL,
  MARKETING_ORIGIN,
} from "../../src/lib/marketing";

describe("the marketing site's addresses (D-99, design 187)", () => {
  it("is dialed.run, over https", () => {
    expect(MARKETING_ORIGIN).toBe("https://dialed.run");
  });

  it("names the origin's own host, so the two cannot drift", () => {
    expect(MARKETING_HOST).toBe(new URL(MARKETING_ORIGIN).hostname);
  });

  it("asks for an invite at /invite", () => {
    expect(MARKETING_INVITE_URL).toBe("https://dialed.run/invite");
  });
});
