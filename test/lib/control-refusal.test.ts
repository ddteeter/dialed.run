import { describe, expect, it } from "vitest";

import {
  CONTROL_REFUSAL_CODE,
  ControlRefusal,
  controlRefusalAdapter,
  controlRefusalMessage,
} from "../../src/lib/control-refusal";

/**
 * A control refusal's trip across a server function's response (SA-L09):
 * its sentence and code, and nothing else, for an error that opts in.
 */
describe("controlRefusalAdapter", () => {
  it("keeps its wire key and code: a tab from the last deploy reads by them", () => {
    expect(controlRefusalAdapter.key).toBe("control-refusal");
    expect(CONTROL_REFUSAL_CODE).toBe("CONTROL_REFUSAL");
  });

  it("takes a ControlRefusal and leaves every other error to the framework", () => {
    expect(controlRefusalAdapter.test(new ControlRefusal("Held."))).toBe(true);
    expect(controlRefusalAdapter.test(new Error("D1 down"))).toBe(false);
    expect(
      controlRefusalAdapter.test({ code: CONTROL_REFUSAL_CODE, message: "x" }),
    ).toBe(false);
  });

  it("sends the code and sentence only, and brings back an Error with them", () => {
    const thrown = Object.assign(new ControlRefusal("Held."), { secret: "x" });
    const wire = controlRefusalAdapter.toSerializable(thrown);
    expect(wire).toStrictEqual({ code: CONTROL_REFUSAL_CODE, message: "Held." });

    const back = controlRefusalAdapter.fromSerializable(wire);
    expect(back).toBeInstanceOf(Error);
    expect(controlRefusalMessage(back)).toBe("Held.");
  });

  it("reads no sentence from any other error", () => {
    expect(controlRefusalMessage(new Error("Held."))).toBeUndefined();
    expect(controlRefusalMessage(undefined)).toBeUndefined();
  });
});
