import { afterEach, describe, expect, it, vi } from "vitest";

import { forecast } from "../../src/modules/weather";
import { mockVisualCrossing } from "./fixtures/visual-crossing-observation";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("forecast (103, thin pass-through with the same cache)", () => {
  it("fetches on a miss and reuses the cache on a second call", async () => {
    const fetchSpy = mockVisualCrossing();
    const at = new Date(1_768_485_600 * 1000);

    const first = await forecast(80.1, 40.1, at);
    expect(first.condition).toBe("Overcast");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await forecast(80.1, 40.1, at);
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // cache hit, no second fetch
  });
});
