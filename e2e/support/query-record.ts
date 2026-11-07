import { appendFileSync, mkdirSync } from "node:fs";

import { test as base } from "@playwright/test";
import type { Response } from "@playwright/test";

import { parseQueryHeader, QUERY_HEADER } from "../../src/lib/query-report";

/**
 * Design 182, part 2: every response that says what it asked D1 (the
 * `x-d1-queries` header a dev server started with `VITE_D1_QUERY_TALLY=1`
 * adds) becomes one line here; `query-report-teardown.ts` reads them once
 * the run is over. It rides under the a11y fixture, so every spec that
 * imports `test` from `a11y.ts` or `demo.ts` records.
 */

const QUERY_DIR = "test-results/queries";

export const QUERY_LINES_PATH = `${QUERY_DIR}/requests.jsonl`;

function recordResponse(response: Response): void {
  const line = parseQueryHeader(response.headers()[QUERY_HEADER]);
  if (line === undefined) return;
  appendFileSync(QUERY_LINES_PATH, `${JSON.stringify(line)}\n`);
}

export const test = base.extend<{ d1Queries: undefined }>({
  d1Queries: [
    async ({ context }, use) => {
      mkdirSync(QUERY_DIR, { recursive: true });
      // The context, not the page: a spec that opens a second page in it
      // is still recorded.
      context.on("response", recordResponse);
      await use(undefined);
      context.off("response", recordResponse);
    },
    { auto: true },
  ],
});
