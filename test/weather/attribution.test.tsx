import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WeatherAttribution } from "../../src/modules/weather";

describe("WeatherAttribution (103, free-tier terms)", () => {
  it("links to Visual Crossing with the required attribution copy", () => {
    const html = renderToString(<WeatherAttribution />);
    expect(html).toContain("Weather by Visual Crossing");
    expect(html).toContain("https://www.visualcrossing.com/weather-data");
  });
});
