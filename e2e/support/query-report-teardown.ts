import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

import type { QueryBaseline } from "../../src/lib/query-report";
import {
  compareWithBaseline,
  parseQueryLines,
  queryBaselineSchema,
  renderQueryReport,
  summarize,
} from "../../src/lib/query-report";
import { QUERY_LINES_PATH } from "./query-record";

/**
 * Design 182, part 2: once the run is over, D1 queries per request, by
 * route, to the CI step summary and the console, compared with
 * `e2e/query-baseline.json`. `QUERY_RECORD=1` rewrites the baseline.
 *
 * Report-only: it never throws, so it never fails a run. A run whose
 * server counted nothing (the `preview` leg, built without the flag)
 * says so in one line and leaves the baseline alone.
 */

const BASELINE_PATH = "e2e/query-baseline.json";

function loadBaseline(): QueryBaseline {
  const parsed = queryBaselineSchema.safeParse(
    JSON.parse(readFileSync(BASELINE_PATH, "utf8")),
  );
  if (parsed.success) return parsed.data;
  console.log(`${BASELINE_PATH} does not parse; comparing with nothing`);
  return { routes: {} };
}

function report(): void {
  const lines = existsSync(QUERY_LINES_PATH)
    ? parseQueryLines(readFileSync(QUERY_LINES_PATH, "utf8"))
    : [];
  if (lines.length === 0) {
    console.log("D1 queries per request: no request carried a count");
    return;
  }
  const run = summarize(lines);
  const text = renderQueryReport(run, compareWithBaseline(run, loadBaseline()));
  console.log(text);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== "") appendFileSync(summary, text);
  if (process.env.QUERY_RECORD === "1") {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(run, undefined, 2)}\n`);
  }
}

export default function queryReportTeardown(): void {
  try {
    report();
  } catch (error) {
    console.log(`D1 query report failed: ${String(error)}`);
  }
}
