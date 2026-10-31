import { describe, expect, it } from "vitest";
import { z } from "zod";

import grafanaJson from "../../docs/ops/grafana-vitals.json?raw";
import {
  DEVICE_WIDTHS,
  VITAL_METRIC_NAMES,
} from "../../src/lib/contracts/vitals";
import { serverDataPoint, toDataPoints } from "../../src/modules/ops/vitals";
import {
  DASHBOARD_PANELS,
  dailyRollupQuery,
  versionQuery,
} from "../../src/modules/ops/vitals-queries";

/**
 * The Grafana dashboard (design 165, step 9) is generated from
 * `DASHBOARD_PANELS` (`npm run generate:grafana`) and committed. This pins
 * the committed JSON to its source, and the queries to the layout
 * `vitals.ts` writes, so a dashboard cannot quietly chart the wrong blob.
 */

const ALTINITY = "vertamedia-clickhouse-datasource";

const datasourceSchema = z.object({ type: z.literal(ALTINITY) });

const inputSchema = z.object({ pluginId: z.literal(ALTINITY) });

const optionSchema = z.object({ value: z.string() });

const variableSchema = z.object({
  name: z.string(),
  options: z.array(optionSchema),
});

const targetSchema = z.object({
  datasource: datasourceSchema,
  format: z.string(),
  dateTimeColDataType: z.literal("timestamp"),
  query: z.string(),
});

const panelSchema = z.object({
  title: z.string(),
  datasource: datasourceSchema,
  targets: z.array(targetSchema).length(1),
});

const dashboardSchema = z.object({
  __inputs: z.array(inputSchema).length(1),
  templating: z.object({ list: z.array(variableSchema) }),
  panels: z.array(panelSchema),
});

const dashboard = dashboardSchema.parse(JSON.parse(grafanaJson));

describe("the committed Grafana dashboard", () => {
  it("has exactly the panels vitals-queries.ts defines, in order", () => {
    expect(
      dashboard.panels.map((panel) => ({
        title: panel.title,
        format: panel.targets[0]?.format,
        query: panel.targets[0]?.query,
      })),
    ).toStrictEqual(
      DASHBOARD_PANELS.map(({ title, format, query }) => ({
        title,
        format,
        query,
      })),
    );
  });

  it("offers every metric and device the beacon sends, and no other", () => {
    const options = new Map(
      dashboard.templating.list.map((variable) => [
        variable.name,
        variable.options.map((option) => option.value),
      ]),
    );
    expect(options).toStrictEqual(
      new Map([
        ["metric", [...VITAL_METRIC_NAMES]],
        ["device", [...DEVICE_WIDTHS]],
      ]),
    );
  });

  it("weights every figure by the sample interval, over the range shown", () => {
    for (const { query } of DASHBOARD_PANELS) {
      expect(query).toContain("_sample_interval");
      expect(query).toContain("FROM dialed_vitals");
      expect(query).toContain("WHERE $timeFilter");
    }
  });
});

describe("the queries read the layout vitals.ts writes", () => {
  it("blob1 the metric, blob3 the device or status class, blob4 the deploy, double1 the value", () => {
    const [browser] = toDataPoints(
      {
        route: "/closet/",
        navigationType: "navigate",
        device: "wide",
        metrics: [{ name: "LCP", value: 1200, parts: [1, 2, 3, 4] }],
      },
      "v9",
    );
    expect(browser?.indexes).toStrictEqual(["/closet/"]);
    expect(browser?.blobs?.[0]).toBe("LCP");
    expect(browser?.blobs?.[2]).toBe("wide");
    expect(browser?.blobs?.[3]).toBe("v9");
    expect(browser?.doubles?.[0]).toBe(1200);

    const server = serverDataPoint(
      { route: "/feed/", method: "GET", status: 503, ms: 80 },
      "v9",
    );
    expect(server.blobs?.[0]).toBe("server");
    expect(server.blobs?.[2]).toBe("5xx");
    expect(server.doubles?.[0]).toBe(80);

    for (const query of [dailyRollupQuery("2026-10-30"), versionQuery(0)]) {
      expect(query).toContain(
        "index1 AS route, blob1 AS metric, blob3 AS device",
      );
    }
    expect(versionQuery(0)).toContain("blob4 AS version");
    expect(DASHBOARD_PANELS[4].query).toContain("blob4 AS version");
  });
});
