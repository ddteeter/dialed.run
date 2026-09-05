import { describe, expect, it } from "vitest";

describe("workers pool", () => {
  it("runs inside workerd with Workers globals", () => {
    expect(typeof caches).toBe("object");
    expect(new Response("ok").status).toBe(200);
  });
});
