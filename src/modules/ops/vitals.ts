/**
 * The speed beacon's data points (design 165, part 1). One per metric, in
 * the `VITALS` dataset's layout:
 *
 * - index1: the route id, which is what Analytics Engine samples by, so a
 *   busy screen cannot crowd a quiet one out of the sample;
 * - blob1–4: metric, navigation type, device width, deploy version;
 * - double1: the value; double2–5: the metric's attribution parts, in
 *   `VITAL_METRICS`' order.
 *
 * `vitals-queries.ts` reads them back by these positions; the layout test
 * pins the two together.
 */
import type { VitalsPayload } from "../../lib/contracts/vitals";

export function toDataPoints(
  payload: VitalsPayload,
  version: string,
): AnalyticsEngineDataPoint[] {
  return payload.metrics.map((metric) => ({
    indexes: [payload.route],
    blobs: [metric.name, payload.navigationType, payload.device, version],
    doubles: [metric.value, ...metric.parts],
  }));
}
