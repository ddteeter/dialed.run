import type { Effort } from "../../../lib/contracts";

/**
 * How much warmer an hour feels at each effort, in °C (owner, 2026-11-26,
 * #1103): a starting table for the replay harness to tune. A record, so an
 * effort added to `effortSchema` fails to compile here until it has a row.
 */
export const EFFORT_WARMTH_C: Readonly<Record<Effort, number>> = {
  easy: 0,
  steady: 2,
  workout: 5,
  race: 7,
};

/**
 * The feel of an hour run at an effort. A run with no effort counts as
 * easy.
 *
 * The Call's own hour and every past run go through this, each with its
 * own effort, so a workout's verdict and an easy Call are compared on the
 * same footing: the band a run is counted in is the band of this feel.
 */
export function feelAtEffortC(
  feelsLikeC: number,
  effort: Effort = "easy",
): number {
  return feelsLikeC + EFFORT_WARMTH_C[effort];
}
