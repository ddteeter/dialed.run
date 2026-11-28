/**
 * The weather backlog the daily digest reports: runs whose weather gave
 * up, or is still pending past a day. A sub-module so the check joins
 * `weather` without widening its parent door (design 240 rule 4).
 */
export { checkWeatherBacklog } from "./backlog";
