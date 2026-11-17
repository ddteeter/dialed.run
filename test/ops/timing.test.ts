import {
  type AnyRoute,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  knownRoutes,
  requestNamer,
  timedName,
  timeRequest,
  timingDeps,
  type TimingDeps,
  type TimingLine,
} from "../../src/modules/ops/timing";
import { env } from "../../src/env";

/**
 * A real TanStack router over a small tree with each kind of route the
 * app has: an index, a param, a literal beside it, a layout with an
 * index, a splat and a template segment. Built per call, inside each test.
 */
function testRouter() {
  const root = createRootRoute();
  const route = (path: string, parent: AnyRoute = root) =>
    createRoute({ getParentRoute: () => parent, path });
  const runs = route("runs");
  const desk = route("desk");
  const tree = root.addChildren([
    route("/"),
    runs.addChildren([route("$runId", runs), route("backlog", runs)]),
    desk.addChildren([route("/", desk)]),
    route("photo/$"),
    route("@{$handle}"),
  ]);
  return createRouter({ routeTree: tree });
}

function nothing(): void {
  /*
   * A silenced console: the call is what the test reads.
   */
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestNamer", () => {
  it("names a page by the route TanStack matches, never its URL", () => {
    const name = requestNamer(() => testRouter());
    expect(name("/")).toBe("/");
    expect(name("/runs/abc")).toBe("/runs/$runId");
    expect(name("/runs/backlog")).toBe("/runs/backlog");
    expect(name("/desk")).toBe("/desk/");
    expect(name("/desk/")).toBe("/desk/");
    expect(name("/photo/a/b.webp")).toBe("/photo/$");
    expect(name("/@ana")).toBe("/@{$handle}");
  });

  it("names a server function by its id", () => {
    expect(requestNamer(() => testRouter())("/_serverFn/abc123")).toBe(
      "serverFn:abc123",
    );
  });

  it("names every path no route covers alike", () => {
    const name = requestNamer(() => testRouter());
    expect(name("/wp-admin")).toBe("unmatched");
    expect(name("/x/_serverFn/abc")).toBe("unmatched");
  });

  it("names a path too deep for its route by the route TanStack serves its not-found under", () => {
    // The 404 status in the same line keeps it apart from the screen's
    // real loads, and the checks judge 2xx only.
    expect(requestNamer(() => testRouter())("/runs/a/b")).toBe("/runs/$runId");
  });

  it("builds the router only when first asked, and only once", () => {
    const makeRouter = vi.fn(() => testRouter());
    const name = requestNamer(makeRouter);
    expect(makeRouter).not.toHaveBeenCalled();
    expect(name("/runs/abc")).toBe("/runs/$runId");
    expect(name("/")).toBe("/");
    expect(makeRouter).toHaveBeenCalledTimes(1);
  });

  it("reports a router that will not build, once, and names every page unmatched", () => {
    const report = vi.fn();
    const broken = new Error("no tree");
    const name = requestNamer(() => {
      throw broken;
    }, report);
    expect(report).not.toHaveBeenCalled();
    expect(name("/")).toBe("unmatched");
    expect(name("/runs/abc")).toBe("unmatched");
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(broken);
  });

  it("still names server functions when the router will not build", () => {
    const report = vi.fn();
    const name = requestNamer(() => {
      throw new Error("no tree");
    }, report);
    expect(name("/_serverFn/abc")).toBe("serverFn:abc");
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a router that will not build to Sentry by default, as the timing surface", () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    requestNamer(() => {
      throw new Error("no tree");
    })("/");
    expect(error).toHaveBeenCalledWith(
      "[sentry-disabled]",
      { surface: "timing" },
      expect.any(Error),
    );
  });
});

/**
 * A clock that moves only when told, and a log that keeps its lines.
 */
function fakeDeps(): TimingDeps & {
  lines: TimingLine[];
  recorded: TimingLine[];
  tick: (ms: number) => void;
} {
  let now = 1000;
  const lines: TimingLine[] = [];
  const recorded: TimingLine[] = [];
  return {
    name: requestNamer(() => testRouter()),
    now: () => now,
    log: (line) => {
      lines.push(line);
    },
    record: (line) => {
      recorded.push(line);
    },
    lines,
    recorded,
    tick: (ms) => {
      now += ms;
    },
  };
}

