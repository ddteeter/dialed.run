import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
  type CLSMetricWithAttribution,
  type INPMetricWithAttribution,
  type LCPMetricWithAttribution,
  type MetricWithAttribution,
} from "web-vitals/attribution";

import {
  browserVitalsDeps,
  startVitalsReporter,
  WIDE_MEDIA_QUERY,
  type VitalsReporterDeps,
  type VitalsRouter,
} from "../../src/lib/browser/vitals";
import {
  VITALS_PATH,
  vitalsPayloadSchema,
} from "../../src/lib/contracts/vitals";

vi.mock("web-vitals/attribution", () => ({
  onLCP: vi.fn(),
  onINP: vi.fn(),
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onTTFB: vi.fn(),
}));

/**
 * The reporter (design 165, step 5) against a router, a clock and a page
 * built by hand: every report, navigation and hide is a call the test
 * makes, and every beacon is a string it reads back.
 */

type NavigationType = MetricWithAttribution["navigationType"];

function base(id: string, value: number, navigationType: NavigationType) {
  return {
    id,
    value,
    delta: value,
    rating: "good" as const,
    navigationType,
    navigationId: 1,
    entries: [],
  };
}

function lcp(
  id: string,
  value: number,
  navigationType: NavigationType = "navigate",
): LCPMetricWithAttribution {
  return {
    ...base(id, value, navigationType),
    name: "LCP",
    attribution: {
      timeToFirstByte: 100,
      resourceLoadDelay: 200,
      resourceLoadDuration: 300,
      elementRenderDelay: 400,
    },
  };
}

function inp(id: string, value: number): INPMetricWithAttribution {
  return {
    ...base(id, value, "navigate"),
    name: "INP",
    attribution: {
      interactionTarget: "",
      interactionTime: 0,
      interactionType: "pointer",
      nextPaintTime: 0,
      processedEventEntries: [],
      inputDelay: 10,
      processingDuration: 20,
      presentationDelay: 30,
      loadState: "complete",
      longAnimationFrameEntries: [],
    },
  };
}

function cls(
  id: string,
  value: number,
  navigationType: NavigationType = "navigate",
): CLSMetricWithAttribution {
  return {
    ...base(id, value, navigationType),
    name: "CLS",
    attribution: {},
  };
}

type Listener = (event: { readonly hrefChanged: boolean }) => void;

/**
 * A router with the two events the reporter listens to, and a current
 * screen the test moves.
 */
class FakeRouter implements VitalsRouter {
  readonly state: { matches: { routeId: string }[] };
  readonly listeners = new Map<string, Set<Listener>>([
    ["onBeforeNavigate", new Set()],
    ["onRendered", new Set()],
  ]);

  constructor(routeIds: string[]) {
    this.state = { matches: routeIds.map((routeId) => ({ routeId })) };
  }

  subscribe(event: "onBeforeNavigate", listener: Listener): () => void;
  subscribe(event: "onRendered", listener: () => void): () => void;
  subscribe(event: string, listener: Listener): () => void {
    const set = this.listeners.get(event);
    set?.add(listener);
    return () => set?.delete(listener);
  }

  emit(event: string, isHrefChanged = true): void {
    const listeners = this.listeners.get(event) ?? [];
    for (const listener of listeners) {
      listener({ hrefChanged: isHrefChanged });
    }
  }

  /**
   * A client-side navigation: start, the clock moves, the new screen
   * renders.
   */
  navigate(to: string, harness: Harness, ms: number): void {
    this.emit("onBeforeNavigate");
    harness.clock += ms;
    this.state.matches = [{ routeId: "__root__" }, { routeId: to }];
    this.emit("onRendered");
  }
}

interface Harness {
  clock: number;
  isWide: boolean;
  readonly router: FakeRouter;
  readonly beacons: unknown[];
  readonly report: (metric: MetricWithAttribution) => void;
  readonly hide: () => void;
  readonly flushes: (() => void)[];
  readonly stop: () => void;
}

/**
 * A callback that does nothing: an observer that never reports, a stop
 * before there is anything to stop.
 */
function nothing(): void {
  // Deliberately empty.
}

function start(routeIds = ["__root__", "/closet/"]): Harness {
  const router = new FakeRouter(routeIds);
  const observers: ((metric: MetricWithAttribution) => void)[] = [];
  const flushes: (() => void)[] = [];
  let stop = nothing;
  const harness: Harness = {
    clock: 0,
    isWide: false,
    router,
    beacons: [],
    report: (metric) => {
      for (const observer of observers) observer(metric);
    },
    hide: () => {
      for (const flush of flushes) flush();
    },
    flushes,
    stop: () => {
      stop();
    },
  };
  const deps: VitalsReporterDeps = {
    observe: (report) => {
      observers.push(report);
    },
    send: (body) => {
      harness.beacons.push(JSON.parse(body));
    },
    onHidden: (flush) => {
      flushes.push(flush);
      return () => {
        flushes.splice(flushes.indexOf(flush), 1);
      };
    },
    isWide: () => harness.isWide,
    now: () => harness.clock,
  };
  stop = startVitalsReporter(router, deps);
  return harness;
}

