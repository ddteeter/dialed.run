/**
 * The speed reporter (design 165, part 1): what the browser measures and
 * how it reaches `POST /api/vitals`.
 *
 * Two sources. `web-vitals` measures the hard load (LCP, INP, CLS, FCP,
 * TTFB), with the attribution build's sub-parts for LCP and INP. The
 * router measures `nav`: a client-side navigation from its start to the
 * render of the screen it lands on, which `web-vitals` cannot see and is
 * most of the waiting in an app that navigates without reloading.
 *
 * **Grouped by route id, never by URL**: the router's own id for the
 * screen (`/runs/$runId`). A hard-load metric belongs to the screen the
 * page loaded on, even when it is reported later, at hide: the load is
 * what it measures. A `nav` belongs to the screen it landed on.
 *
 * **Sent on hide**, the one moment a page reliably gets to speak:
 * `sendBeacon` survives the page going away, and `web-vitals` finalises
 * LCP, CLS and INP then. Its listeners are window capture listeners, so
 * they run before this file's, which listens on the document. One beacon
 * per route and navigation type, because a payload carries one of each,
 * and at most `MAX_METRICS_PER_BEACON` metrics per beacon.
 *
 * **Each metric is sent once.** `web-vitals` reports CLS and INP again on
 * a later hide if they grew; sending that too would count one page twice.
 * Until the first send the latest value wins, and after it later reports
 * are dropped, which understates a page that kept shifting after it was
 * first hidden. That is the cheaper error: a percentile over samples
 * counted twice is wrong everywhere, and this is wrong only for that page.
 */
import type { MetricWithAttribution } from "web-vitals/attribution";

import {
  MAX_METRICS_PER_BEACON,
  VITAL_METRICS,
  VITALS_PATH,
  vitalMetricSchema,
  vitalsPayloadSchema,
  type VitalsPayload,
} from "../contracts/vitals";

type BeaconMetric = VitalsPayload["metrics"][number];
type NavigationType = VitalsPayload["navigationType"];

/**
 * The router, as much of it as this file reads. TanStack's router
 * satisfies it; a test builds one by hand.
 */
export interface VitalsRouter {
  subscribe(
    event: "onBeforeNavigate",
    listener: (event: { readonly hrefChanged: boolean }) => void,
  ): () => void;
  subscribe(event: "onRendered", listener: () => void): () => void;
  readonly state: {
    readonly matches: readonly { readonly routeId: string }[];
  };
}

export interface VitalsReporterDeps {
  /**
   * Registers a report callback with every `web-vitals` metric.
   */
  readonly observe: (report: (metric: MetricWithAttribution) => void) => void;
  readonly send: (body: string) => void;
  /**
   * Calls `flush` whenever the page is hidden; returns the unsubscribe.
   */
  readonly onHidden: (flush: () => void) => () => void;
  readonly isWide: () => boolean;
  /**
   * A monotonic clock, in milliseconds.
   */
  readonly now: () => number;
}

/**
 * From `BREAKPOINT.wide` up the layout is the desktop one: `--breakpoint-wide`
 * in `src/styles.css`, which a test pins this to. Below it is `narrow`.
 */
export const WIDE_MEDIA_QUERY = "(min-width: 720px)";

/**
 * `web-vitals`, loaded on first use, with `report` registered on all five
 * metrics. A dynamic import keeps the library out of the entry chunk every
 * visitor waits on (`scripts/check-bundle.ts`' budget), and costs no
 * measurement: its observers read the browser's buffered entries, so
 * starting after hydration still sees the load. A chunk that will not load
 * costs only this page's sample (law 5).
 */
async function observeOnLoad(
  report: (metric: MetricWithAttribution) => void,
): Promise<void> {
  try {
    const { onLCP, onINP, onCLS, onFCP, onTTFB } =
      await import("web-vitals/attribution");
    for (const on of [onLCP, onINP, onCLS, onFCP, onTTFB]) on(report);
  } catch {
    // Measuring is secondary: the page goes unmeasured, nothing more.
  }
}

/**
 * The real browser: the beacon, the document's visibility, the screen's
 * width and `performance.now`.
 */
export function browserVitalsDeps(): VitalsReporterDeps {
  return {
    observe: (report) => {
      void observeOnLoad(report);
    },
    send: (body) => {
      navigator.sendBeacon(VITALS_PATH, body);
    },
    onHidden: (flush) => {
      const listener = (): void => {
        if (document.visibilityState === "hidden") flush();
      };
      document.addEventListener("visibilitychange", listener);
      return () => {
        document.removeEventListener("visibilitychange", listener);
      };
    },
    isWide: () => matchMedia(WIDE_MEDIA_QUERY).matches,
    now: () => performance.now(),
  };
}

/**
 * The sub-parts a metric carries, in `VITAL_METRICS`' order, read off the
 * attribution by the contract's own names.
 */
