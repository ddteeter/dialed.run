import { describe, expect, it } from "vitest";

import {
  gaveUpDropInput,
  gaveUpRetryInput,
} from "../../src/modules/ops/inputs";

/**
 * What the Desk's Retry and Drop accept from the browser (R-119): a row id,
 * and for Retry which of the job's retries.
 */
describe("gaveUpRetryInput", () => {
  it.each(["again", "extract"])("accepts the %s retry", (step) => {
    expect(gaveUpRetryInput.parse({ id: "g1", step })).toStrictEqual({
      id: "g1",
      step,
    });
  });

  it.each([
    ["no step", { id: "g1" }],
    ["an unknown step", { id: "g1", step: "refetch" }],
    ["an empty step", { id: "g1", step: "" }],
    ["no id", { step: "again" }],
    ["an empty id", { id: "", step: "again" }],
  ])("refuses %s", (_, input) => {
    expect(gaveUpRetryInput.safeParse(input).success).toBe(false);
  });
});

describe("gaveUpDropInput", () => {
  it("accepts a row id", () => {
    expect(gaveUpDropInput.parse({ id: "g1" })).toStrictEqual({ id: "g1" });
  });

  it.each([
    ["no id", {}],
    ["an empty id", { id: "" }],
  ])("refuses %s", (_, input) => {
    expect(gaveUpDropInput.safeParse(input).success).toBe(false);
  });
});