describe("startVitalsReporter, the hard load", () => {
  it("sends LCP with its four parts, under the landing route, on hide", () => {
    const page = start();
    page.report(lcp("v1", 1200));
    expect(page.beacons).toEqual([]);
    page.hide();
    expect(page.beacons).toEqual([
      {
        route: "/closet/",
        navigationType: "navigate",
        device: "narrow",
        metrics: [{ name: "LCP", value: 1200, parts: [100, 200, 300, 400] }],
      },
    ]);
  });

  it("sends INP's three parts in the contract's order, and CLS with none", () => {
    const page = start();
    page.report(inp("i1", 180));
    page.report(cls("c1", 0.05));
    page.hide();
    expect(page.beacons).toEqual([
      {
        route: "/closet/",
        navigationType: "navigate",
        device: "narrow",
        metrics: [
          { name: "INP", value: 180, parts: [10, 20, 30] },
          { name: "CLS", value: 0.05, parts: [] },
        ],
      },
    ]);
  });

  it("says wide from the breakpoint up, read when the page hides", () => {
    const page = start();
    page.report(cls("c1", 0));
    page.isWide = true;
    page.hide();
    expect(page.beacons).toEqual([expect.objectContaining({ device: "wide" })]);
  });

  it("keeps a hard-load metric on the landing route after navigating", () => {
    const page = start();
    page.router.navigate("/runs/$runId", page, 0);
    page.report(inp("i1", 90));
    page.hide();
    expect(page.beacons).toContainEqual(
      expect.objectContaining({
        route: "/closet/",
        metrics: [expect.objectContaining({ name: "INP" })],
      }),
    );
  });

  it("sends nothing when there is nothing to send", () => {
    const page = start();
    page.hide();
    expect(page.beacons).toEqual([]);
  });

  it("sends the latest value of a metric, and the metric only once", () => {
    const page = start();
    page.report(cls("c1", 0.1));
    page.report(cls("c1", 0.2));
    page.hide();
    page.report(cls("c1", 0.3));
    page.hide();
    expect(page.beacons).toEqual([
      expect.objectContaining({
        metrics: [{ name: "CLS", value: 0.2, parts: [] }],
      }),
    ]);
  });

  it("sends a metric reported after a hide on the next one", () => {
    const page = start();
    page.report(cls("c1", 0.1));
    page.hide();
    page.report(cls("c2", 0.4, "back-forward-cache"));
    page.hide();
    expect(page.beacons).toEqual([
      expect.objectContaining({ navigationType: "navigate" }),
      expect.objectContaining({
        navigationType: "back-forward-cache",
        metrics: [{ name: "CLS", value: 0.4, parts: [] }],
      }),
    ]);
  });

  it("spells a soft navigation the way the contract does", () => {
    const page = start();
    page.report(lcp("v1", 900, "soft-navigation"));
    page.hide();
    expect(page.beacons).toEqual([
      expect.objectContaining({ navigationType: "soft" }),
    ]);
  });

  it("one beacon per navigation type", () => {
    const page = start();
    page.report(lcp("v1", 900, "reload"));
    page.report(cls("c1", 0.1, "navigate"));
    page.hide();
    expect(page.beacons).toEqual([
      expect.objectContaining({
        navigationType: "reload",
        metrics: [expect.objectContaining({ name: "LCP" })],
      }),
      expect.objectContaining({
        navigationType: "navigate",
        metrics: [expect.objectContaining({ name: "CLS" })],
      }),
    ]);
  });

  it("drops a value the endpoint would refuse, and only that one", () => {
    const page = start();
    page.report(lcp("v1", 200_000));
    page.report(cls("c1", 0.1));
    page.hide();
    expect(page.beacons).toEqual([
      expect.objectContaining({
        metrics: [{ name: "CLS", value: 0.1, parts: [] }],
      }),
    ]);
  });

  it("sends nothing for a page with no route, or a route of the wrong shape", () => {
    const empty = start([]);
    empty.report(cls("c1", 0.1));
    empty.hide();
    expect(empty.beacons).toEqual([]);

    const rootOnly = start(["__root__"]);
    rootOnly.report(cls("c1", 0.1));
    rootOnly.hide();
    expect(rootOnly.beacons).toEqual([]);
  });

  it("every beacon passes the endpoint's schema", () => {
    const page = start();
    page.report(lcp("v1", 1200));
    page.report(inp("i1", 180));
    page.router.navigate("/feed/", page, 250);
    page.hide();
    expect(page.beacons).toHaveLength(2);
    for (const beacon of page.beacons) {
      expect(vitalsPayloadSchema.safeParse(beacon).success).toBe(true);
    }
  });
});

