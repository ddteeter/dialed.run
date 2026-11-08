import { describe, expect, it } from "vitest";

import type { QueryBaseline, QueryLine } from "../../src/lib/query-report";
import {
  compareWithBaseline,
  formatQueryHeader,
  parseQueryHeader,
  parseQueryLines,
  QUERY_HEADER,
  queryBaselineSchema,
  readableRoute,
  renderQueryReport,
  SERVER_FN_ROUTE,
  summarize,
} from "../../src/lib/query-report";

const line = (
  route: string,
  statements: number,
  rowsRead: number,
): QueryLine => ({ route, statements, rowsRead });

describe("the header", () => {
  it("is named x-d1-queries", () => {
    expect(QUERY_HEADER).toBe("x-d1-queries");
  });

  it("formats as route;statements;rowsRead", () => {
    expect(formatQueryHeader(line("/closet/", 3, 41))).toBe("/closet/;3;41");
  });

  it("round-trips", () => {
    const sent = line("serverFn:abc_def", 10, 12);
    expect(parseQueryHeader(formatQueryHeader(sent))).toEqual(sent);
  });

  it("takes the route as everything before the last two fields", () => {
    expect(parseQueryHeader("/a;b;2;3")).toEqual(line("/a;b", 2, 3));
  });

  it("refuses anything else", () => {
    expect(parseQueryHeader(undefined)).toBeUndefined();
    expect(parseQueryHeader(42)).toBeUndefined();
    expect(parseQueryHeader("")).toBeUndefined();
    expect(parseQueryHeader(";1;2")).toBeUndefined();
    expect(parseQueryHeader("/a;1")).toBeUndefined();
    expect(parseQueryHeader("/a;1;2x")).toBeUndefined();
    expect(parseQueryHeader("/a;x1;2")).toBeUndefined();
    expect(parseQueryHeader("/a;-1;2")).toBeUndefined();
    expect(parseQueryHeader("x/a;1;2\n")).toBeUndefined();
    expect(parseQueryHeader("\n/a;1;2")).toBeUndefined();
    expect(parseQueryHeader(`/a;1;${"9".repeat(400)}`)).toBeUndefined();
    expect(parseQueryHeader("/a;;2")).toBeUndefined();
    expect(parseQueryHeader("/a;1;")).toBeUndefined();
    expect(parseQueryHeader("/a;1.5;2")).toBeUndefined();
    expect(parseQueryHeader("/a;1e3;2")).toBeUndefined();
    expect(parseQueryHeader("/a;1;2;")).toBeUndefined();
    expect(parseQueryHeader("/a; 1;2")).toBeUndefined();
    expect(parseQueryHeader("/a;1;2 ")).toBeUndefined();
  });

  it("caps the value at 1024 characters", () => {
    const route = `/${"a".repeat(1019)}`;
    expect(parseQueryHeader(`${route};1;2`)).toEqual(line(route, 1, 2));
    expect(parseQueryHeader(`${route}a;1;2`)).toBeUndefined();
  });
});

