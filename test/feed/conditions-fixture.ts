import { pointSpan } from "../../src/modules/feed/conditions-shape";
import type { Conditions } from "../../src/modules/feed/conditions-shape";

/**
 * A viewer's conditions: a live reading, so a span with no width.
 *
 * Written once rather than at each call site because `Conditions` grew a
 * `span` in task 054, and every test building one by hand would otherwise
 * restate "this point is also its own range" — a fact about the type, not
 * about the test.
 *
 * In its own file, not `helpers.ts`, and that is load-bearing: `helpers.ts`
 * reaches `src/env` to seed D1, so a jsdom test importing this from there
 * fails to resolve `cloudflare:workers`. This imports only the shape.
 */
export function pointConditions(
  params: Readonly<{
    tempC: number;
    feelsLikeC: number;
    precipMm?: number;
    condition?: string;
    windKph?: number;
  }>,
): Conditions {
  return {
    tempC: params.tempC,
    feelsLikeC: params.feelsLikeC,
    precipMm: params.precipMm ?? 0,
    condition: params.condition ?? "clear",
    windKph: params.windKph ?? 5,
    source: "visualcrossing",
    span: pointSpan(params.tempC, params.feelsLikeC),
  };
}
