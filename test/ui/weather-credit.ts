import { within } from "@testing-library/react";

/**
 * Visual Crossing's credit as a conditions surface's test asks for it (D-144).
 * The copy itself is pinned once, literally, in
 * `weather-attribution.dom.test.tsx`; a surface's test only asks whether
 * the credit is there, so it reads the name from here.
 */
export const WEATHER_CREDIT = "Weather data provided by Visual Crossing";

/**
The credit inside `scope`, or null.
*/
export function queryWeatherCredit(scope: HTMLElement): HTMLElement | null {
  return within(scope).queryByRole("link", { name: WEATHER_CREDIT });
}
