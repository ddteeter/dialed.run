# Performance dashboards (design 165)

Two dashboards, set up once by the owner after the first deploy
(`docs/deployment.md` §8). Both read only what design 165 records: route
ids, never URLs, and no account, IP or user agent.

## Grafana: speed over the last three months (`VITALS`)

Grafana Cloud's free tier is enough. The dashboard is generated, not drawn:
`docs/ops/grafana-vitals.json`, from the panels in
`src/modules/ops/vitals-queries.ts` (`npm run generate:grafana`).
`test/ops/dashboards.test.ts` fails if the two disagree.

1. Make a second API token for Grafana: Account › Account Analytics ›
   Read, nothing else. Not the Worker's `ANALYTICS_SQL_TOKEN`, so either
   can be revoked alone.
2. Install the **Altinity plugin for ClickHouse**
   (`vertamedia-clickhouse-datasource`), the one Cloudflare's Analytics
   Engine guide recommends.
3. Add a data source with it:
   - URL: `https://api.cloudflare.com/client/v4/accounts/<account_id>/analytics_engine/sql`
   - every auth setting off;
   - a custom header `Authorization` with the value `Bearer <token>`.
4. Dashboards › New › Import, upload `docs/ops/grafana-vitals.json`, and
   pick the data source when asked (`DS_VITALS`).

The `metric` and `device` variables choose what the browser panels show.
The panels:

| panel                     | what it shows                                                                 |
| ------------------------- | ----------------------------------------------------------------------------- |
| p75 by route              | the chosen metric's p75 per screen over time                                  |
| Samples by route          | how many measurements stand behind each line, so a thin line reads as one     |
| Server p95 by route (2xx) | time to first byte of successful responses, per screen                        |
| Server 5xx by route       | server errors per screen                                                      |
| p75 by deploy             | the chosen metric per screen and deploy over the range shown, for regressions |

Every figure is weighted by `_sample_interval`, because Analytics Engine
samples at volume. A query added by hand must do the same: a count is
`sum(_sample_interval)`, a percentile `quantileExactWeighted(q)(double1,
_sample_interval)`.

## Cloudflare: server timing over the last seven days (Workers Logs)

A Custom Dashboard named **Performance**, built from saved Query Builder
queries over the one JSON line `server.ts` logs per request:
`{kind: "timing", route, method, status, ms}`. Workers Logs keeps seven
days; the `VITALS` dataset and `perf_daily` keep the longer view.

In Workers & Pages › the Worker › Observability › Query Builder, save:

| saved query         | filter                              | calculation | group by |
| ------------------- | ----------------------------------- | ----------- | -------- |
| Server p50 by route | `kind = timing`                     | P50 of `ms` | `route`  |
| Server p95 by route | `kind = timing`                     | P95 of `ms` | `route`  |
| 5xx by route        | `kind = timing` and `status >= 500` | Count       | `route`  |
| Beacons refused     | `kind = vitals-refused`             | Count       | `reason` |

Then Observability › Dashboards › Create, name it **Performance**, and add
each saved query as a chart. "Beacons refused" is how a flood or a broken
client shows up: `cross-site` and `too-large` climbing is a probe,
`invalid` climbing after a deploy is our own client sending something the
endpoint no longer accepts.
