/**
 * The speed beacon's wire format (design 165, part 1): what the browser
 * sends to `POST /api/vitals` and what the endpoint parses. Isomorphic, so
 * the client builds its payload from the same schema the server refuses
 * one by.
 *
 * Nothing in it identifies anyone: a route id (never the URL), a
 * navigation type, a two-way screen width and numbers. The deploy version
 * is stamped by the server, not claimed by the client.
 */
import { z } from "zod";

/**
 * Every metric the beacon carries, with the largest value accepted and the
 * names of its attribution sub-parts, in the order they are sent and
 * stored. `nav` is ours: a client-side navigation's start to render, which
 * `web-vitals` cannot see, and is most of what "waiting" means in an app
 * that navigates without reloading. Milliseconds throughout, except CLS,
 * which is a unitless score.
 *
 * A rating (good / poor) is not part of it: it follows from the value, so
 * queries derive it rather than store a second copy.
 */
export const VITAL_METRIC_NAMES = [
  "LCP",
  "INP",
  "CLS",
  "FCP",
  "TTFB",
  "nav",
] as const;

export type VitalMetric = (typeof VITAL_METRIC_NAMES)[number];

/**
 * The table, keyed by every name and only those: `satisfies` refuses a
 * missing key and an extra one alike, so the list and the table cannot
 * drift apart.
 */
export const VITAL_METRICS = {
  LCP: {
    max: 120_000,
    parts: [
      "timeToFirstByte",
      "resourceLoadDelay",
      "resourceLoadDuration",
      "elementRenderDelay",
    ],
  },
  INP: {
    max: 60_000,
    parts: ["inputDelay", "processingDuration", "presentationDelay"],
  },
  CLS: { max: 10, parts: [] },
  FCP: { max: 120_000, parts: [] },
  TTFB: { max: 120_000, parts: [] },
  nav: { max: 120_000, parts: [] },
} as const satisfies Record<
  VitalMetric,
  { readonly max: number; readonly parts: readonly string[] }
>;

/**
 * How the page was reached: `web-vitals`' own navigation types, and `soft`
 * for a client-side navigation.
 */
const NAVIGATION_TYPES = [
  "navigate",
  "reload",
  "back-forward",
  "back-forward-cache",
  "prerender",
  "restore",
  "soft",
] as const;

/**
 * Screen width, in two: the layout changes at the desktop breakpoint, and
 * two values are as much as the privacy text promises.
 */
const DEVICE_WIDTHS = ["narrow", "wide"] as const;

/**
 * The most metrics one beacon may carry. A page lifecycle sends five
 * vitals and a handful of navigations; a payload past this is not ours.
 */
export const MAX_METRICS_PER_BEACON = 20;

/**
 * Where the beacon goes: `src/routes/api/vitals.ts`, which a test pins to
 * this. A string because `sendBeacon` takes one, and the typed router has
 * no say over a request that is not a navigation.
 */
export const VITALS_PATH = "/api/vitals";

/**
 * The shape of a route id (`/runs/$runId`, `/@{$handle}`): which ids exist
 * is not checked here, because the list can only be read where the route
 * tree is, and a forged value for a real route is the abuse that matters
 * anyway (design 165, deltas). At most 96 characters, all ASCII, because
 * it becomes the data point's index and Analytics Engine drops a point
 * whose index is over 96 bytes; the longest real id is under 30.
 */
const ROUTE_ID = /^\/[\w$@{}./-]{0,95}$/;

const measurement = z.number().nonnegative();

/**
 * One metric, parsed on its own. The browser drops a metric that fails it
 * rather than send a beacon the endpoint would refuse whole.
 */
export const vitalMetricSchema = z
  .strictObject({
    name: z.enum(VITAL_METRIC_NAMES),
    value: measurement,
    parts: z.array(measurement).default([]),
  })
  .refine(({ name, value }) => value <= VITAL_METRICS[name].max, {
    message: "value out of range",
  })
  .refine(
    ({ name, parts }) =>
      parts.length === VITAL_METRICS[name].parts.length &&
      parts.every((part) => part <= VITAL_METRICS[name].max),
    { message: "parts do not match the metric" },
  );

export const vitalsPayloadSchema = z.strictObject({
  route: z.string().regex(ROUTE_ID),
  navigationType: z.enum(NAVIGATION_TYPES),
  device: z.enum(DEVICE_WIDTHS),
  metrics: z.array(vitalMetricSchema).min(1).max(MAX_METRICS_PER_BEACON),
});

export type VitalsPayload = z.infer<typeof vitalsPayloadSchema>;