describe("timeRequest", () => {
  it("logs the route, method, status and the time until the response existed", async () => {
    const deps = fakeDeps();
    const response = new Response("ok", { status: 201 });
    const result = await timeRequest(
      new Request("https://dialed.run/runs/abc?x=1", { method: "POST" }),
      () => {
        deps.tick(42);
        return Promise.resolve(response);
      },
      deps,
    );
    expect(result).toBe(response);
    expect(deps.lines).toEqual([
      {
        kind: "timing",
        route: "/runs/$runId",
        method: "POST",
        status: 201,
        ms: 42,
      },
    ]);
    expect(deps.recorded).toEqual(deps.lines);
  });

  it("logs a request that throws as a 500 and lets the error through", async () => {
    const deps = fakeDeps();
    const failure = new Error("boom");
    await expect(
      timeRequest(
        new Request("https://dialed.run/"),
        () => {
          deps.tick(7);
          return Promise.reject(failure);
        },
        deps,
      ),
    ).rejects.toBe(failure);
    expect(deps.lines).toEqual([
      { kind: "timing", route: "/", method: "GET", status: 500, ms: 7 },
    ]);
    expect(deps.recorded).toEqual(deps.lines);
  });
});

describe("timingDeps", () => {
  it("logs the line as an object, which Workers Logs indexes field by field", () => {
    const log = vi.spyOn(console, "log").mockImplementation(nothing);
    const line: TimingLine = {
      kind: "timing",
      route: "/",
      method: "GET",
      status: 200,
      ms: 3,
    };
    timingDeps(requestNamer(() => testRouter())).log(line);
    expect(log).toHaveBeenCalledWith(line);
  });

  it("reads the real clock in milliseconds", () => {
    vi.spyOn(Date, "now").mockReturnValue(123_456);
    expect(timingDeps(requestNamer(() => testRouter())).now()).toBe(123_456);
  });

  it("records the line in the dataset, stamped with the deploy", () => {
    const write = vi.spyOn(env.VITALS, "writeDataPoint");
    timingDeps(requestNamer(() => testRouter())).record({
      kind: "timing",
      route: "/runs/$runId",
      method: "GET",
      status: 200,
      ms: 12,
    });
    expect(write).toHaveBeenCalledWith({
      indexes: ["/runs/$runId"],
      blobs: ["server", "GET", "2xx", env.CF_VERSION_METADATA.id],
      doubles: [12],
    });
  });

  it("keeps the namer it was given", () => {
    const name = requestNamer(() => testRouter());
    expect(timingDeps(name).name).toBe(name);
  });
});

describe("timedName (SA-L08)", () => {
  it.each([200, 204, 299])("keeps a server function's id when it answered %i", (status) => {
    expect(timedName("serverFn:abc", status)).toBe("serverFn:abc");
  });

  it.each([199, 300, 404, 500])(
    "names a server function that answered %i alike",
    (status) => {
      expect(timedName("serverFn:abc", status)).toBe("serverFn:failed");
    },
  );

  it("leaves a page's name alone whatever it answered", () => {
    expect(timedName("/runs/$runId", 500)).toBe("/runs/$runId");
    expect(timedName("unmatched", 404)).toBe("unmatched");
  });

  it("is the name timeRequest records", async () => {
    const deps = fakeDeps();
    await timeRequest(
      new Request("https://dialed.run/_serverFn/never-registered"),
      () => Promise.resolve(new Response("", { status: 500 })),
      deps,
    );
    expect(deps.lines.map((line) => line.route)).toStrictEqual([
      "serverFn:failed",
    ]);
  });
});

describe("knownRoutes (SA-M34)", () => {
  it("knows the tree's routes, server functions and unmatched, and nothing else", () => {
    const isKnown = knownRoutes(() => testRouter());
    expect(isKnown("/runs/$runId")).toBe(true);
    expect(isKnown("/desk/")).toBe(true);
    expect(isKnown("serverFn:abc")).toBe(true);
    expect(isKnown("unmatched")).toBe(true);
    expect(isKnown("/x/0001")).toBe(false);
    expect(isKnown("/runs/abc")).toBe(false);
    expect(isKnown("toString")).toBe(false);
  });

  it("builds the router on the first question, and once", () => {
    const makeRouter = vi.fn(() => testRouter());
    const isKnown = knownRoutes(makeRouter);
    expect(makeRouter).not.toHaveBeenCalled();
    isKnown("/");
    isKnown("/x");
    expect(makeRouter).toHaveBeenCalledTimes(1);
  });

  it("keeps every name, and reports once, when the router will not build", () => {
    const failure = new Error("no tree");
    const report = vi.fn();
    const isKnown = knownRoutes(() => {
      throw failure;
    }, report);
    expect(isKnown("/x/0001")).toBe(true);
    expect(isKnown("/y")).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(failure);
  });
});

describe("knownRoutes' default report", () => {
  it("goes to Sentry, as the timing surface", () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    knownRoutes(() => {
      throw new Error("no tree");
    })("/");
    expect(error).toHaveBeenCalledWith(
      "[sentry-disabled]",
      { surface: "timing" },
      expect.any(Error),
    );
  });
});
