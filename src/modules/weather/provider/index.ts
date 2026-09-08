/**
 * The one place that decides which upstream we talk to.
 *
 * `WeatherProvider` (lib/contracts) has always been the seam, but every
 * call site reached past it and constructed the Visual Crossing adapter
 * itself, which made the interface decorative: swapping or A/B-ing a
 * provider meant editing each caller, and a test could only substitute one
 * by monkey-patching the module.
 *
 * Callers now ask for `weatherProvider()` and get whatever this file says.
 */
import { env } from "../../../env";
import type { WeatherProvider } from "../../../lib/contracts";
import { createVisualCrossingProvider } from "./visual-crossing";

export function weatherProvider(): WeatherProvider {
  return createVisualCrossingProvider(env.VISUAL_CROSSING_API_KEY);
}