function partsOf(metric: MetricWithAttribution): number[] {
  switch (metric.name) {
    case "LCP": {
      return VITAL_METRICS.LCP.parts.map((part) => metric.attribution[part]);
    }
    case "INP": {
      return VITAL_METRICS.INP.parts.map((part) => metric.attribution[part]);
    }
    default: {
      return [];
    }
  }
}

/**
 * `web-vitals`' navigation types are the contract's, except that it
 * spells a client-side navigation out.
 */
function navigationTypeOf(metric: MetricWithAttribution): NavigationType {
  return metric.navigationType === "soft-navigation"
    ? "soft"
    : metric.navigationType;
}

interface Pending {
  readonly route: string;
  readonly navigationType: NavigationType;
  readonly metric: BeaconMetric;
}

interface Group {
  readonly route: string;
  readonly navigationType: NavigationType;
  readonly metrics: readonly BeaconMetric[];
}

/**
 * The current screen's route id: the deepest match.
 */
function routeIdOf(router: VitalsRouter): string | undefined {
  return router.state.matches.at(-1)?.routeId;
}

/**
 * The pending metrics as beacons: grouped by route and navigation type,
 * in groups no bigger than one beacon may carry, and parsed by the
 * endpoint's own schema, so a route id of the wrong shape is never sent.
 */
function beaconsOf(
  pending: Iterable<Pending>,
  device: VitalsPayload["device"],
): VitalsPayload[] {
  const groups = new Map<string, Group>();
  for (const { route, navigationType, metric } of pending) {
    const key = `${navigationType} ${route}`;
    const group = groups.get(key) ?? { route, navigationType, metrics: [] };
    groups.set(key, { ...group, metrics: [...group.metrics, metric] });
  }
  const beacons: VitalsPayload[] = [];
  for (const { route, navigationType, metrics } of groups.values()) {
    for (let at = 0; at < metrics.length; at += MAX_METRICS_PER_BEACON) {
      const parsed = vitalsPayloadSchema.safeParse({
        route,
        navigationType,
        device,
        metrics: metrics.slice(at, at + MAX_METRICS_PER_BEACON),
      });
      if (parsed.success) beacons.push(parsed.data);
    }
  }
  return beacons;
}

/**
 * The metric as the endpoint will parse it, or `undefined` for one it
 * would refuse (a value out of range), which is dropped alone rather than
 * sinking its beacon.
 */
function beaconMetricOf(metric: BeaconMetric): BeaconMetric | undefined {
  const parsed = vitalMetricSchema.safeParse(metric);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Starts measuring. Returns the stop, which unsubscribes from the router
 * and the page and makes `web-vitals`' callbacks inert: those cannot be
 * unregistered, so a reporter started twice (React's strict mode does)
 * would otherwise report everything twice.
 */
export function startVitalsReporter(
  router: VitalsRouter,
  deps: VitalsReporterDeps = browserVitalsDeps(),
): () => void {
  const landing = routeIdOf(router);
  let isStopped = false;
  let navigationStart: number | undefined;

  // `web-vitals`' metrics by their id, so a re-report replaces the last; a
  // navigation is measured once, so it is keyed by a symbol of its own.
  const pending = new Map<string | symbol, Pending>();
  const sent = new Set<string | symbol>();

  deps.observe((metric) => {
    if (isStopped || landing === undefined || sent.has(metric.id)) return;
    const beaconMetric = beaconMetricOf({
      name: metric.name,
      value: metric.value,
      parts: partsOf(metric),
    });
    if (beaconMetric === undefined) return;
    pending.set(metric.id, {
      route: landing,
      navigationType: navigationTypeOf(metric),
      metric: beaconMetric,
    });
  });

  const unsubscribeStart = router.subscribe("onBeforeNavigate", (event) => {
    // Same address is the router reloading the screen it is on (an
    // `invalidate` after a save), which is not a navigation.
    if (event.hrefChanged) navigationStart = deps.now();
  });
  const unsubscribeRendered = router.subscribe("onRendered", () => {
    const route = routeIdOf(router);
    if (navigationStart === undefined || route === undefined) return;
    const metric = beaconMetricOf({
      name: "nav",
      value: deps.now() - navigationStart,
      parts: [],
    });
    navigationStart = undefined;
    if (metric !== undefined) {
      pending.set(Symbol("nav"), { route, navigationType: "soft", metric });
    }
  });

  const unsubscribeHidden = deps.onHidden(() => {
    const device = deps.isWide() ? "wide" : "narrow";
    for (const beacon of beaconsOf(pending.values(), device)) {
      deps.send(JSON.stringify(beacon));
    }
    for (const id of pending.keys()) sent.add(id);
    pending.clear();
  });

  return () => {
    isStopped = true;
    unsubscribeStart();
    unsubscribeRendered();
    unsubscribeHidden();
  };
}