/**
A dev server's id for a function: base64url of its file and export.
*/
function devId(file: string, exported: string): string {
  return btoa(JSON.stringify({ file, export: exported }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const serverFn = (file: string, exported: string): string =>
  `serverFn:${devId(file, exported)}`;

describe("readableRoute", () => {
  it("marks a server function with serverFn:", () => {
    expect(SERVER_FN_ROUTE).toBe("serverFn:");
  });

  it("names a module's server function by module and export", () => {
    expect(
      readableRoute(
        serverFn(
          "/src/modules/notifications/functions.ts?tss-serverfn-split",
          "bellStateFn_createServerFn_handler",
        ),
      ),
    ).toBe("serverFn:notifications/bellStateFn");
  });

  it("decodes the id TanStack's dev server sends, - and _ included", () => {
    // The e2e run's id for safety's fileReportAction: `_` stands for `/`.
    expect(
      readableRoute(
        "serverFn:eyJmaWxlIjoiL3NyYy9tb2R1bGVzL3NhZmV0eS9mdW5jdGlvbnMudHM_dHNzLXNlcnZlcmZuLXNwbGl0IiwiZXhwb3J0IjoiZmlsZVJlcG9ydEFjdGlvbl9jcmVhdGVTZXJ2ZXJGbl9oYW5kbGVyIn0",
      ),
    ).toBe("serverFn:safety/fileReportAction");
    const plus = devId("/src/modules/runs/functions.ts", "a>>b");
    expect(plus).toContain("-");
    expect(readableRoute(`serverFn:${plus}`)).toBe("serverFn:runs/a>>b");
  });

  it("names a module's functions.ts with no query string too", () => {
    expect(
      readableRoute(serverFn("/src/modules/runs/functions.ts", "list")),
    ).toBe("serverFn:runs/list");
  });

  it.each([
    "/src/modules/runs/import.ts?tss-serverfn-split",
    "/app/src/modules/runs/functions.ts",
    "/src/modules/runs/functions.tsx",
    "/src/modules/runs/deep/functions.ts",
    "/src/modules//functions.ts",
  ])(
    "keeps the whole file when it is not a module's functions.ts: %s",
    (file) => {
      expect(readableRoute(serverFn(file, "go"))).toBe(`serverFn:${file}/go`);
    },
  );

  it("drops only a trailing _createServerFn_handler", () => {
    expect(
      readableRoute(
        serverFn(
          "/src/modules/runs/functions.ts",
          "a_createServerFn_handler_b",
        ),
      ),
    ).toBe("serverFn:runs/a_createServerFn_handler_b");
  });

  it.each([
    ["a route id", "/closet/"],
    ["unmatched", "unmatched"],
    ["a name with serverFn: inside", "/x/serverFn:abc"],
    ["an id that is not base64", "serverFn:%%%"],
    ["an id that is not JSON", `serverFn:${btoa("not json")}`],
    [
      "an id of the wrong shape",
      `serverFn:${btoa(JSON.stringify({ file: "/a" }))}`,
    ],
    ["a production hash", "serverFn:3f9a1c0d2b"],
    // As long as `serverFn:`, so only the prefix check keeps it.
    [
      "a path that ends in a dev id",
      `/feed/me/${devId("/src/modules/runs/functions.ts", "list")}`,
    ],
  ])("keeps %s as it came", (_label, route) => {
    expect(readableRoute(route)).toBe(route);
  });
});

describe("parseQueryLines", () => {
  it("reads each line, skipping a torn or foreign one", () => {
    const text = [
      JSON.stringify(line("/a", 1, 2)),
      '{"route":"/b","statem',
      JSON.stringify({ ...line("/c", 1, 2), extra: true }),
      JSON.stringify(line("", 1, 2)),
      JSON.stringify(line("/d", 1.5, 2)),
      JSON.stringify(line("/e", 1, -1)),
      JSON.stringify(line("/g", -1, 1)),
      JSON.stringify(line("/h", 1, 2.5)),
      JSON.stringify(line("/f", 0, 0)),
      "",
    ].join("\n");
    expect(parseQueryLines(text)).toEqual([line("/a", 1, 2), line("/f", 0, 0)]);
  });
});

describe("summarize", () => {
  it("groups by route, sorted, with count and nearest-rank p50 and max", () => {
    const run = summarize([
      line("/b", 5, 50),
      line("/a", 3, 9),
      line("/b", 1, 10),
      line("/b", 4, 30),
      line("/a", 2, 7),
    ]);
    expect(Object.keys(run.routes)).toEqual(["/a", "/b"]);
    expect(run).toEqual({
      routes: {
        "/a": {
          count: 2,
          statements: { p50: 2, max: 3 },
          rowsRead: { p50: 7, max: 9 },
        },
        "/b": {
          count: 3,
          statements: { p50: 4, max: 5 },
          rowsRead: { p50: 30, max: 50 },
        },
      },
    });
  });

  it("sorts numbers as numbers", () => {
    const run = summarize([
      line("/a", 10, 1),
      line("/a", 9, 1),
      line("/a", 2, 1),
    ]);
    expect(run.routes["/a"]?.statements).toEqual({ p50: 9, max: 10 });
  });

  it("is a baseline the schema accepts", () => {
    const run = summarize([line("/a", 1, 1)]);
    expect(queryBaselineSchema.parse(run)).toEqual(run);
  });

  it("refuses a baseline no run could have written", () => {
    const valid = summarize([line("/a", 1, 1)]).routes["/a"];
    const bad = [
      { ...valid, count: 0 },
      { ...valid, count: 1.5 },
      { ...valid, statements: { p50: -1, max: 1 } },
      { ...valid, rowsRead: { p50: 0, max: -1 } },
      { ...valid, extra: 1 },
    ];
    for (const route of bad) {
      expect(
        queryBaselineSchema.safeParse({ routes: { "/a": route } }).success,
      ).toBe(false);
    }
    expect(
      queryBaselineSchema.safeParse({ routes: {}, extra: 1 }).success,
    ).toBe(false);
  });

  it("keys a server function by its readable name, merging its calls", () => {
    const id = serverFn("/src/modules/runs/functions.ts", "list");
    const { routes } = summarize([line(id, 1, 1), line(id, 3, 3)]);
    expect(Object.keys(routes)).toEqual(["serverFn:runs/list"]);
    expect(routes["serverFn:runs/list"]?.count).toBe(2);
  });

  it("summarizes nothing as no routes", () => {
    expect(summarize([])).toEqual({ routes: {} });
  });
});

const summary = (p50: number, max: number) => ({
  count: 1,
  statements: { p50, max },
  rowsRead: { p50: 0, max: 0 },
});

describe("compareWithBaseline", () => {
  const baseline: QueryBaseline = {
    routes: {
      "/same": summary(2, 3),
      "/p50": summary(2, 3),
      "/max": summary(2, 3),
      "/fell": summary(2, 3),
      "/gone": summary(1, 1),
    },
  };

  it("lists rises, new routes and gone ones", () => {
    const run: QueryBaseline = {
      routes: {
        "/same": summary(2, 3),
        "/p50": summary(3, 3),
        "/max": summary(2, 4),
        "/fell": summary(1, 2),
        "/new": summary(1, 1),
      },
    };
    expect(compareWithBaseline(run, baseline)).toEqual({
      rose: [
        { route: "/p50", was: { p50: 2, max: 3 }, now: { p50: 3, max: 3 } },
        { route: "/max", was: { p50: 2, max: 3 }, now: { p50: 2, max: 4 } },
      ],
      added: ["/new"],
      gone: ["/gone"],
    });
  });

  it("reports every route as new against an empty baseline", () => {
    const run: QueryBaseline = { routes: { "/a": summary(1, 1) } };
    expect(compareWithBaseline(run, { routes: {} })).toEqual({
      rose: [],
      added: ["/a"],
      gone: [],
    });
  });
});

describe("renderQueryReport", () => {
  it("renders the table and what moved", () => {
    const run: QueryBaseline = {
      routes: {
        "/a|b": {
          count: 4,
          statements: { p50: 2, max: 5 },
          rowsRead: { p50: 10, max: 40 },
        },
      },
    };
    const text = renderQueryReport(run, {
      rose: [{ route: "/r", was: { p50: 1, max: 2 }, now: { p50: 3, max: 4 } }],
      added: ["/n"],
      gone: ["/g"],
    });
    expect(text).toBe(
      [
        "### D1 queries per request",
        "",
        "| route | requests | statements p50 / max | rows read p50 / max |",
        "| --- | --- | --- | --- |",
        String.raw`| ${"`"}/a\|b${"`"} | 4 | 2 / 5 | 10 / 40 |`,
        "",
        "Statements rose against e2e/query-baseline.json:",
        "- `/r`: 1 / 2 → 3 / 4",
        "",
        "New since the baseline:",
        "- `/n`",
        "",
        "Gone since the baseline:",
        "- `/g`",
        "",
      ].join("\n"),
    );
  });

  it("says so when no request was counted, and lists nothing unmoved", () => {
    expect(
      renderQueryReport({ routes: {} }, { rose: [], added: [], gone: [] }),
    ).toBe(
      [
        "### D1 queries per request",
        "",
        "No request carried a query count.",
        "",
      ].join("\n"),
    );
  });
});