describe("startVitalsReporter, navigations", () => {
  it("times a navigation from its start to the render, under where it landed", () => {
    const page = start();
    page.clock = 1000;
    page.router.navigate("/runs/$runId", page, 250);
    page.hide();
    expect(page.beacons).toEqual([
      {
        route: "/runs/$runId",
        navigationType: "soft",
        device: "narrow",
        metrics: [{ name: "nav", value: 250, parts: [] }],
      },
    ]);
  });

  it("counts two navigations to one screen as two in one beacon", () => {
    const page = start();
    page.router.navigate("/feed/", page, 100);
    page.router.navigate("/feed/", page, 300);
    page.router.navigate("/closet/", page, 50);
    page.hide();
    expect(page.beacons).toEqual([
      expect.objectContaining({
        route: "/feed/",
        metrics: [
          { name: "nav", value: 100, parts: [] },
          { name: "nav", value: 300, parts: [] },
        ],
      }),
      expect.objectContaining({
        route: "/closet/",
        metrics: [{ name: "nav", value: 50, parts: [] }],
      }),
    ]);
  });

  it("splits more metrics than a beacon may carry", () => {
    const page = start();
    for (let index = 0; index < 21; index += 1) {
      page.router.navigate("/feed/", page, index);
    }
    page.hide();
    expect(
      page.beacons.map((beacon) => vitalsPayloadSchema.parse(beacon).metrics),
    ).toEqual([
      expect.objectContaining({ length: 20 }),
      [{ name: "nav", value: 20, parts: [] }],
    ]);
  });

  it("ignores a reload of the same address, and a render nobody started", () => {
    const page = start();
    page.router.emit("onBeforeNavigate", false);
    page.router.emit("onRendered");
    page.hide();
    expect(page.beacons).toEqual([]);
  });

  it("measures a navigation once, however many renders follow", () => {
    const page = start();
    page.router.navigate("/feed/", page, 100);
    page.clock += 500;
    page.router.emit("onRendered");
    page.hide();
    expect(page.beacons).toEqual([
      expect.objectContaining({
        metrics: [{ name: "nav", value: 100, parts: [] }],
      }),
    ]);
  });

  it("sends a navigation once", () => {
    const page = start();
    page.router.navigate("/feed/", page, 100);
    page.hide();
    page.hide();
    expect(page.beacons).toHaveLength(1);
  });

  it("drops a navigation that lands on no route, and one too long to be real", () => {
    const page = start();
    page.router.emit("onBeforeNavigate");
    page.router.state.matches = [];
    page.router.emit("onRendered");
    page.router.navigate("/feed/", page, 200_000);
    page.hide();
    expect(page.beacons).toEqual([]);
  });
});

describe("startVitalsReporter's stop", () => {
  it("lets go of the router and the page", () => {
    const page = start();
    page.stop();
    expect(page.router.listeners.get("onBeforeNavigate")?.size).toBe(0);
    expect(page.router.listeners.get("onRendered")?.size).toBe(0);
    expect(page.flushes).toEqual([]);
  });

  it("leaves web-vitals' callbacks inert", () => {
    const page = start();
    const [flush] = page.flushes;
    page.stop();
    page.report(cls("c1", 0.1));
    flush?.();
    expect(page.beacons).toEqual([]);
  });
});

describe("browserVitalsDeps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("observes the five web-vitals metrics, with attribution, once loaded", async () => {
    const report = vi.fn();
    browserVitalsDeps().observe(report);
    await vi.waitFor(() => {
      for (const on of [onLCP, onINP, onCLS, onFCP, onTTFB]) {
        expect(on).toHaveBeenCalledExactlyOnceWith(report);
      }
    });
  });

  it("leaves the page unmeasured when the library fails", async () => {
    vi.mocked(onLCP).mockImplementationOnce(() => {
      throw new Error("chunk failed to load");
    });
    const report = vi.fn();
    expect(() => {
      browserVitalsDeps().observe(report);
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(onLCP).toHaveBeenCalledWith(report);
    });
  });

  it("sends a beacon to the endpoint", () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon });
    browserVitalsDeps().send("{}");
    expect(sendBeacon).toHaveBeenCalledWith("/api/vitals", "{}");
  });

  it("flushes when the document is hidden, and not when it is shown", () => {
    let state: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => state,
    );
    const flush = vi.fn();
    const stop = browserVitalsDeps().onHidden(flush);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).not.toHaveBeenCalled();
    state = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(1);

    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("reads the width from the wide breakpoint's media query", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === WIDE_MEDIA_QUERY,
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    expect(browserVitalsDeps().isWide()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(WIDE_MEDIA_QUERY);
  });

  it("reads the clock from performance.now", () => {
    vi.spyOn(performance, "now").mockReturnValue(42.5);
    expect(browserVitalsDeps().now()).toBe(42.5);
  });
});

const source = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("what the reporter restates, pinned to its source", () => {
  it("the wide media query is the theme's wide breakpoint", () => {
    const width = /--breakpoint-wide:\s*(\d+px);/.exec(
      source("../../src/styles.css"),
    )?.[1];
    expect(WIDE_MEDIA_QUERY).toBe(`(min-width: ${String(width)})`);
  });

  it("the beacon's path is the endpoint's route", () => {
    expect(source("../../src/routes/api/vitals.ts")).toContain(
      `createFileRoute("${VITALS_PATH}")`,
    );
  });
});
