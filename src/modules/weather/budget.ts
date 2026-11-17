/**
 * Each runner's daily budget of weather-provider calls (SA-M13, SA-M27):
 * a city lookup, a climate-normals read, a run's hour, a zone lookup, each
 * counted when it would reach the provider, whoever asks (the runner or
 * the hourly retry for their run). Kept in `rate_limits` as kind
 * `weather-runner`, keyed by the runner's id.
 *
 * Past the budget the call is not made, and the caller degrades as it does
 * when the provider is down (law 5): Find answers NOT FOUND YET, the
 * starter list orders by latitude, a run stays pending for the retry.
 */
import { coreDb } from "../../env";
import { isWithinRateLimit } from "../email";

/**
How many provider calls one runner's requests may cause in a day. GUESS, held for the owner (design 231).
*/
export const WEATHER_CALLS_PER_DAY = 60;

const DAY_S = 24 * 60 * 60;

/**
A provider call refused because the runner's day's budget is spent.
*/
export class WeatherBudgetSpentError extends Error {
  constructor() {
    super("The runner's weather budget for the day is spent");
    this.name = "WeatherBudgetSpentError";
  }
}

/**
Spend one call, or throw `WeatherBudgetSpentError`: what a provider call site runs first.
*/
export type SpendWeatherCall = () => Promise<void>;

export function runnerWeatherBudget(userId: string): SpendWeatherCall {
  return async () => {
    const isWithin = await isWithinRateLimit(
      coreDb(),
      "weather-runner",
      userId,
      WEATHER_CALLS_PER_DAY,
      DAY_S,
    );
    if (!isWithin) throw new WeatherBudgetSpentError();
  };
}

/**
For a call no runner caused (the hourly zone fill): nothing to count.
*/
export const spendNothing: SpendWeatherCall = () => Promise.resolve();

/**
Whether an error is a spent budget, rather than the provider failing.
*/
export function isWeatherBudgetSpent(error: unknown): boolean {
  return error instanceof WeatherBudgetSpentError;
}
