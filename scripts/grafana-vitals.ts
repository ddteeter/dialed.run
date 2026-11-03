/**
 * Writes `docs/ops/grafana-vitals.json`, the Grafana dashboard over the
 * `VITALS` dataset (design 165), from the panels in
 * `src/modules/ops/vitals-queries.ts` and the beacon's own metric and
 * device lists. The JSON is committed and imported, never built by hand;
 * `test/ops/dashboards.test.ts` fails when it no longer matches.
 *
 * `npm run generate:grafana`.
 */
import { writeFileSync } from "node:fs";
import { DEVICE_WIDTHS, VITAL_METRIC_NAMES } from "../src/lib/contracts/vitals";
import { DASHBOARD_PANELS } from "../src/modules/ops/vitals-queries";

const datasource = {
  type: "vertamedia-clickhouse-datasource",
  uid: "${DS_VITALS}",
};
const variable = (name: string, options: readonly string[]) => ({
  name,
  label: name,
  type: "custom",
  query: options.join(","),
  current: { text: options[0], value: options[0] },
  options: options.map((value, index) => ({
    text: value,
    value,
    selected: index === 0,
  })),
});
const dashboard = {
  __inputs: [
    {
      name: "DS_VITALS",
      label: "Analytics Engine (dialed_vitals)",
      type: "datasource",
      pluginId: "vertamedia-clickhouse-datasource",
      pluginName: "Altinity plugin for ClickHouse",
    },
  ],
  title: "dialed.run speed",
  uid: "dialed-vitals",
  schemaVersion: 39,
  time: { from: "now-7d", to: "now" },
  templating: {
    list: [
      variable("metric", VITAL_METRIC_NAMES),
      variable("device", DEVICE_WIDTHS),
    ],
  },
  panels: DASHBOARD_PANELS.map((panel, index) => ({
    id: index + 1,
    title: panel.title,
    type: panel.format === "table" ? "table" : "timeseries",
    datasource,
    gridPos: { h: 9, w: 12, x: (index % 2) * 12, y: Math.floor(index / 2) * 9 },
    targets: [
      {
        refId: "A",
        datasource,
        format: panel.format,
        dateTimeType: "DATETIME",
        dateTimeColDataType: "timestamp",
        rawQuery: true,
        query: panel.query,
      },
    ],
  })),
};
writeFileSync(
  "docs/ops/grafana-vitals.json",
  JSON.stringify(dashboard, undefined, 2) + "\n",
);
