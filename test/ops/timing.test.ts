import { afterEach, describe, expect, it, vi } from "vitest";

import {
  requestNamer,
  timeRequest,
  timingDeps,
  type TimingDeps,
  type TimingLine,
} from "../../src/modules/ops/timing";

/**
A route tree in the shape `routeTree.gen.ts` leaves at runtime.
*/
const tree = {
  options: {},
  children: [
    { options: { id: "/" } },
    { options: { id: "/runs/$runId" } },
    { options: { id: "/desk" }, children: [{ options: { id: "/" } }] },
  ],
};

function nothing(): void {
  /*
   * A silenced console: the call is what the test reads.
   */
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestNamer", () => {
  it("names a page by its route id, never its URL", () => {
    const name = requestNamer(tree);
    expect(name("/runs/abc")).toBe("/runs/$runId");
    expect(name("/desk")).toBe("/desk/");
    expect(name("/")).toBe("/");
  });

  it("names a server function by its id", () => {
    expect(requestNamer(tree)("/_serverFn/abc123")).toBe("serverFn:abc123");
  });

  it("names every path no route covers alike", () => {
    const name = requestNamer(tree);
    expect(name("/wp-admin")).toBe("unmatched");
    expect(name("/runs/a/b")).toBe("unmatched");
    expect(name("/x/_serverFn/abc")).toBe("unmatched");
  });

  it("reads the tree only when first asked, and only once", () => {
    const report = vi.fn();
    const name = requestNamer({ children: "not routes" }, report);
    expect(report).not.toHaveBeenCalled();
    expect(name("/")).toBe("unmatched");
    expect(name("/runs/abc")).toBe("unmatched");
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("still names server functions when the tree cannot be read", () => {
    const report = vi.fn();
    expect(requestNamer(undefined, report)("/_serverFn/abc")).toBe(
      "serverFn:abc",
    );
    expect(report).not.toHaveBeenCalled();
  });

  it("reports an unreadable tree to Sentry by default, as the timing surface", () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    requestNamer(undefined)("/");
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
  tick: (ms: number) => void;
} {
  let now = 1000;
  const lines: TimingLine[] = [];
  return {
    name: requestNamer(tree),
    now: () => now,
    log: (line) => {
      lines.push(line);
    },
    lines,
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
    timingDeps(requestNamer(tree)).log(line);
    expect(log).toHaveBeenCalledWith(line);
  });

  it("reads the real clock in milliseconds", () => {
    vi.spyOn(Date, "now").mockReturnValue(123_456);
    expect(timingDeps(requestNamer(tree)).now()).toBe(123_456);
  });

  it("keeps the namer it was given", () => {
    const name = requestNamer(tree);
    expect(timingDeps(name).name).toBe(name);
  });
});
